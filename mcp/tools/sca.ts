import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { generateIPA } from "../../src/core/engines/ipaGenerator";
import {
  applySoundChanges,
  buildMacrosFromInventory,
  findMatchingPhonemes,
  parseFeatureExpression,
  SCA_BOUNDARY_FEATURE,
} from "../../src/core/engines/scaEngine";
import {
  type ParsedSCARuleInput,
  parseSCARulesText,
  serializeSCARuleSetForImport,
} from "../../src/core/engines/scaImportParser";
import { newPrefixedId } from "../../src/core/lexicon/ids";
import { NATURAL_PAIRS, PHONEME_FEATURES } from "../../src/data/ipa_features";
import type {
  FeatureExpression,
  FeatureReplacement,
  PhonologyConfig,
  SCAConfig,
  SCARule,
  SCARuleSet,
  SCAStepLog,
  WordEntry,
} from "../../src/types";
import { assertWriteAllowed, type McpConfig } from "../config";
import { McpError } from "../errors";
import {
  assertSafeRelativeLanguagePath,
  resolveLanguage,
} from "../registry/addressing";
import {
  readLexiconUnlocked,
  readPhonologyUnlocked,
  readScaUnlocked,
  readWorkspaceUnlocked,
  withConsistentProjectRead,
} from "../storage/read";
import { computeFileRevision } from "../storage/revision";
import {
  markSessionScopeWritten,
  planLanguageSnapshot,
  shouldAutoSnapshot,
} from "../storage/snapshot";
import {
  executeProjectTransaction,
  type PlannedMutation,
  type RevisionExpectation,
} from "../storage/transaction";
import { registerDefinedTool } from "../toolRegistry";
import { computeStructuralDiff } from "../util/diff";
import {
  commonWriteInputFields,
  familyInputFields,
  languageInputFields,
  normalizeRelPathPosix,
  resolveFamilyFromArgs,
  resolveLanguageUnlocked,
} from "./_helpers";

const MAX_SIMULATE_WORDS = 500;

const featureExpressionSchema = z
  .object({
    positive: z.array(z.string()).default([]),
    negative: z.array(z.string()).default([]),
  })
  .passthrough();

const featureReplacementSchema = z
  .object({
    set_features: z.array(z.string()).default([]),
    remove_features: z.array(z.string()).default([]),
  })
  .passthrough();

const scaRuleInputSchema = z
  .object({
    rule_id: z.string().optional(),
    description: z.string().optional(),
    target: z.string().optional(),
    replacement: z.string().optional(),
    context_before: z.string().optional(),
    context_after: z.string().optional(),
    exceptions: z.array(z.string()).optional(),
    feature_mode: z.boolean().optional(),
    target_features: featureExpressionSchema.nullable().optional(),
    replacement_features: featureReplacementSchema.nullable().optional(),
    context_before_features: featureExpressionSchema.nullable().optional(),
    context_after_features: featureExpressionSchema.nullable().optional(),
  })
  .passthrough();

const scaRuleSetInputSchema = z
  .object({
    ruleset_id: z.string().optional(),
    name: z.string().min(1),
    order: z.number().int().optional(),
    rules: z.array(scaRuleInputSchema).default([]),
  })
  .passthrough();

type ScaRuleInput = z.infer<typeof scaRuleInputSchema>;
type ScaRuleSetInput = z.infer<typeof scaRuleSetInputSchema>;

function decodeBoundaryFeature(feat: string): string {
  return feat === SCA_BOUNDARY_FEATURE ? "#" : feat;
}

function encodeBoundaryFeature(feat: string): string {
  return feat === "#" ? SCA_BOUNDARY_FEATURE : feat;
}

function formatFeatureExprHuman(expr: FeatureExpression | null): string {
  if (!expr) return "";
  const plus = expr.positive.map((f) => `+${decodeBoundaryFeature(f)}`);
  const minus = expr.negative.map((f) => `-${decodeBoundaryFeature(f)}`);
  const parts = [...plus, ...minus];
  return parts.length > 0 ? `[${parts.join(", ")}]` : "";
}

function formatFeatureReplHuman(repl: FeatureReplacement | null): string {
  if (!repl) return "";
  const plus = repl.set_features.map((f) => `+${decodeBoundaryFeature(f)}`);
  const minus = repl.remove_features.map((f) => `-${decodeBoundaryFeature(f)}`);
  return [...plus, ...minus].join(", ");
}

function formatRuleArrowLine(rule: SCARule): string {
  const desc = (rule.description || "").trim();
  const exceptions = (rule.exceptions || [])
    .map((e) => e.trim())
    .filter(Boolean);

  if (rule.feature_mode) {
    // Feature-mode rules use `@feature` delimited syntax so `parseSCARulesText` round-trips losslessly
    return [
      desc.replace(/\|/g, "/"),
      "@feature",
      formatFeatureExprHuman(rule.target_features),
      formatFeatureReplHuman(rule.replacement_features),
      formatFeatureExprHuman(rule.context_before_features),
      formatFeatureExprHuman(rule.context_after_features),
      exceptions.join(", "),
    ].join(" | ");
  }

  const cleanDesc = desc.replace(/[:：]/g, " -");
  const lhs = cleanDesc ? `${cleanDesc}: ${rule.target}` : rule.target;
  const before = (rule.context_before || "").trim();
  const after = (rule.context_after || "").trim();
  let line = `${lhs} > ${rule.replacement}`;
  if (before || after) {
    line += ` / ${before}_${after}`;
  }
  if (exceptions.length > 0) {
    line += ` ! ${exceptions.join(", ")}`;
  }
  return line;
}

