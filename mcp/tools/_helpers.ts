import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  LanguageEntry,
  OperationType,
  PhonologyConfig,
  WordEntry,
} from "../../src/types";
import { McpError } from "../errors";
import {
  assertSafeRelativeLanguagePath,
  type ResolvedFamily,
  type ResolvedLanguage,
  resolveFamily,
  resolveLanguage,
} from "../registry/addressing";
import type { McpConfig } from "../config";
import {
  buildLegacyArchive,
  stripLegacyFieldsFromPhonology,
} from "../storage/legacy";
import {
  isValidWordEntryCompat,
  readPhonologyUnlocked,
  readWorkspaceUnlocked,
  normalizeWordEntryFromRaw,
} from "../storage/read";
import {
  markSessionScopeWritten,
  planLanguageSnapshot,
  shouldAutoSnapshot,
} from "../storage/snapshot";
import type {
  PlannedMutation,
  RevisionExpectation,
} from "../storage/transaction";
import { computeFileRevision, computeLexiconRevision } from "../storage/revision";

export const familyInputFields = {
  family: z
    .string()
    .optional()
    .describe("Family ID, name, or .conlang path (defaults to active family)"),
  family_id: z
    .string()
    .optional()
    .describe("Alias for family"),
};

export const languageInputFields = {
  language: z
    .string()
    .optional()
    .describe("Language ID, name, or relative directory path"),
  language_id: z
    .string()
    .optional()
    .describe("Alias for language"),
};

export const commonWriteInputFields = {
  operation_id: z
    .string()
    .optional()
    .describe("Client-generated idempotency ID"),
  expected_revision: z
    .string()
    .optional()
    .describe("Expected target revision for optimistic concurrency (CAS)"),
  dry_run: z
    .boolean()
    .optional()
    .describe("If true, preview changes and return base_revisions without mutating disk"),
};

export function pickFamilyArg(args: {
  family?: string;
  family_id?: string;
}): string | undefined {
  return args.family ?? args.family_id;
}

export function pickLanguageArg(
  args: { language?: string; language_id?: string },
  fieldLabel: string = "language",
): string {
  const val = (args.language ?? args.language_id)?.trim();
  if (!val) {
    throw new McpError(
      "VALIDATION",
      `Missing required parameter "${fieldLabel}" (or "language_id").`,
    );
  }
  return val;
}

export function resolveFamilyFromArgs(
  config: McpConfig,
  args: { family?: string; family_id?: string },
): ResolvedFamily {
  return resolveFamily(config, pickFamilyArg(args));
}

export function resolveLanguageUnlocked(
  family: ResolvedFamily,
  args: { language?: string; language_id?: string },
): ResolvedLanguage {
  const ws = readWorkspaceUnlocked(family.conlang_file_path);
  const langQuery = pickLanguageArg(args);
  return resolveLanguage(family, langQuery, {
    workspace: ws.config,
    revision: ws.revision,
  });
}

export function normalizeRelPathPosix(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

export function bucketFilename(romanized: string): string {
  const chars = Array.from(romanized);
  const first = chars[0] ? Array.from(chars[0].toLowerCase())[0] ?? "_" : "_";
  if (/^[a-z]$/.test(first)) {
    return `lexicon_${first}.ndjson`;
  }
  return "lexicon_others.ndjson";
}

export function readLexiconBucketsPreserveUnknownUnlocked(
  projectDir: string,
  language: LanguageEntry,
): Map<string, WordEntry[]> {
  const langDir = assertSafeRelativeLanguagePath(projectDir, language.path);
  const lexiconDir = path.join(langDir, "lexicon");
  const buckets = new Map<string, WordEntry[]>();
  if (!fs.existsSync(lexiconDir) || !fs.statSync(lexiconDir).isDirectory()) {
    return buckets;
  }

  const files = fs
    .readdirSync(lexiconDir)
    .filter((f) => f.endsWith(".ndjson"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const fname of files) {
    const abs = path.join(lexiconDir, fname);
    const lines = fs.readFileSync(abs, "utf-8").split(/\r?\n/);
    const entries: WordEntry[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const norm = normalizeWordEntryFromRaw(parsed, language.language_id);
        if (isValidWordEntryCompat(norm)) {
          entries.push(norm);
        }
      } catch (err) {
        console.warn(`Skipping corrupt NDJSON line in ${fname}:`, err);
      }
    }
    buckets.set(fname, entries);
  }
  return buckets;
}

export function serializeBucketWords(words: WordEntry[]): Buffer {
  const sorted = [...words].sort((a, b) =>
    Buffer.compare(
      Buffer.from(a.con_word_romanized, "utf-8"),
      Buffer.from(b.con_word_romanized, "utf-8"),
    ),
  );
  const lines = sorted.map((w) => JSON.stringify(w));
  return Buffer.from(lines.join("\n") + "\n", "utf-8");
}

/**
 * 清掉值为 `undefined` 的自有属性。
 *
 * 调用方用 `key: undefined` 显式表达「置空」：浅合并（`{ ...prev, ...next }`）时它能覆盖
 * 旧值，但落盘前必须删掉，否则 NDJSON 里会出现 `"usage_note": null` 之类的脏字段。
 */
function dropUndefinedKeys<T extends object>(value: T): T {
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) {
      delete record[key];
    }
  }
  return value;
}

