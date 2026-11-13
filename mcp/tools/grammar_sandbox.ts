import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { generateDerivedWords } from "../../src/core/engines/derivationEngine";
import { generateIPA } from "../../src/core/engines/ipaGenerator";
import {
  applyAgglutinativeChain,
  applyFusionalInflection,
  applyInflection,
  applyInflectionTypologyAware,
  generateParadigm,
} from "../../src/core/engines/morphologyEngine";
import {
  type AnnotatedToken,
  autoApplyInflections,
  processSandboxText,
  reorderBySyntax,
} from "../../src/core/engines/sandbox";
import { analyzeTypology } from "../../src/core/engines/typologyAnalyzer";
import { newEntryId, newPrefixedId, nowIso } from "../../src/core/lexicon/ids";
import type {
  DerivationRule,
  GrammarConfig,
  InflectionDimension,
  MorphophonologyRule,
  WordEntry,
} from "../../src/types";
import { assertWriteAllowed, type McpConfig } from "../config";
import { McpError } from "../errors";
import {
  assertSafeRelativeLanguagePath,
  resolveLanguage,
} from "../registry/addressing";
import {
  readGrammarUnlocked,
  readLexiconUnlocked,
  readPhonologyUnlocked,
  readWorkspaceUnlocked,
  withConsistentProjectRead,
} from "../storage/read";
import {
  markSessionScopeWritten,
  planLanguageSnapshot,
  shouldAutoSnapshot,
} from "../storage/snapshot";
import {
  executeProjectTransaction,
  type PlannedMutation,
} from "../storage/transaction";
import {
  linearizeClause,
  type ClauseNode,
  type NPNode,
  type PPNode,
} from "../../src/core/engines/phraseSandbox";
import { registerDefinedTool } from "../toolRegistry";
import { computeStructuralDiff } from "../util/diff";
import { paginate } from "../util/paging";
import {
  commonWriteInputFields,
  familyInputFields,
  languageInputFields,
  normalizeRelPathPosix,
  resolveFamilyFromArgs,
  resolveLanguageUnlocked,
} from "./_helpers";

const GRAMMAR_SECTIONS = [
  "typology",
  "syntax",
  "pos",
  "inflection",
  "derivation",
  "chapters",
] as const;

const MORPHOLOGY_TYPES = [
  "prefix",
  "suffix",
  "infix",
  "circumfix",
  "reduplication",
  "ablaut",
] as const;

const conditionClauseSchema = z
  .object({
    type: z.enum([
      "ends_with_phoneme_class",
      "starts_with_phoneme_class",
      "matches_regex",
    ]),
    class: z.enum(["vowel", "consonant"]).optional(),
    regex: z.string().optional(),
    then_affix: z.string(),
    else_affix: z.string(),
  })
  .passthrough();

const infixConfigSchema = z
  .object({
    position_regex: z.string(),
    morpheme: z.string(),
  })
  .passthrough();

const circumfixConfigSchema = z
  .object({
    prefix_part: z.string(),
    suffix_part: z.string(),
  })
  .passthrough();

const reduplicationConfigSchema = z
  .object({
    mode: z.enum(["full", "partial_onset", "partial_coda"]),
  })
  .passthrough();

const ablautConfigSchema = z
  .object({
    target_vowel: z.string(),
    replacement_vowel: z.string(),
  })
  .passthrough();

const featureExpressionSchema = z
  .object({
    positive: z.array(z.string()),
    negative: z.array(z.string()),
  })
  .passthrough();

const featureReplacementSchema = z
  .object({
    set_features: z.array(z.string()),
    remove_features: z.array(z.string()),
  })
  .passthrough();

const morphophonologyRuleSchema = z
  .object({
    rule_id: z.string().optional(),
    description: z.string().optional(),
    disabled: z.boolean().optional(),
    priority: z.number().optional(),
    target: z.string(),
    replacement: z.string(),
    context_before: z.string().optional(),
    context_after: z.string().optional(),
    feature_mode: z.boolean().optional(),
    target_features: featureExpressionSchema.nullable().optional(),
    replacement_features: featureReplacementSchema.nullable().optional(),
    context_before_features: featureExpressionSchema.nullable().optional(),
    context_after_features: featureExpressionSchema.nullable().optional(),
  })
  .passthrough();

const caseDimBindingSchema = z
  .object({
    dim_id: z.string(),
    val_id: z.string(),
  })
  .passthrough();

const posInputSchema = z
  .object({
    pos_id: z.string().optional(),
    name: z.string(),
    gloss_abbr: z.string().optional(),
    word_pattern: z.string().optional(),
    requires_definition: z.boolean().optional(),
    requires_pronunciation: z.boolean().optional(),
  })
  .passthrough();

const dimValInputSchema = z
  .object({
    val_id: z.string().optional(),
    name: z.string(),
    gloss: z.string(),
  })
  .passthrough();

const dimensionInputSchema = z
  .object({
    dim_id: z.string().optional(),
    name: z.string(),
    applies_to_pos: z.array(z.string()).optional(),
    values: z.array(dimValInputSchema),
  })
  .passthrough();

const inflectionRuleInputSchema = z
  .object({
    rule_id: z.string().optional(),
    pos_id: z.string(),
    dimension_values: z.record(z.string(), z.string()).optional(),
    type: z.enum(MORPHOLOGY_TYPES),
    affix: z.string().optional(),
    tag: z.string().optional(),
    match_regex: z.string().optional(),
    disabled: z.boolean().optional(),
    condition: conditionClauseSchema.nullable().optional(),
    infix_config: infixConfigSchema.optional(),
    circumfix_config: circumfixConfigSchema.optional(),
    reduplication_config: reduplicationConfigSchema.optional(),
    ablaut_config: ablautConfigSchema.optional(),
    slot_id: z.string().optional(),
    conjugation_class_id: z.string().optional(),
    fused_dimensions: z.array(z.record(z.string(), z.string())).optional(),
    sca_mutable: z.boolean().optional(),
  })
  .passthrough();

const derivationRuleInputSchema = z
  .object({
    rule_id: z.string().optional(),
    name: z.string(),
    source_pos_id: z.string(),
    target_pos_id: z.string(),
    type: z.enum(MORPHOLOGY_TYPES),
    affix: z.string().optional(),
    condition: conditionClauseSchema.nullable().optional(),
    infix_config: infixConfigSchema.optional(),
    circumfix_config: circumfixConfigSchema.optional(),
    semantic_note: z.string().optional(),
    sca_mutable: z.boolean().optional(),
  })
  .passthrough();