function normalizeFeatureExpr(
  raw: z.infer<typeof featureExpressionSchema> | null | undefined,
): FeatureExpression | null {
  if (!raw) return null;
  const { positive, negative, ...rest } = raw;
  return {
    ...rest,
    positive: positive.map((f) => encodeBoundaryFeature(f.trim())).filter(Boolean),
    negative: negative.map((f) => encodeBoundaryFeature(f.trim())).filter(Boolean),
  };
}

function normalizeFeatureRepl(
  raw: z.infer<typeof featureReplacementSchema> | null | undefined,
): FeatureReplacement | null {
  if (!raw) return null;
  const { set_features, remove_features, ...rest } = raw;
  return {
    ...rest,
    set_features: set_features
      .map((f) => encodeBoundaryFeature(f.trim()))
      .filter(Boolean),
    remove_features: remove_features
      .map((f) => encodeBoundaryFeature(f.trim()))
      .filter(Boolean),
  };
}

function buildRulePreservingUnknown(
  input: ScaRuleInput,
  existingById: Map<string, Record<string, unknown>>,
): SCARule {
  const ruleId = input.rule_id?.trim() || newPrefixedId("sca_rule");
  const prev = existingById.get(ruleId) ?? {};
  const featureMode =
    input.feature_mode !== undefined
      ? input.feature_mode
      : Boolean(prev.feature_mode);

  const target =
    input.target !== undefined
      ? input.target.trim()
      : typeof prev.target === "string"
        ? prev.target
        : "";
  const replacement =
    input.replacement !== undefined
      ? input.replacement.trim()
      : typeof prev.replacement === "string"
        ? prev.replacement
        : "";

  const targetFeatures =
    input.target_features !== undefined
      ? normalizeFeatureExpr(input.target_features)
      : prev.target_features && typeof prev.target_features === "object"
        ? (prev.target_features as FeatureExpression)
        : null;
  const replacementFeatures =
    input.replacement_features !== undefined
      ? normalizeFeatureRepl(input.replacement_features)
      : prev.replacement_features && typeof prev.replacement_features === "object"
        ? (prev.replacement_features as FeatureReplacement)
        : null;
  const contextBeforeFeatures =
    input.context_before_features !== undefined
      ? normalizeFeatureExpr(input.context_before_features)
      : prev.context_before_features &&
          typeof prev.context_before_features === "object"
        ? (prev.context_before_features as FeatureExpression)
        : null;
  const contextAfterFeatures =
    input.context_after_features !== undefined
      ? normalizeFeatureExpr(input.context_after_features)
      : prev.context_after_features &&
          typeof prev.context_after_features === "object"
        ? (prev.context_after_features as FeatureExpression)
        : null;

  if (!featureMode && (!target || !replacement)) {
    throw new McpError(
      "VALIDATION",
      `SCA rule "${ruleId}" in character mode requires non-empty "target" and "replacement".`,
    );
  }
  if (featureMode && (!targetFeatures || !replacementFeatures)) {
    throw new McpError(
      "VALIDATION",
      `SCA rule "${ruleId}" in feature_mode requires non-null "target_features" and "replacement_features".`,
    );
  }

  const {
    rule_id: _rid,
    description,
    target: _t,
    replacement: _r,
    context_before,
    context_after,
    exceptions,
    feature_mode: _fm,
    target_features: _tf,
    replacement_features: _rf,
    context_before_features: _cbf,
    context_after_features: _caf,
    ...extraInput
  } = input;

  const merged: Record<string, unknown> = {
    ...prev,
    ...extraInput,
    rule_id: ruleId,
    description:
      description !== undefined
        ? description
        : typeof prev.description === "string"
          ? prev.description
          : "",
    target,
    replacement,
    context_before:
      context_before !== undefined
        ? context_before
        : typeof prev.context_before === "string"
          ? prev.context_before
          : "",
    context_after:
      context_after !== undefined
        ? context_after
        : typeof prev.context_after === "string"
          ? prev.context_after
          : "",
    exceptions:
      exceptions !== undefined
        ? exceptions
        : Array.isArray(prev.exceptions)
          ? (prev.exceptions as string[])
          : [],
    feature_mode: featureMode,
    target_features: targetFeatures,
    replacement_features: replacementFeatures,
    context_before_features: contextBeforeFeatures,
    context_after_features: contextAfterFeatures,
  };

  return merged as unknown as SCARule;
}

function buildRuleSetPreservingUnknown(
  input: ScaRuleSetInput,
  fallbackOrder: number,
  existingRuleSetsById: Map<string, Record<string, unknown>>,
  existingRulesById: Map<string, Record<string, unknown>>,
): SCARuleSet {
  const rulesetId = input.ruleset_id?.trim() || newPrefixedId("ruleset");
  const prevSet = existingRuleSetsById.get(rulesetId) ?? {};
  const { ruleset_id: _id, name, order, rules, ...extraSet } = input;

  const builtRules = rules.map((r) =>
    buildRulePreservingUnknown(r, existingRulesById),
  );

  const mergedSet: Record<string, unknown> = {
    ...prevSet,
    ...extraSet,
    ruleset_id: rulesetId,
    name: name.trim(),
    order:
      order !== undefined
        ? order
        : typeof prevSet.order === "number"
          ? prevSet.order
          : fallbackOrder,
    rules: builtRules,
  };

  return mergedSet as unknown as SCARuleSet;
}