export function mergeWordPreservingUnknown(
  existing: WordEntry | undefined,
  incoming: WordEntry,
): WordEntry {
  if (!existing) {
    return incoming;
  }
  const existingSensesById = new Map(
    existing.senses.map((s) => [s.sense_id, s]),
  );
  // 义项合并后统一清理 undefined：concept_id / usage_note / inflection_class_id
  // 等可选字段一旦被显式置空，不得再从 existing 复活
  const mergedSenses = incoming.senses.map((s) => {
    const prev = existingSensesById.get(s.sense_id);
    return prev ? dropUndefinedKeys({ ...prev, ...s }) : dropUndefinedKeys({ ...s });
  });

  const mergedEvolution =
    existing.evolution || incoming.evolution
      ? {
          ...existing.evolution,
          ...incoming.evolution,
          is_deprecated:
            incoming.evolution?.is_deprecated ??
            existing.evolution?.is_deprecated ??
            false,
          deprecated_since_language_id:
            incoming.evolution?.deprecated_since_language_id !== undefined
              ? incoming.evolution.deprecated_since_language_id
              : (existing.evolution?.deprecated_since_language_id ?? null),
        }
      : undefined;

  return dropUndefinedKeys({
    ...existing,
    ...incoming,
    senses: mergedSenses,
    etymology: dropUndefinedKeys({
      ...existing.etymology,
      ...incoming.etymology,
    }),
    metadata: {
      ...existing.metadata,
      ...incoming.metadata,
    },
    ...(mergedEvolution ? { evolution: mergedEvolution } : {}),
  });
}

export function validateWordStrictOrThrow(word: WordEntry, index?: number): void {
  const prefix = index !== undefined ? `entries[${index}]` : "entry";
  const rom = (word.con_word_romanized ?? "").trim();
  if (!rom || rom === "new_word") {
    throw new McpError(
      "VALIDATION",
      `${prefix}: con_word_romanized must be non-empty and cannot be placeholder 'new_word'.`,
    );
  }
  if (!Array.isArray(word.senses) || word.senses.length === 0) {
    throw new McpError(
      "VALIDATION",
      `${prefix} ("${rom}"): must include at least one sense.`,
    );
  }
  const hasNonEmptyGloss = word.senses.some(
    (s) => typeof s.gloss === "string" && s.gloss.trim().length > 0,
  );
  if (!hasNonEmptyGloss) {
    throw new McpError(
      "VALIDATION",
      `${prefix} ("${rom}"): at least one sense must have a non-empty gloss.`,
    );
  }
}