const chapterInputSchema = z
  .object({
    chapter_id: z.string().optional(),
    title: z.string(),
    content: z.string(),
    order: z.number().int().optional(),
    embedded_paradigms: z
      .array(
        z
          .object({
            paradigm_id: z.string().optional(),
            pos_id: z.string(),
            dimension_ids: z.array(z.string()),
            test_word: z.string(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const affixSlotInputSchema = z
  .object({
    slot_id: z.string().optional(),
    position: z.number().int(),
    dimension_id: z.string(),
    is_obligatory: z.boolean().optional(),
    label: z.string().optional(),
  })
  .passthrough();

const conjugationClassInputSchema = z
  .object({
    class_id: z.string().optional(),
    name: z.string(),
    applies_to_pos: z.string(),
    stem_pattern: z.string().optional(),
    rule_ids: z.array(z.string()).optional(),
  })
  .passthrough();

const irregularOverrideInputSchema = z
  .object({
    entry_id: z.string(),
    dimension_values: z.record(z.string(), z.string()),
    surface_form: z.string(),
    stem_start: z.number().int().min(0).optional(),
  })
  .passthrough()
  .refine((form) => form.stem_start === undefined || form.stem_start <= Array.from(form.surface_form).length, {
    message: "stem_start exceeds the surface_form codepoint length",
    path: ["stem_start"],
  });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function indexRawArrayByKey(
  rawArr: unknown,
  keyField: string,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(rawArr)) return map;
  for (const item of rawArr) {
    if (isRecord(item) && typeof item[keyField] === "string" && item[keyField]) {
      map.set(item[keyField] as string, item);
    }
  }
  return map;
}

function canonicalDimKey(dims: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(dims)
      .sort()
      .map((k) => [k, dims[k]]),
  );
}

function resolveDimensionValues(
  rawDims: Record<string, string>,
  dimensions: readonly InflectionDimension[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawK, rawV] of Object.entries(rawDims)) {
    const dim =
      dimensions.find((d) => d.dim_id === rawK) ??
      dimensions.find((d) => d.name.toLowerCase() === rawK.toLowerCase());
    if (!dim) {
      out[rawK] = rawV;
      continue;
    }
    const val =
      dim.values.find((v) => v.val_id === rawV) ??
      dim.values.find(
        (v) =>
          v.gloss.toLowerCase() === rawV.toLowerCase() ||
          v.name.toLowerCase() === rawV.toLowerCase(),
      );
    out[dim.dim_id] = val ? val.val_id : rawV;
  }
  return out;
}

function resolveWordAndPos(
  args: { word?: string; entry_id?: string; pos_id?: string },
  words: readonly WordEntry[],
): { word: string; entry_id: string; pos_id: string } {
  let entry: WordEntry | undefined;
  if (args.entry_id) {
    entry = words.find((w) => w.entry_id === args.entry_id);
    if (!entry && !args.word) {
      throw new McpError(
        "NOT_FOUND",
        `Lexicon entry "${args.entry_id}" not found.`,
      );
    }
  } else if (args.word) {
    const clean = args.word.trim();
    entry = words.find((w) => w.con_word_romanized === clean);
  }

  const word = args.word?.trim() || entry?.con_word_romanized || "";
  if (!word) {
    throw new McpError(
      "VALIDATION",
      "Provide either a non-empty word or an existing entry_id.",
    );
  }
  const posId = args.pos_id?.trim() || entry?.senses[0]?.pos_id || "";
  return {
    word,
    entry_id: args.entry_id?.trim() || entry?.entry_id || "",
    pos_id: posId,
  };
}

const npInputSchema: z.ZodType<NPNode> = z.lazy(() =>
  z.object({
    head: z.string(),
    number: z
      .string()
      .optional()
      .describe("Number dimension gloss such as SG or PL, injected on the NP head"),
    determiner: z.string().optional(),
    numeral: z.string().optional(),
    adjectives: z.array(z.string()).optional(),
    possessor: npInputSchema.optional(),
    pp: ppInputSchema.optional(),
  }),
);

const ppInputSchema: z.ZodType<PPNode> = z.lazy(() =>
  z.object({
    adposition: z.string(),
    object: npInputSchema,
  }),
);

const clauseInputSchema: z.ZodType<ClauseNode> = z.object({
  subject: npInputSchema,
  verb: z.object({
    gloss: z.string(),
    tam: z.array(z.string()).optional(),
  }),
  object: npInputSchema.optional(),
  obliques: z.array(ppInputSchema).optional(),
  polarity: z
    .enum(["affirmative", "negative"])
    .optional()
    .describe("Clause polarity; negative attaches a NEG affix or an independent negator"),
});

export function registerGrammarSandboxTools(
  server: McpServer,
  config: McpConfig,
): void {
  // 1. gram_get
  registerDefinedTool(server, config, {
    name: "gram_get",
    title: "Get Language Grammar Configuration",
    description:
      "Read grammar.json for a language (optionally filtered by sections: typology, syntax, pos, inflection, derivation, chapters) along with its local revision.",
    toolsets: ["core"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      sections: z
        .array(z.enum(GRAMMAR_SECTIONS))
        .optional()
        .describe("Optional sections filter (returns full GrammarConfig when omitted)"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      return await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "gram_get",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const gram = readGrammarUnlocked(family.project_dir, resolved.language);
          if (!args.sections || args.sections.length === 0) {
            return {
              family_id: family.family_id,
              language_id: resolved.language.language_id,
              revision: gram.revision,
              config: gram.config,
            };
          }

          const secSet = new Set(args.sections);
          const partial: Record<string, unknown> = {
            language_id: gram.config.language_id,
          };
          if (secSet.has("typology")) partial.typology = gram.config.typology;
          if (secSet.has("syntax")) partial.syntax = gram.config.syntax;
          if (secSet.has("pos"))
            partial.parts_of_speech = gram.config.parts_of_speech;
          if (secSet.has("inflection")) {
            partial.inflection_dimensions = gram.config.inflection_dimensions;
            partial.inflection_rules = gram.config.inflection_rules;
            partial.affix_slots = gram.config.affix_slots;
            partial.conjugation_classes = gram.config.conjugation_classes;
            partial.irregular_overrides = gram.config.irregular_overrides;
          }
          if (secSet.has("derivation")) {
            partial.derivation_rules = gram.config.derivation_rules;
          }
          if (secSet.has("chapters")) {
            partial.grammar_manual = gram.config.grammar_manual;
          }

          return {
            family_id: family.family_id,
            language_id: resolved.language.language_id,
            revision: gram.revision,
            sections: args.sections,
            config: partial,
          };
        },
      );
    },
  });

  // 2. gram_inflect
  registerDefinedTool(server, config, {
    name: "gram_inflect",
    title: "Inflect Word(s) Using Morphology Engine",
    description:
      "Inflect one or up to 500 words using typology-aware inflection, agglutinative affix slot chains, fusional inflection, or a specific rule_id.",
    toolsets: ["compute"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      word: z.string().optional().describe("Romanized stem to inflect"),
      entry_id: z
        .string()
        .optional()
        .describe("Optional lexicon entry_id (looks up stem, POS, and irregular overrides)"),
      pos_id: z.string().optional().describe("Part of speech ID"),
      dimension_values: z
        .record(z.string(), z.string())
        .optional()
        .describe("Map of dim_id (or name) -> val_id (or gloss)"),
      rule_id: z
        .string()
        .optional()
        .describe("Optional explicit inflection rule_id to apply directly"),
      mode: z
        .enum(["typology_aware", "slot_chain", "fusional", "single_rule"])
        .optional()
        .describe("Inflection strategy (default: typology_aware, or single_rule when rule_id is set)"),
      items: z
        .array(
          z.object({
            word: z.string().optional(),
            entry_id: z.string().optional(),
            pos_id: z.string().optional(),
            dimension_values: z.record(z.string(), z.string()).optional(),
            rule_id: z.string().optional(),
          }),
        )
        .max(500)
        .optional()
        .describe("Optional batch of up to 500 inflection requests"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "gram_inflect",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const gram = readGrammarUnlocked(family.project_dir, resolved.language);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          return { resolved, gram, phono, lex };
        },
      );

      const requests =
        args.items && args.items.length > 0
          ? args.items
          : [
              {
                word: args.word,
                entry_id: args.entry_id,
                pos_id: args.pos_id,
                dimension_values: args.dimension_values,
                rule_id: args.rule_id,
              },
            ];

      const results = requests.map((req) => {
        const target = resolveWordAndPos(req, snapshot.lex.words);
        const explicitRuleId = req.rule_id ?? args.rule_id;
        const effectiveMode =
          args.mode ?? (explicitRuleId ? "single_rule" : "typology_aware");

        if (effectiveMode === "single_rule" || explicitRuleId) {
          if (!explicitRuleId) {
            throw new McpError(
              "VALIDATION",
              "rule_id is required when mode is 'single_rule'.",
            );
          }
          const rule = snapshot.gram.config.inflection_rules.find(
            (r) => r.rule_id === explicitRuleId,
          );
          if (!rule) {
            throw new McpError(
              "NOT_FOUND",
              `Inflection rule "${explicitRuleId}" not found in grammar.json.`,
            );
          }
          const inf = applyInflection(
            target.word,
            rule,
            snapshot.phono.config,
            snapshot.gram.config.morphophonology_rules ?? [],
          );
          const ipa = generateIPA(inf.result, snapshot.phono.config, { stem_start: inf.stem_start });
          return {
            input: target.word,
            entry_id: target.entry_id || null,
            pos_id: target.pos_id || rule.pos_id,
            mode: "single_rule" as const,
            rule_id: rule.rule_id,
            result: inf.result,
            phonemic_ipa: ipa.phonemic,
            surface_ipa: ipa.surface || null,
            applied: inf.applied,
            log: inf.log,
          };
        }

        if (!target.pos_id) {
          throw new McpError(
            "VALIDATION",
            `pos_id is required to inflect "${target.word}" (or pass an entry_id that has a sense pos_id).`,
          );
        }

        const resolvedDims = resolveDimensionValues(
          req.dimension_values ?? args.dimension_values ?? {},
          snapshot.gram.config.inflection_dimensions,
        );

        const inf =
          effectiveMode === "slot_chain"
            ? applyAgglutinativeChain(
                target.word,
                target.pos_id,
                resolvedDims,
                snapshot.gram.config,
                snapshot.phono.config,
              )
            : effectiveMode === "fusional"
              ? applyFusionalInflection(
                  target.word,
                  target.entry_id,
                  target.pos_id,
                  resolvedDims,
                  snapshot.gram.config,
                  snapshot.phono.config,
                )
              : applyInflectionTypologyAware(
                  target.word,
                  target.entry_id,
                  target.pos_id,
                  resolvedDims,
                  snapshot.gram.config,
                  snapshot.phono.config,
                );

        const ipa = generateIPA(inf.result, snapshot.phono.config, { stem_start: inf.stem_start });
        return {
          input: target.word,
          entry_id: target.entry_id || null,
          pos_id: target.pos_id,
          dimension_values: resolvedDims,
          mode: effectiveMode,
          result: inf.result,
          phonemic_ipa: ipa.phonemic,
          surface_ipa: ipa.surface || null,
          applied: inf.applied,
          log: inf.log,
        };
      });

      return {
        family_id: family.family_id,
        language_id: snapshot.resolved.language.language_id,
        morphological_type: snapshot.gram.config.typology.morphological_type,
        results: args.items ? results : undefined,
        ...(args.items ? {} : results[0]),
        dependencies: {
          "grammar.json": snapshot.gram.revision,
          "phonology.json": snapshot.phono.revision,
          lexicon: snapshot.lex.revision,
        },
      };
    },
  });

  // 3. gram_paradigm
  registerDefinedTool(server, config, {
    name: "gram_paradigm",
    title: "Generate Inflection Paradigm Table",
    description:
      "Generate the full inflection paradigm table for a word or lexicon entry across all active inflection rules for its part of speech.",
    toolsets: ["compute"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      word: z.string().optional().describe("Romanized stem"),
      entry_id: z.string().optional().describe("Lexicon entry_id"),
      pos_id: z
        .string()
        .optional()
        .describe("Part of speech ID (inferred from entry_id when omitted)"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "gram_paradigm",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const gram = readGrammarUnlocked(family.project_dir, resolved.language);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          return { resolved, gram, phono, lex };
        },
      );

      const target = resolveWordAndPos(args, snapshot.lex.words);
      if (!target.pos_id) {
        throw new McpError(
          "VALIDATION",
          `pos_id is required to generate a paradigm for "${target.word}".`,
        );
      }

      const rawCells = generateParadigm(
        target.word,
        target.pos_id,
        snapshot.gram.config.inflection_rules,
        snapshot.phono.config,
        target.entry_id ? { entryId: target.entry_id, grammar: snapshot.gram.config } : undefined,
      );

      const overrides = target.entry_id
        ? snapshot.gram.config.irregular_overrides.filter(
            (ov) => ov.entry_id === target.entry_id,
          )
        : [];

      const cells = rawCells.map((cell) => {
        const matchedOverride = overrides.find((ov) =>
          Object.entries(ov.dimension_values).every(
            ([k, v]) => cell.dimensionValues[k] === v,
          ),
        );
        const surfaceForm = matchedOverride
          ? matchedOverride.surface_form
          : cell.result;
        const ipa = generateIPA(surfaceForm, snapshot.phono.config, {
          stem_start: matchedOverride ? matchedOverride.stem_start : cell.stem_start,
        });
        return {
          dimension_values: cell.dimensionValues,
          tag: cell.tag,
          result: surfaceForm,
          stem_start: matchedOverride ? matchedOverride.stem_start : cell.stem_start,
          phonemic_ipa: ipa.phonemic,
          surface_ipa: ipa.surface || null,
          irregular_override: Boolean(matchedOverride),
          log: matchedOverride
            ? `irregular override -> "${matchedOverride.surface_form}"`
            : cell.log,
        };
      });

      return {
        family_id: family.family_id,
        language_id: snapshot.resolved.language.language_id,
        word: target.word,
        entry_id: target.entry_id || null,
        pos_id: target.pos_id,
        total_cells: cells.length,
        cells,
        revision: snapshot.gram.revision,
        dependencies: {
          "grammar.json": snapshot.gram.revision,
          "phonology.json": snapshot.phono.revision,
          lexicon: snapshot.lex.revision,
        },
      };
    },
  });

  // 4. gram_derive
  registerDefinedTool(server, config, {
    name: "gram_derive",
    title: "Preview Word Derivations",
    description:
      "Preview derived words and IPA by applying saved or inline derivation rule(s) to lexicon entries or explicit stems. Read-only; commit selected derivations via lex_upsert.",
    toolsets: ["compute"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      rule_id: z
        .string()
        .optional()
        .describe("Specific derivation rule_id from grammar.json (runs all matching rules if omitted)"),
      rule: derivationRuleInputSchema
        .optional()
        .describe("Optional inline derivation rule to preview without saving"),
      entry_ids: z
        .array(z.string())
        .max(500)
        .optional()
        .describe("Optional subset of lexicon entry_ids"),
      words: z
        .array(
          z.object({
            word: z.string(),
            pos_id: z.string().optional(),
            gloss: z.string().optional(),
          }),
        )
        .max(500)
        .optional()
        .describe("Optional explicit words to derive instead of lexicon entries"),
      limit: z.number().int().min(1).max(500).optional(),
      cursor: z.string().optional(),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "gram_derive",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const gram = readGrammarUnlocked(family.project_dir, resolved.language);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          return { resolved, gram, phono, lex };
        },
      );

      let rulesToRun: DerivationRule[] = [];
      if (args.rule) {
        rulesToRun = [
          {
            rule_id: args.rule.rule_id || "inline_rule",
            name: args.rule.name,
            source_pos_id: args.rule.source_pos_id,
            target_pos_id: args.rule.target_pos_id,
            type: args.rule.type,
            affix: args.rule.affix ?? "",
            condition: args.rule.condition ?? null,
            infix_config: args.rule.infix_config,
            circumfix_config: args.rule.circumfix_config,
            semantic_note: args.rule.semantic_note ?? "",
            sca_mutable: args.rule.sca_mutable,
          },
        ];
      } else if (args.rule_id) {
        const found = snapshot.gram.config.derivation_rules.find(
          (r) => r.rule_id === args.rule_id,
        );
        if (!found) {
          throw new McpError(
            "NOT_FOUND",
            `Derivation rule "${args.rule_id}" not found in grammar.json.`,
          );
        }
        rulesToRun = [found];
      } else {
        rulesToRun = snapshot.gram.config.derivation_rules;
      }

      const isoNow = nowIso();
      let candidateSourceWords: WordEntry[];
      if (args.words && args.words.length > 0) {
        candidateSourceWords = args.words.map((w, idx) => ({
          entry_id: `adhoc_${idx}`,
          language_id: snapshot.resolved.language.language_id,
          con_word_romanized: w.word.trim(),
          phonetic_ipa: "",
          phonetic_override: false,
          senses: [
            {
              sense_id: `sense_${idx}`,
              pos_id: w.pos_id ?? "",
              gloss: w.gloss ?? "",
              definitions: [],
              examples: [],
            },
          ],
          etymology: {
            origin_type: "a_priori",
            parent_entry_id: null,
            source_language_id: null,
            applied_sound_changes: [],
            semantic_shift_note: "",
          },
          metadata: { tags: [], created_at: isoNow, updated_at: isoNow },
        }));
      } else if (args.entry_ids && args.entry_ids.length > 0) {
        const idSet = new Set(args.entry_ids);
        candidateSourceWords = snapshot.lex.words.filter((w) =>
          idSet.has(w.entry_id),
        );
      } else {
        candidateSourceWords = snapshot.lex.words.filter(
          (w) => !w.evolution?.is_deprecated,
        );
      }

      const previews: {
        rule_id: string;
        rule_name: string;
        source_pos_id: string;
        target_pos_id: string;
        semantic_note: string;
        source_entry_id: string;
        source_romanized: string;
        source_gloss: string;
        derived_romanized: string;
        derived_ipa: string;
      }[] = [];

      for (const rule of rulesToRun) {
        const matchingWords = args.words
          ? candidateSourceWords.filter(
              (w) =>
                !w.senses[0]?.pos_id ||
                !rule.source_pos_id ||
                w.senses.some((s) => s.pos_id === rule.source_pos_id),
            )
          : candidateSourceWords.filter(
              (w) =>
                !rule.source_pos_id ||
                w.senses.some((s) => s.pos_id === rule.source_pos_id),
            );

        const derivedList = generateDerivedWords(
          matchingWords,
          rule,
          snapshot.phono.config,
          snapshot.gram.config.morphophonology_rules ?? [],
        );
        for (const item of derivedList) {
          previews.push({
            rule_id: rule.rule_id,
            rule_name: rule.name,
            source_pos_id: rule.source_pos_id,
            target_pos_id: rule.target_pos_id,
            semantic_note: rule.semantic_note,
            source_entry_id: item.source.entry_id,
            source_romanized: item.source.con_word_romanized,
            source_gloss: item.source.senses[0]?.gloss ?? "",
            derived_romanized: item.derived,
            derived_ipa: item.ipa,
          });
        }
      }

      const page = paginate(previews, snapshot.gram.revision, {
        limit: args.limit,
        cursor: args.cursor,
      });

      return {
        family_id: family.family_id,
        language_id: snapshot.resolved.language.language_id,
        items: page.items,
        total: page.total,
        next_cursor: page.next_cursor,
        revision: snapshot.gram.revision,
        dependencies: {
          "grammar.json": snapshot.gram.revision,
          "phonology.json": snapshot.phono.revision,
          lexicon: snapshot.lex.revision,
        },
      };
    },
  });

  // 5. gram_analyze_typology
  registerDefinedTool(server, config, {
    name: "gram_analyze_typology",
    title: "Analyze Morphological Typology Indices",
    description:
      "Estimate synthesis_index and fusion_index from the language's lexicon and active inflection rules and compare against configured typology settings.",
    toolsets: ["compute", "audit"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "gram_analyze_typology",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const gram = readGrammarUnlocked(family.project_dir, resolved.language);
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          return { resolved, gram, lex };
        },
      );

      const activeWords = snapshot.lex.words.filter(
        (w) => !w.evolution?.is_deprecated,
      );
      const estimated = analyzeTypology(activeWords, snapshot.gram.config);

      return {
        family_id: family.family_id,
        language_id: snapshot.resolved.language.language_id,
        configured: snapshot.gram.config.typology,
        syntax: snapshot.gram.config.syntax,
        estimated: {
          synthesis_index: Number(estimated.synthesis_index.toFixed(2)),
          fusion_index: Number(estimated.fusion_index.toFixed(2)),
          word_count: estimated.word_count,
          rules_analyzed: estimated.rules_analyzed,
        },
        revision: snapshot.gram.revision,
        dependencies: {
          "grammar.json": snapshot.gram.revision,
          lexicon: snapshot.lex.revision,
        },
      };
    },
  });

  // 6. sandbox_translate
  registerDefinedTool(server, config, {
    name: "sandbox_translate",
    title: "Translate Gloss Sentence in Grammar Sandbox",
    description:
      "Translate gloss strings (e.g. 'dog-NOM see-PST cat-ACC'), role-annotated tokens, or a recursive clause tree into inflected, syntax-ordered conlang sentences with IPA. A clause tree assigns case by the grammar's morphosyntactic alignment and keeps each NP's modifiers attached to its own head.",
    toolsets: ["compute"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      text: z
        .string()
        .optional()
        .describe("Space-separated gloss tokens with optional '-TAG' suffixes, e.g. 'dog-NOM chase-PST cat-ACC'"),
      annotated_tokens: z
        .array(
          z.object({
            gloss: z.string(),
            role: z.enum(["S", "V", "O", "Mod", "Adp", "Other"]),
            tags: z.array(z.string()).optional(),
          }),
        )
        .max(200)
        .optional()
        .describe("Optional syntax-role annotated tokens (applies word-order reordering and automatic case tags)"),
      reorder_syntax: z
        .boolean()
        .optional()
        .describe("When annotated_tokens is provided, reorder by grammar.syntax (default: true)"),
      clause: clauseInputSchema
        .optional()
        .describe(
          "Recursive clause tree; each NP carries its own determiner/numeral/number/adjectives/possessor and nested PP, and the clause may set polarity. Case affixes follow grammar.syntax.alignment and grammar.typology.head_marking.",
        ),
    },
    handler: async (args) => {
      if (
        !args.text?.trim() &&
        (!args.annotated_tokens || args.annotated_tokens.length === 0) &&
        !args.clause
      ) {
        throw new McpError(
          "VALIDATION",
          "Provide non-empty text, annotated_tokens, or a clause tree.",
        );
      }

      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "sandbox_translate",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          const gram = readGrammarUnlocked(family.project_dir, resolved.language);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          return { resolved, lex, gram, phono };
        },
      );

      const wordsMap: Record<string, WordEntry> = {};
      for (const w of snapshot.lex.words) {
        if (!w.evolution?.is_deprecated) {
          wordsMap[w.entry_id] = w;
        }
      }

      let effectiveGlossText = args.text?.trim() ?? "";
      let phrase: ReturnType<typeof linearizeClause> | null = null;
      if (args.clause) {
        phrase = linearizeClause(args.clause, snapshot.gram.config);
        effectiveGlossText = phrase.glossLine;
      } else if (args.annotated_tokens && args.annotated_tokens.length > 0) {
        const prepared: AnnotatedToken[] = args.annotated_tokens.map((tok) => {
          const cleanGloss = tok.gloss.trim();
          const matchedWord = Object.values(wordsMap).find((w) =>
            w.senses.some(
              (s) => s.gloss.toLowerCase().trim() === cleanGloss.toLowerCase(),
            ),
          );
          const posId = matchedWord?.senses[0]?.pos_id ?? "";
          const autoTags = autoApplyInflections(
            tok.role,
            snapshot.gram.config.inflection_dimensions,
            posId,
          );
          const combinedTags = Array.from(
            new Set([...(tok.tags ?? []), ...autoTags]),
          );
          return {
            gloss: cleanGloss,
            role: tok.role,
            tags: combinedTags,
          };
        });

        const ordered =
          args.reorder_syntax === false
            ? prepared
            : reorderBySyntax(prepared, snapshot.gram.config.syntax);

        effectiveGlossText = ordered
          .map((t) =>
            t.tags.length > 0 ? `${t.gloss}-${t.tags.join("-")}` : t.gloss,
          )
          .join(" ");
      }

      const tokens = processSandboxText(
        effectiveGlossText,
        wordsMap,
        snapshot.gram.config,
        snapshot.phono.config,
      );

      const unresolvedGlosses = tokens
        .filter((t) => t.conlang.startsWith("?") && t.conlang.endsWith("?"))
        .map((t) => t.gloss);

      return {
        family_id: family.family_id,
        language_id: snapshot.resolved.language.language_id,
        input_gloss: effectiveGlossText,
        syntax: snapshot.gram.config.syntax,
        conlang_sentence: tokens.map((t) => t.conlang).join(" "),
        ipa_sentence: `/${tokens
          .map((t) => t.ipa.replace(/^\/|\/$/gu, ""))
          .join(" ")}/`,
        gloss_sentence: tokens.map((t) => t.gloss).join(" "),
        phrase: phrase
          ? {
              alignment: phrase.alignment,
              head_marking: phrase.headMarking,
              case_tags: phrase.caseTags,
              words: phrase.words,
              steps: phrase.steps,
              warnings: phrase.warnings,
            }
          : undefined,
        tokens,
        unresolved_glosses: unresolvedGlosses,
        dependencies: {
          lexicon: snapshot.lex.revision,
          "grammar.json": snapshot.gram.revision,
          "phonology.json": snapshot.phono.revision,
        },
      };
    },
  });

  // 7. gram_update
  registerDefinedTool(server, config, {
    name: "gram_update",
    title: "Update Language Grammar Configuration",
    description:
      "Merge partial section updates onto grammar.json while preserving unknown fields on top-level and ID-keyed nested items (pos_id, dim_id, val_id, rule_id, chapter_id, slot_id, class_id), with automatic grammar snapshot and CAS.",
    toolsets: ["write"],
    access: "write",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      ...commonWriteInputFields,
      syntax: z
        .object({
          word_order: z
            .enum(["SVO", "SOV", "VSO", "VOS", "OVS", "OSV"])
            .optional(),
          modifier_position: z.enum(["before_head", "after_head"]).optional(),
          adposition_type: z.enum(["preposition", "postposition"]).optional(),
          alignment: z
            .enum(["nom_acc", "erg_abs", "tripartite"])
            .optional()
            .describe("Morphosyntactic alignment used by the phrase sandbox"),
          case_gloss_map: z
            .object({
              nom: caseDimBindingSchema.optional(),
              acc: caseDimBindingSchema.optional(),
              erg: caseDimBindingSchema.optional(),
              abs: caseDimBindingSchema.optional(),
              gen: caseDimBindingSchema.optional(),
            })
            .optional()
            .describe(
              "Explicit case role -> inflection dimension value binding (partial map allowed; merged with the existing bindings)",
            ),
        })
        .passthrough()
        .optional(),
      typology: z
        .object({
          morphological_type: z
            .enum(["isolating", "agglutinative", "fusional", "polysynthetic"])
            .optional(),
          synthesis_index: z.number().min(1).max(5).optional(),
          fusion_index: z.number().min(1).max(3).optional(),
          head_marking: z
            .enum(["head", "dependent", "double", "none"])
            .optional(),
          auto_estimated: z.boolean().optional(),
        })
        .passthrough()
        .optional(),
      parts_of_speech: z.array(posInputSchema).optional(),
      inflection_dimensions: z.array(dimensionInputSchema).optional(),
      inflection_rules: z.array(inflectionRuleInputSchema).optional(),
      derivation_rules: z.array(derivationRuleInputSchema).optional(),
      grammar_manual: z.array(chapterInputSchema).optional(),
      affix_slots: z.array(affixSlotInputSchema).optional(),
      conjugation_classes: z.array(conjugationClassInputSchema).optional(),
      irregular_overrides: z.array(irregularOverrideInputSchema).optional(),
      morphophonology_rules: z
        .array(morphophonologyRuleSchema)
        .optional()
        .describe("Synchronic morphophonology rules applied across morpheme boundaries"),
    },
    handler: async (args) => {
      assertWriteAllowed(config, "gram_update");
      if (!args.dry_run && !args.operation_id?.trim()) {
        throw new McpError(
          "VALIDATION",
          "operation_id is required when committing writes (omit only for dry_run: true).",
        );
      }

      const hasAnySection =
        args.syntax !== undefined ||
        args.typology !== undefined ||
        args.parts_of_speech !== undefined ||
        args.inflection_dimensions !== undefined ||
        args.inflection_rules !== undefined ||
        args.derivation_rules !== undefined ||
        args.grammar_manual !== undefined ||
        args.affix_slots !== undefined ||
        args.conjugation_classes !== undefined ||
        args.irregular_overrides !== undefined ||
        args.morphophonology_rules !== undefined;

      if (!hasAnySection) {
        throw new McpError(
          "VALIDATION",
          "Provide at least one grammar section to update.",
        );
      }

      const family = resolveFamilyFromArgs(config, args);
      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "gram_update",
        operationId: args.operation_id,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const resolved = resolveLanguage(
            family,
            (args.language ?? args.language_id ?? "").trim(),
            { workspace: ws.config, revision: ws.revision },
          );
          const langDir = assertSafeRelativeLanguagePath(
            family.project_dir,
            resolved.language.path,
          );
          const langRel = normalizeRelPathPosix(resolved.language.path);
          const grammarAbs = path.join(langDir, "grammar.json");
          const grammarRel = `${langRel}/grammar.json`;

          const currentLoad = readGrammarUnlocked(
            family.project_dir,
            resolved.language,
          );
          const currentCfg: GrammarConfig = structuredClone(currentLoad.config);

          let rawDiskObj: Record<string, unknown> = {};
          if (fs.existsSync(grammarAbs)) {
            rawDiskObj = JSON.parse(
              fs.readFileSync(grammarAbs, "utf-8"),
            ) as Record<string, unknown>;
          }

          const nextObj: Record<string, unknown> = {
            ...currentCfg,
            ...rawDiskObj,
            language_id:
              (typeof rawDiskObj.language_id === "string" &&
                rawDiskObj.language_id) ||
              resolved.language.language_id,
          };
          delete nextObj.inflections;

          // 1. syntax
          if (args.syntax !== undefined) {
            const rawSyn = isRecord(rawDiskObj.syntax) ? rawDiskObj.syntax : {};
            const mergedSyntax: Record<string, unknown> = {
              ...currentCfg.syntax,
              ...rawSyn,
              ...args.syntax,
            };
            if (args.syntax.case_gloss_map !== undefined) {
              const prevMap = isRecord(rawSyn.case_gloss_map)
                ? rawSyn.case_gloss_map
                : isRecord(currentCfg.syntax.case_gloss_map)
                  ? currentCfg.syntax.case_gloss_map
                  : {};
              mergedSyntax.case_gloss_map = {
                ...prevMap,
                ...args.syntax.case_gloss_map,
              };
            }
            nextObj.syntax = mergedSyntax;
          } else if (!isRecord(nextObj.syntax)) {
            nextObj.syntax = currentCfg.syntax;
          }

          // 2. typology
          if (args.typology !== undefined) {
            const rawTypo = isRecord(rawDiskObj.typology)
              ? rawDiskObj.typology
              : {};
            nextObj.typology = {
              ...currentCfg.typology,
              ...rawTypo,
              ...args.typology,
            };
          } else if (!isRecord(nextObj.typology)) {
            nextObj.typology = currentCfg.typology;
          }

          // 3. parts_of_speech (preserve unknown by pos_id)
          if (args.parts_of_speech !== undefined) {
            const rawPosById = indexRawArrayByKey(
              rawDiskObj.parts_of_speech,
              "pos_id",
            );
            nextObj.parts_of_speech = args.parts_of_speech.map((p) => {
              const posId = p.pos_id?.trim() || newPrefixedId("pos");
              const prevRaw = rawPosById.get(posId) ?? {};
              return {
                ...prevRaw,
                ...p,
                pos_id: posId,
                name: p.name,
                gloss_abbr:
                  p.gloss_abbr ??
                  (typeof prevRaw.gloss_abbr === "string"
                    ? prevRaw.gloss_abbr
                    : ""),
                word_pattern:
                  p.word_pattern ??
                  (typeof prevRaw.word_pattern === "string"
                    ? prevRaw.word_pattern
                    : ""),
                requires_definition:
                  p.requires_definition ??
                  Boolean(prevRaw.requires_definition),
                requires_pronunciation:
                  p.requires_pronunciation ??
                  Boolean(prevRaw.requires_pronunciation),
              };
            });
          } else if (!Array.isArray(nextObj.parts_of_speech)) {
            nextObj.parts_of_speech = currentCfg.parts_of_speech;
          }

          // 4. inflection_dimensions (preserve unknown by dim_id and nested values by val_id)
          if (args.inflection_dimensions !== undefined) {
            const rawDimsById = indexRawArrayByKey(
              rawDiskObj.inflection_dimensions,
              "dim_id",
            );
            nextObj.inflection_dimensions = args.inflection_dimensions.map(
              (dim) => {
                const dimId = dim.dim_id?.trim() || newPrefixedId("dim");
                const prevDimRaw = rawDimsById.get(dimId) ?? {};
                const rawValsById = indexRawArrayByKey(
                  prevDimRaw.values,
                  "val_id",
                );
                const mergedValues = dim.values.map((val) => {
                  const valId = val.val_id?.trim() || newPrefixedId("val");
                  const prevValRaw = rawValsById.get(valId) ?? {};
                  return {
                    ...prevValRaw,
                    ...val,
                    val_id: valId,
                    name: val.name,
                    gloss: val.gloss,
                  };
                });
                return {
                  ...prevDimRaw,
                  ...dim,
                  dim_id: dimId,
                  name: dim.name,
                  applies_to_pos:
                    dim.applies_to_pos ??
                    (Array.isArray(prevDimRaw.applies_to_pos)
                      ? prevDimRaw.applies_to_pos
                      : []),
                  values: mergedValues,
                };
              },
            );
          } else if (!Array.isArray(nextObj.inflection_dimensions)) {
            nextObj.inflection_dimensions = currentCfg.inflection_dimensions;
          }

          // 5. inflection_rules (preserve unknown by rule_id)
          if (args.inflection_rules !== undefined) {
            const rawRulesSource = Array.isArray(rawDiskObj.inflection_rules)
              ? rawDiskObj.inflection_rules
              : rawDiskObj.inflections;
            const rawRulesById = indexRawArrayByKey(rawRulesSource, "rule_id");
            nextObj.inflection_rules = args.inflection_rules.map((r) => {
              const ruleId = r.rule_id?.trim() || newEntryId();
              const prevRaw = rawRulesById.get(ruleId) ?? {};
              const copyPrev = { ...prevRaw };
              delete copyPrev.pos;
              return {
                ...copyPrev,
                ...r,
                rule_id: ruleId,
                pos_id: r.pos_id,
                dimension_values:
                  r.dimension_values ??
                  (isRecord(prevRaw.dimension_values)
                    ? (prevRaw.dimension_values as Record<string, string>)
                    : {}),
                type: r.type,
                affix:
                  r.affix ??
                  (typeof prevRaw.affix === "string" ? prevRaw.affix : ""),
                tag:
                  r.tag ?? (typeof prevRaw.tag === "string" ? prevRaw.tag : ""),
                match_regex:
                  r.match_regex ??
                  (typeof prevRaw.match_regex === "string"
                    ? prevRaw.match_regex
                    : ".*"),
                disabled: r.disabled ?? Boolean(prevRaw.disabled),
                condition:
                  r.condition !== undefined
                    ? r.condition
                    : ((prevRaw.condition as GrammarConfig["inflection_rules"][number]["condition"]) ??
                      null),
              };
            });
          } else if (!Array.isArray(nextObj.inflection_rules)) {
            nextObj.inflection_rules = currentCfg.inflection_rules;
          }

          // 6. derivation_rules (preserve unknown by rule_id)
          if (args.derivation_rules !== undefined) {
            const rawDerivById = indexRawArrayByKey(
              rawDiskObj.derivation_rules,
              "rule_id",
            );
            nextObj.derivation_rules = args.derivation_rules.map((d) => {
              const ruleId = d.rule_id?.trim() || newEntryId();
              const prevRaw = rawDerivById.get(ruleId) ?? {};
              return {
                ...prevRaw,
                ...d,
                rule_id: ruleId,
                name: d.name,
                source_pos_id: d.source_pos_id,
                target_pos_id: d.target_pos_id,
                type: d.type,
                affix:
                  d.affix ??
                  (typeof prevRaw.affix === "string" ? prevRaw.affix : ""),
                condition:
                  d.condition !== undefined
                    ? d.condition
                    : ((prevRaw.condition as DerivationRule["condition"]) ??
                      null),
                semantic_note:
                  d.semantic_note ??
                  (typeof prevRaw.semantic_note === "string"
                    ? prevRaw.semantic_note
                    : ""),
              };
            });
          } else if (!Array.isArray(nextObj.derivation_rules)) {
            nextObj.derivation_rules = currentCfg.derivation_rules;
          }

          // 7. grammar_manual (preserve unknown by chapter_id & paradigm_id)
          if (args.grammar_manual !== undefined) {
            const rawChaptersById = indexRawArrayByKey(
              rawDiskObj.grammar_manual,
              "chapter_id",
            );
            nextObj.grammar_manual = args.grammar_manual.map((ch, idx) => {
              const chapterId = ch.chapter_id?.trim() || newEntryId();
              const prevCh = rawChaptersById.get(chapterId) ?? {};
              const rawParadigmsById = indexRawArrayByKey(
                prevCh.embedded_paradigms,
                "paradigm_id",
              );
              const paradigms = (ch.embedded_paradigms ?? []).map((p) => {
                const pid = p.paradigm_id?.trim() || newEntryId();
                const prevP = rawParadigmsById.get(pid) ?? {};
                return {
                  ...prevP,
                  ...p,
                  paradigm_id: pid,
                };
              });
              return {
                ...prevCh,
                ...ch,
                chapter_id: chapterId,
                title: ch.title,
                content: ch.content,
                order:
                  ch.order ??
                  (typeof prevCh.order === "number" ? prevCh.order : idx),
                embedded_paradigms:
                  ch.embedded_paradigms !== undefined
                    ? paradigms
                    : Array.isArray(prevCh.embedded_paradigms)
                      ? prevCh.embedded_paradigms
                      : [],
              };
            });
          } else if (!Array.isArray(nextObj.grammar_manual)) {
            nextObj.grammar_manual = currentCfg.grammar_manual;
          }

          // 8. affix_slots (preserve unknown by slot_id)
          if (args.affix_slots !== undefined) {
            const rawSlotsById = indexRawArrayByKey(
              rawDiskObj.affix_slots,
              "slot_id",
            );
            nextObj.affix_slots = args.affix_slots.map((s) => {
              const slotId = s.slot_id?.trim() || newPrefixedId("slot");
              const prevRaw = rawSlotsById.get(slotId) ?? {};
              return {
                ...prevRaw,
                ...s,
                slot_id: slotId,
                position: s.position,
                dimension_id: s.dimension_id,
                is_obligatory:
                  s.is_obligatory ?? Boolean(prevRaw.is_obligatory),
                label:
                  s.label ??
                  (typeof prevRaw.label === "string" ? prevRaw.label : ""),
              };
            });
          } else if (!Array.isArray(nextObj.affix_slots)) {
            nextObj.affix_slots = currentCfg.affix_slots;
          }

          // 9. conjugation_classes (preserve unknown by class_id)
          if (args.conjugation_classes !== undefined) {
            const rawClassesById = indexRawArrayByKey(
              rawDiskObj.conjugation_classes,
              "class_id",
            );
            nextObj.conjugation_classes = args.conjugation_classes.map((cc) => {
              const classId = cc.class_id?.trim() || newPrefixedId("conj");
              const prevRaw = rawClassesById.get(classId) ?? {};
              return {
                ...prevRaw,
                ...cc,
                class_id: classId,
                name: cc.name,
                applies_to_pos: cc.applies_to_pos,
                stem_pattern:
                  cc.stem_pattern ??
                  (typeof prevRaw.stem_pattern === "string"
                    ? prevRaw.stem_pattern
                    : ""),
                rule_ids:
                  cc.rule_ids ??
                  (Array.isArray(prevRaw.rule_ids)
                    ? (prevRaw.rule_ids as string[])
                    : []),
              };
            });
          } else if (!Array.isArray(nextObj.conjugation_classes)) {
            nextObj.conjugation_classes = currentCfg.conjugation_classes;
          }

          // 10. irregular_overrides (preserve unknown by entry_id + dimension_values)
          if (args.irregular_overrides !== undefined) {
            const rawOverrides = new Map<string, Record<string, unknown>>();
            if (Array.isArray(rawDiskObj.irregular_overrides)) {
              for (const ov of rawDiskObj.irregular_overrides) {
                if (
                  isRecord(ov) &&
                  typeof ov.entry_id === "string" &&
                  isRecord(ov.dimension_values)
                ) {
                  const key = `${ov.entry_id}::${canonicalDimKey(ov.dimension_values as Record<string, string>)}`;
                  rawOverrides.set(key, ov);
                }
              }
            }
            nextObj.irregular_overrides = args.irregular_overrides.map((ov) => {
              const key = `${ov.entry_id}::${canonicalDimKey(ov.dimension_values)}`;
              const prevRaw = rawOverrides.get(key) ?? {};
              return {
                ...prevRaw,
                ...ov,
              };
            });
          } else if (!Array.isArray(nextObj.irregular_overrides)) {
            nextObj.irregular_overrides = currentCfg.irregular_overrides;
          }

          // 11. morphophonology_rules (preserve unknown by rule_id)
          if (args.morphophonology_rules !== undefined) {
            const rawMpById = indexRawArrayByKey(
              rawDiskObj.morphophonology_rules,
              "rule_id",
            );
            nextObj.morphophonology_rules = args.morphophonology_rules.map((rule) => {
              const ruleId = rule.rule_id?.trim() || newPrefixedId("mp");
              const prevRaw = rawMpById.get(ruleId) ?? {};
              return {
                ...prevRaw,
                ...rule,
                rule_id: ruleId,
                description:
                  rule.description ??
                  (typeof prevRaw.description === "string"
                    ? prevRaw.description
                    : ""),
                disabled: rule.disabled ?? Boolean(prevRaw.disabled),
                priority:
                  rule.priority ??
                  (typeof prevRaw.priority === "number" ? prevRaw.priority : 0),
                target: rule.target,
                replacement: rule.replacement,
                context_before:
                  rule.context_before ??
                  (typeof prevRaw.context_before === "string"
                    ? prevRaw.context_before
                    : ""),
                context_after:
                  rule.context_after ??
                  (typeof prevRaw.context_after === "string"
                    ? prevRaw.context_after
                    : ""),
                feature_mode: rule.feature_mode ?? Boolean(prevRaw.feature_mode),
                target_features:
                  rule.target_features !== undefined
                    ? rule.target_features
                    : ((prevRaw.target_features as MorphophonologyRule["target_features"]) ??
                      null),
                replacement_features:
                  rule.replacement_features !== undefined
                    ? rule.replacement_features
                    : ((prevRaw.replacement_features as MorphophonologyRule["replacement_features"]) ??
                      null),
                context_before_features:
                  rule.context_before_features !== undefined
                    ? rule.context_before_features
                    : ((prevRaw.context_before_features as MorphophonologyRule["context_before_features"]) ??
                      null),
                context_after_features:
                  rule.context_after_features !== undefined
                    ? rule.context_after_features
                    : ((prevRaw.context_after_features as MorphophonologyRule["context_after_features"]) ??
                      null),
              };
            });
          } else if (
            nextObj.morphophonology_rules === undefined &&
            currentCfg.morphophonology_rules !== undefined
          ) {
            nextObj.morphophonology_rules = currentCfg.morphophonology_rules;
          }

          const diff = computeStructuralDiff(rawDiskObj, nextObj);
          const changed =
            !fs.existsSync(grammarAbs) ||
            diff.added.length > 0 ||
            diff.removed.length > 0 ||
            diff.changed.length > 0;

          const mutations: PlannedMutation[] = [];
          let snapshotId: string | null = null;

          if (changed) {
            const needSnap = shouldAutoSnapshot({
              projectDir: family.project_dir,
              languageId: resolved.language.language_id,
              scope: "grammar",
              batchSize: 1,
            });
            if (needSnap) {
              const snap = planLanguageSnapshot({
                projectDir: family.project_dir,
                language: resolved.language,
                scope: "grammar",
                origin: "mcp",
                operationType: "auto_snapshot",
                description: "MCP gram_update",
              });
              snapshotId = snap.snapshotId;
              mutations.push(...snap.mutations);
              if (!args.dry_run) {
                markSessionScopeWritten(
                  family.project_dir,
                  resolved.language.language_id,
                  "grammar",
                );
              }
            }
            mutations.push({
              kind: "write_file",
              relPath: grammarRel,
              content: JSON.stringify(nextObj, null, 2),
            });
          }

          return {
            expectations: [
              {
                label: "grammar.json",
                targetPath: grammarAbs,
                expectedRevision: args.expected_revision ?? "",
              },
            ],
            mutations,
            languageId: resolved.language.language_id,
            snapshotId,
            auditSummary: `Updated grammar.json for ${resolved.language.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              changed,
              diff,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed,
              language_id: resolved.language.language_id,
              diff,
              revision: newRevisions["grammar.json"],
              revisions: newRevisions,
              snapshot_id: snapshotId,
              summary: changed
                ? `Updated grammar.json for ${resolved.language.name}`
                : `No effective changes to grammar.json for ${resolved.language.name}`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });
}
