import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  generateIPA,
  generateIPATraced,
  romanizationToPhonemesTraced,
} from "../../src/core/engines/ipaGenerator";
import { tokenizePhonemes } from "../../src/core/engines/phonemeTokenizer";
import { analyzeRomanization } from "../../src/core/engines/romanizationLint";
import {
  charactersOf,
  formatCodepoint,
} from "../../src/core/engines/unicodeBlocks";
import { newEntryId } from "../../src/core/lexicon/ids";
import { PHONOLOGY_PRESETS } from "../../src/data/phonology_presets";
import type {
  AllophonyRule,
  PhonemeInventory,
  PhonologyConfig,
  RomanizationMap,
  RomanizationRule,
  ToneDefinition,
} from "../../src/types";
import { assertWriteAllowed, type McpConfig } from "../config";
import { McpError } from "../errors";
import {
  inspectLegacyWritingUnlocked,
  readLexiconUnlocked,
  readPhonologyUnlocked,
  withConsistentProjectRead,
} from "../storage/read";
import { executeProjectTransaction } from "../storage/transaction";
import { registerDefinedTool } from "../toolRegistry";
import {
  commonWriteInputFields,
  familyInputFields,
  languageInputFields,
  planPhonologyWriteUnlocked,
  resolveFamilyFromArgs,
  resolveLanguageUnlocked,
} from "./_helpers";

const PHONO_SECTIONS = [
  "inventory",
  "romanization",
  "phonotactics",
  "tones",
  "allophony",
  "glyph_annotations",
  "font",
] as const;

type PhonoSection = (typeof PHONO_SECTIONS)[number];

function requireOperationIdOnCommit(
  operationId: string | undefined,
  dryRun?: boolean,
): string | undefined {
  if (!dryRun && (!operationId || !operationId.trim())) {
    throw new McpError(
      "VALIDATION",
      "operation_id is required when committing writes (omit only for dry_run: true).",
      "Provide a unique client-generated operation_id or preview first with dry_run: true.",
    );
  }
  return operationId?.trim();
}

function projectPhonologySections(
  cfg: PhonologyConfig,
  sections?: readonly PhonoSection[],
): Partial<PhonologyConfig> & { language_id: string } {
  if (!sections || sections.length === 0) {
    return cfg;
  }
  const set = new Set<PhonoSection>(sections);
  const out: Partial<PhonologyConfig> & { language_id: string } = {
    language_id: cfg.language_id,
  };
  if (set.has("inventory")) {
    out.phoneme_inventory = cfg.phoneme_inventory;
  }
  if (set.has("romanization")) {
    out.romanization_maps = cfg.romanization_maps;
  }
  if (set.has("phonotactics")) {
    out.phonotactics = cfg.phonotactics;
  } else if (set.has("tones")) {
    out.phonotactics = {
      macros: {},
      syllable_structure: cfg.phonotactics.syllable_structure,
      blacklist_patterns: [],
      vowel_harmony: { enabled: false, group_a: [], group_b: [] },
      tone_system: cfg.phonotactics.tone_system,
    };
  }
  if (set.has("allophony")) {
    out.allophony_rules = cfg.allophony_rules;
  }
  if (set.has("glyph_annotations") && cfg.glyph_annotations) {
    out.glyph_annotations = cfg.glyph_annotations;
  }
  if (set.has("font")) {
    out.font_features = cfg.font_features;
    out.font_input = cfg.font_input;
  }
  return out;
}

export interface DerivedRomanizationRuleView extends RomanizationRule {
  chars: { char: string; codepoint: string }[];
  nfd: string;
  is_multichar: boolean;
  has_context: boolean;
  output_in_inventory: boolean;
}

export interface DerivedRomanizationMapView
  extends Omit<RomanizationMap, "rules"> {
  rules: DerivedRomanizationRuleView[];
}

export function buildDerivedRomanizationView(
  maps: readonly RomanizationMap[],
  inventory: PhonemeInventory,
): {
  maps: DerivedRomanizationMapView[];
  summary: {
    total_maps: number;
    total_rules: number;
    input_chars: string[];
    multichar_inputs: string[];
    contextual_rule_count: number;
  };
} {
  const knownNormSet = new Set<string>(
    [...inventory.consonants, ...inventory.vowels]
      .map((p) => p.normalize("NFC"))
      .filter(Boolean),
  );
  const knownNormList = Array.from(knownNormSet);

  const allInputChars = new Set<string>();
  const multiCharInputs = new Set<string>();
  let contextualRuleCount = 0;
  let totalRules = 0;

  const derivedMaps: DerivedRomanizationMapView[] = maps.map((map) => {
    const derivedRules: DerivedRomanizationRuleView[] = map.rules.map((rule) => {
      totalRules += 1;
      const nfc = (rule.input ?? "").normalize("NFC");
      const nfd = (rule.input ?? "").normalize("NFD");
      const cpChars = charactersOf(nfc);
      for (const ch of cpChars) {
        if (ch.trim()) allInputChars.add(ch);
      }
      const isMulti = cpChars.length > 1;
      if (isMulti && nfc) {
        multiCharInputs.add(nfc);
      }
      const beforeTrim = (rule.context_before ?? "").trim();
      const afterTrim = (rule.context_after ?? "").trim();
      const hasContext =
        (beforeTrim.length > 0 && beforeTrim !== "_") ||
        (afterTrim.length > 0 && afterTrim !== "_");
      if (hasContext) {
        contextualRuleCount += 1;
      }

      const outNfc = (rule.output_phoneme ?? "").trim().normalize("NFC");
      let outputInInventory = false;
      if (outNfc) {
        if (knownNormSet.has(outNfc)) {
          outputInInventory = true;
        } else {
          const toks = tokenizePhonemes(outNfc, knownNormList).filter(
            (t) => t.trim().length > 0,
          );
          outputInInventory =
            toks.length > 0 && toks.every((t) => knownNormSet.has(t));
        }
      }

      return {
        ...rule,
        chars: cpChars.map((ch) => ({
          char: ch,
          codepoint: formatCodepoint(ch.codePointAt(0) ?? 0),
        })),
        nfd,
        is_multichar: isMulti,
        has_context: hasContext,
        output_in_inventory: outputInInventory,
      };
    });

    return {
      ...map,
      rules: derivedRules,
    };
  });

  return {
    maps: derivedMaps,
    summary: {
      total_maps: derivedMaps.length,
      total_rules: totalRules,
      input_chars: Array.from(allInputChars).sort(),
      multichar_inputs: Array.from(multiCharInputs).sort(),
      contextual_rule_count: contextualRuleCount,
    },
  };
}

