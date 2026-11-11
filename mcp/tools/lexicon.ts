import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { generateIPA } from "../../src/core/engines/ipaGenerator";
import {
  type CSVColumnMapping,
  previewCSVImport,
} from "../../src/core/engines/importCSV";
import { ipaFuzzySearch } from "../../src/core/engines/ipaSearch";
import {
  type QCIssue,
  type QCRuleKey,
  runQualityCheck,
} from "../../src/core/engines/qualityCheck";
import { buildMacrosFromInventory, applySoundChanges } from "../../src/core/engines/scaEngine";
import { computeStatistics } from "../../src/core/engines/statistics";
import {
  getWordEvolution,
  getWordSyncDigest,
  hasWordChangedFromParent,
} from "../../src/core/engines/wordLifecycle";
import { newEntryId, newPrefixedId, nowIso } from "../../src/core/lexicon/ids";
import { computeWordIpa } from "../../src/core/lexicon/utils";
import { computePullSync } from "../../src/core/workflows/pullSync";
import { PHONEME_FEATURES } from "../../src/data/ipa_features";
import type {
  EntryMetadata,
  Etymology,
  OriginType,
  PhonologyConfig,
  Sense,
  WordEntry,
  WordEvolution,
} from "../../src/types";
import {
  assertDestructiveAllowed,
  assertWriteAllowed,
  type McpConfig,
} from "../config";
import { McpError } from "../errors";
import {
  assertPathAllowed,
  assertSafeRelativeLanguagePath,
  resolveLanguage,
} from "../registry/addressing";
import {
  readGrammarUnlocked,
  readLexiconUnlocked,
  readPhonologyUnlocked,
  readScaUnlocked,
  readWorkspaceUnlocked,
  withConsistentProjectRead,
} from "../storage/read";
import {
  executeProjectTransaction,
  type RevisionExpectation,
} from "../storage/transaction";
import { registerDefinedTool } from "../toolRegistry";
import { projectArrayFields } from "../util/fields";
import { paginate } from "../util/paging";
import {
  bucketFilename,
  commonWriteInputFields,
  familyInputFields,
  languageInputFields,
  mergeWordPreservingUnknown,
  planLexiconBucketWriteUnlocked,
  resolveFamilyFromArgs,
  resolveLanguageUnlocked,
  validateWordStrictOrThrow,
} from "./_helpers";

const ORIGIN_TYPES = [
  "a_priori",
  "a_posteriori",
  "mixed",
  "derived",
  "borrowed",
  "evolved",
] as const;

const QC_RULE_KEYS: readonly QCRuleKey[] = [
  "missingPos",
  "unmappedSpelling",
  "emptyIpa",
  "patternMismatch",
  "missingRequired",
  "duplicateWord",
] as const;

const senseInputSchema = z
  .object({
    sense_id: z.string().optional(),
    pos_id: z.string().optional(),
    gloss: z.string(),
    definitions: z.array(z.string()).optional(),
    examples: z.array(z.string()).optional(),
    grammatical_function: z.string().optional(),
  })
  .passthrough();

const etymologyInputSchema = z
  .object({
    origin_type: z.enum(ORIGIN_TYPES).optional(),
    parent_entry_id: z.string().nullable().optional(),
    source_language_id: z.string().nullable().optional(),
    applied_sound_changes: z.array(z.string()).optional(),
    semantic_shift_note: z.string().optional(),
  })
  .passthrough();

