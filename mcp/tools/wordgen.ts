import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { generateIPA } from "../../src/core/engines/ipaGenerator";
import {
  deriveGeneratorConfigByTypology,
  type DropoffMap,
  generateWords,
  type RewriteRule,
  SWADESH_100,
} from "../../src/core/engines/wordGenerator";
import type { PhonologyConfig, WordEntry } from "../../src/types";
import type { McpConfig } from "../config";
import { McpError } from "../errors";
import {
  readGrammarUnlocked,
  readLexiconUnlocked,
  readPhonologyUnlocked,
  withConsistentProjectRead,
} from "../storage/read";
import { registerDefinedTool } from "../toolRegistry";
import {
  familyInputFields,
  languageInputFields,
  resolveFamilyFromArgs,
  resolveLanguageUnlocked,
} from "./_helpers";

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runWithOptionalSeed<T>(seed: number | undefined, fn: () => T): T {
  if (seed === undefined) {
    return fn();
  }
  const originalRandom = Math.random;
  Math.random = createMulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function extractConceptTokensFromWord(word: WordEntry): Set<string> {
  const tokens = new Set<string>();
  const stripArticles = (clause: string): string =>
    clause
      .trim()
      .toLowerCase()
      .replace(/^(?:to|a|an|the)\s+/u, "")
      .trim();

  for (const sense of word.senses) {
    const clauses = sense.gloss.split(/[,;/|()[\]]+/u);
    for (const rawClause of clauses) {
      const cleaned = stripArticles(rawClause);
      if (cleaned) {
        tokens.add(cleaned);
        for (const piece of cleaned.match(/[\p{L}\p{N}']+/gu) ?? []) {
          tokens.add(piece);
        }
      }
    }
    for (const def of sense.definitions) {
      for (const rawClause of def.split(/[,;/|()[\]]+/u)) {
        const cleaned = stripArticles(rawClause);
        if (cleaned && cleaned.length <= 24) {
          tokens.add(cleaned);
        }
      }
    }
  }

  for (const tag of word.metadata.tags) {
    const lower = tag.trim().toLowerCase();
    if (lower.startsWith("swadesh:")) {
      const concept = lower.slice("swadesh:".length).trim();
      if (concept) tokens.add(concept);
    } else if (lower) {
      tokens.add(lower);
    }
  }

  return tokens;
}

export function registerWordgenTools(
  server: McpServer,
  config: McpConfig,
): void {
  // 1. wordgen_generate
  registerDefinedTool(server, config, {
    name: "wordgen_generate",
    title: "Generate Candidate Words from Phonotactics",
    description:
      "Generate candidate words satisfying the language's phoneme inventory, syllable structure, macros, and blacklist patterns, filtering out existing lexicon words and optionally using a deterministic seed. Read-only; save chosen words with lex_upsert.",
    toolsets: ["compute"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      count: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Number of candidate words to generate (default: 20)"),
      min_syllables: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Minimum syllable count (defaults to typology-derived setting)"),
      max_syllables: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Maximum syllable count (defaults to typology-derived setting)"),
      syllable_structure: z
        .string()
        .optional()
        .describe("Optional temporary override over phonotactics.syllable_structure"),
      exclude_existing: z
        .boolean()
        .optional()
        .describe("Filter out forms already in the language's lexicon (default: true)"),
      rewrite_rules: z
        .array(
          z.object({
            pattern: z.string(),
            replacement: z.string(),
          }),
        )
        .optional()
        .describe("Optional regex rewrite rules applied to generated candidates"),
      dropoffs: z
        .record(z.string(), z.number().min(0).max(5))
        .optional()
        .describe("Optional Zipfian dropoff exponents per macro key (e.g. { C: 1.5, V: 1.2 })"),
      seed: z
        .number()
        .int()
        .optional()
        .describe("Optional integer PRNG seed for deterministic candidate generation"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "wordgen_generate",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const grammar = readGrammarUnlocked(
            family.project_dir,
            resolved.language,
          );
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          return { resolved, phono, grammar, lex };
        },
      );

      const typoDefaults = deriveGeneratorConfigByTypology(
        snapshot.grammar.config.typology.morphological_type,
      );
      const count = args.count ?? 20;
      const minSyllables = args.min_syllables ?? typoDefaults.minSyllables;
      const maxSyllables =
        args.max_syllables ?? Math.max(minSyllables, typoDefaults.maxSyllables);

      if (minSyllables > maxSyllables) {
        throw new McpError(
          "VALIDATION",
          `min_syllables (${minSyllables}) cannot exceed max_syllables (${maxSyllables}).`,
        );
      }

      const effectivePhono: PhonologyConfig = args.syllable_structure
        ? {
            ...snapshot.phono.config,
            phonotactics: {
              ...snapshot.phono.config.phonotactics,
              syllable_structure: args.syllable_structure,
            },
          }
        : snapshot.phono.config;

      const defaultDropoffs: DropoffMap = args.dropoffs ?? {
        C: typoDefaults.defaultDropoff,
        V: typoDefaults.defaultDropoff,
      };
      const rewriteRules: RewriteRule[] | undefined = args.rewrite_rules;
      const excludeExisting = args.exclude_existing ?? true;
      const existingForms = new Set(
        excludeExisting
          ? snapshot.lex.words.map((w) => w.con_word_romanized.toLowerCase().trim())
          : [],
      );

      const generatedForms = runWithOptionalSeed(args.seed, () => {
        const collected: string[] = [];
        const seen = new Set<string>();
        const maxRounds = excludeExisting ? 4 : 1;

        for (let round = 0; round < maxRounds && collected.length < count; round++) {
          const batchTarget = Math.min(
            Math.max(count - collected.length, Math.ceil(count * 1.5)),
            1000,
          );
          const rawBatch = generateWords(effectivePhono, {
            count: batchTarget,
            minSyllables,
            maxSyllables,
            rewriteRules,
            dropoffs: defaultDropoffs,
          });
          for (const candidate of rawBatch) {
            const key = candidate.toLowerCase().trim();
            if (!key || seen.has(key) || existingForms.has(key)) continue;
            seen.add(key);
            collected.push(candidate);
            if (collected.length >= count) break;
          }
        }
        return collected;
      });

      const candidates = generatedForms.map((romanized) => {
        const ipa = generateIPA(romanized, snapshot.phono.config);
        return {
          romanized,
          phonemic_ipa: ipa.phonemic,
          surface_ipa: ipa.surface || null,
        };
      });

      return {
        family_id: family.family_id,
        language_id: snapshot.resolved.language.language_id,
        requested_count: count,
        generated_count: candidates.length,
        parameters: {
          min_syllables: minSyllables,
          max_syllables: maxSyllables,
          syllable_structure: effectivePhono.phonotactics.syllable_structure,
          morphological_type: snapshot.grammar.config.typology.morphological_type,
          exclude_existing: excludeExisting,
          seed: args.seed ?? null,
        },
        candidates,
        dependencies: {
          "phonology.json": snapshot.phono.revision,
          "grammar.json": snapshot.grammar.revision,
          lexicon: snapshot.lex.revision,
        },
      };
    },
  });

  // 2. wordgen_swadesh_gaps
  registerDefinedTool(server, config, {
    name: "wordgen_swadesh_gaps",
    title: "Audit Swadesh-100 Lexicon Coverage & Gaps",
    description:
      "Compare the Swadesh-100 core vocabulary list against the language's lexicon glosses, definitions, and tags, returning covered concepts, missing concepts, and coverage percentage.",
    toolsets: ["audit", "compute"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      include_deprecated: z
        .boolean()
        .optional()
        .describe("Count deprecated words toward Swadesh coverage (default: false)"),
      include_covered_details: z
        .boolean()
        .optional()
        .describe("Include matching entry details for covered concepts (default: true)"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "wordgen_swadesh_gaps",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          return { resolved, lex };
        },
      );

      const activeWords = args.include_deprecated
        ? snapshot.lex.words
        : snapshot.lex.words.filter((w) => !w.evolution?.is_deprecated);

      const indexedWords = activeWords.map((word) => ({
        word,
        tokens: extractConceptTokensFromWord(word),
      }));

      const missing: string[] = [];
      const covered: {
        concept: string;
        entries: {
          entry_id: string;
          romanized: string;
          ipa: string;
          gloss: string;
        }[];
      }[] = [];

      for (const concept of SWADESH_100) {
        const conceptLower = concept.toLowerCase().trim();
        const matches = indexedWords
          .filter((item) => item.tokens.has(conceptLower))
          .map((item) => ({
            entry_id: item.word.entry_id,
            romanized: item.word.con_word_romanized,
            ipa: item.word.phonetic_ipa,
            gloss: item.word.senses.map((s) => s.gloss).join("; "),
          }));

        if (matches.length === 0) {
          missing.push(concept);
        } else {
          covered.push({
            concept,
            entries: matches.slice(0, 5),
          });
        }
      }

      const total = SWADESH_100.length;
      const coveredCount = covered.length;
      const coveragePercentage =
        total > 0 ? Number(((coveredCount / total) * 100).toFixed(2)) : 0;

      return {
        family_id: family.family_id,
        language_id: snapshot.resolved.language.language_id,
        total_concepts: total,
        covered_count: coveredCount,
        missing_count: missing.length,
        coverage_percentage: coveragePercentage,
        missing,
        covered:
          args.include_covered_details === false
            ? covered.map((c) => ({ concept: c.concept, match_count: c.entries.length }))
            : covered,
        revision: snapshot.lex.revision,
      };
    },
  });
}