function collectBatchTexts(
  single: string | undefined,
  batch: readonly string[] | undefined,
  wordsAlias: readonly string[] | undefined,
  maxItems: number,
  fieldLabel: string = "texts",
): string[] {
  const combined: string[] = [];
  if (single !== undefined) {
    combined.push(single);
  }
  if (batch !== undefined) {
    combined.push(...batch);
  }
  if (wordsAlias !== undefined) {
    combined.push(...wordsAlias);
  }
  if (combined.length === 0) {
    throw new McpError(
      "VALIDATION",
      `Provide at least one string in "text", "${fieldLabel}", or "words".`,
    );
  }
  if (combined.length > maxItems) {
    throw new McpError(
      "VALIDATION",
      `Batch size ${combined.length} exceeds maximum of ${maxItems}.`,
    );
  }
  return combined;
}

function resolveMapOrDefault(
  config: PhonologyConfig,
  mapId?: string,
): RomanizationMap | undefined {
  if (!mapId || mapId === "default") {
    return (
      config.romanization_maps.find((m) => m.is_default) ??
      config.romanization_maps[0]
    );
  }
  const found = config.romanization_maps.find((m) => m.map_id === mapId);
  if (!found) {
    throw new McpError(
      "NOT_FOUND",
      `Romanization map "${mapId}" not found.`,
      "Call romanization_get to inspect available romanization_maps.",
      {
        available_maps: config.romanization_maps.map((m) => ({
          map_id: m.map_id,
          name: m.name,
          is_default: m.is_default,
        })),
      },
    );
  }
  return found;
}

function stripIpaDelimiters(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("/") && trimmed.endsWith("/") && trimmed.length >= 2) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeRuleMatchKey(
  input: string,
  contextBefore: string | undefined,
  contextAfter: string | undefined,
): string {
  const inp = input.normalize("NFC");
  const befRaw = (contextBefore ?? "").trim().normalize("NFC");
  const aftRaw = (contextAfter ?? "").trim().normalize("NFC");
  const bef = befRaw === "_" ? "" : befRaw;
  const aft = aftRaw === "_" ? "" : aftRaw;
  return `${bef}|${inp}|${aft}`;
}