const metadataInputSchema = z
  .object({
    tags: z.array(z.string()).optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

const evolutionInputSchema = z
  .object({
    is_deprecated: z.boolean().optional(),
    deprecated_since_language_id: z.string().nullable().optional(),
    parent_snapshot_hash: z.string().nullable().optional(),
    last_synced_word_hash: z.string().nullable().optional(),
  })
  .passthrough();

const wordUpsertItemSchema = z
  .object({
    entry_id: z.string().optional(),
    con_word_romanized: z.string(),
    phonetic_ipa: z.string().optional(),
    phonetic_override: z.boolean().optional(),
    senses: z.array(senseInputSchema).optional(),
    etymology: etymologyInputSchema.optional(),
    metadata: metadataInputSchema.optional(),
    evolution: evolutionInputSchema.optional(),
  })
  .passthrough();

type WordUpsertInput = z.infer<typeof wordUpsertItemSchema>;

function stripIpaDelimiters(raw: string): string {
  return raw.trim().replace(/^[\/\[](.*)[\/\]]$/u, "$1").trim();
}

function buildEffectiveScaMacros(
  primaryPhono: PhonologyConfig,
  fallbackPhono?: PhonologyConfig,
): Record<string, string[]> {
  const consonants =
    primaryPhono.phoneme_inventory.consonants.length > 0
      ? primaryPhono.phoneme_inventory.consonants
      : (fallbackPhono?.phoneme_inventory.consonants ?? []);
  const vowels =
    primaryPhono.phoneme_inventory.vowels.length > 0
      ? primaryPhono.phoneme_inventory.vowels
      : (fallbackPhono?.phoneme_inventory.vowels ?? []);
  return buildMacrosFromInventory(consonants, vowels, {
    ...(fallbackPhono?.phonotactics.macros ?? {}),
    ...primaryPhono.phonotactics.macros,
  });
}

interface IndexedBucketWord {
  bucketName: string;
  word: WordEntry;
}

function indexBucketsById(
  buckets: Map<string, WordEntry[]>,
): Map<string, IndexedBucketWord> {
  const index = new Map<string, IndexedBucketWord>();
  for (const [bucketName, list] of buckets.entries()) {
    for (const word of list) {
      index.set(word.entry_id, { bucketName, word });
    }
  }
  return index;
}

function applyUpsertIntoBuckets(
  buckets: Map<string, WordEntry[]>,
  existingIndex: Map<string, IndexedBucketWord>,
  word: WordEntry,
  dirtyBuckets: Set<string>,
): { isNew: boolean; bucketMoved: boolean; changed: boolean } {
  const prev = existingIndex.get(word.entry_id);
  const targetBucket = bucketFilename(word.con_word_romanized);

  if (!prev) {
    const arr = buckets.get(targetBucket) ?? [];
    arr.push(word);
    buckets.set(targetBucket, arr);
    existingIndex.set(word.entry_id, { bucketName: targetBucket, word });
    dirtyBuckets.add(targetBucket);
    return { isNew: true, bucketMoved: false, changed: true };
  }

  const unchanged = JSON.stringify(prev.word) === JSON.stringify(word);
  if (unchanged && prev.bucketName === targetBucket) {
    return { isNew: false, bucketMoved: false, changed: false };
  }

  if (prev.bucketName !== targetBucket) {
    const oldArr = buckets.get(prev.bucketName) ?? [];
    buckets.set(
      prev.bucketName,
      oldArr.filter((w) => w.entry_id !== word.entry_id),
    );
    dirtyBuckets.add(prev.bucketName);

    const newArr = (buckets.get(targetBucket) ?? []).filter(
      (w) => w.entry_id !== word.entry_id,
    );
    newArr.push(word);
    buckets.set(targetBucket, newArr);
    dirtyBuckets.add(targetBucket);
    existingIndex.set(word.entry_id, { bucketName: targetBucket, word });
    return { isNew: false, bucketMoved: true, changed: true };
  }

  const sameArr = buckets.get(targetBucket) ?? [];
  const pos = sameArr.findIndex((w) => w.entry_id === word.entry_id);
  if (pos >= 0) {
    sameArr[pos] = word;
  } else {
    sameArr.push(word);
  }
  buckets.set(targetBucket, sameArr);
  dirtyBuckets.add(targetBucket);
  existingIndex.set(word.entry_id, { bucketName: targetBucket, word });
  return { isNew: false, bucketMoved: false, changed: true };
}

function buildNormalizedWordFromUpsert(
  rawItem: WordUpsertInput,
  existing: WordEntry | undefined,
  languageId: string,
  phonoConfig: PhonologyConfig,
  isoNow: string,
): WordEntry {
  const entryId = rawItem.entry_id?.trim() || existing?.entry_id || newEntryId();
  const romanized = rawItem.con_word_romanized.trim();

  const rawSenses = rawItem.senses ?? existing?.senses ?? [];
  const senses: Sense[] = rawSenses.map((s) => {
    const senseCopy: Record<string, unknown> = { ...s };
    if (
      senseCopy.grammatical_function === undefined ||
      senseCopy.grammatical_function === null
    ) {
      delete senseCopy.grammatical_function;
    }
    return {
      ...(senseCopy as unknown as Sense),
      sense_id: s.sense_id?.trim() || newPrefixedId("sense"),
      pos_id: s.pos_id ?? "",
      gloss: s.gloss,
      definitions: s.definitions ?? [],
      examples: s.examples ?? [],
    };
  });

  const phoneticOverride =
    rawItem.phonetic_override ?? existing?.phonetic_override ?? false;
  const rawIpa = rawItem.phonetic_ipa ?? existing?.phonetic_ipa ?? "";
  const phoneticIpa = computeWordIpa(
    {
      con_word_romanized: romanized,
      phonetic_ipa: rawIpa,
      phonetic_override: phoneticOverride,
    },
    phonoConfig,
  );

  const etymology: Etymology = {
    origin_type: "a_priori",
    parent_entry_id: null,
    source_language_id: null,
    applied_sound_changes: [],
    semantic_shift_note: "",
    ...(existing?.etymology ?? {}),
    ...(rawItem.etymology ?? {}),
  };

  const metadata: EntryMetadata = {
    tags: [],
    ...(existing?.metadata ?? {}),
    ...(rawItem.metadata ?? {}),
    created_at:
      rawItem.metadata?.created_at ||
      existing?.metadata.created_at ||
      isoNow,
    updated_at: rawItem.metadata?.updated_at || isoNow,
  };

  const evolution: WordEvolution | undefined =
    rawItem.evolution || existing?.evolution
      ? {
          is_deprecated: false,
          deprecated_since_language_id: null,
          parent_snapshot_hash: null,
          last_synced_word_hash: null,
          ...(existing?.evolution ?? {}),
          ...(rawItem.evolution ?? {}),
        }
      : undefined;

  const extraTop: Record<string, unknown> = { ...rawItem };
  const candidate: WordEntry = {
    ...(extraTop as unknown as WordEntry),
    entry_id: entryId,
    language_id: languageId,
    con_word_romanized: romanized,
    phonetic_ipa: phoneticIpa,
    phonetic_override: phoneticOverride,
    senses,
    etymology,
    metadata,
  };
  if (evolution !== undefined) {
    candidate.evolution = evolution;
  } else {
    delete candidate.evolution;
  }
  return mergeWordPreservingUnknown(existing, candidate);
}

function assertCommitOperationId(
  dryRun: boolean | undefined,
  operationId: string | undefined,
): void {
  if (!dryRun && !operationId?.trim()) {
    throw new McpError(
      "VALIDATION",
      "operation_id is required when committing writes (omit only for dry_run: true).",
    );
  }
}

export function registerLexiconTools(
  server: McpServer,
  config: McpConfig,
): void {
  // 1. lex_search
  registerDefinedTool(server, config, {
    name: "lex_search",
    title: "Search Lexicon Entries",
    description:
      "Search and filter lexicon entries by text/regex (romanized, gloss, definitions, examples, tags) or phonological similarity (ipa_query), with sorting, revision-bound cursor pagination, and field projection.",
    toolsets: ["core"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      query: z
        .string()
        .optional()
        .describe("Substring, prefix, exact, or regex query over romanized/gloss/definitions"),
      match_mode: z
        .enum(["contains", "prefix", "exact", "regex"])
        .optional()
        .describe("Text matching mode (default: contains)"),
      mode: z
        .enum(["text", "ipa_fuzzy"])
        .optional()
        .describe("Set to ipa_fuzzy (or provide ipa_query) for IPA feature-weighted fuzzy search"),
      ipa_query: z
        .string()
        .optional()
        .describe("IPA string for phonological similarity search"),
      ipa_threshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Max normalized IPA edit distance in [0, 1] (default: 0.6)"),
      pos_id: z.string().optional().describe("Filter entries having a sense with this pos_id"),
      tag: z.string().optional().describe("Filter entries having this metadata tag"),
      origin_type: z
        .enum(ORIGIN_TYPES)
        .optional()
        .describe("Filter by etymology.origin_type"),
      deprecated: z
        .boolean()
        .optional()
        .describe("Filter by evolution.is_deprecated status"),
      changed_from_parent: z
        .boolean()
        .optional()
        .describe("Filter entries differing from their parent language entry"),
      sort_by: z
        .enum(["romanized", "created_at", "updated_at", "ipa_distance"])
        .optional()
        .describe("Sort field (default: romanized, or ipa_distance when ipa_query is used)"),
      sort_dir: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction (default: asc)"),
      limit: z.number().int().min(1).max(500).optional(),
      cursor: z.string().optional(),
      fields: z.array(z.string()).optional(),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "lex_search",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          const needPhono =
            Boolean(args.ipa_query?.trim()) || args.mode === "ipa_fuzzy";
          const phono = needPhono
            ? readPhonologyUnlocked(
                family.project_dir,
                family.conlang_file_path,
                resolved.language,
              )
            : null;
          let parentWordsMap: Map<string, WordEntry> | null = null;
          if (args.changed_from_parent !== undefined && resolved.language.parent_id) {
            const parentLang = resolved.workspace.languages.find(
              (l) => l.language_id === resolved.language.parent_id,
            );
            if (parentLang) {
              const parentLex = readLexiconUnlocked(family.project_dir, parentLang);
              parentWordsMap = new Map(parentLex.words.map((w) => [w.entry_id, w]));
            }
          }
          return { resolved, lex, phono, parentWordsMap };
        },
      );

      let filtered = [...snapshot.lex.words];

      // Metadata / POS / origin / deprecated / parent filters
      if (args.pos_id) {
        filtered = filtered.filter((w) =>
          w.senses.some((s) => s.pos_id === args.pos_id),
        );
      }
      if (args.tag) {
        const tagLower = args.tag.toLowerCase();
        filtered = filtered.filter((w) =>
          w.metadata.tags.some((t) => t.toLowerCase() === tagLower),
        );
      }
      if (args.origin_type) {
        filtered = filtered.filter(
          (w) => w.etymology.origin_type === args.origin_type,
        );
      }
      if (args.deprecated !== undefined) {
        filtered = filtered.filter(
          (w) => Boolean(w.evolution?.is_deprecated) === args.deprecated,
        );
      }
      if (args.changed_from_parent !== undefined) {
        const pMap = snapshot.parentWordsMap;
        filtered = filtered.filter((w) => {
          if (!pMap) return false;
          const parentId = w.etymology.parent_entry_id ?? w.entry_id;
          const parentEntry = pMap.get(parentId);
          if (!parentEntry) return args.changed_from_parent === true;
          return (
            hasWordChangedFromParent(w, parentEntry) === args.changed_from_parent
          );
        });
      }

      // Text / regex query
      const textQuery =
        args.mode === "ipa_fuzzy" && !args.ipa_query ? undefined : args.query?.trim();
      if (textQuery) {
        const matchMode = args.match_mode ?? "contains";
        let compiledRegex: RegExp | null = null;
        if (matchMode === "regex") {
          try {
            compiledRegex = new RegExp(textQuery, "iu");
          } catch (err) {
            throw new McpError(
              "VALIDATION",
              `Invalid search regex "${textQuery}": ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        const qLower = textQuery.toLowerCase();
        const matchesField = (val: string): boolean => {
          if (compiledRegex) return compiledRegex.test(val);
          const v = val.toLowerCase();
          if (matchMode === "exact") return v === qLower;
          if (matchMode === "prefix") return v.startsWith(qLower);
          return v.includes(qLower);
        };

        filtered = filtered.filter(
          (w) =>
            matchesField(w.con_word_romanized) ||
            matchesField(w.phonetic_ipa) ||
            w.senses.some(
              (s) =>
                matchesField(s.gloss) ||
                s.definitions.some(matchesField) ||
                s.examples.some(matchesField),
            ) ||
            w.metadata.tags.some(matchesField),
        );
      }

      // IPA fuzzy query
      const effectiveIpaQuery =
        args.ipa_query?.trim() ||
        (args.mode === "ipa_fuzzy" ? args.query?.trim() : undefined);
      let distanceMap: Map<string, number> | null = null;

      if (effectiveIpaQuery) {
        const cleanQuery = stripIpaDelimiters(effectiveIpaQuery);
        const phonoCfg = snapshot.phono?.config;
        const inventory = Array.from(
          new Set([
            ...(phonoCfg?.phoneme_inventory.consonants ?? []),
            ...(phonoCfg?.phoneme_inventory.vowels ?? []),
            ...Object.keys(PHONEME_FEATURES),
          ]),
        );
        const strippedEntries = filtered.map((w) => ({
          ...w,
          phonetic_ipa: stripIpaDelimiters(w.phonetic_ipa),
        }));
        const originalById = new Map(filtered.map((w) => [w.entry_id, w]));
        const hits = ipaFuzzySearch(
          cleanQuery,
          strippedEntries,
          inventory,
          args.ipa_threshold ?? 0.6,
        );
        distanceMap = new Map();
        filtered = [];
        for (const hit of hits) {
          const orig = originalById.get(hit.entry.entry_id);
          if (orig) {
            filtered.push(orig);
            distanceMap.set(orig.entry_id, Number(hit.distance.toFixed(4)));
          }
        }
      }

      // Sorting
      const sortBy =
        args.sort_by ?? (distanceMap !== null ? "ipa_distance" : "romanized");
      const dir = args.sort_dir === "desc" ? -1 : 1;
      filtered.sort((a, b) => {
        let cmp = 0;
        if (sortBy === "ipa_distance" && distanceMap) {
          cmp = (distanceMap.get(a.entry_id) ?? 1) - (distanceMap.get(b.entry_id) ?? 1);
        } else if (sortBy === "created_at") {
          cmp = a.metadata.created_at.localeCompare(b.metadata.created_at);
        } else if (sortBy === "updated_at") {
          cmp = a.metadata.updated_at.localeCompare(b.metadata.updated_at);
        }
        if (cmp === 0) {
          cmp = Buffer.compare(
            Buffer.from(a.con_word_romanized, "utf-8"),
            Buffer.from(b.con_word_romanized, "utf-8"),
          );
        }
        return cmp * dir;
      });

      const page = paginate(filtered, snapshot.lex.revision, {
        limit: args.limit,
        cursor: args.cursor,
      });

      const ipaDistances = distanceMap
        ? Object.fromEntries(
            page.items.map((w) => [w.entry_id, distanceMap.get(w.entry_id) ?? 0]),
          )
        : undefined;

      return {
        family_id: family.family_id,
        language_id: snapshot.resolved.language.language_id,
        items: projectArrayFields(page.items, args.fields),
        total: page.total,
        next_cursor: page.next_cursor,
        revision: snapshot.lex.revision,
        skipped: snapshot.lex.skipped,
        ...(ipaDistances ? { ipa_distances: ipaDistances } : {}),
      };
    },
  });

  // 2. lex_get
  registerDefinedTool(server, config, {
    name: "lex_get",
    title: "Get Lexicon Entries by ID or Spelling",
    description:
      "Batch lookup lexicon entries by entry_ids and/or exact con_word_romanized forms, with optional parent entry comparison and field projection.",
    toolsets: ["core"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      entry_ids: z
        .array(z.string())
        .max(500)
        .optional()
        .describe("Entry IDs to look up"),
      romanized: z
        .array(z.string())
        .max(500)
        .optional()
        .describe("Exact romanized spellings to look up"),
      case_sensitive: z
        .boolean()
        .optional()
        .describe("Whether romanized lookup is case-sensitive (default: true)"),
      with_parent: z
        .boolean()
        .optional()
        .describe("If true and language has a parent_id, include corresponding parent entries"),
      fields: z.array(z.string()).optional(),
    },
    handler: async (args) => {
      const wantIds = (args.entry_ids ?? []).map((s) => s.trim()).filter(Boolean);
      const wantForms = (args.romanized ?? []).map((s) => s.trim()).filter(Boolean);
      if (wantIds.length === 0 && wantForms.length === 0) {
        throw new McpError(
          "VALIDATION",
          "Provide at least one non-empty entry_ids or romanized value.",
        );
      }

      const family = resolveFamilyFromArgs(config, args);
      return await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "lex_get",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          const byId = new Map(lex.words.map((w) => [w.entry_id, w]));
          const caseSensitive = args.case_sensitive ?? true;

          const matchedMap = new Map<string, WordEntry>();
          const missingIds: string[] = [];
          const missingForms: string[] = [];

          for (const id of wantIds) {
            const hit = byId.get(id);
            if (hit) {
              matchedMap.set(hit.entry_id, hit);
            } else {
              missingIds.push(id);
            }
          }

          for (const form of wantForms) {
            const key = caseSensitive ? form : form.toLowerCase();
            const hits = lex.words.filter((w) =>
              caseSensitive
                ? w.con_word_romanized === key
                : w.con_word_romanized.toLowerCase() === key,
            );
            if (hits.length === 0) {
              missingForms.push(form);
            } else {
              for (const h of hits) {
                matchedMap.set(h.entry_id, h);
              }
            }
          }

          const items = Array.from(matchedMap.values());
          let parentComparison:
            | {
                parent_language_id: string;
                parent_revision: string;
                entries: Record<
                  string,
                  {
                    parent_entry: WordEntry | null;
                    changed_from_parent: boolean;
                  }
                >;
              }
            | undefined;

          if (args.with_parent && resolved.language.parent_id) {
            const parentLang = resolved.workspace.languages.find(
              (l) => l.language_id === resolved.language.parent_id,
            );
            if (parentLang) {
              const parentLex = readLexiconUnlocked(family.project_dir, parentLang);
              const parentById = new Map(
                parentLex.words.map((w) => [w.entry_id, w]),
              );
              const entries: Record<
                string,
                { parent_entry: WordEntry | null; changed_from_parent: boolean }
              > = {};
              for (const w of items) {
                const pId = w.etymology.parent_entry_id ?? w.entry_id;
                const pWord = parentById.get(pId) ?? null;
                entries[w.entry_id] = {
                  parent_entry: pWord,
                  changed_from_parent: pWord
                    ? hasWordChangedFromParent(w, pWord)
                    : true,
                };
              }
              parentComparison = {
                parent_language_id: parentLang.language_id,
                parent_revision: parentLex.revision,
                entries,
              };
            }
          }

          return {
            family_id: family.family_id,
            language_id: resolved.language.language_id,
            items: projectArrayFields(items, args.fields),
            count: items.length,
            not_found: {
              entry_ids: missingIds,
              romanized: missingForms,
            },
            revision: lex.revision,
            ...(parentComparison ? { parent: parentComparison } : {}),
          };
        },
      );
    },
  });

  // 3. lex_stats
  registerDefinedTool(server, config, {
    name: "lex_stats",
    title: "Compute Lexicon Statistics",
    description:
      "Compute lexicon statistics including word count, POS distribution, origin breakdown, phoneme/character/bigram frequencies, and syllable distribution.",
    toolsets: ["compute", "audit"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      include_deprecated: z
        .boolean()
        .optional()
        .describe("Include deprecated entries in statistical counts (default: false)"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "lex_stats",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const grammar = readGrammarUnlocked(family.project_dir, resolved.language);
          return { resolved, lex, phono, grammar };
        },
      );

      const deprecatedCount = snapshot.lex.words.filter(
        (w) => w.evolution?.is_deprecated,
      ).length;
      const targetWords = args.include_deprecated
        ? snapshot.lex.words
        : snapshot.lex.words.filter((w) => !w.evolution?.is_deprecated);

      const report = computeStatistics(
        targetWords,
        snapshot.phono.config,
        snapshot.grammar.config,
      );

      const originCounts = new Map<OriginType, number>();
      let overriddenIpaCount = 0;
      for (const w of targetWords) {
        const origin = w.etymology.origin_type;
        originCounts.set(origin, (originCounts.get(origin) ?? 0) + 1);
        if (w.phonetic_override) overriddenIpaCount++;
      }

      const originDistribution = Array.from(originCounts.entries())
        .map(([origin_type, count]) => ({
          origin_type,
          count,
          percentage:
            targetWords.length > 0
              ? Number(((count / targetWords.length) * 100).toFixed(2))
              : 0,
        }))
        .sort((a, b) => b.count - a.count);

      return {
        family_id: family.family_id,
        language_id: snapshot.resolved.language.language_id,
        total_entries_in_lexicon: snapshot.lex.words.length,
        deprecated_count: deprecatedCount,
        overridden_ipa_count: overriddenIpaCount,
        origin_distribution: originDistribution,
        stats: report,
        revision: snapshot.lex.revision,
        dependencies: {
          lexicon: snapshot.lex.revision,
          "phonology.json": snapshot.phono.revision,
          "grammar.json": snapshot.grammar.revision,
        },
      };
    },
  });

  // 4. lex_quality_check
  registerDefinedTool(server, config, {
    name: "lex_quality_check",
    title: "Run Lexicon Quality Checks",
    description:
      "Run lexicon quality checks (missingPos, unmappedSpelling, emptyIpa, patternMismatch, missingRequired, duplicateWord) and return issues grouped by category plus paginated details.",
    toolsets: ["audit", "compute"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      disabled_rules: z
        .array(z.enum(["missingPos", "unmappedSpelling", "emptyIpa", "patternMismatch", "missingRequired", "duplicateWord"]))
        .optional()
        .describe("QC rules to skip"),
      enabled_rules: z
        .array(z.enum(["missingPos", "unmappedSpelling", "emptyIpa", "patternMismatch", "missingRequired", "duplicateWord"]))
        .optional()
        .describe("If set, run only these QC rules"),
      severity: z
        .enum(["error", "warning"])
        .optional()
        .describe("Optional filter by issue severity"),
      include_deprecated: z
        .boolean()
        .optional()
        .describe("Check deprecated entries too (default: false)"),
      limit: z.number().int().min(1).max(500).optional(),
      cursor: z.string().optional(),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "lex_quality_check",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const grammar = readGrammarUnlocked(family.project_dir, resolved.language);
          return { resolved, lex, phono, grammar };
        },
      );

      const disabled = new Set<QCRuleKey>(args.disabled_rules ?? []);
      if (args.enabled_rules && args.enabled_rules.length > 0) {
        const enabledSet = new Set<QCRuleKey>(args.enabled_rules);
        for (const key of QC_RULE_KEYS) {
          if (!enabledSet.has(key)) disabled.add(key);
        }
      }

      const wordsToCheck = args.include_deprecated
        ? snapshot.lex.words
        : snapshot.lex.words.filter((w) => !w.evolution?.is_deprecated);

      let issues = runQualityCheck(
        wordsToCheck,
        snapshot.phono.config,
        snapshot.grammar.config,
        Array.from(disabled),
      );
      if (args.severity) {
        issues = issues.filter((i) => i.severity === args.severity);
      }

      const byCategory: Record<
        string,
        { count: number; errors: number; warnings: number; examples: QCIssue[] }
      > = {};
      for (const issue of issues) {
        let bucket = byCategory[issue.rule];
        if (!bucket) {
          bucket = { count: 0, errors: 0, warnings: 0, examples: [] };
          byCategory[issue.rule] = bucket;
        }
        bucket.count++;
        if (issue.severity === "error") bucket.errors++;
        else bucket.warnings++;
        if (bucket.examples.length < 10) {
          bucket.examples.push(issue);
        }
      }

      const page = paginate(issues, snapshot.lex.revision, {
        limit: args.limit,
        cursor: args.cursor,
      });

      return {
        family_id: family.family_id,
        language_id: snapshot.resolved.language.language_id,
        summary: {
          checked_words: wordsToCheck.length,
          skipped_ndjson_lines: snapshot.lex.skipped.length,
          total_issues: issues.length,
          errors: issues.filter((i) => i.severity === "error").length,
          warnings: issues.filter((i) => i.severity === "warning").length,
        },
        by_category: byCategory,
        issues: page.items,
        total: page.total,
        next_cursor: page.next_cursor,
        skipped_lines: snapshot.lex.skipped,
        revision: snapshot.lex.revision,
        dependencies: {
          lexicon: snapshot.lex.revision,
          "phonology.json": snapshot.phono.revision,
          "grammar.json": snapshot.grammar.revision,
        },
      };
    },
  });

  // 5. lex_parent_diff
  registerDefinedTool(server, config, {
    name: "lex_parent_diff",
    title: "Diff Child Lexicon Against Evolved Parent Lexicon",
    description:
      "Compare a daughter language's lexicon against its parent language after applying the daughter's SCA rules, reporting pending additions/updates and hash conflicts.",
    toolsets: ["evolution", "audit"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      mode: z
        .enum(["add", "update"])
        .optional()
        .describe("Optional filter on pending sync items"),
      limit: z.number().int().min(1).max(500).optional(),
      cursor: z.string().optional(),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "lex_parent_diff",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const child = resolved.language;
          if (!child.parent_id) {
            throw new McpError(
              "VALIDATION",
              `Language "${child.name}" (${child.language_id}) has no parent_id and cannot run parent diff.`,
            );
          }
          const parent = resolved.workspace.languages.find(
            (l) => l.language_id === child.parent_id,
          );
          if (!parent) {
            throw new McpError(
              "NOT_FOUND",
              `Parent language "${child.parent_id}" referenced by "${child.name}" does not exist in workspace.`,
            );
          }

          const childLex = readLexiconUnlocked(family.project_dir, child);
          const parentLex = readLexiconUnlocked(family.project_dir, parent);
          const childSca = readScaUnlocked(family.project_dir, child);
          const childPhono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            child,
          );
          const parentPhono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            parent,
          );

          return {
            resolved,
            child,
            parent,
            childLex,
            parentLex,
            childSca,
            childPhono,
            parentPhono,
          };
        },
      );

      const macros = buildEffectiveScaMacros(
        snapshot.childPhono.config,
        snapshot.parentPhono.config,
      );
      const plan = computePullSync({
        parentLanguageId: snapshot.parent.language_id,
        childLanguageId: snapshot.child.language_id,
        parentWords: snapshot.parentLex.words,
        childWords: snapshot.childLex.words,
        scaRuleSets: snapshot.childSca.config.rule_sets,
        macros,
      });

      const parentById = new Map(
        snapshot.parentLex.words.map((w) => [w.entry_id, w]),
      );
      const childById = new Map(
        snapshot.childLex.words.map((w) => [w.entry_id, w]),
      );

      let pendingItems = plan.pending.map((item) => {
        const ipa = computeWordIpa(item.word, snapshot.childPhono.config);
        const existingChild = childById.get(item.word.entry_id);
        const parentWord =
          parentById.get(item.word.etymology.parent_entry_id ?? item.word.entry_id);
        return {
          mode: item.mode,
          entry_id: item.word.entry_id,
          parent_romanized: parentWord?.con_word_romanized ?? null,
          before_child_romanized: existingChild?.con_word_romanized ?? null,
          evolved_romanized: item.word.con_word_romanized,
          evolved_ipa: ipa,
          gloss: item.word.senses[0]?.gloss ?? "",
          applied_sound_changes: item.word.etymology.applied_sound_changes,
          word: { ...item.word, phonetic_ipa: ipa },
        };
      });

      if (args.mode) {
        pendingItems = pendingItems.filter((p) => p.mode === args.mode);
      }

      const conflicts = plan.conflicts.map((c) => {
        const pWord = parentById.get(c.parentEntryId);
        const cWord = childById.get(c.childEntryId);
        return {
          parentEntryId: c.parentEntryId,
          childEntryId: c.childEntryId,
          parent_romanized: pWord?.con_word_romanized ?? null,
          child_romanized: cWord?.con_word_romanized ?? null,
          gloss: cWord?.senses[0]?.gloss ?? pWord?.senses[0]?.gloss ?? "",
        };
      });

      const page = paginate(pendingItems, snapshot.childLex.revision, {
        limit: args.limit,
        cursor: args.cursor,
      });

      return {
        family_id: family.family_id,
        language_id: snapshot.child.language_id,
        parent_language_id: snapshot.parent.language_id,
        summary: {
          pending_total: plan.pending.length,
          pending_adds: plan.pending.filter((p) => p.mode === "add").length,
          pending_updates: plan.pending.filter((p) => p.mode === "update").length,
          conflicts: conflicts.length,
        },
        pending: page.items,
        total: page.total,
        next_cursor: page.next_cursor,
        conflicts,
        child_revision: snapshot.childLex.revision,
        parent_revision: snapshot.parentLex.revision,
        dependencies: {
          workspace: snapshot.resolved.workspace_revision,
          lexicon: snapshot.childLex.revision,
          parent_lexicon: snapshot.parentLex.revision,
          "sca_rules.json": snapshot.childSca.revision,
          "phonology.json": snapshot.childPhono.revision,
        },
      };
    },
  });

  // 6. lex_upsert
  registerDefinedTool(server, config, {
    name: "lex_upsert",
    title: "Upsert Lexicon Entries",
    description:
      "Create or update 1..500 lexicon entries in one atomic transaction. Auto-generates entry_id/sense_id/timestamps, computes IPA when phonetic_override is false, strictly validates every entry, preserves unknown fields, and handles cross-bucket moves.",
    toolsets: ["write"],
    access: "write",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      ...commonWriteInputFields,
      entries: z
        .array(wordUpsertItemSchema)
        .min(1)
        .max(500)
        .describe("1..500 word entries to create or update"),
    },
    handler: async (args) => {
      assertWriteAllowed(config, "lex_upsert");
      assertCommitOperationId(args.dry_run, args.operation_id);

      const family = resolveFamilyFromArgs(config, args);
      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "lex_upsert",
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
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const isoNow = nowIso();

          let addedCount = 0;
          let updatedCount = 0;
          let bucketMovesCount = 0;
          const upsertedWords: WordEntry[] = [];

          const bucketPlan = planLexiconBucketWriteUnlocked({
            projectDir: family.project_dir,
            language: resolved.language,
            expectedRevision: args.expected_revision,
            dryRun: args.dry_run,
            operationType: "auto_snapshot",
            description: `MCP lex_upsert (${args.entries.length} entries)`,
            batchSize: args.entries.length,
            mutateBuckets: (buckets) => {
              const existingIndex = indexBucketsById(buckets);
              const validationErrors: { index: number; message: string }[] = [];
              const prepared: WordEntry[] = [];

              for (let idx = 0; idx < args.entries.length; idx++) {
                const rawItem = args.entries[idx];
                const lookupId = rawItem.entry_id?.trim();
                const prev = lookupId ? existingIndex.get(lookupId)?.word : undefined;
                const built = buildNormalizedWordFromUpsert(
                  rawItem,
                  prev,
                  resolved.language.language_id,
                  phono.config,
                  isoNow,
                );
                try {
                  validateWordStrictOrThrow(built, idx);
                  prepared.push(built);
                } catch (err) {
                  validationErrors.push({
                    index: idx,
                    message: err instanceof Error ? err.message : String(err),
                  });
                }
              }

              if (validationErrors.length > 0) {
                throw new McpError(
                  "VALIDATION",
                  `Lexicon validation failed on ${validationErrors.length} entry/entries: ${validationErrors[0].message}`,
                  "Ensure every entry has non-empty con_word_romanized (not 'new_word') and at least one sense with non-empty gloss.",
                  { errors: validationErrors },
                );
              }

              const dirtyBuckets = new Set<string>();
              let changedCount = 0;
              for (const word of prepared) {
                const outcome = applyUpsertIntoBuckets(
                  buckets,
                  existingIndex,
                  word,
                  dirtyBuckets,
                );
                upsertedWords.push(word);
                if (outcome.isNew) addedCount++;
                else if (outcome.changed) updatedCount++;
                if (outcome.bucketMoved) bucketMovesCount++;
                if (outcome.changed) changedCount++;
              }

              return { dirtyBuckets, changedCount };
            },
          });

          return {
            expectations: [bucketPlan.expectation],
            mutations: bucketPlan.mutations,
            languageId: resolved.language.language_id,
            snapshotId: bucketPlan.snapshotId,
            auditSummary: `Upserted ${upsertedWords.length} lexicon entries (${addedCount} added, ${updatedCount} updated)`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              added: addedCount,
              updated: updatedCount,
              unchanged: upsertedWords.length - addedCount - updatedCount,
              bucket_moves: bucketMovesCount,
              entries_preview: upsertedWords.slice(0, 50).map((w) => ({
                entry_id: w.entry_id,
                con_word_romanized: w.con_word_romanized,
                phonetic_ipa: w.phonetic_ipa,
                gloss: w.senses[0]?.gloss ?? "",
              })),
              base_revisions: {
                ...baseRevisions,
                "phonology.json": phono.revision,
              },
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed: bucketPlan.changedCount > 0,
              language_id: resolved.language.language_id,
              added: addedCount,
              updated: updatedCount,
              bucket_moves: bucketMovesCount,
              entry_ids: upsertedWords.map((w) => w.entry_id),
              revision: newRevisions.lexicon,
              revisions: newRevisions,
              snapshot_id: bucketPlan.snapshotId,
              summary: `Upserted ${upsertedWords.length} lexicon entries (${addedCount} added, ${updatedCount} updated)`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 7. lex_regenerate_ipa
  registerDefinedTool(server, config, {
    name: "lex_regenerate_ipa",
    title: "Regenerate Lexicon IPA Transcriptions",
    description:
      "Recompute phonetic_ipa across lexicon entries from current phonology romanization & allophony rules (skipping phonetic_override entries unless include_overridden is true).",
    toolsets: ["write", "compute"],
    access: "write",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      ...commonWriteInputFields,
      expected_phonology_revision: z
        .string()
        .optional()
        .describe("Optional expected phonology.json revision for dependency CAS"),
      base_revisions: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional base_revisions returned by dry_run"),
      include_overridden: z
        .boolean()
        .optional()
        .describe("If true, also recompute entries where phonetic_override is true (default: false)"),
      clear_override_flag: z
        .boolean()
        .optional()
        .describe("When include_overridden is true, also set phonetic_override = false (default: false)"),
      entry_ids: z
        .array(z.string())
        .max(500)
        .optional()
        .describe("Optional subset of entry_ids to regenerate"),
    },
    handler: async (args) => {
      assertWriteAllowed(config, "lex_regenerate_ipa");
      assertCommitOperationId(args.dry_run, args.operation_id);

      const family = resolveFamilyFromArgs(config, args);
      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "lex_regenerate_ipa",
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
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const langDir = assertSafeRelativeLanguagePath(
            family.project_dir,
            resolved.language.path,
          );
          const phonoAbs = path.join(langDir, "phonology.json");

          const filterSet =
            args.entry_ids && args.entry_ids.length > 0
              ? new Set(args.entry_ids)
              : null;
          const isoNow = nowIso();
          const changes: {
            entry_id: string;
            romanized: string;
            before_ipa: string;
            after_ipa: string;
          }[] = [];
          let scannedCount = 0;

          const lexExpected =
            args.expected_revision ?? args.base_revisions?.lexicon ?? "";
          const phonoExpectedExplicit =
            args.expected_phonology_revision ??
            args.base_revisions?.["phonology.json"];

          const bucketPlan = planLexiconBucketWriteUnlocked({
            projectDir: family.project_dir,
            language: resolved.language,
            expectedRevision: lexExpected,
            dryRun: args.dry_run,
            operationType: "auto_snapshot",
            description: "MCP lex_regenerate_ipa",
            batchSize: 20,
            mutateBuckets: (buckets) => {
              const dirtyBuckets = new Set<string>();
              for (const [bname, words] of buckets.entries()) {
                let bucketDirty = false;
                const nextWords = words.map((w) => {
                  if (filterSet && !filterSet.has(w.entry_id)) {
                    return w;
                  }
                  if (w.phonetic_override && !args.include_overridden) {
                    return w;
                  }
                  scannedCount++;
                  const nextIpa = generateIPA(
                    w.con_word_romanized,
                    phono.config,
                  ).phonemic;
                  const nextOverride =
                    args.include_overridden && args.clear_override_flag
                      ? false
                      : w.phonetic_override;
                  if (
                    nextIpa === w.phonetic_ipa &&
                    nextOverride === w.phonetic_override
                  ) {
                    return w;
                  }
                  bucketDirty = true;
                  changes.push({
                    entry_id: w.entry_id,
                    romanized: w.con_word_romanized,
                    before_ipa: w.phonetic_ipa,
                    after_ipa: nextIpa,
                  });
                  return {
                    ...w,
                    phonetic_ipa: nextIpa,
                    phonetic_override: nextOverride,
                    metadata: {
                      ...w.metadata,
                      updated_at: isoNow,
                    },
                  };
                });
                if (bucketDirty) {
                  buckets.set(bname, nextWords);
                  dirtyBuckets.add(bname);
                }
              }
              return { dirtyBuckets, changedCount: changes.length };
            },
          });

          const expectations: RevisionExpectation[] = [bucketPlan.expectation];
          if (args.dry_run || phonoExpectedExplicit !== undefined) {
            expectations.push({
              label: "phonology.json",
              targetPath: phonoAbs,
              expectedRevision: phonoExpectedExplicit ?? "",
            });
          }

          return {
            expectations,
            mutations: bucketPlan.mutations,
            languageId: resolved.language.language_id,
            snapshotId: bucketPlan.snapshotId,
            auditSummary: `Regenerated IPA for ${changes.length}/${scannedCount} lexicon entries`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              scanned_count: scannedCount,
              changed_count: changes.length,
              changes,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed: changes.length > 0,
              language_id: resolved.language.language_id,
              scanned_count: scannedCount,
              changed_count: changes.length,
              changes,
              revision: newRevisions.lexicon,
              revisions: {
                ...newRevisions,
                "phonology.json": phono.revision,
              },
              snapshot_id: bucketPlan.snapshotId,
              summary: `Regenerated IPA on ${changes.length} of ${scannedCount} scanned entries`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 8. lex_pull_sync
  registerDefinedTool(server, config, {
    name: "lex_pull_sync",
    title: "Pull & Evolve Lexicon Entries from Parent Language",
    description:
      "Evolve parent language lexicon entries through this language's SCA rules and apply additions/updates with mandatory lexicon snapshot and configurable conflict_strategy.",
    toolsets: ["write", "evolution"],
    access: "write",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      ...commonWriteInputFields,
      entry_ids: z
        .array(z.string())
        .max(500)
        .optional()
        .describe("Optional subset of parent/child entry_ids to sync"),
      conflict_strategy: z
        .enum(["skip", "keep_child", "overwrite_from_parent"])
        .optional()
        .describe("How to resolve parent/child hash conflicts (default: skip)"),
      base_revisions: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional dependency revisions map from dry_run / lex_parent_diff"),
    },
    handler: async (args) => {
      assertWriteAllowed(config, "lex_pull_sync");
      assertCommitOperationId(args.dry_run, args.operation_id);

      const strategy = args.conflict_strategy ?? "skip";
      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "lex_pull_sync",
        operationId: args.operation_id,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId, warnings: txWarnings }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const resolved = resolveLanguage(
            family,
            (args.language ?? args.language_id ?? "").trim(),
            { workspace: ws.config, revision: ws.revision },
          );
          const child = resolved.language;
          if (!child.parent_id) {
            throw new McpError(
              "VALIDATION",
              `Language "${child.name}" (${child.language_id}) has no parent_id.`,
            );
          }
          const parent = ws.config.languages.find(
            (l) => l.language_id === child.parent_id,
          );
          if (!parent) {
            throw new McpError(
              "NOT_FOUND",
              `Parent language "${child.parent_id}" not found in workspace.`,
            );
          }

          const parentLex = readLexiconUnlocked(family.project_dir, parent);
          const childLex = readLexiconUnlocked(family.project_dir, child);
          const childSca = readScaUnlocked(family.project_dir, child);
          const childPhono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            child,
          );
          const parentPhono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            parent,
          );

          const macros = buildEffectiveScaMacros(
            childPhono.config,
            parentPhono.config,
          );
          const syncPlan = computePullSync({
            parentLanguageId: parent.language_id,
            childLanguageId: child.language_id,
            parentWords: parentLex.words,
            childWords: childLex.words,
            scaRuleSets: childSca.config.rule_sets,
            macros,
          });

          const filterIds =
            args.entry_ids && args.entry_ids.length > 0
              ? new Set(args.entry_ids)
              : null;
          const parentById = new Map(
            parentLex.words.map((w) => [w.entry_id, w]),
          );
          const isoNow = nowIso();

          let added = 0;
          let updated = 0;
          let resolvedConflicts = 0;
          const skippedConflicts: {
            parentEntryId: string;
            childEntryId: string;
          }[] = [];
          const appliedEntries: {
            entry_id: string;
            mode: "add" | "update" | "conflict_keep_child" | "conflict_overwrite";
            romanized: string;
            ipa: string;
          }[] = [];

          const lexExpected =
            args.expected_revision ??
            args.base_revisions?.lexicon ??
            args.base_revisions?.child_lexicon ??
            "";

          const bucketPlan = planLexiconBucketWriteUnlocked({
            projectDir: family.project_dir,
            language: child,
            expectedRevision: lexExpected,
            dryRun: args.dry_run,
            operationType: "pull_sync",
            description: `MCP lex_pull_sync from ${parent.name} (${strategy})`,
            batchSize: Math.max(1, syncPlan.pending.length + syncPlan.conflicts.length),
            mandatorySnapshot: true,
            mutateBuckets: (buckets) => {
              const existingIndex = indexBucketsById(buckets);
              const dirtyBuckets = new Set<string>();
              let changedCount = 0;

              for (const item of syncPlan.pending) {
                const parentId =
                  item.word.etymology.parent_entry_id ?? item.word.entry_id;
                if (
                  filterIds &&
                  !filterIds.has(item.word.entry_id) &&
                  !filterIds.has(parentId)
                ) {
                  continue;
                }
                const rom = item.word.con_word_romanized.trim();
                if (!rom || rom === "new_word") {
                  txWarnings.push(
                    `Skipped entry "${item.word.entry_id}" because sound changes produced empty/invalid romanized form.`,
                  );
                  continue;
                }
                const prev = existingIndex.get(item.word.entry_id)?.word;
                const computedIpa = computeWordIpa(item.word, childPhono.config);
                const parentWord = parentById.get(parentId);
                const parentSyncHash = parentWord
                  ? getWordSyncDigest(parentWord)
                  : (item.word.evolution?.parent_snapshot_hash ?? null);

                const mergedBase = mergeWordPreservingUnknown(prev, {
                  ...item.word,
                  phonetic_ipa: computedIpa,
                  metadata: {
                    ...item.word.metadata,
                    created_at:
                      prev?.metadata.created_at ||
                      item.word.metadata.created_at ||
                      isoNow,
                    updated_at: isoNow,
                  },
                });
                const finalWord: WordEntry = {
                  ...mergedBase,
                  evolution: {
                    ...getWordEvolution(mergedBase),
                    parent_snapshot_hash: parentSyncHash,
                    last_synced_word_hash: getWordSyncDigest(mergedBase),
                  },
                };

                const res = applyUpsertIntoBuckets(
                  buckets,
                  existingIndex,
                  finalWord,
                  dirtyBuckets,
                );
                if (res.changed) {
                  changedCount++;
                  if (res.isNew) added++;
                  else updated++;
                  appliedEntries.push({
                    entry_id: finalWord.entry_id,
                    mode: item.mode,
                    romanized: finalWord.con_word_romanized,
                    ipa: finalWord.phonetic_ipa,
                  });
                }
              }

              for (const conflict of syncPlan.conflicts) {
                if (
                  filterIds &&
                  !filterIds.has(conflict.parentEntryId) &&
                  !filterIds.has(conflict.childEntryId)
                ) {
                  continue;
                }
                if (strategy === "skip") {
                  skippedConflicts.push(conflict);
                  continue;
                }

                const parentWord = parentById.get(conflict.parentEntryId);
                const existingChild = existingIndex.get(conflict.childEntryId)?.word;
                if (!parentWord || !existingChild) {
                  skippedConflicts.push(conflict);
                  continue;
                }

                const parentSyncHash = getWordSyncDigest(parentWord);

                if (strategy === "keep_child") {
                  const childSynced: WordEntry = {
                    ...existingChild,
                    metadata: {
                      ...existingChild.metadata,
                      updated_at: isoNow,
                    },
                    evolution: {
                      ...getWordEvolution(existingChild),
                      parent_snapshot_hash: parentSyncHash,
                      last_synced_word_hash: getWordSyncDigest(existingChild),
                    },
                  };
                  const res = applyUpsertIntoBuckets(
                    buckets,
                    existingIndex,
                    childSynced,
                    dirtyBuckets,
                  );
                  if (res.changed) {
                    changedCount++;
                    resolvedConflicts++;
                    appliedEntries.push({
                      entry_id: childSynced.entry_id,
                      mode: "conflict_keep_child",
                      romanized: childSynced.con_word_romanized,
                      ipa: childSynced.phonetic_ipa,
                    });
                  }
                } else if (strategy === "overwrite_from_parent") {
                  const { result, changelog } = applySoundChanges(
                    parentWord.con_word_romanized,
                    childSca.config.rule_sets,
                    macros,
                  );
                  const evolvedRom = result.trim();
                  if (!evolvedRom || evolvedRom === "new_word") {
                    txWarnings.push(
                      `Skipped conflict entry "${conflict.childEntryId}" because evolved parent form was empty.`,
                    );
                    skippedConflicts.push(conflict);
                    continue;
                  }
                  const appliedRuleIds = Array.from(
                    new Set(changelog.map((step) => step.rule_id)),
                  );
                  const candidate: WordEntry = mergeWordPreservingUnknown(
                    existingChild,
                    {
                      ...parentWord,
                      entry_id: existingChild.entry_id,
                      language_id: child.language_id,
                      con_word_romanized: evolvedRom,
                      phonetic_override: false,
                      phonetic_ipa: computeWordIpa(
                        {
                          con_word_romanized: evolvedRom,
                          phonetic_ipa: "",
                          phonetic_override: false,
                        },
                        childPhono.config,
                      ),
                      etymology: {
                        ...parentWord.etymology,
                        origin_type: "evolved",
                        parent_entry_id: parentWord.entry_id,
                        source_language_id: parent.language_id,
                        applied_sound_changes: appliedRuleIds,
                      },
                      metadata: {
                        ...parentWord.metadata,
                        created_at:
                          existingChild.metadata.created_at ||
                          parentWord.metadata.created_at ||
                          isoNow,
                        updated_at: isoNow,
                      },
                    },
                  );
                  const finalOverwritten: WordEntry = {
                    ...candidate,
                    evolution: {
                      ...getWordEvolution(parentWord),
                      parent_snapshot_hash: parentSyncHash,
                      last_synced_word_hash: getWordSyncDigest(candidate),
                    },
                  };
                  const res = applyUpsertIntoBuckets(
                    buckets,
                    existingIndex,
                    finalOverwritten,
                    dirtyBuckets,
                  );
                  if (res.changed) {
                    changedCount++;
                    resolvedConflicts++;
                    appliedEntries.push({
                      entry_id: finalOverwritten.entry_id,
                      mode: "conflict_overwrite",
                      romanized: finalOverwritten.con_word_romanized,
                      ipa: finalOverwritten.phonetic_ipa,
                    });
                  }
                }
              }

              return { dirtyBuckets, changedCount };
            },
          });

          const childDir = assertSafeRelativeLanguagePath(
            family.project_dir,
            child.path,
          );
          const parentDir = assertSafeRelativeLanguagePath(
            family.project_dir,
            parent.path,
          );

          const expectations: RevisionExpectation[] = [bucketPlan.expectation];
          if (args.dry_run || args.base_revisions?.parent_lexicon) {
            expectations.push({
              label: "parent_lexicon",
              targetPath: path.join(parentDir, "lexicon"),
              isLexiconDir: true,
              expectedRevision: args.base_revisions?.parent_lexicon ?? "",
            });
          }
          if (args.dry_run || args.base_revisions?.["sca_rules.json"]) {
            expectations.push({
              label: "sca_rules.json",
              targetPath: path.join(childDir, "sca_rules.json"),
              expectedRevision: args.base_revisions?.["sca_rules.json"] ?? "",
            });
          }
          if (args.dry_run || args.base_revisions?.["phonology.json"]) {
            expectations.push({
              label: "phonology.json",
              targetPath: path.join(childDir, "phonology.json"),
              expectedRevision: args.base_revisions?.["phonology.json"] ?? "",
            });
          }
          if (args.dry_run || args.base_revisions?.workspace) {
            expectations.push({
              label: "workspace",
              targetPath: family.conlang_file_path,
              expectedRevision: args.base_revisions?.workspace ?? "",
            });
          }

          return {
            expectations,
            mutations: bucketPlan.mutations,
            languageId: child.language_id,
            snapshotId: bucketPlan.snapshotId,
            auditSummary: `Pull-synced ${appliedEntries.length} entries into ${child.language_id} from ${parent.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: child.language_id,
              parent_language_id: parent.language_id,
              conflict_strategy: strategy,
              added,
              updated,
              resolved_conflicts: resolvedConflicts,
              skipped_conflicts: skippedConflicts,
              applied_entries: appliedEntries,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed: bucketPlan.changedCount > 0,
              language_id: child.language_id,
              parent_language_id: parent.language_id,
              conflict_strategy: strategy,
              added,
              updated,
              resolved_conflicts: resolvedConflicts,
              skipped_conflicts: skippedConflicts,
              applied_entries: appliedEntries,
              revision: newRevisions.lexicon,
              revisions: newRevisions,
              snapshot_id: bucketPlan.snapshotId,
              summary: `Pull Sync applied ${appliedEntries.length} entries (${added} added, ${updated} updated, ${resolvedConflicts} conflicts resolved, ${skippedConflicts.length} conflicts skipped)`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 9. lex_borrow
  registerDefinedTool(server, config, {
    name: "lex_borrow",
    title: "Borrow Words from Another Language",
    description:
      "Borrow 1..500 lexicon entries from a source language in the same family into the target language, recording origin_type = 'borrowed', source_language_id, and parent_entry_id.",
    toolsets: ["write", "evolution"],
    access: "write",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      ...commonWriteInputFields,
      source_language: z
        .string()
        .describe("Donor language ID, name, or relative path"),
      entry_ids: z
        .array(z.string())
        .min(1)
        .max(500)
        .describe("Source language entry_ids to borrow"),
      adapt_with_sca: z
        .boolean()
        .optional()
        .describe("Apply target language's SCA rules to adapt borrowed word spelling (default: false)"),
      romanized_overrides: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional map of source_entry_id -> adapted romanized spelling"),
      ipa_overrides: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional map of source_entry_id -> custom phonetic_ipa (sets phonetic_override: true)"),
      semantic_shift_note: z.string().optional(),
      tags: z
        .array(z.string())
        .optional()
        .describe("Optional extra tags to attach to borrowed entries"),
    },
    handler: async (args) => {
      assertWriteAllowed(config, "lex_borrow");
      assertCommitOperationId(args.dry_run, args.operation_id);

      const family = resolveFamilyFromArgs(config, args);
      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "lex_borrow",
        operationId: args.operation_id,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const targetResolved = resolveLanguage(
            family,
            (args.language ?? args.language_id ?? "").trim(),
            { workspace: ws.config, revision: ws.revision },
          );
          const sourceResolved = resolveLanguage(
            family,
            args.source_language.trim(),
            { workspace: ws.config, revision: ws.revision },
          );

          if (
            targetResolved.language.language_id ===
            sourceResolved.language.language_id
          ) {
            throw new McpError(
              "VALIDATION",
              "source_language and target language must be different languages.",
            );
          }

          const sourceLex = readLexiconUnlocked(
            family.project_dir,
            sourceResolved.language,
          );
          const sourceById = new Map(
            sourceLex.words.map((w) => [w.entry_id, w]),
          );
          const missingIds = args.entry_ids.filter((id) => !sourceById.has(id));
          if (missingIds.length > 0) {
            throw new McpError(
              "NOT_FOUND",
              `${missingIds.length} entry_id(s) not found in source language "${sourceResolved.language.name}".`,
              undefined,
              { missing_entry_ids: missingIds },
            );
          }

          const targetPhono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            targetResolved.language,
          );
          const targetSca = args.adapt_with_sca
            ? readScaUnlocked(family.project_dir, targetResolved.language)
            : null;
          const macros = buildEffectiveScaMacros(targetPhono.config);
          const isoNow = nowIso();

          const borrowedItems: {
            source_entry_id: string;
            target_entry_id: string;
            romanized: string;
            ipa: string;
            is_new: boolean;
          }[] = [];

          const bucketPlan = planLexiconBucketWriteUnlocked({
            projectDir: family.project_dir,
            language: targetResolved.language,
            expectedRevision: args.expected_revision,
            dryRun: args.dry_run,
            operationType: "borrowing",
            description: `MCP lex_borrow (${args.entry_ids.length} words from ${sourceResolved.language.name})`,
            batchSize: args.entry_ids.length,
            mutateBuckets: (buckets) => {
              const existingIndex = indexBucketsById(buckets);
              const existingLoansBySrc = new Map<string, WordEntry>();
              for (const { word } of existingIndex.values()) {
                if (
                  word.etymology.origin_type === "borrowed" &&
                  word.etymology.source_language_id ===
                    sourceResolved.language.language_id &&
                  word.etymology.parent_entry_id
                ) {
                  existingLoansBySrc.set(word.etymology.parent_entry_id, word);
                }
              }

              const dirtyBuckets = new Set<string>();
              let changedCount = 0;

              for (let idx = 0; idx < args.entry_ids.length; idx++) {
                const srcWord = sourceById.get(args.entry_ids[idx])!;
                const priorLoan = existingLoansBySrc.get(srcWord.entry_id);
                const targetEntryId = priorLoan?.entry_id ?? newEntryId();

                let adaptedRomanized =
                  args.romanized_overrides?.[srcWord.entry_id]?.trim();
                let appliedRuleIds: string[] = [];
                if (!adaptedRomanized) {
                  if (targetSca) {
                    const scaOut = applySoundChanges(
                      srcWord.con_word_romanized,
                      targetSca.config.rule_sets,
                      macros,
                    );
                    adaptedRomanized = scaOut.result.trim();
                    appliedRuleIds = Array.from(
                      new Set(scaOut.changelog.map((s) => s.rule_id)),
                    );
                  } else {
                    adaptedRomanized = srcWord.con_word_romanized.trim();
                  }
                }

                const customIpa = args.ipa_overrides?.[srcWord.entry_id];
                const phoneticOverride = customIpa !== undefined;
                const phoneticIpa = phoneticOverride
                  ? customIpa
                  : computeWordIpa(
                      {
                        con_word_romanized: adaptedRomanized,
                        phonetic_ipa: "",
                        phonetic_override: false,
                      },
                      targetPhono.config,
                    );

                const mergedTags = Array.from(
                  new Set([
                    ...(priorLoan?.metadata.tags ?? srcWord.metadata.tags),
                    ...(args.tags ?? []),
                  ]),
                );

                const loanEntry: WordEntry = mergeWordPreservingUnknown(
                  priorLoan,
                  {
                    entry_id: targetEntryId,
                    language_id: targetResolved.language.language_id,
                    con_word_romanized: adaptedRomanized,
                    phonetic_ipa: phoneticIpa,
                    phonetic_override: phoneticOverride,
                    senses: srcWord.senses.map((s) => ({
                      ...s,
                      sense_id: priorLoan
                        ? s.sense_id
                        : newPrefixedId("sense"),
                    })),
                    etymology: {
                      origin_type: "borrowed",
                      parent_entry_id: srcWord.entry_id,
                      source_language_id: sourceResolved.language.language_id,
                      applied_sound_changes: appliedRuleIds,
                      semantic_shift_note:
                        args.semantic_shift_note ??
                        priorLoan?.etymology.semantic_shift_note ??
                        "",
                    },
                    metadata: {
                      tags: mergedTags,
                      created_at: priorLoan?.metadata.created_at || isoNow,
                      updated_at: isoNow,
                    },
                  },
                );

                validateWordStrictOrThrow(loanEntry, idx);
                const res = applyUpsertIntoBuckets(
                  buckets,
                  existingIndex,
                  loanEntry,
                  dirtyBuckets,
                );
                if (res.changed) changedCount++;
                borrowedItems.push({
                  source_entry_id: srcWord.entry_id,
                  target_entry_id: loanEntry.entry_id,
                  romanized: loanEntry.con_word_romanized,
                  ipa: loanEntry.phonetic_ipa,
                  is_new: res.isNew,
                });
              }

              return { dirtyBuckets, changedCount };
            },
          });

          return {
            expectations: [bucketPlan.expectation],
            mutations: bucketPlan.mutations,
            languageId: targetResolved.language.language_id,
            snapshotId: bucketPlan.snapshotId,
            auditSummary: `Borrowed ${borrowedItems.length} words from ${sourceResolved.language.language_id} into ${targetResolved.language.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: targetResolved.language.language_id,
              source_language_id: sourceResolved.language.language_id,
              borrowed: borrowedItems,
              base_revisions: {
                ...baseRevisions,
                source_lexicon: sourceLex.revision,
              },
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed: bucketPlan.changedCount > 0,
              language_id: targetResolved.language.language_id,
              source_language_id: sourceResolved.language.language_id,
              borrowed: borrowedItems,
              revision: newRevisions.lexicon,
              revisions: newRevisions,
              snapshot_id: bucketPlan.snapshotId,
              summary: `Borrowed ${borrowedItems.length} word(s) from ${sourceResolved.language.name}`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 10. lex_import_csv
  registerDefinedTool(server, config, {
    name: "lex_import_csv",
    title: "Import Lexicon Entries from CSV",
    description:
      "Parse CSV text or an allowed CSV file (PolyGlot, Vulgarlang, or generic format), compute IPA when missing, strictly validate entries, and upsert into lexicon buckets (supports dry_run preview).",
    toolsets: ["write"],
    access: "write",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      ...commonWriteInputFields,
      csv_text: z.string().optional().describe("Raw CSV text (including header row)"),
      file_path: z
        .string()
        .optional()
        .describe("Path to CSV file inside allowed roots"),
      column_mapping: z
        .object({
          word: z.number().int().min(-1).optional(),
          ipa: z.number().int().min(-1).optional(),
          pos: z.number().int().min(-1).optional(),
          gloss: z.number().int().min(-1).optional(),
          definition: z.number().int().min(-1).optional(),
        })
        .optional()
        .describe("Optional zero-based column index overrides (-1 for absent)"),
      origin_type: z
        .enum(ORIGIN_TYPES)
        .optional()
        .describe("Origin type assigned to imported entries (default: a_posteriori)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags assigned to imported entries (default: ['imported'])"),
    },
    handler: async (args) => {
      assertWriteAllowed(config, "lex_import_csv");
      assertCommitOperationId(args.dry_run, args.operation_id);

      let csvContent = args.csv_text;
      if (!csvContent && args.file_path) {
        const resolvedCsvPath = assertPathAllowed(args.file_path, config);
        if (!fs.existsSync(resolvedCsvPath) || !fs.statSync(resolvedCsvPath).isFile()) {
          throw new McpError(
            "NOT_FOUND",
            `CSV file not found: ${args.file_path}`,
          );
        }
        csvContent = fs.readFileSync(resolvedCsvPath, "utf-8");
      }
      if (!csvContent || !csvContent.trim()) {
        throw new McpError(
          "VALIDATION",
          "Provide non-empty csv_text or a readable file_path.",
        );
      }

      const family = resolveFamilyFromArgs(config, args);
      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "lex_import_csv",
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
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );

          const preview = previewCSVImport(
            csvContent!,
            resolved.language.language_id,
          );
          if (preview.rows.length === 0) {
            throw new McpError(
              "VALIDATION",
              "CSV contains no data rows after header.",
            );
          }

          const effectiveMapping: CSVColumnMapping = {
            ...preview.mapping,
            ...(args.column_mapping ?? {}),
          };
          const isoNow = nowIso();
          const entryIdHeaderIdx = preview.headers.findIndex(
            (h) => h.trim().toLowerCase() === "entry_id",
          );

          let added = 0;
          let updated = 0;
          const importedEntries: WordEntry[] = [];

          const bucketPlan = planLexiconBucketWriteUnlocked({
            projectDir: family.project_dir,
            language: resolved.language,
            expectedRevision: args.expected_revision,
            dryRun: args.dry_run,
            operationType: "auto_snapshot",
            description: `MCP lex_import_csv (${preview.rows.length} rows)`,
            batchSize: preview.rows.length,
            mandatorySnapshot: true,
            mutateBuckets: (buckets) => {
              const existingIndex = indexBucketsById(buckets);
              const nonEmptyRows = preview.rows.filter((r) =>
                r.some((c) => c.trim().length > 0),
              );
              const rowErrors: { row: number; message: string }[] = [];
              const builtWords: WordEntry[] = [];

              for (let i = 0; i < nonEmptyRows.length; i++) {
                const row = nonEmptyRows[i];
                const defaultParsed = preview.words[i];
                const rawWord =
                  effectiveMapping.word >= 0
                    ? (row[effectiveMapping.word] ?? "").trim()
                    : (defaultParsed?.con_word_romanized ?? "").trim();
                const rawIpa =
                  effectiveMapping.ipa >= 0
                    ? (row[effectiveMapping.ipa] ?? "").trim()
                    : (defaultParsed?.phonetic_ipa ?? "").trim();
                const rawGloss =
                  effectiveMapping.gloss >= 0
                    ? (row[effectiveMapping.gloss] ?? "").trim()
                    : (defaultParsed?.senses[0]?.gloss ?? "").trim();
                const rawDef =
                  effectiveMapping.definition >= 0
                    ? (row[effectiveMapping.definition] ?? "").trim()
                    : (defaultParsed?.senses[0]?.definitions[0] ?? "").trim();
                const posId =
                  args.column_mapping?.pos !== undefined
                    ? effectiveMapping.pos >= 0
                      ? (row[effectiveMapping.pos] ?? "").trim() || "pos_noun"
                      : "pos_noun"
                    : (defaultParsed?.senses[0]?.pos_id ?? "pos_noun");

                const explicitId =
                  entryIdHeaderIdx >= 0 ? (row[entryIdHeaderIdx] ?? "").trim() : "";
                const entryId = explicitId || newEntryId();
                const existing = existingIndex.get(entryId)?.word;

                const phoneticOverride = rawIpa.length > 0;
                const phoneticIpa = computeWordIpa(
                  {
                    con_word_romanized: rawWord,
                    phonetic_ipa: rawIpa,
                    phonetic_override: phoneticOverride,
                  },
                  phono.config,
                );

                const candidate: WordEntry = mergeWordPreservingUnknown(existing, {
                  entry_id: entryId,
                  language_id: resolved.language.language_id,
                  con_word_romanized: rawWord,
                  phonetic_ipa: phoneticIpa,
                  phonetic_override: phoneticOverride,
                  senses: [
                    {
                      sense_id:
                        existing?.senses[0]?.sense_id || newPrefixedId("sense"),
                      pos_id: posId,
                      gloss: rawGloss,
                      definitions: rawDef
                        ? rawDef
                            .split(";")
                            .map((d) => d.trim())
                            .filter(Boolean)
                        : [],
                      examples: existing?.senses[0]?.examples ?? [],
                    },
                  ],
                  etymology: {
                    origin_type: args.origin_type ?? "a_posteriori",
                    parent_entry_id: existing?.etymology.parent_entry_id ?? null,
                    source_language_id:
                      existing?.etymology.source_language_id ?? null,
                    applied_sound_changes:
                      existing?.etymology.applied_sound_changes ?? [],
                    semantic_shift_note:
                      existing?.etymology.semantic_shift_note ?? "",
                  },
                  metadata: {
                    tags: args.tags ?? ["imported"],
                    created_at: existing?.metadata.created_at || isoNow,
                    updated_at: isoNow,
                  },
                });

                try {
                  validateWordStrictOrThrow(candidate, i);
                  builtWords.push(candidate);
                } catch (err) {
                  rowErrors.push({
                    row: i + 2,
                    message: err instanceof Error ? err.message : String(err),
                  });
                }
              }

              if (rowErrors.length > 0) {
                throw new McpError(
                  "VALIDATION",
                  `CSV import failed validation on ${rowErrors.length} row(s): row ${rowErrors[0].row}: ${rowErrors[0].message}`,
                  "Verify column_mapping and ensure every row has non-empty word and gloss.",
                  {
                    detected_format: preview.format,
                    headers: preview.headers,
                    mapping: effectiveMapping,
                    errors: rowErrors,
                  },
                );
              }

              const dirtyBuckets = new Set<string>();
              let changedCount = 0;
              for (const w of builtWords) {
                const res = applyUpsertIntoBuckets(
                  buckets,
                  existingIndex,
                  w,
                  dirtyBuckets,
                );
                importedEntries.push(w);
                if (res.isNew) added++;
                else if (res.changed) updated++;
                if (res.changed) changedCount++;
              }
              return { dirtyBuckets, changedCount };
            },
          });

          return {
            expectations: [bucketPlan.expectation],
            mutations: bucketPlan.mutations,
            languageId: resolved.language.language_id,
            snapshotId: bucketPlan.snapshotId,
            auditSummary: `Imported ${importedEntries.length} CSV entries into ${resolved.language.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              detected_format: preview.format,
              headers: preview.headers,
              mapping: effectiveMapping,
              total_rows: importedEntries.length,
              added,
              updated,
              sample_entries: importedEntries.slice(0, 25),
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed: bucketPlan.changedCount > 0,
              language_id: resolved.language.language_id,
              detected_format: preview.format,
              imported_count: importedEntries.length,
              added,
              updated,
              revision: newRevisions.lexicon,
              revisions: newRevisions,
              snapshot_id: bucketPlan.snapshotId,
              summary: `Imported ${importedEntries.length} CSV entries (${added} added, ${updated} updated)`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 11. lex_delete
  registerDefinedTool(server, config, {
    name: "lex_delete",
    title: "Delete Lexicon Entries",
    description:
      "Destructively delete 1..500 lexicon entries by entry_id across lexicon buckets after recording a mandatory lexicon snapshot. Requires --mode write+destructive and confirm: true.",
    toolsets: ["write", "admin"],
    access: "destructive",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      ...commonWriteInputFields,
      entry_ids: z
        .array(z.string())
        .min(1)
        .max(500)
        .describe("Entry IDs to delete"),
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to execute deletion"),
    },
    handler: async (args) => {
      assertDestructiveAllowed(config, "lex_delete", args.confirm, args.dry_run);
      assertCommitOperationId(args.dry_run, args.operation_id);

      const family = resolveFamilyFromArgs(config, args);
      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "lex_delete",
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

          const targetSet = new Set(
            args.entry_ids.map((id) => id.trim()).filter(Boolean),
          );
          const deletedEntries: { entry_id: string; romanized: string }[] = [];
          const foundSet = new Set<string>();

          const bucketPlan = planLexiconBucketWriteUnlocked({
            projectDir: family.project_dir,
            language: resolved.language,
            expectedRevision: args.expected_revision,
            dryRun: args.dry_run,
            operationType: "auto_snapshot",
            description: `MCP lex_delete (${targetSet.size} entries)`,
            batchSize: targetSet.size,
            mandatorySnapshot: true,
            mutateBuckets: (buckets) => {
              const dirtyBuckets = new Set<string>();
              for (const [bname, words] of buckets.entries()) {
                const kept: WordEntry[] = [];
                let removedHere = false;
                for (const w of words) {
                  if (targetSet.has(w.entry_id)) {
                    removedHere = true;
                    foundSet.add(w.entry_id);
                    deletedEntries.push({
                      entry_id: w.entry_id,
                      romanized: w.con_word_romanized,
                    });
                  } else {
                    kept.push(w);
                  }
                }
                if (removedHere) {
                  buckets.set(bname, kept);
                  dirtyBuckets.add(bname);
                }
              }
              return { dirtyBuckets, changedCount: deletedEntries.length };
            },
          });

          const notFoundIds = Array.from(targetSet).filter(
            (id) => !foundSet.has(id),
          );

          return {
            expectations: [bucketPlan.expectation],
            mutations: bucketPlan.mutations,
            languageId: resolved.language.language_id,
            snapshotId: bucketPlan.snapshotId,
            auditSummary: `Deleted ${deletedEntries.length} lexicon entries from ${resolved.language.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              deleted_count: deletedEntries.length,
              deleted_entries: deletedEntries,
              not_found_ids: notFoundIds,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed: deletedEntries.length > 0,
              language_id: resolved.language.language_id,
              deleted_count: deletedEntries.length,
              deleted_ids: deletedEntries.map((d) => d.entry_id),
              not_found_ids: notFoundIds,
              revision: newRevisions.lexicon,
              revisions: newRevisions,
              snapshot_id: bucketPlan.snapshotId,
              summary: `Deleted ${deletedEntries.length} lexicon entries`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });
}