export function planLexiconBucketWriteUnlocked(opts: {
  projectDir: string;
  language: LanguageEntry;
  expectedRevision?: string;
  dryRun?: boolean;
  operationType: OperationType;
  description: string;
  batchSize: number;
  mandatorySnapshot?: boolean;
  mutateBuckets: (buckets: Map<string, WordEntry[]>) => {
    dirtyBuckets: Set<string>;
    changedCount: number;
  };
}): {
  expectation: RevisionExpectation;
  mutations: PlannedMutation[];
  snapshotId: string | null;
  changedCount: number;
} {
  const langDir = assertSafeRelativeLanguagePath(opts.projectDir, opts.language.path);
  const langRel = normalizeRelPathPosix(opts.language.path);
  const lexiconRel = `${langRel}/lexicon`;
  const lexiconAbs = path.join(langDir, "lexicon");

  const expectation: RevisionExpectation = {
    label: "lexicon",
    targetPath: lexiconAbs,
    isLexiconDir: true,
    expectedRevision: opts.expectedRevision ?? "",
  };

  const buckets = readLexiconBucketsPreserveUnknownUnlocked(
    opts.projectDir,
    opts.language,
  );
  const { dirtyBuckets, changedCount } = opts.mutateBuckets(buckets);

  const mutations: PlannedMutation[] = [];
  let snapshotId: string | null = null;

  if (dirtyBuckets.size > 0) {
    const needSnap = shouldAutoSnapshot({
      projectDir: opts.projectDir,
      languageId: opts.language.language_id,
      scope: "lexicon",
      batchSize: opts.batchSize,
      mandatory: opts.mandatorySnapshot,
    });
    if (needSnap) {
      const snap = planLanguageSnapshot({
        projectDir: opts.projectDir,
        language: opts.language,
        scope: "lexicon",
        origin: "mcp",
        operationType: opts.operationType,
        description: opts.description,
      });
      snapshotId = snap.snapshotId;
      mutations.push(...snap.mutations);
      if (!opts.dryRun) {
        markSessionScopeWritten(
          opts.projectDir,
          opts.language.language_id,
          "lexicon",
        );
      }
    }

    mutations.push({ kind: "create_dir", relPath: lexiconRel });
    const sortedDirty = Array.from(dirtyBuckets).sort();
    for (const bname of sortedDirty) {
      const rel = `${lexiconRel}/${bname}`;
      const bwords = buckets.get(bname) ?? [];
      if (bwords.length > 0) {
        mutations.push({
          kind: "write_file",
          relPath: rel,
          content: serializeBucketWords(bwords),
        });
      } else if (fs.existsSync(path.join(lexiconAbs, bname))) {
        mutations.push({
          kind: "delete_path",
          relPath: rel,
        });
      }
    }
  }

  return {
    expectation,
    mutations,
    snapshotId,
    changedCount,
  };
}

/**
 * Plans a safe write to `phonology.json`:
 * - Operates strictly on `local_config` (never injecting inherited `glyph_annotations` unless explicitly requested).
 * - Preserves top-level and nested unknown fields on `phonology.json`.
 * - Archives and strips legacy `writing_systems` / `font_encoding_profiles` / map & rule writing fields on first write (`PRD §4.6`).
 * - Records an automatic `phonology` language snapshot according to policy (`§3.6`).
 */