export function registerPhonologyTools(
  server: McpServer,
  config: McpConfig,
): void {
  // 1. phono_get
  registerDefinedTool(server, config, {
    name: "phono_get",
    title: "Get Phonology Configuration",
    description:
      "Reads a language's phonology configuration, returning both local_config and effective_config (with ancestor-inherited glyph_annotations if applicable), annotations_source, annotations_owner_id, local revision, effective_revision, dependency revisions, and legacy_writing inspection.",
    toolsets: ["core"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      sections: z
        .array(z.enum(PHONO_SECTIONS))
        .optional()
        .describe("Optional sections filter to reduce payload size"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      return await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "phono_get",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const legacy = inspectLegacyWritingUnlocked(
            family.project_dir,
            resolved.language,
          );
          const localCfg = phono.local_config ?? phono.config;
          const effectiveCfg = phono.effective_config ?? phono.config;

          return {
            language_id: resolved.language.language_id,
            language_name: resolved.language.name,
            local_config: projectPhonologySections(localCfg, args.sections),
            effective_config: projectPhonologySections(
              effectiveCfg,
              args.sections,
            ),
            annotations_source: phono.annotations_source ?? "none",
            annotations_owner_id: phono.annotations_owner_id ?? null,
            revision: phono.revision,
            effective_revision: phono.effective_revision ?? phono.revision,
            dependencies: phono.dependencies ?? {},
            legacy_writing: legacy,
          };
        },
      );
    },
  });

  // 2. romanization_get
  registerDefinedTool(server, config, {
    name: "romanization_get",
    title: "Get Romanization Maps & Derived Metadata",
    description:
      "Returns romanization_maps (all maps, default map, or a specific map_id) enriched with per-rule NFC codepoint breakdown, NFD form, multichar/context flags, inventory membership check, input summary, phoneme_inventory, revision, and legacy_writing.needs_review.",
    toolsets: ["core"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      map_id: z
        .string()
        .optional()
        .describe(
          "Optional map_id, 'default', or 'all' (defaults to 'all' maps)",
        ),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      return await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "romanization_get",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const legacy = inspectLegacyWritingUnlocked(
            family.project_dir,
            resolved.language,
          );
          const allMaps = phono.config.romanization_maps;
          const defaultMap =
            allMaps.find((m) => m.is_default) ?? allMaps[0] ?? null;

          let selectedMaps: RomanizationMap[];
          if (!args.map_id || args.map_id === "all") {
            selectedMaps = allMaps;
          } else if (args.map_id === "default") {
            selectedMaps = defaultMap ? [defaultMap] : [];
          } else {
            const match = allMaps.find((m) => m.map_id === args.map_id);
            if (!match) {
              throw new McpError(
                "NOT_FOUND",
                `Romanization map "${args.map_id}" not found in language "${resolved.language.name}".`,
              );
            }
            selectedMaps = [match];
          }

          const derived = buildDerivedRomanizationView(
            selectedMaps,
            phono.config.phoneme_inventory,
          );

          return {
            language_id: resolved.language.language_id,
            language_name: resolved.language.name,
            default_map_id: defaultMap?.map_id ?? null,
            romanization_maps: derived.maps,
            phoneme_inventory: phono.config.phoneme_inventory,
            summary: derived.summary,
            revision: phono.revision,
            legacy_writing: {
              present: legacy.present,
              fields: legacy.fields,
              needs_review: legacy.needs_review,
            },
          };
        },
      );
    },
  });

  // 3. romanization_analyze
  registerDefinedTool(server, config, {
    name: "romanization_analyze",
    title: "Analyze Romanization Health",
    description:
      "Audits romanization maps against phoneme_inventory and lexicon words across all 6 issue categories: unreachable_phonemes, unknown_output_phonemes, conflicting_rules, duplicate_rules, shadowed_rules, and case_issues, plus unmapped lexicon spellings.",
    toolsets: ["audit", "compute"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      map_scope: z
        .string()
        .optional()
        .default("default")
        .describe("'default', 'all', or a specific map_id"),
      max_examples: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("Maximum lexicon unmapped word examples to include"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "romanization_analyze",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          const legacy = inspectLegacyWritingUnlocked(
            family.project_dir,
            resolved.language,
          );
          return { resolved, phono, lex, legacy };
        },
      );

      const { resolved, phono, lex, legacy } = snapshot;
      if (
        args.map_scope !== "default" &&
        args.map_scope !== "all" &&
        !phono.config.romanization_maps.some((m) => m.map_id === args.map_scope)
      ) {
        throw new McpError(
          "NOT_FOUND",
          `Romanization map "${args.map_scope}" not found in language "${resolved.language.name}".`,
        );
      }

      const analysis = analyzeRomanization(phono.config, {
        mapScope: args.map_scope,
      });

      // Cross-check active lexicon words for unmapped characters
      const targetMap =
        args.map_scope !== "default" && args.map_scope !== "all"
          ? phono.config.romanization_maps.find(
              (m) => m.map_id === args.map_scope,
            )
          : phono.config.romanization_maps.find((m) => m.is_default) ??
            phono.config.romanization_maps[0];

      const unmappedCharsSet = new Set<string>();
      const unmappedExamples: {
        entry_id: string;
        spelling: string;
        unmapped_chars: string[];
      }[] = [];
      let unmappedWordCount = 0;
      const activeWords = lex.words.filter((w) => !w.evolution?.is_deprecated);

      if (targetMap && targetMap.rules.length > 0) {
        for (const w of activeWords) {
          const traced = romanizationToPhonemesTraced(
            w.con_word_romanized,
            targetMap,
          );
          const fallbacks = traced.segments
            .filter(
              (seg) =>
                seg.kind === "fallback" &&
                !/^\s+$/u.test(seg.input) &&
                !/^\p{P}+$/u.test(seg.input),
            )
            .map((seg) => seg.input);
          if (fallbacks.length > 0) {
            unmappedWordCount += 1;
            const uniq = Array.from(new Set(fallbacks));
            for (const ch of uniq) unmappedCharsSet.add(ch);
            if (unmappedExamples.length < args.max_examples) {
              unmappedExamples.push({
                entry_id: w.entry_id,
                spelling: w.con_word_romanized,
                unmapped_chars: uniq,
              });
            }
          }
        }
      }

      return {
        language_id: resolved.language.language_id,
        language_name: resolved.language.name,
        map_ids: analysis.map_ids,
        unreachable_phonemes: analysis.unreachable_phonemes,
        unknown_output_phonemes: analysis.unknown_output_phonemes,
        conflicting_rules: analysis.conflicting_rules,
        duplicate_rules: analysis.duplicate_rules,
        shadowed_rules: analysis.shadowed_rules,
        case_issues: analysis.case_issues,
        lexicon_unmapped: {
          words_scanned: activeWords.length,
          unmapped_word_count: unmappedWordCount,
          unmapped_chars: Array.from(unmappedCharsSet).sort(),
          examples: unmappedExamples,
        },
        legacy_needs_review: legacy.needs_review,
        summary: {
          ...analysis.summary,
          lexicon_unmapped_words: unmappedWordCount,
          legacy_needs_review: legacy.needs_review.length,
        },
        revision: phono.revision,
        effective_revision: phono.effective_revision ?? phono.revision,
        dependencies: {
          ...(phono.dependencies ?? {}),
          lexicon: lex.revision,
        },
      };
    },
  });

  // 4. phono_to_ipa
  registerDefinedTool(server, config, {
    name: "phono_to_ipa",
    title: "Convert Romanized Text to IPA",
    description:
      "Converts up to 500 romanized words or phrases into phonemic /.../ and surface [...] IPA using the shared GUI IPA engine, optionally selecting map_id and returning full segment + allophony step trace.",
    toolsets: ["compute", "core"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      text: z.string().optional().describe("Single romanized text to convert"),
      texts: z
        .array(z.string())
        .max(500)
        .optional()
        .describe("Batch of up to 500 romanized strings"),
      words: z
        .array(z.string())
        .max(500)
        .optional()
        .describe("Alias for texts: batch of up to 500 romanized words"),
      map_id: z
        .string()
        .optional()
        .describe("Optional romanization map_id (defaults to default map)"),
      include_trace: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Include codepoint-provenance RomanizationSegment[] and AllophonyStep[]",
        ),
      stem_start: z.number().int().min(0).optional().describe("Optional raw input codepoint offset of the stem, used for stress after grammatical prefixes"),
    },
    handler: async (args) => {
      const inputs = collectBatchTexts(
        args.text,
        args.texts,
        args.words,
        500,
        "texts",
      );
      const family = resolveFamilyFromArgs(config, args);

      const { resolved, phono } = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "phono_to_ipa",
        () => {
          const r = resolveLanguageUnlocked(family, args);
          const p = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            r.language,
          );
          return { resolved: r, phono: p };
        },
      );

      const selectedMap = resolveMapOrDefault(phono.config, args.map_id);
      const effectiveConfig: PhonologyConfig = selectedMap
        ? {
            ...phono.config,
            romanization_maps: [
              { ...selectedMap, is_default: true },
              ...phono.config.romanization_maps
                .filter((m) => m.map_id !== selectedMap.map_id)
                .map((m) => ({ ...m, is_default: false })),
            ],
          }
        : phono.config;

      const results = inputs.map((word) => {
        if (args.stem_start !== undefined && args.stem_start > Array.from(word).length) {
          throw new McpError("VALIDATION", "stem_start exceeds the input codepoint length.");
        }
        const traced = generateIPATraced(word, effectiveConfig, { stem_start: args.stem_start });
        const unmatchedChars =
          traced.romanization?.segments
            .filter(
              (seg) => seg.kind === "fallback" && !/^\s+$/u.test(seg.input),
            )
            .map((seg) => seg.input) ?? [];

        return {
          input: word,
          phonemic: traced.phonemic,
          surface: traced.surface,
          unmatched_chars: unmatchedChars,
          ...(args.include_trace
            ? {
                trace: {
                  normalized_input: traced.romanization?.normalized_input ?? "",
                  segments: traced.romanization?.segments ?? [],
                  allophony_steps: traced.allophony_steps,
                  ...(traced.prosody ? { prosody: traced.prosody } : {}),
                },
              }
            : {}),
        };
      });

      return {
        language_id: resolved.language.language_id,
        map_id: selectedMap?.map_id ?? null,
        revision: phono.revision,
        results,
      };
    },
  });

  // 5. phono_tokenize
  registerDefinedTool(server, config, {
    name: "phono_tokenize",
    title: "Tokenize Phonetic or Romanized Strings",
    description:
      "Batch tokenizes phonetic/IPA strings (or romanized words via romanization map) into greedy longest-match phoneme tokens against the language's phoneme_inventory.",
    toolsets: ["compute"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      text: z.string().optional().describe("Single string to tokenize"),
      texts: z
        .array(z.string())
        .max(500)
        .optional()
        .describe("Batch of up to 500 strings"),
      words: z
        .array(z.string())
        .max(500)
        .optional()
        .describe("Alias for texts: batch of up to 500 strings"),
      input_mode: z
        .enum(["ipa", "romanized"])
        .optional()
        .default("ipa")
        .describe("Interpret inputs as phonetic/IPA strings or romanized spellings"),
      map_id: z
        .string()
        .optional()
        .describe("Romanization map_id when input_mode is 'romanized'"),
    },
    handler: async (args) => {
      const inputs = collectBatchTexts(
        args.text,
        args.texts,
        args.words,
        500,
        "texts",
      );
      const family = resolveFamilyFromArgs(config, args);

      const { resolved, phono } = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "phono_tokenize",
        () => {
          const r = resolveLanguageUnlocked(family, args);
          const p = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            r.language,
          );
          return { resolved: r, phono: p };
        },
      );

      const inventory = [
        ...phono.config.phoneme_inventory.consonants,
        ...phono.config.phoneme_inventory.vowels,
      ];
      const inventorySet = new Set(inventory);
      const selectedMap =
        args.input_mode === "romanized"
          ? resolveMapOrDefault(phono.config, args.map_id)
          : undefined;

      const results = inputs.map((item) => {
        if (args.input_mode === "romanized") {
          if (!selectedMap) {
            const fallbackTokens = tokenizePhonemes(item, inventory);
            return {
              input: item,
              phoneme_string: item,
              tokens: fallbackTokens,
              unknown_tokens: fallbackTokens.filter(
                (t) => t.trim().length > 0 && !inventorySet.has(t),
              ),
              segments: [],
            };
          }
          const romTrace = romanizationToPhonemesTraced(item, selectedMap);
          const tokens = tokenizePhonemes(romTrace.output, inventory);
          return {
            input: item,
            phoneme_string: romTrace.output,
            tokens,
            unknown_tokens: tokens.filter(
              (t) => t.trim().length > 0 && !inventorySet.has(t),
            ),
            segments: romTrace.segments,
          };
        }

        const cleaned = stripIpaDelimiters(item);
        const tokens = tokenizePhonemes(cleaned, inventory);
        return {
          input: item,
          cleaned_input: cleaned,
          tokens,
          unknown_tokens: tokens.filter(
            (t) => t.trim().length > 0 && !inventorySet.has(t),
          ),
        };
      });

      return {
        language_id: resolved.language.language_id,
        input_mode: args.input_mode,
        map_id: selectedMap?.map_id ?? null,
        revision: phono.revision,
        results,
      };
    },
  });

  // 6. phono_presets_list
  registerDefinedTool(server, config, {
    name: "phono_presets_list",
    title: "List Built-in Phonology Presets",
    description:
      "Lists built-in naturalistic phonology presets (consonants, vowels, and syllable structure templates) that can be applied via phono_apply_preset.",
    toolsets: ["core", "write"],
    access: "read",
    inputSchema: {},
    handler: () => {
      const presets = PHONOLOGY_PRESETS.map((p) => ({
        id: p.id,
        consonants: p.consonants,
        vowels: p.vowels,
        consonant_count: p.consonants.length,
        vowel_count: p.vowels.length,
        syllable_structure: p.syllable_structure,
        name_key: p.nameKey,
        description_key: p.descriptionKey,
      }));
      return {
        total: presets.length,
        presets,
      };
    },
  });

  // 7. phono_update
  const phonoInventoryPatchSchema = z
    .object({
      consonants: z.array(z.string()).optional(),
      vowels: z.array(z.string()).optional(),
    })
    .passthrough();

  const vowelHarmonyPatchSchema = z
    .object({
      enabled: z.boolean().optional(),
      group_a: z.array(z.string()).optional(),
      group_b: z.array(z.string()).optional(),
    })
    .passthrough();

  const toneInputSchema = z
    .object({
      tone_id: z.string().optional(),
      name: z.string(),
      marker: z.string(),
    })
    .passthrough();

  const toneSystemPatchSchema = z
    .object({
      enabled: z.boolean().optional(),
      tones: z.array(toneInputSchema).optional(),
    })
    .passthrough();

  const phonotacticsPatchSchema = z
    .object({
      macros: z.record(z.string(), z.array(z.string())).optional(),
      syllable_structure: z.string().optional(),
      blacklist_patterns: z.array(z.string()).optional(),
      vowel_harmony: vowelHarmonyPatchSchema.optional(),
      tone_system: toneSystemPatchSchema.optional(),
      stress: z.object({ position: z.literal("initial"), domain: z.enum(["word", "entry"]) }).nullable().optional(),
    })
    .passthrough();

  const allophonyRuleInputSchema = z
    .object({
      rule_id: z.string().optional(),
      description: z.string().optional(),
      target: z.string().min(1),
      replacement: z.string(),
      context_before: z.string().optional(),
      context_after: z.string().optional(),
      priority: z.number().optional(),
    })
    .passthrough();

  registerDefinedTool(server, config, {
    name: "phono_update",
    title: "Update Phonology Sections",
    description:
      "Merges partial updates to phoneme_inventory, phonotactics, and/or allophony_rules strictly onto local_config (preserving unknown fields and never copying inherited glyph_annotations into local_config).",
    toolsets: ["write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      phoneme_inventory: phonoInventoryPatchSchema.optional(),
      phonotactics: phonotacticsPatchSchema.optional(),
      allophony_rules: z.array(allophonyRuleInputSchema).optional(),
      font_features: z.array(z.string().regex(/^[+-]?[A-Za-z0-9]{4}(?:=\d+)?$/)).optional(),
      font_input: z.object({
        phonemes: z.record(z.string().min(1), z.string()),
        vowels: z.array(z.string().min(1)),
        multigraphs: z.array(z.string().min(2)),
        separator: z.string().min(1),
        use_parent_phonemes: z.boolean().optional(),
        source_substitutions: z.record(z.string().min(1), z.string()).optional(),
      }).nullable().optional(),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "phono_update");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      if (
        args.phoneme_inventory === undefined &&
        args.phonotactics === undefined &&
        args.allophony_rules === undefined &&
        args.font_features === undefined &&
        args.font_input === undefined
      ) {
        throw new McpError(
          "VALIDATION",
          "Provide at least one phonology or font input section to update.",
        );
      }

      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "phono_update",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId, warnings }) => {
          const resolved = resolveLanguageUnlocked(family, args);
          const updatedSections: string[] = [];

          const plan = planPhonologyWriteUnlocked({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            language: resolved.language,
            operationId,
            expectedRevision: args.expected_revision,
            dryRun: args.dry_run,
            description: `Update phonology for '${resolved.language.name}'`,
            buildNextLocalConfig: (currentLocal) => {
              const next = structuredClone(currentLocal);

              if (args.font_features !== undefined) {
                next.font_features = [...args.font_features];
                updatedSections.push("font_features");
              }
              if (args.font_input !== undefined) {
                if (args.font_input === null) delete next.font_input;
                else next.font_input = structuredClone(args.font_input);
                updatedSections.push("font_input");
              }

              if (args.phoneme_inventory) {
                updatedSections.push("phoneme_inventory");
                next.phoneme_inventory = {
                  ...currentLocal.phoneme_inventory,
                  ...(args.phoneme_inventory as Partial<PhonemeInventory>),
                  consonants:
                    args.phoneme_inventory.consonants ??
                    currentLocal.phoneme_inventory.consonants,
                  vowels:
                    args.phoneme_inventory.vowels ??
                    currentLocal.phoneme_inventory.vowels,
                };
              }

              if (args.phonotactics) {
                updatedSections.push("phonotactics");
                const prevPt = currentLocal.phonotactics;
                const patchPt = args.phonotactics;

                const existingTonesById = new Map(
                  prevPt.tone_system.tones.map((t) => [t.tone_id, t]),
                );
                const mergedTones: ToneDefinition[] =
                  patchPt.tone_system?.tones !== undefined
                    ? patchPt.tone_system.tones.map((t) => {
                        const tid = t.tone_id?.trim() || newEntryId();
                        const prevTone = existingTonesById.get(tid);
                        return {
                          ...(prevTone ?? {}),
                          ...(t as unknown as ToneDefinition),
                          tone_id: tid,
                          name: t.name,
                          marker: t.marker,
                        };
                      })
                    : prevPt.tone_system.tones;

                next.phonotactics = {
                  ...prevPt,
                  ...(patchPt as unknown as Partial<PhonologyConfig["phonotactics"]>),
                  macros: patchPt.macros ?? prevPt.macros,
                  syllable_structure:
                    patchPt.syllable_structure ?? prevPt.syllable_structure,
                  blacklist_patterns:
                    patchPt.blacklist_patterns ?? prevPt.blacklist_patterns,
                  vowel_harmony: patchPt.vowel_harmony
                    ? {
                        ...prevPt.vowel_harmony,
                        ...patchPt.vowel_harmony,
                        enabled:
                          patchPt.vowel_harmony.enabled ??
                          prevPt.vowel_harmony.enabled,
                        group_a:
                          patchPt.vowel_harmony.group_a ??
                          prevPt.vowel_harmony.group_a,
                        group_b:
                          patchPt.vowel_harmony.group_b ??
                          prevPt.vowel_harmony.group_b,
                      }
                    : prevPt.vowel_harmony,
                  tone_system: patchPt.tone_system
                    ? {
                        ...prevPt.tone_system,
                        ...patchPt.tone_system,
                        enabled:
                          patchPt.tone_system.enabled ??
                          prevPt.tone_system.enabled,
                        tones: mergedTones,
                      }
                    : prevPt.tone_system,
                };
              }

              if (args.allophony_rules !== undefined) {
                updatedSections.push("allophony_rules");
                const existingById = new Map(
                  currentLocal.allophony_rules.map((r) => [r.rule_id, r]),
                );
                next.allophony_rules = args.allophony_rules.map((r, idx) => {
                  const rid = r.rule_id?.trim() || newEntryId();
                  const prevRule = existingById.get(rid);
                  return {
                    ...(prevRule ?? {}),
                    ...(r as unknown as AllophonyRule),
                    rule_id: rid,
                    description: r.description ?? prevRule?.description ?? "",
                    target: r.target,
                    replacement: r.replacement,
                    context_before:
                      r.context_before ?? prevRule?.context_before ?? "",
                    context_after:
                      r.context_after ?? prevRule?.context_after ?? "",
                    priority:
                      r.priority ??
                      prevRule?.priority ??
                      args.allophony_rules!.length - idx,
                  };
                });
              }

              // Strictly preserve local_config.glyph_annotations as-is; never inject inherited annotations
              return next;
            },
          });

          warnings.push(...plan.warnings);

          return {
            expectations: [plan.expectation],
            mutations: plan.mutations,
            languageId: resolved.language.language_id,
            snapshotId: plan.snapshotId,
            auditSummary: `Updated phonology sections [${updatedSections.join(", ")}] for ${resolved.language.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              updated_sections: updatedSections,
              legacy_archive_file: plan.legacyArchiveFile,
              after_local: {
                phoneme_inventory: plan.afterLocal.phoneme_inventory,
                phonotactics: plan.afterLocal.phonotactics,
                allophony_rules_count: plan.afterLocal.allophony_rules.length,
              },
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, txWarnings) => ({
              operation_id: operationId,
              committed: true,
              changed: true,
              language_id: resolved.language.language_id,
              updated_sections: updatedSections,
              snapshot_id: plan.snapshotId,
              legacy_archive_file: plan.legacyArchiveFile,
              revision: newRevisions["phonology.json"],
              revisions: newRevisions,
              summary: `Updated phonology (${updatedSections.join(", ")}) for '${resolved.language.name}'.`,
              warnings: txWarnings.length > 0 ? txWarnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 8. romanization_upsert_rules
  const romanizationRuleInputSchema = z
    .object({
      rule_id: z.string().optional(),
      input: z.string().min(1),
      output_phoneme: z.string(),
      output_type: z.enum(["phoneme", "separator"]).optional(),
      context_before: z.string().optional(),
      context_after: z.string().optional(),
    })
    .passthrough();

  registerDefinedTool(server, config, {
    name: "romanization_upsert_rules",
    title: "Upsert Romanization Rules",
    description:
      "Upserts up to 500 romanization rules into the target or default romanization map, matching existing rules by rule_id or (input, context_before, context_after) while preserving unknown rule fields.",
    toolsets: ["write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      map_id: z
        .string()
        .optional()
        .describe(
          "Target romanization map_id (defaults to default map, creating one if none exists)",
        ),
      position: z
        .enum(["append", "prepend"])
        .optional()
        .default("append")
        .describe("Where to insert newly created rules"),
      rules: z
        .array(romanizationRuleInputSchema)
        .min(1)
        .max(500)
        .describe("Rules to insert or update"),
      preview_ipa_impact: z
        .boolean()
        .optional()
        .default(false)
        .describe("Compute count of non-override lexicon entries whose IPA would change"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "romanization_upsert_rules");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "romanization_upsert_rules",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId, warnings }) => {
          const resolved = resolveLanguageUnlocked(family, args);
          let targetMapId = "";
          let insertedCount = 0;
          let updatedCount = 0;
          const affectedRuleIds: string[] = [];

          const plan = planPhonologyWriteUnlocked({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            language: resolved.language,
            operationId,
            expectedRevision: args.expected_revision,
            dryRun: args.dry_run,
            batchSize: args.rules.length,
            description: `Upsert ${args.rules.length} romanization rule(s) in '${resolved.language.name}'`,
            buildNextLocalConfig: (currentLocal) => {
              const next = structuredClone(currentLocal);
              let mapIdx = -1;

              if (args.map_id) {
                mapIdx = next.romanization_maps.findIndex(
                  (m) => m.map_id === args.map_id,
                );
                if (mapIdx < 0) {
                  throw new McpError(
                    "NOT_FOUND",
                    `Romanization map "${args.map_id}" not found in language "${resolved.language.name}".`,
                  );
                }
              } else {
                mapIdx = next.romanization_maps.findIndex((m) => m.is_default);
                if (mapIdx < 0 && next.romanization_maps.length > 0) {
                  mapIdx = 0;
                }
                if (mapIdx < 0) {
                  next.romanization_maps.push({
                    map_id: newEntryId(),
                    name: "Default",
                    is_default: true,
                    rules: [],
                  });
                  mapIdx = 0;
                }
              }

              const targetMap = next.romanization_maps[mapIdx];
              targetMapId = targetMap.map_id;
              const currentRules = [...targetMap.rules];
              const prependedRules: RomanizationRule[] = [];

              for (const rawRule of args.rules) {
                const explicitId = rawRule.rule_id?.trim();
                let matchIdx = -1;

                if (explicitId) {
                  matchIdx = currentRules.findIndex(
                    (r) => r.rule_id === explicitId,
                  );
                }
                if (matchIdx < 0) {
                  const key = normalizeRuleMatchKey(
                    rawRule.input,
                    rawRule.context_before,
                    rawRule.context_after,
                  );
                  matchIdx = currentRules.findIndex(
                    (r) =>
                      normalizeRuleMatchKey(
                        r.input,
                        r.context_before,
                        r.context_after,
                      ) === key,
                  );
                }

                if (matchIdx >= 0) {
                  const prev = currentRules[matchIdx];
                  const merged: RomanizationRule = {
                    ...prev,
                    ...(rawRule as unknown as RomanizationRule),
                    rule_id: prev.rule_id || explicitId || newEntryId(),
                    input: rawRule.input,
                    output_phoneme: rawRule.output_phoneme,
                    context_before:
                      rawRule.context_before !== undefined
                        ? rawRule.context_before
                        : prev.context_before,
                    context_after:
                      rawRule.context_after !== undefined
                        ? rawRule.context_after
                        : prev.context_after,
                  };
                  currentRules[matchIdx] = merged;
                  updatedCount += 1;
                  affectedRuleIds.push(merged.rule_id);
                } else {
                  const created: RomanizationRule = {
                    ...(rawRule as unknown as RomanizationRule),
                    rule_id: explicitId || newEntryId(),
                    input: rawRule.input,
                    output_phoneme: rawRule.output_phoneme,
                    context_before: rawRule.context_before ?? "",
                    context_after: rawRule.context_after ?? "",
                  };
                  if (args.position === "prepend") {
                    prependedRules.push(created);
                  } else {
                    currentRules.push(created);
                  }
                  insertedCount += 1;
                  affectedRuleIds.push(created.rule_id);
                }
              }

              targetMap.rules = [...prependedRules, ...currentRules];
              return next;
            },
          });

          warnings.push(...plan.warnings);

          let ipaImpact:
            | {
                non_override_words_checked: number;
                words_changing_ipa: number;
              }
            | undefined;
          if (args.preview_ipa_impact || args.dry_run) {
            const lex = readLexiconUnlocked(
              family.project_dir,
              resolved.language,
            );
            const candidates = lex.words.filter((w) => !w.phonetic_override);
            let changing = 0;
            for (const w of candidates) {
              const beforeIpa = generateIPA(
                w.con_word_romanized,
                plan.beforeLocal,
              );
              const afterIpa = generateIPA(
                w.con_word_romanized,
                plan.afterLocal,
              );
              if (
                beforeIpa.phonemic !== afterIpa.phonemic ||
                beforeIpa.surface !== afterIpa.surface
              ) {
                changing += 1;
              }
            }
            ipaImpact = {
              non_override_words_checked: candidates.length,
              words_changing_ipa: changing,
            };
          }

          return {
            expectations: [plan.expectation],
            mutations: plan.mutations,
            languageId: resolved.language.language_id,
            snapshotId: plan.snapshotId,
            auditSummary: `Upserted romanization rules in map ${targetMapId} (${insertedCount} inserted, ${updatedCount} updated)`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              map_id: targetMapId,
              inserted_count: insertedCount,
              updated_count: updatedCount,
              rule_ids: affectedRuleIds,
              ipa_impact: ipaImpact,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, txWarnings) => ({
              operation_id: operationId,
              committed: true,
              changed: insertedCount > 0 || updatedCount > 0,
              language_id: resolved.language.language_id,
              map_id: targetMapId,
              inserted_count: insertedCount,
              updated_count: updatedCount,
              rule_ids: affectedRuleIds,
              ipa_impact: ipaImpact,
              snapshot_id: plan.snapshotId,
              revision: newRevisions["phonology.json"],
              revisions: newRevisions,
              summary: `Upserted romanization rules in map ${targetMapId}: ${insertedCount} inserted, ${updatedCount} updated.`,
              warnings: txWarnings.length > 0 ? txWarnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 9. romanization_delete_rules
  registerDefinedTool(server, config, {
    name: "romanization_delete_rules",
    title: "Delete Romanization Rules",
    description:
      "Deletes specified romanization rules by rule_id from the target or default romanization map.",
    toolsets: ["write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      map_id: z
        .string()
        .optional()
        .describe("Target romanization map_id (defaults to default map)"),
      rule_ids: z
        .array(z.string().min(1))
        .min(1)
        .max(500)
        .describe("Rule IDs to remove"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "romanization_delete_rules");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "romanization_delete_rules",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId, warnings }) => {
          const resolved = resolveLanguageUnlocked(family, args);
          const idSet = new Set(args.rule_ids.map((id) => id.trim()));
          let targetMapId = "";
          const deletedIds: string[] = [];
          const missingIds: string[] = [];

          const plan = planPhonologyWriteUnlocked({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            language: resolved.language,
            operationId,
            expectedRevision: args.expected_revision,
            dryRun: args.dry_run,
            batchSize: idSet.size,
            description: `Delete ${idSet.size} romanization rule(s) in '${resolved.language.name}'`,
            buildNextLocalConfig: (currentLocal) => {
              const next = structuredClone(currentLocal);
              const map = args.map_id
                ? next.romanization_maps.find((m) => m.map_id === args.map_id)
                : next.romanization_maps.find((m) => m.is_default) ??
                  next.romanization_maps[0];

              if (!map) {
                throw new McpError(
                  "NOT_FOUND",
                  args.map_id
                    ? `Romanization map "${args.map_id}" not found.`
                    : `Language "${resolved.language.name}" has no romanization maps.`,
                );
              }
              targetMapId = map.map_id;
              const existingIds = new Set(map.rules.map((r) => r.rule_id));
              for (const reqId of idSet) {
                if (existingIds.has(reqId)) {
                  deletedIds.push(reqId);
                } else {
                  missingIds.push(reqId);
                }
              }
              map.rules = map.rules.filter((r) => !idSet.has(r.rule_id));
              return next;
            },
          });

          warnings.push(...plan.warnings);
          if (missingIds.length > 0) {
            warnings.push(
              `Rule ID(s) not found in map ${targetMapId}: ${missingIds.join(", ")}`,
            );
          }

          return {
            expectations: [plan.expectation],
            mutations: deletedIds.length > 0 ? plan.mutations : [],
            languageId: resolved.language.language_id,
            snapshotId: deletedIds.length > 0 ? plan.snapshotId : null,
            auditSummary: `Deleted ${deletedIds.length} romanization rule(s) from map ${targetMapId}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              map_id: targetMapId,
              deleted_rule_ids: deletedIds,
              not_found_rule_ids: missingIds,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, txWarnings) => ({
              operation_id: operationId,
              committed: true,
              changed: deletedIds.length > 0,
              language_id: resolved.language.language_id,
              map_id: targetMapId,
              deleted_count: deletedIds.length,
              deleted_rule_ids: deletedIds,
              not_found_rule_ids: missingIds,
              snapshot_id: deletedIds.length > 0 ? plan.snapshotId : null,
              revision: newRevisions["phonology.json"],
              revisions: newRevisions,
              summary: `Deleted ${deletedIds.length} rule(s) from romanization map ${targetMapId}.`,
              warnings: txWarnings.length > 0 ? txWarnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 10. romanization_map_upsert
  registerDefinedTool(server, config, {
    name: "romanization_map_upsert",
    title: "Create, Update, or Delete Romanization Map",
    description:
      "Creates or updates a RomanizationMap's metadata (name, is_default — automatically unsetting is_default on sibling maps when true), or deletes a map when delete: true.",
    toolsets: ["write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      map_id: z
        .string()
        .optional()
        .describe("Existing map_id to update/delete, or optional custom ID for creation"),
      name: z
        .string()
        .min(1)
        .optional()
        .describe("Display name of the romanization map (required when creating)"),
      is_default: z
        .boolean()
        .optional()
        .describe("Set this map as default (toggles other maps' is_default to false)"),
      delete: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, removes the specified map_id"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "romanization_map_upsert");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      if (args.delete && !args.map_id?.trim()) {
        throw new McpError(
          "VALIDATION",
          'Parameter "map_id" is required when delete is true.',
        );
      }

      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "romanization_map_upsert",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId, warnings }) => {
          const resolved = resolveLanguageUnlocked(family, args);
          let action: "created" | "updated" | "deleted" = "updated";
          let resultMapId = "";

          const plan = planPhonologyWriteUnlocked({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            language: resolved.language,
            operationId,
            expectedRevision: args.expected_revision,
            dryRun: args.dry_run,
            description: `Upsert romanization map in '${resolved.language.name}'`,
            buildNextLocalConfig: (currentLocal) => {
              const next = structuredClone(currentLocal);
              const reqId = args.map_id?.trim();

              if (args.delete) {
                const idx = next.romanization_maps.findIndex(
                  (m) => m.map_id === reqId,
                );
                if (idx < 0) {
                  throw new McpError(
                    "NOT_FOUND",
                    `Romanization map "${reqId}" not found.`,
                  );
                }
                const [removed] = next.romanization_maps.splice(idx, 1);
                resultMapId = removed.map_id;
                action = "deleted";
                if (removed.is_default && next.romanization_maps.length > 0) {
                  next.romanization_maps[0].is_default = true;
                }
                return next;
              }

              const existingIdx = reqId
                ? next.romanization_maps.findIndex((m) => m.map_id === reqId)
                : -1;

              if (existingIdx >= 0) {
                action = "updated";
                const existing = next.romanization_maps[existingIdx];
                resultMapId = existing.map_id;
                const makeDefault =
                  args.is_default !== undefined
                    ? args.is_default
                    : existing.is_default;
                next.romanization_maps[existingIdx] = {
                  ...existing,
                  name: args.name?.trim() ?? existing.name,
                  is_default: makeDefault,
                };
                if (makeDefault) {
                  next.romanization_maps = next.romanization_maps.map(
                    (m, idx) =>
                      idx === existingIdx ? m : { ...m, is_default: false },
                  );
                }
              } else {
                if (!args.name?.trim()) {
                  throw new McpError(
                    "VALIDATION",
                    'Parameter "name" is required when creating a new romanization map.',
                  );
                }
                action = "created";
                resultMapId = reqId || newEntryId();
                const makeDefault =
                  args.is_default ?? next.romanization_maps.length === 0;
                if (makeDefault) {
                  next.romanization_maps = next.romanization_maps.map((m) => ({
                    ...m,
                    is_default: false,
                  }));
                }
                next.romanization_maps.push({
                  map_id: resultMapId,
                  name: args.name.trim(),
                  is_default: makeDefault,
                  rules: [],
                });
              }

              return next;
            },
          });

          warnings.push(...plan.warnings);

          return {
            expectations: [plan.expectation],
            mutations: plan.mutations,
            languageId: resolved.language.language_id,
            snapshotId: plan.snapshotId,
            auditSummary: `${action} romanization map ${resultMapId} in ${resolved.language.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              action,
              map_id: resultMapId,
              maps: plan.afterLocal.romanization_maps.map((m) => ({
                map_id: m.map_id,
                name: m.name,
                is_default: m.is_default,
                rule_count: m.rules.length,
              })),
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, txWarnings) => ({
              operation_id: operationId,
              committed: true,
              changed: true,
              action,
              map_id: resultMapId,
              maps: plan.afterLocal.romanization_maps.map((m) => ({
                map_id: m.map_id,
                name: m.name,
                is_default: m.is_default,
                rule_count: m.rules.length,
              })),
              snapshot_id: plan.snapshotId,
              revision: newRevisions["phonology.json"],
              revisions: newRevisions,
              summary: `Romanization map ${resultMapId} ${action} in '${resolved.language.name}'.`,
              warnings: txWarnings.length > 0 ? txWarnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 11. phono_apply_preset
  registerDefinedTool(server, config, {
    name: "phono_apply_preset",
    title: "Apply Built-in Phonology Preset",
    description:
      "Applies a built-in phonology preset from phono_presets_list to a language's local_config with merge_mode 'replace' or 'union'.",
    toolsets: ["write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      preset_id: z.string().min(1).describe("Preset ID from phono_presets_list"),
      merge_mode: z
        .enum(["replace", "union"])
        .default("replace")
        .describe("'replace' overwrites inventory & syllable structure; 'union' merges deduplicated phonemes"),
      apply_syllable_structure: z
        .boolean()
        .optional()
        .describe("Override whether syllable_structure is updated (defaults to true for replace, false for union)"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "phono_apply_preset");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const preset = PHONOLOGY_PRESETS.find((p) => p.id === args.preset_id.trim());
      if (!preset) {
        throw new McpError(
          "NOT_FOUND",
          `Phonology preset "${args.preset_id}" not found.`,
          "Call phono_presets_list to view valid preset IDs.",
          { available_presets: PHONOLOGY_PRESETS.map((p) => p.id) },
        );
      }

      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "phono_apply_preset",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId, warnings }) => {
          const resolved = resolveLanguageUnlocked(family, args);
          const shouldUpdateSyllable =
            args.apply_syllable_structure ?? args.merge_mode === "replace";

          const plan = planPhonologyWriteUnlocked({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            language: resolved.language,
            operationId,
            expectedRevision: args.expected_revision,
            dryRun: args.dry_run,
            mandatorySnapshot: true,
            description: `Apply preset '${preset.id}' (${args.merge_mode}) to '${resolved.language.name}'`,
            buildNextLocalConfig: (currentLocal) => {
              const next = structuredClone(currentLocal);
              const nextConsonants =
                args.merge_mode === "replace"
                  ? [...preset.consonants]
                  : Array.from(
                      new Set([
                        ...currentLocal.phoneme_inventory.consonants,
                        ...preset.consonants,
                      ]),
                    );
              const nextVowels =
                args.merge_mode === "replace"
                  ? [...preset.vowels]
                  : Array.from(
                      new Set([
                        ...currentLocal.phoneme_inventory.vowels,
                        ...preset.vowels,
                      ]),
                    );

              next.phoneme_inventory = {
                ...currentLocal.phoneme_inventory,
                consonants: nextConsonants,
                vowels: nextVowels,
              };

              if (shouldUpdateSyllable) {
                next.phonotactics = {
                  ...currentLocal.phonotactics,
                  syllable_structure: preset.syllable_structure,
                };
              }
              return next;
            },
          });

          warnings.push(...plan.warnings);

          return {
            expectations: [plan.expectation],
            mutations: plan.mutations,
            languageId: resolved.language.language_id,
            snapshotId: plan.snapshotId,
            auditSummary: `Applied phonology preset '${preset.id}' (${args.merge_mode}) to ${resolved.language.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              preset_id: preset.id,
              merge_mode: args.merge_mode,
              before_inventory: plan.beforeLocal.phoneme_inventory,
              after_inventory: plan.afterLocal.phoneme_inventory,
              after_syllable_structure:
                plan.afterLocal.phonotactics.syllable_structure,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, txWarnings) => ({
              operation_id: operationId,
              committed: true,
              changed: true,
              language_id: resolved.language.language_id,
              preset_id: preset.id,
              merge_mode: args.merge_mode,
              phoneme_inventory: plan.afterLocal.phoneme_inventory,
              syllable_structure:
                plan.afterLocal.phonotactics.syllable_structure,
              snapshot_id: plan.snapshotId,
              revision: newRevisions["phonology.json"],
              revisions: newRevisions,
              summary: `Applied preset '${preset.id}' (${args.merge_mode}) to '${resolved.language.name}'.`,
              warnings: txWarnings.length > 0 ? txWarnings : undefined,
            }),
          };
        },
      });
    },
  });
}