function parsedRuleToScaRule(parsed: ParsedSCARuleInput): SCARule {
  return {
    rule_id: newPrefixedId("sca_rule"),
    description: parsed.description,
    target: parsed.target,
    replacement: parsed.replacement,
    context_before: parsed.context_before,
    context_after: parsed.context_after,
    exceptions: parsed.exceptions,
    feature_mode: parsed.feature_mode,
    target_features: parsed.target_features,
    replacement_features: parsed.replacement_features,
    context_before_features: parsed.context_before_features,
    context_after_features: parsed.context_after_features,
  };
}

function resolveWordIpaForSca(
  word: WordEntry,
  phono: PhonologyConfig | null,
): string {
  const cleanedStored = (word.phonetic_ipa || "")
    .trim()
    .replace(/^[/[]+|[\/\]]+$/g, "");
  if (cleanedStored) {
    return cleanedStored;
  }
  if (phono) {
    const gen = generateIPA(word.con_word_romanized, phono);
    if (gen.phonemic) return gen.phonemic;
  }
  return word.con_word_romanized;
}

export function registerScaTools(server: McpServer, config: McpConfig): void {
  // ── 1. sca_get ───────────────────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "sca_get",
    title: "Get SCA Rules",
    description:
      "Return the language's Sound Change Applier (SCA) rule sets and rules (character and feature modes) with file revision.",
    toolsets: ["core", "evolution"],
    access: "read",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      return await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "sca_get",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const sca = readScaUnlocked(family.project_dir, resolved.language);
          const orderedSets = [...sca.config.rule_sets].sort(
            (a, b) => a.order - b.order,
          );
          const totalRules = orderedSets.reduce(
            (acc, rs) => acc + rs.rules.length,
            0,
          );
          return {
            family_id: family.family_id,
            language_id: resolved.language.language_id,
            language_name: resolved.language.name,
            sca: {
              ...sca.config,
              rule_sets: orderedSets,
            },
            rule_set_count: orderedSets.length,
            total_rules: totalRules,
            revision: sca.revision,
          };
        },
      );
    },
  });

  // ── 2. sca_simulate ──────────────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "sca_simulate",
    title: "Simulate Sound Changes",
    description:
      "Simulate sound changes on up to 500 words (explicit word list or sampled from parent/current lexicon) with optional inline rule_sets or rules_text override and step-by-step changelog trace.",
    toolsets: ["compute", "evolution"],
    access: "read",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      words: z
        .array(z.string())
        .max(MAX_SIMULATE_WORDS)
        .optional()
        .describe("Explicit list of up to 500 IPA or romanized words to simulate"),
      input_format: z
        .enum(["ipa", "romanized", "auto"])
        .optional()
        .describe(
          "How to interpret explicit words: 'ipa' (direct), 'romanized' (convert via phonology first), or 'auto' (default 'ipa' unless romanized conversion requested)",
        ),
      source: z
        .enum(["explicit", "parent_lexicon", "current_lexicon"])
        .optional()
        .describe(
          "Source of words when 'words' is omitted (defaults to 'parent_lexicon' if language has parent_id, otherwise 'current_lexicon')",
        ),
      sample_limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_SIMULATE_WORDS)
        .optional()
        .describe("Max words to sample when reading from lexicon (default 100, max 500)"),
      rule_sets: z
        .array(scaRuleSetInputSchema)
        .optional()
        .describe("Optional temporary inline rule sets to test without saving"),
      rules_text: z
        .string()
        .optional()
        .describe(
          "Optional temporary human-readable sound change text (e.g. 'p > b / V_V') to parse and test without saving",
        ),
      macros: z
        .record(z.string(), z.array(z.string()))
        .optional()
        .describe("Optional custom macro overrides (e.g. { N: ['m', 'n', 'ŋ'] })"),
      include_unchanged: z
        .boolean()
        .optional()
        .describe("Include words whose surface form did not change (default true)"),
      include_trace: z
        .boolean()
        .optional()
        .describe("Include step-by-step rule changelog per word (default true)"),
    },
    handler: async (args) => {
      const hasLanguageArg = Boolean(
        (args.language ?? args.language_id)?.trim(),
      );
      const hasExplicitWords = Array.isArray(args.words) && args.words.length > 0;
      const hasInlineRules =
        (Array.isArray(args.rule_sets) && args.rule_sets.length > 0) ||
        Boolean(args.rules_text?.trim());

      if (!hasLanguageArg && (!hasExplicitWords || !hasInlineRules)) {
        throw new McpError(
          "VALIDATION",
          'Either specify "language" or provide both explicit "words" and inline rules ("rule_sets" or "rules_text").',
        );
      }

      if (args.words && args.words.length > MAX_SIMULATE_WORDS) {
        throw new McpError(
          "VALIDATION",
          `sca_simulate accepts at most ${MAX_SIMULATE_WORDS} words per call (got ${args.words.length}).`,
        );
      }

      let inlineRuleSets: SCARuleSet[] | null = null;
      if (args.rules_text !== undefined) {
        const parsed = parseSCARulesText(args.rules_text);
        if (parsed.errors.length > 0) {
          throw new McpError(
            "VALIDATION",
            `Failed to parse rules_text (${parsed.errors.length} error(s)).`,
            "Run sca_parse_rules_text to inspect line-by-line syntax errors.",
            { errors: parsed.errors },
          );
        }
        inlineRuleSets = [
          {
            ruleset_id: "inline_text_ruleset",
            name: "Inline Rules Text",
            order: 0,
            rules: parsed.rules.map(parsedRuleToScaRule),
          },
        ];
      } else if (args.rule_sets !== undefined) {
        const emptySetMap = new Map<string, Record<string, unknown>>();
        const emptyRuleMap = new Map<string, Record<string, unknown>>();
        inlineRuleSets = args.rule_sets.map((rs, idx) =>
          buildRuleSetPreservingUnknown(rs, idx, emptySetMap, emptyRuleMap),
        );
      }

      interface SimItem {
        entry_id?: string;
        romanized?: string;
        gloss?: string;
        input: string;
      }

      let familyId: string | null = null;
      let languageId: string | null = null;
      let sourceUsed: "explicit" | "parent_lexicon" | "current_lexicon" =
        "explicit";
      let simItems: SimItem[] = [];
      let ruleSetsToRun: SCARuleSet[] = inlineRuleSets ?? [];
      let macros: Record<string, string[]> = buildMacrosFromInventory(
        [],
        [],
        args.macros,
      );
      let inventoryPhonemes: string[] = [];
      const dependencies: Record<string, string> = {};

      if (hasLanguageArg) {
        const family = resolveFamilyFromArgs(config, args);
        familyId = family.family_id;

        const collected = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "sca_simulate",
          () => {
            const ws = readWorkspaceUnlocked(family.conlang_file_path);
            const resolved = resolveLanguage(
              family,
              (args.language ?? args.language_id ?? "").trim(),
              { workspace: ws.config, revision: ws.revision },
            );
            const lang = resolved.language;
            const phono = readPhonologyUnlocked(
              family.project_dir,
              family.conlang_file_path,
              lang,
            );
            const sca = readScaUnlocked(family.project_dir, lang);
            const deps: Record<string, string> = {
              workspace: ws.revision,
              phonology: phono.revision,
              sca: sca.revision,
            };

            let parentLang = null;
            let parentPhono: PhonologyConfig | null = null;
            if (lang.parent_id) {
              parentLang =
                ws.config.languages.find(
                  (l) => l.language_id === lang.parent_id,
                ) ?? null;
              if (parentLang) {
                const pLoaded = readPhonologyUnlocked(
                  family.project_dir,
                  family.conlang_file_path,
                  parentLang,
                );
                parentPhono = pLoaded.local_config ?? pLoaded.config;
                deps[`parent_phonology:${parentLang.language_id}`] =
                  pLoaded.revision;
              }
            }

            const phonoLocal = phono.local_config ?? phono.config;

            const chosenSource: "explicit" | "parent_lexicon" | "current_lexicon" =
              args.source ??
              (hasExplicitWords
                ? "explicit"
                : parentLang
                  ? "parent_lexicon"
                  : "current_lexicon");

            const items: SimItem[] = [];
            const sampleLimit = Math.min(
              MAX_SIMULATE_WORDS,
              Math.max(1, args.sample_limit ?? 100),
            );

            if (chosenSource === "explicit") {
              if (!args.words || args.words.length === 0) {
                throw new McpError(
                  "VALIDATION",
                  'source="explicit" requires a non-empty "words" array.',
                );
              }
              const fmt = args.input_format ?? "ipa";
              const basisPhono = parentPhono ?? phonoLocal;
              for (const rawWord of args.words) {
                const trimmed = rawWord.trim().replace(/^[/[]+|[\/\]]+$/g, "");
                if (fmt === "romanized") {
                  const gen = generateIPA(trimmed, basisPhono);
                  items.push({
                    romanized: rawWord,
                    input: gen.phonemic || trimmed,
                  });
                } else {
                  items.push({ input: trimmed });
                }
              }
            } else if (chosenSource === "parent_lexicon") {
              if (!parentLang) {
                throw new McpError(
                  "VALIDATION",
                  `Language "${lang.name}" (${lang.language_id}) has no parent_id to sample parent_lexicon from.`,
                );
              }
              const parentLex = readLexiconUnlocked(
                family.project_dir,
                parentLang,
              );
              deps[`parent_lexicon:${parentLang.language_id}`] =
                parentLex.revision;
              const activeWords = parentLex.words
                .filter((w) => !w.evolution?.is_deprecated)
                .slice(0, sampleLimit);
              for (const w of activeWords) {
                items.push({
                  entry_id: w.entry_id,
                  romanized: w.con_word_romanized,
                  gloss: w.senses[0]?.gloss ?? "",
                  input: resolveWordIpaForSca(w, parentPhono),
                });
              }
            } else {
              const curLex = readLexiconUnlocked(family.project_dir, lang);
              deps.lexicon = curLex.revision;
              const activeWords = curLex.words
                .filter((w) => !w.evolution?.is_deprecated)
                .slice(0, sampleLimit);
              for (const w of activeWords) {
                items.push({
                  entry_id: w.entry_id,
                  romanized: w.con_word_romanized,
                  gloss: w.senses[0]?.gloss ?? "",
                  input: resolveWordIpaForSca(w, phonoLocal),
                });
              }
            }

            const basisInv = (parentPhono ?? phonoLocal).phoneme_inventory;
            const childInv = phonoLocal.phoneme_inventory;
            const combinedConsonants = Array.from(
              new Set([...basisInv.consonants, ...childInv.consonants]),
            );
            const combinedVowels = Array.from(
              new Set([...basisInv.vowels, ...childInv.vowels]),
            );
            const builtMacros = buildMacrosFromInventory(
              combinedConsonants,
              combinedVowels,
              {
                ...phonoLocal.phonotactics.macros,
                ...(args.macros ?? {}),
              },
            );

            return {
              languageId: lang.language_id,
              sourceUsed: chosenSource,
              items,
              savedRuleSets: sca.config.rule_sets,
              macros: builtMacros,
              inventoryPhonemes: [...combinedConsonants, ...combinedVowels],
              deps,
            };
          },
        );

        languageId = collected.languageId;
        sourceUsed = collected.sourceUsed;
        simItems = collected.items;
        if (!inlineRuleSets) {
          ruleSetsToRun = collected.savedRuleSets;
        }
        macros = collected.macros;
        inventoryPhonemes = collected.inventoryPhonemes;
        Object.assign(dependencies, collected.deps);
      } else {
        simItems = (args.words ?? []).map((w) => ({
          input: w.trim().replace(/^[/[]+|[\/\]]+$/g, ""),
        }));
      }

      const orderedSets = [...ruleSetsToRun].sort((a, b) => a.order - b.order);
      const includeUnchanged = args.include_unchanged ?? true;
      const includeTrace = args.include_trace ?? true;

      interface SimulatedWordOutput {
        entry_id?: string;
        romanized?: string;
        gloss?: string;
        input: string;
        output: string;
        changed: boolean;
        changelog?: SCAStepLog[];
      }

      const results: SimulatedWordOutput[] = [];
      let changedCount = 0;

      for (const item of simItems) {
        const applied = applySoundChanges(
          item.input,
          orderedSets,
          macros,
          inventoryPhonemes,
        );
        const changed = applied.result !== item.input;
        if (changed) changedCount += 1;
        if (!includeUnchanged && !changed) continue;

        const out: SimulatedWordOutput = {
          ...(item.entry_id ? { entry_id: item.entry_id } : {}),
          ...(item.romanized !== undefined ? { romanized: item.romanized } : {}),
          ...(item.gloss !== undefined ? { gloss: item.gloss } : {}),
          input: item.input,
          output: applied.result,
          changed,
        };
        if (includeTrace) {
          out.changelog = applied.changelog;
        }
        results.push(out);
      }

      return {
        family_id: familyId,
        language_id: languageId,
        source: sourceUsed,
        using_inline_rules: inlineRuleSets !== null,
        rule_set_count: orderedSets.length,
        total_simulated: simItems.length,
        changed_count: changedCount,
        unchanged_count: simItems.length - changedCount,
        results,
        dependencies,
      };
    },
  });

  // ── 3. sca_parse_rules_text ──────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "sca_parse_rules_text",
    title: "Parse SCA Rules Text",
    description:
      "Parse human-readable sound change rules text (e.g. 'p > b / V_V ! pp' or pipe-delimited '@feature' lines) into structured SCA rules with per-line error reporting.",
    toolsets: ["compute", "evolution"],
    access: "read",
    idempotent: true,
    inputSchema: {
      text: z
        .string()
        .describe(
          "Multi-line sound change rules text (supports 'target > replacement / before_after ! exceptions' and '@feature' pipe lines)",
        ),
      rule_set_name: z
        .string()
        .optional()
        .describe("Name for the generated SCARuleSet preview (default 'Imported Rules')"),
      order: z
        .number()
        .int()
        .optional()
        .describe("Order index for the generated SCARuleSet preview (default 0)"),
      strict: z
        .boolean()
        .optional()
        .describe("If true, throw VALIDATION error when any line fails to parse"),
    },
    handler: (args) => {
      const parsed = parseSCARulesText(args.text);
      if (args.strict && parsed.errors.length > 0) {
        throw new McpError(
          "VALIDATION",
          `SCA rules text contains ${parsed.errors.length} syntax error(s).`,
          "Fix the reported lines and retry.",
          { errors: parsed.errors },
        );
      }
      const rules = parsed.rules.map(parsedRuleToScaRule);
      const ruleSet: SCARuleSet = {
        ruleset_id: newPrefixedId("ruleset"),
        name: args.rule_set_name?.trim() || "Imported Rules",
        order: args.order ?? 0,
        rules,
      };
      return {
        valid: parsed.errors.length === 0,
        rule_count: rules.length,
        error_count: parsed.errors.length,
        rules,
        errors: parsed.errors,
        rule_set: ruleSet,
      };
    },
  });

  // ── 4. sca_feature_query ─────────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "sca_feature_query",
    title: "Query IPA Phonological Features",
    description:
      "Look up distinctive phonological features for a phoneme OR find all IPA phonemes matching a feature expression ({ positive, negative } or '[+voiced, +stop]'), optionally intersected with a language's phoneme inventory.",
    toolsets: ["compute", "evolution"],
    access: "read",
    idempotent: true,
    inputSchema: {
      phoneme: z
        .string()
        .optional()
        .describe("Exact IPA phoneme to inspect (e.g. 'p', 'tʃ', 'ɑ')"),
      expression: z
        .string()
        .optional()
        .describe("Feature expression string (e.g. '[+voiced, +stop, -nasal]')"),
      positive: z
        .array(z.string())
        .optional()
        .describe("Features that matching phonemes MUST possess"),
      negative: z
        .array(z.string())
        .optional()
        .describe("Features that matching phonemes MUST NOT possess"),
      list_all_features: z
        .boolean()
        .optional()
        .describe("If true, include the catalog of all recognized distinctive feature names"),
      ...familyInputFields,
      ...languageInputFields,
    },
    handler: async (args) => {
      let inventorySet: Set<string> | null = null;
      let languageRevision: string | null = null;
      let languageId: string | null = null;

      if ((args.language ?? args.language_id)?.trim()) {
        const family = resolveFamilyFromArgs(config, args);
        const invData = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "sca_feature_query",
          () => {
            const resolved = resolveLanguageUnlocked(family, args);
            const phono = readPhonologyUnlocked(
              family.project_dir,
              family.conlang_file_path,
              resolved.language,
            );
            const inv = (phono.local_config ?? phono.config).phoneme_inventory;
            return {
              languageId: resolved.language.language_id,
              revision: phono.revision,
              phonemes: [...inv.consonants, ...inv.vowels],
            };
          },
        );
        inventorySet = new Set(invData.phonemes);
        languageRevision = invData.revision;
        languageId = invData.languageId;
      }

      const allDistinctFeatures = (): string[] => {
        const set = new Set<string>();
        for (const feats of Object.values(PHONEME_FEATURES)) {
          for (const f of feats) set.add(f);
        }
        return Array.from(set).sort();
      };

      if (args.phoneme !== undefined && args.phoneme.trim().length > 0) {
        const p = args.phoneme.trim();
        const features = PHONEME_FEATURES[p] ?? null;
        return {
          mode: "phoneme_lookup" as const,
          phoneme: p,
          known: features !== null,
          features: features ?? [],
          natural_pair: NATURAL_PAIRS[p] ?? null,
          ...(inventorySet !== null
            ? {
                language_id: languageId,
                in_language_inventory: inventorySet.has(p),
                phonology_revision: languageRevision,
              }
            : {}),
          ...(args.list_all_features
            ? { available_features: allDistinctFeatures() }
            : {}),
        };
      }

      const hasExpr =
        Boolean(args.expression?.trim()) ||
        (args.positive !== undefined && args.positive.length > 0) ||
        (args.negative !== undefined && args.negative.length > 0);

      if (hasExpr) {
        const parsedExpr = args.expression
          ? parseFeatureExpression(args.expression)
          : { positive: [], negative: [] };
        const mergedExpr: FeatureExpression = {
          positive: Array.from(
            new Set([
              ...parsedExpr.positive,
              ...(args.positive ?? []).map((f) =>
                encodeBoundaryFeature(f.trim()),
              ),
            ]),
          ).filter(Boolean),
          negative: Array.from(
            new Set([
              ...parsedExpr.negative,
              ...(args.negative ?? []).map((f) =>
                encodeBoundaryFeature(f.trim()),
              ),
            ]),
          ).filter(Boolean),
        };

        const matches = findMatchingPhonemes(mergedExpr);
        const inInventory = inventorySet
          ? matches.filter((m) => inventorySet.has(m))
          : undefined;

        return {
          mode: "feature_match" as const,
          expression: mergedExpr,
          formatted_expression: formatFeatureExprHuman(mergedExpr),
          matching_phonemes: matches,
          count: matches.length,
          ...(inInventory !== undefined
            ? {
                language_id: languageId,
                in_language_inventory: inInventory,
                in_language_inventory_count: inInventory.length,
                phonology_revision: languageRevision,
              }
            : {}),
          ...(args.list_all_features
            ? { available_features: allDistinctFeatures() }
            : {}),
        };
      }

      const features = allDistinctFeatures();
      return {
        mode: "catalog" as const,
        total_phonemes: Object.keys(PHONEME_FEATURES).length,
        total_features: features.length,
        available_features: features,
      };
    },
  });

  // ── 5. sca_export_rules_text ─────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "sca_export_rules_text",
    title: "Export SCA Rules as Text",
    description:
      "Format a language's SCAConfig (or provided rule_sets) into clean human-readable sound change rules text ('target > replacement / before_after' or pipe-delimited import format).",
    toolsets: ["core", "evolution"],
    access: "read",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      rule_sets: z
        .array(scaRuleSetInputSchema)
        .optional()
        .describe("Optional inline rule_sets to format instead of reading sca_rules.json"),
      ruleset_id: z
        .string()
        .optional()
        .describe("Optional ruleset_id filter to export a single rule set"),
      format: z
        .enum(["arrow", "delimited"])
        .optional()
        .describe(
          "Output style: 'arrow' (default 'target > replacement / before_after', '@feature' pipe for feature rules) or 'delimited' (pipe-delimited import template)",
        ),
    },
    handler: async (args) => {
      const format = args.format ?? "arrow";
      let ruleSets: SCARuleSet[];
      let familyId: string | null = null;
      let languageId: string | null = null;
      let revision: string | null = null;

      if (args.rule_sets !== undefined) {
        const emptySetMap = new Map<string, Record<string, unknown>>();
        const emptyRuleMap = new Map<string, Record<string, unknown>>();
        ruleSets = args.rule_sets.map((rs, idx) =>
          buildRuleSetPreservingUnknown(rs, idx, emptySetMap, emptyRuleMap),
        );
      } else {
        const family = resolveFamilyFromArgs(config, args);
        familyId = family.family_id;
        const loaded = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "sca_export_rules_text",
          () => {
            const resolved = resolveLanguageUnlocked(family, args);
            const sca = readScaUnlocked(family.project_dir, resolved.language);
            return {
              languageId: resolved.language.language_id,
              sca,
            };
          },
        );
        languageId = loaded.languageId;
        ruleSets = loaded.sca.config.rule_sets;
        revision = loaded.sca.revision;
      }

      let filtered = [...ruleSets].sort((a, b) => a.order - b.order);
      if (args.ruleset_id?.trim()) {
        filtered = filtered.filter(
          (rs) => rs.ruleset_id === args.ruleset_id?.trim(),
        );
        if (filtered.length === 0) {
          throw new McpError(
            "NOT_FOUND",
            `SCA rule set "${args.ruleset_id}" not found.`,
          );
        }
      }

      const blocks: string[] = [];
      let totalRules = 0;
      for (const rs of filtered) {
        totalRules += rs.rules.length;
        if (format === "delimited") {
          blocks.push(serializeSCARuleSetForImport(rs.name, rs.rules));
        } else {
          const lines = [`# Rule Set: ${rs.name} (order: ${rs.order})`];
          for (const r of rs.rules) {
            lines.push(formatRuleArrowLine(r));
          }
          blocks.push(lines.join("\n"));
        }
      }

      return {
        family_id: familyId,
        language_id: languageId,
        format,
        rule_set_count: filtered.length,
        total_rules: totalRules,
        text: blocks.join("\n\n"),
        revision,
      };
    },
  });

  // ── 6. sca_update ────────────────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "sca_update",
    title: "Update SCA Rules",
    description:
      "Create, update, reorder, or delete SCA rule sets and rules (via structured JSON or human-readable text) in sca_rules.json, preserving unknown fields and recording an automatic SCA snapshot.",
    toolsets: ["write", "evolution"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      ...commonWriteInputFields,
      mode: z
        .enum(["replace_all", "upsert_rule_sets", "delete_rule_sets"])
        .optional()
        .describe(
          "Update mode: 'replace_all' replaces rule_sets array; 'upsert_rule_sets' merges by ruleset_id; 'delete_rule_sets' removes delete_ruleset_ids",
        ),
      rule_sets: z
        .array(scaRuleSetInputSchema)
        .optional()
        .describe("Structured rule sets to write or upsert"),
      from_text: z
        .object({
          text: z.string(),
          ruleset_id: z.string().optional(),
          ruleset_name: z.string().optional(),
          order: z.number().int().optional(),
          append_to_existing: z.boolean().optional(),
        })
        .optional()
        .describe(
          "Parse human-readable SCA rules text and save into a new or existing rule set",
        ),
      delete_ruleset_ids: z
        .array(z.string())
        .optional()
        .describe("Rule set IDs to delete"),
    },
    handler: async (args) => {
      const dryRun = Boolean(args.dry_run);
      assertWriteAllowed(config, "sca_update");
      if (!dryRun && !args.operation_id?.trim()) {
        throw new McpError(
          "VALIDATION",
          "operation_id is required when committing writes (omit only for dry_run: true).",
        );
      }

      if (
        args.rule_sets === undefined &&
        args.from_text === undefined &&
        (!args.delete_ruleset_ids || args.delete_ruleset_ids.length === 0)
      ) {
        throw new McpError(
          "VALIDATION",
          'Provide at least one of "rule_sets", "from_text", or "delete_ruleset_ids".',
        );
      }

      let parsedTextRules: SCARule[] | null = null;
      if (args.from_text !== undefined) {
        const parsed = parseSCARulesText(args.from_text.text);
        if (parsed.errors.length > 0) {
          throw new McpError(
            "VALIDATION",
            `from_text contains ${parsed.errors.length} syntax error(s); refusing to commit partial SCA rules.`,
            "Run sca_parse_rules_text to inspect errors first.",
            { errors: parsed.errors },
          );
        }
        parsedTextRules = parsed.rules.map(parsedRuleToScaRule);
      }

      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "sca_update",
        operationId: args.operation_id,
        requestPayloadForDigest: args,
        dryRun,
        requireRevisionsOnCommit: true,
        planInsideLock: () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lang = resolved.language;
          const langDir = assertSafeRelativeLanguagePath(
            family.project_dir,
            lang.path,
          );
          const scaPath = path.join(langDir, "sca_rules.json");
          const currentSca = readScaUnlocked(family.project_dir, lang);

          let rawTop: Record<string, unknown> = {};
          if (fs.existsSync(scaPath)) {
            rawTop = JSON.parse(fs.readFileSync(scaPath, "utf-8")) as Record<
              string,
              unknown
            >;
          }

          const existingRuleSetsById = new Map<string, Record<string, unknown>>();
          const existingRulesById = new Map<string, Record<string, unknown>>();
          if (Array.isArray(rawTop.rule_sets)) {
            for (const rs of rawTop.rule_sets as Record<string, unknown>[]) {
              if (rs && typeof rs === "object" && typeof rs.ruleset_id === "string") {
                existingRuleSetsById.set(rs.ruleset_id, rs);
              }
              if (rs && typeof rs === "object" && Array.isArray(rs.rules)) {
                for (const r of rs.rules as Record<string, unknown>[]) {
                  if (r && typeof r === "object" && typeof r.rule_id === "string") {
                    existingRulesById.set(r.rule_id, r);
                  }
                }
              }
            }
          }

          const effectiveMode =
            args.mode ??
            (args.rule_sets !== undefined
              ? "replace_all"
              : args.from_text !== undefined
                ? "upsert_rule_sets"
                : "delete_rule_sets");

          let nextRuleSets: SCARuleSet[] = [...currentSca.config.rule_sets];

          if (effectiveMode === "replace_all") {
            const incomingSets = args.rule_sets ?? [];
            nextRuleSets = incomingSets.map((rs, idx) =>
              buildRuleSetPreservingUnknown(
                rs,
                idx,
                existingRuleSetsById,
                existingRulesById,
              ),
            );
          } else if (effectiveMode === "upsert_rule_sets" && args.rule_sets) {
            for (const rs of args.rule_sets) {
              const built = buildRuleSetPreservingUnknown(
                rs,
                nextRuleSets.length,
                existingRuleSetsById,
                existingRulesById,
              );
              const existingIdx = nextRuleSets.findIndex(
                (item) => item.ruleset_id === built.ruleset_id,
              );
              if (existingIdx >= 0) {
                nextRuleSets[existingIdx] = built;
              } else {
                nextRuleSets.push(built);
              }
            }
          }

          if (args.from_text && parsedTextRules) {
            const targetId = args.from_text.ruleset_id?.trim();
            const existingIdx = targetId
              ? nextRuleSets.findIndex((rs) => rs.ruleset_id === targetId)
              : -1;

            if (existingIdx >= 0) {
              const prev = nextRuleSets[existingIdx];
              const prevRaw =
                existingRuleSetsById.get(prev.ruleset_id) ??
                (prev as unknown as Record<string, unknown>);
              const mergedRules = args.from_text.append_to_existing
                ? [...prev.rules, ...parsedTextRules]
                : parsedTextRules;
              nextRuleSets[existingIdx] = {
                ...(prevRaw as unknown as SCARuleSet),
                ruleset_id: prev.ruleset_id,
                name: args.from_text.ruleset_name?.trim() || prev.name,
                order: args.from_text.order ?? prev.order,
                rules: mergedRules,
              };
            } else {
              const newId = targetId || newPrefixedId("ruleset");
              nextRuleSets.push({
                ruleset_id: newId,
                name:
                  args.from_text.ruleset_name?.trim() || "Imported Sound Changes",
                order: args.from_text.order ?? nextRuleSets.length,
                rules: parsedTextRules,
              });
            }
          }

          if (args.delete_ruleset_ids && args.delete_ruleset_ids.length > 0) {
            const toDelete = new Set(
              args.delete_ruleset_ids.map((id) => id.trim()),
            );
            nextRuleSets = nextRuleSets.filter(
              (rs) => !toDelete.has(rs.ruleset_id),
            );
          }

          nextRuleSets.sort((a, b) => a.order - b.order);

          const nextConfig: SCAConfig = {
            ...(rawTop as unknown as SCAConfig),
            language_id:
              typeof rawTop.language_id === "string" && rawTop.language_id
                ? rawTop.language_id
                : lang.language_id,
            rule_sets: nextRuleSets,
          };

          const expectations: RevisionExpectation[] = [
            {
              label: "sca_rules.json",
              targetPath: scaPath,
              expectedRevision: args.expected_revision ?? "",
            },
          ];

          const totalRules = nextRuleSets.reduce(
            (acc, rs) => acc + rs.rules.length,
            0,
          );
          const needSnap = shouldAutoSnapshot({
            projectDir: family.project_dir,
            languageId: lang.language_id,
            scope: "sca",
            batchSize: Math.max(1, totalRules),
          });

          const mutations: PlannedMutation[] = [];
          let snapshotId: string | null = null;
          if (!dryRun && needSnap) {
            const snap = planLanguageSnapshot({
              projectDir: family.project_dir,
              language: lang,
              scope: "sca",
              origin: "mcp",
              operationType: "auto_snapshot",
              description: `MCP sca_update (${nextRuleSets.length} rule sets, ${totalRules} rules)`,
            });
            snapshotId = snap.snapshotId;
            mutations.push(...snap.mutations);
          }

          const scaRel = `${normalizeRelPathPosix(lang.path)}/sca_rules.json`;
          mutations.push({
            kind: "write_file",
            relPath: scaRel,
            content: JSON.stringify(nextConfig, null, 2),
          });

          const diff = computeStructuralDiff(currentSca.config, nextConfig);

          return {
            expectations,
            mutations,
            languageId: lang.language_id,
            snapshotId,
            auditSummary: `Updated SCA rules for ${lang.language_id} (${nextRuleSets.length} rule sets, ${totalRules} rules)`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              family_id: family.family_id,
              language_id: lang.language_id,
              rule_set_count: nextRuleSets.length,
              total_rules: totalRules,
              would_snapshot: needSnap,
              snapshot_scope: "sca",
              base_revisions: baseRevisions,
              diff,
              preview_sca: nextConfig,
            }),
            buildResponse: (newRevisions, warnings) => {
              markSessionScopeWritten(
                family.project_dir,
                lang.language_id,
                "sca",
              );
              return {
                committed: true,
                operation_id: args.operation_id,
                family_id: family.family_id,
                language_id: lang.language_id,
                revision:
                  newRevisions["sca_rules.json"] ??
                  newRevisions[scaRel] ??
                  computeFileRevision(scaPath),
                revisions: newRevisions,
                snapshot_id: snapshotId,
                rule_set_count: nextRuleSets.length,
                total_rules: totalRules,
                diff,
                warnings: warnings.length > 0 ? warnings : undefined,
              };
            },
          };
        },
      });
    },
  });
}