export function planPhonologyWriteUnlocked(opts: {
  projectDir: string;
  conlangFilePath: string;
  language: LanguageEntry;
  operationId: string;
  expectedRevision?: string;
  dryRun?: boolean;
  description: string;
  batchSize?: number;
  mandatorySnapshot?: boolean;
  buildNextLocalConfig: (
    currentLocal: PhonologyConfig,
    phonoLoad: ReturnType<typeof readPhonologyUnlocked>,
  ) => PhonologyConfig;
}): {
  expectation: RevisionExpectation;
  mutations: PlannedMutation[];
  snapshotId: string | null;
  legacyArchiveFile: string | null;
  beforeLocal: PhonologyConfig;
  afterLocal: PhonologyConfig;
  warnings: string[];
} {
  const langDir = assertSafeRelativeLanguagePath(opts.projectDir, opts.language.path);
  const langRel = normalizeRelPathPosix(opts.language.path);
  const phonoAbs = path.join(langDir, "phonology.json");
  const phonoRel = `${langRel}/phonology.json`;

  const phonoLoad = readPhonologyUnlocked(
    opts.projectDir,
    opts.conlangFilePath,
    opts.language,
  );
  const currentLocalCfg = phonoLoad.local_config ?? phonoLoad.config;
  const beforeLocal = structuredClone(currentLocalCfg);

  let rawDiskBytes = Buffer.alloc(0);
  let rawDiskObj: Record<string, unknown> = {};
  if (fs.existsSync(phonoAbs)) {
    rawDiskBytes = fs.readFileSync(phonoAbs);
    rawDiskObj = JSON.parse(rawDiskBytes.toString("utf-8")) as Record<
      string,
      unknown
    >;
  }

  const nextLocal = opts.buildNextLocalConfig(
    structuredClone(currentLocalCfg),
    phonoLoad,
  );

  // Merge onto rawDiskObj to preserve top-level unknown fields, then strip legacy writing fields
  const mergedObj: Record<string, unknown> = {
    ...rawDiskObj,
    ...nextLocal,
    language_id: nextLocal.language_id || opts.language.language_id,
  };
  if (!nextLocal.glyph_annotations || nextLocal.glyph_annotations.length === 0) {
    delete mergedObj.glyph_annotations;
  } else {
    mergedObj.glyph_annotations = nextLocal.glyph_annotations;
  }

  const cleanedObj = stripLegacyFieldsFromPhonology(mergedObj);
  const afterLocal = cleanedObj as unknown as PhonologyConfig;

  const mutations: PlannedMutation[] = [];
  const warnings: string[] = [];
  let snapshotId: string | null = null;
  let legacyArchiveFile: string | null = null;

  const needSnap = shouldAutoSnapshot({
    projectDir: opts.projectDir,
    languageId: opts.language.language_id,
    scope: "phonology",
    batchSize: opts.batchSize ?? 1,
    mandatory: opts.mandatorySnapshot,
  });
  if (needSnap) {
    const snap = planLanguageSnapshot({
      projectDir: opts.projectDir,
      language: opts.language,
      scope: "phonology",
      origin: "mcp",
      operationType: "auto_snapshot",
      description: opts.description,
    });
    snapshotId = snap.snapshotId;
    mutations.push(...snap.mutations);
    if (!opts.dryRun) {
      markSessionScopeWritten(
        opts.projectDir,
        opts.language.language_id,
        "phonology",
      );
    }
  }

  if (fs.existsSync(phonoAbs)) {
    const migratedCount = nextLocal.glyph_annotations?.length ?? 0;
    const archive = buildLegacyArchive(
      rawDiskBytes,
      rawDiskObj,
      opts.operationId,
      "mcp",
      migratedCount,
    );
    if (archive) {
      legacyArchiveFile = `${langRel}/.conlang-maker/legacy/${archive.archiveFileName}`;
      mutations.push({
        kind: "write_file",
        relPath: legacyArchiveFile,
        content: JSON.stringify(archive.payload, null, 2),
      });
      warnings.push(
        `Archived deprecated writing fields to ${legacyArchiveFile}` +
          (archive.payload.needs_review.length > 0
            ? ` (${archive.payload.needs_review.length} unconfirmed rule(s) recorded in needs_review)`
            : ""),
      );
    }
  }

  mutations.push({
    kind: "write_file",
    relPath: phonoRel,
    content: JSON.stringify(cleanedObj, null, 2),
  });

  const expectation: RevisionExpectation = {
    label: "phonology.json",
    targetPath: phonoAbs,
    expectedRevision: opts.expectedRevision ?? "",
  };

  return {
    expectation,
    mutations,
    snapshotId,
    legacyArchiveFile,
    beforeLocal,
    afterLocal,
    warnings,
  };
}

export function currentLexiconRevUnlocked(
  projectDir: string,
  language: LanguageEntry,
): string {
  const langDir = assertSafeRelativeLanguagePath(projectDir, language.path);
  return computeLexiconRevision(path.join(langDir, "lexicon"));
}

/**
 * Roadmap v3 / Pillar 1：一次读全语系各语言词典，构建
 * `Record<language_id, Record<entry_id, WordEntry>>` 索引供词源追溯链使用。
 * 返回 lexicon 目录缺失语言的 revision 为 MISSING_REVISION 的占位。
 */
export function readAllLexiconsByLanguageUnlocked(
  projectDir: string,
  languages: readonly LanguageEntry[],
): {
  wordsByLanguage: Record<string, Record<string, WordEntry>>;
  revisions: Record<string, string>;
} {
  const wordsByLanguage: Record<string, Record<string, WordEntry>> = {};
  const revisions: Record<string, string> = {};
  for (const language of languages) {
    const lex = readLexiconBucketsPreserveUnknownUnlocked(projectDir, language);
    const dict: Record<string, WordEntry> = {};
    for (const words of lex.values()) {
      for (const word of words) dict[word.entry_id] = word;
    }
    wordsByLanguage[language.language_id] = dict;
    revisions[language.language_id] = currentLexiconRevUnlocked(
      projectDir,
      language,
    );
  }
  return { wordsByLanguage, revisions };
}

export function currentFileRevUnlocked(
  projectDir: string,
  language: LanguageEntry,
  relFile: string,
): string {
  const langDir = assertSafeRelativeLanguagePath(projectDir, language.path);
  return computeFileRevision(path.join(langDir, relFile));
}
