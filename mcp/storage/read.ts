import fs from "node:fs";
import path from "node:path";
import type {
  CorpusIndexEntry,
  CorpusIndexLoadResult,
  CorpusText,
  CorpusTextLoadResult,
  EntryMetadata,
  Etymology,
  GlyphAnnotation,
  GlyphAnnotationsSource,
  GlossTokenStatus,
  GrammarConfig,
  GrammarLoadResult,
  InflectionRule,
  LanguageEntry,
  LanguageFontStatus,
  LegacyWritingInspection,
  LexiconLoadResult,
  LexiconSkippedLine,
  MorphophonologyRule,
  PhonologyConfig,
  PhonologyLoadResult,
  SCAConfig,
  ScaLoadResult,
  Sense,
  WordEntry,
  WordEvolution,
  WorkspaceConfig,
  WorkspaceLoadResult,
} from "../../src/types";
import type { PermissionMode } from "../config";
import { McpError } from "../errors";
import { inspectFontBytesCompat } from "../font/loader";
import { assertSafeRelativeLanguagePath } from "../registry/addressing";
import {
  inspectLegacyWritingFromRaw,
  migrateLegacyGlyphAnnotations,
} from "./legacy";
import { withProjectLock } from "./lock";
import { ensureTransactionsRecovered } from "./recovery";
import {
  computeFileRevision,
  computeLexiconRevision,
  MISSING_REVISION,
  sha256Prefix16,
} from "./revision";

export function defaultPhonologyConfig(languageId: string = "lang_proto"): PhonologyConfig {
  return {
    language_id: languageId || "lang_proto",
    phoneme_inventory: { consonants: [], vowels: [] },
    romanization_maps: [],
    phonotactics: {
      macros: {},
      syllable_structure: "(C)V(C)",
      blacklist_patterns: [],
      vowel_harmony: { enabled: false, group_a: [], group_b: [] },
      tone_system: { enabled: false, tones: [] },
    },
    allophony_rules: [],
  };
}

export function defaultGrammarConfig(languageId: string = "lang_proto"): GrammarConfig {
  return {
    language_id: languageId || "lang_proto",
    syntax: {
      word_order: "SVO",
      modifier_position: "before_head",
      adposition_type: "preposition",
    },
    parts_of_speech: [],
    inflection_dimensions: [],
    inflection_rules: [],
    derivation_rules: [],
    grammar_manual: [],
    typology: {
      morphological_type: "fusional",
      synthesis_index: 2.0,
      fusion_index: 2.0,
      head_marking: "dependent",
      auto_estimated: true,
    },
    affix_slots: [],
    conjugation_classes: [],
    irregular_overrides: [],
  };
}

export function defaultScaConfig(languageId: string = "lang_proto"): SCAConfig {
  return {
    language_id: languageId || "lang_proto",
    rule_sets: [],
  };
}

function isAllowRecovery(mode: PermissionMode): boolean {
  return mode !== "read-only";
}

export async function withConsistentProjectRead<T>(
  projectDir: string,
  mode: PermissionMode,
  toolName: string,
  reader: () => T | Promise<T>,
): Promise<T> {
  return await withProjectLock(projectDir, toolName, async () => {
    ensureTransactionsRecovered(projectDir, isAllowRecovery(mode));
    return await reader();
  });
}

export function readWorkspaceUnlocked(conlangFilePath: string): WorkspaceLoadResult {
  if (!fs.existsSync(conlangFilePath)) {
    return {
      config: {
        workspace_version: "3.0",
        languages: [
          {
            language_id: "lang_proto",
            name: "Proto Language",
            path: "proto_language",
            parent_id: null,
          },
        ],
      },
      revision: MISSING_REVISION,
    };
  }
  const revision = computeFileRevision(conlangFilePath);
  const raw = JSON.parse(
    fs.readFileSync(conlangFilePath, "utf-8"),
  ) as Partial<WorkspaceConfig> & Record<string, unknown>;
  const config: WorkspaceConfig = {
    ...raw,
    workspace_version:
      typeof raw.workspace_version === "string" && raw.workspace_version
        ? raw.workspace_version
        : "3.0",
    languages: Array.isArray(raw.languages)
      ? raw.languages.map((l) => ({
          ...l,
          parent_id: l.parent_id ?? null,
        }))
      : [],
  };
  if (Array.isArray(config.custom_concepts) && config.custom_concepts.length === 0) {
    delete config.custom_concepts;
  }
  // Roadmap v3：空数组集合不落空键（与 Rust skip_serializing_if = "Vec::is_empty" 对齐）
  for (const gapKey of [
    "lexical_gaps",
    "primary_cognate_overrides",
    "saved_lexicon_filters",
  ] as const) {
    const value = config[gapKey];
    if (Array.isArray(value) && value.length === 0) {
      delete config[gapKey];
    }
  }
  return { config, revision };
}

export async function readWorkspace(
  conlangFilePath: string,
  mode: PermissionMode,
): Promise<WorkspaceLoadResult> {
  const projectDir = path.dirname(conlangFilePath);
  return await withConsistentProjectRead(
    projectDir,
    mode,
    "read_workspace",
    () => readWorkspaceUnlocked(conlangFilePath),
  );
}

function normalizeGlyphAnnotation(raw: Record<string, unknown>): GlyphAnnotation {
  const out: Record<string, unknown> = {
    ...raw,
    codepoint: typeof raw.codepoint === "number" ? raw.codepoint : 0,
    label: typeof raw.label === "string" ? raw.label : "",
  };
  if (typeof raw.kind === "string" && raw.kind.length > 0) {
    out.kind = raw.kind;
  } else {
    delete out.kind;
  }
  if (Array.isArray(raw.phonemes) && raw.phonemes.length > 0) {
    out.phonemes = raw.phonemes;
  } else {
    delete out.phonemes;
  }
  return out as unknown as GlyphAnnotation;
}

function normalizePhonologyObject(
  raw: Record<string, unknown>,
  fallbackLanguageId: string,
): PhonologyConfig {
  const base = defaultPhonologyConfig(fallbackLanguageId);
  const inv = (raw.phoneme_inventory ?? {}) as Record<string, unknown>;
  const pt = (raw.phonotactics ?? {}) as Record<string, unknown>;
  const vh = (pt.vowel_harmony ?? {}) as Record<string, unknown>;
  const ts = (pt.tone_system ?? {}) as Record<string, unknown>;

  const rawAnnots = Array.isArray(raw.glyph_annotations)
    ? (raw.glyph_annotations as Record<string, unknown>[]).map(
        normalizeGlyphAnnotation,
      )
    : [];

  const copy: Record<string, unknown> = { ...raw };
  delete copy.glyph_annotations;

  const normalized: PhonologyConfig = {
    ...(copy as unknown as PhonologyConfig),
    language_id:
      typeof raw.language_id === "string" && raw.language_id
        ? raw.language_id
        : fallbackLanguageId || "lang_proto",
    phoneme_inventory: {
      ...inv,
      consonants: Array.isArray(inv.consonants) ? (inv.consonants as string[]) : [],
      vowels: Array.isArray(inv.vowels) ? (inv.vowels as string[]) : [],
    },
    romanization_maps: Array.isArray(raw.romanization_maps)
      ? (raw.romanization_maps as Record<string, unknown>[]).map((m) => ({
          ...m,
          map_id: typeof m.map_id === "string" ? m.map_id : "",
          name: typeof m.name === "string" ? m.name : "",
          is_default: Boolean(m.is_default),
          rules: Array.isArray(m.rules)
            ? (m.rules as Record<string, unknown>[]).map((r) => ({
                ...r,
                rule_id: typeof r.rule_id === "string" ? r.rule_id : "",
                input: typeof r.input === "string" ? r.input : "",
                output_phoneme:
                  typeof r.output_phoneme === "string" ? r.output_phoneme : "",
                context_before:
                  typeof r.context_before === "string" ? r.context_before : "",
                context_after:
                  typeof r.context_after === "string" ? r.context_after : "",
              }))
            : [],
        }))
      : [],
    phonotactics: {
      ...pt,
      macros:
        typeof pt.macros === "object" && pt.macros !== null
          ? (pt.macros as Record<string, string[]>)
          : base.phonotactics.macros,
      syllable_structure:
        typeof pt.syllable_structure === "string"
          ? pt.syllable_structure
          : "(C)V(C)",
      blacklist_patterns: Array.isArray(pt.blacklist_patterns)
        ? (pt.blacklist_patterns as string[])
        : [],
      vowel_harmony: {
        ...vh,
        enabled: Boolean(vh.enabled),
        group_a: Array.isArray(vh.group_a) ? (vh.group_a as string[]) : [],
        group_b: Array.isArray(vh.group_b) ? (vh.group_b as string[]) : [],
      },
      tone_system: {
        ...ts,
        enabled: Boolean(ts.enabled),
        tones: Array.isArray(ts.tones)
          ? (ts.tones as Record<string, unknown>[]).map((t) => ({
              ...t,
              tone_id: typeof t.tone_id === "string" ? t.tone_id : "",
              name: typeof t.name === "string" ? t.name : "",
              marker: typeof t.marker === "string" ? t.marker : "",
            }))
          : [],
      },
    },
    allophony_rules: Array.isArray(raw.allophony_rules)
      ? (raw.allophony_rules as Record<string, unknown>[]).map((a) => ({
          ...a,
          rule_id: typeof a.rule_id === "string" ? a.rule_id : "",
          description: typeof a.description === "string" ? a.description : "",
          target: typeof a.target === "string" ? a.target : "",
          replacement: typeof a.replacement === "string" ? a.replacement : "",
          context_before:
            typeof a.context_before === "string" ? a.context_before : "",
          context_after:
            typeof a.context_after === "string" ? a.context_after : "",
          priority: typeof a.priority === "number" ? a.priority : 0,
        }))
      : [],
  };

  if (rawAnnots.length > 0) {
    normalized.glyph_annotations = rawAnnots;
  }

  return normalized;
}

function ownFontRevisionUnlocked(langDir: string): string {
  const found = findOwnFontFile(langDir);
  return found ? computeFileRevision(found) : MISSING_REVISION;
}

export function inspectLegacyWritingUnlocked(
  projectDir: string,
  language: LanguageEntry,
): LegacyWritingInspection {
  const langDir = assertSafeRelativeLanguagePath(projectDir, language.path);
  const phonoPath = path.join(langDir, "phonology.json");
  if (!fs.existsSync(phonoPath)) {
    return { present: false, fields: [], needs_review: [] };
  }
  const rawObj = JSON.parse(fs.readFileSync(phonoPath, "utf-8")) as Record<
    string,
    unknown
  >;
  return inspectLegacyWritingFromRaw(rawObj);
}

export async function inspectLegacyWriting(
  projectDir: string,
  language: LanguageEntry,
  mode: PermissionMode,
): Promise<LegacyWritingInspection> {
  return await withConsistentProjectRead(
    projectDir,
    mode,
    "inspect_legacy_writing",
    () => inspectLegacyWritingUnlocked(projectDir, language),
  );
}

/**
 * Matches Rust `load_phonology` (`src-tauri/src/commands/phonology.rs`) bit-for-bit:
 * - Locally migrated legacy `writing_systems` + `font_encoding_profiles` populate `local_config.glyph_annotations`
 *   with `annotations_source = "legacy_migrated"`.
 * - Ancestor `glyph_annotations` populate `effective_config.glyph_annotations` ONLY when `local_config` has none.
 * - Dependency keys match Rust `BTreeMap`: `local_phonology`, `own_font`, `workspace`, `ancestor_phonology:<id>`, `ancestor_font:<id>`.
 */
export function readPhonologyUnlocked(
  projectDir: string,
  conlangFilePath: string,
  language: LanguageEntry,
): PhonologyLoadResult {
  const ws = readWorkspaceUnlocked(conlangFilePath);
  const langDir = assertSafeRelativeLanguagePath(projectDir, language.path);
  const phonoPath = path.join(langDir, "phonology.json");
  const localRev = computeFileRevision(phonoPath);

  let rawObj: Record<string, unknown> = {};
  const fileExisted = fs.existsSync(phonoPath);
  if (fileExisted) {
    rawObj = JSON.parse(fs.readFileSync(phonoPath, "utf-8")) as Record<
      string,
      unknown
    >;
  }

  const legacyInspection = inspectLegacyWritingFromRaw(rawObj);
  const localConfig: PhonologyConfig = fileExisted
    ? normalizePhonologyObject(rawObj, "lang_proto")
    : defaultPhonologyConfig("lang_proto");

  let localMigrated = false;
  if (
    (!localConfig.glyph_annotations ||
      localConfig.glyph_annotations.length === 0) &&
    Object.prototype.hasOwnProperty.call(rawObj, "writing_systems")
  ) {
    const migratedLocal = migrateLegacyGlyphAnnotations(rawObj).map((g) =>
      normalizeGlyphAnnotation(g as unknown as Record<string, unknown>),
    );
    if (migratedLocal.length > 0) {
      localConfig.glyph_annotations = migratedLocal;
      localMigrated = true;
    }
  }

  const dependencies: Record<string, string> = {
    local_phonology: localRev,
    own_font: ownFontRevisionUnlocked(langDir),
    workspace: fs.existsSync(conlangFilePath) ? ws.revision : MISSING_REVISION,
  };

  let inheritedAnnotations: { ownerId: string; annotations: GlyphAnnotation[] } | null =
    null;

  const seen = new Set<string>([language.language_id]);
  let currentParentId = language.parent_id;
  while (currentParentId) {
    if (seen.has(currentParentId)) break;
    seen.add(currentParentId);
    const parentEntry = ws.config.languages.find(
      (l) => l.language_id === currentParentId,
    );
    if (!parentEntry) break;

    const parentDir = assertSafeRelativeLanguagePath(projectDir, parentEntry.path);
    const parentPhonoPath = path.join(parentDir, "phonology.json");
    dependencies[`ancestor_phonology:${parentEntry.language_id}`] =
      computeFileRevision(parentPhonoPath);
    dependencies[`ancestor_font:${parentEntry.language_id}`] =
      ownFontRevisionUnlocked(parentDir);

    if (inheritedAnnotations === null && fs.existsSync(parentPhonoPath)) {
      const parentRaw = JSON.parse(
        fs.readFileSync(parentPhonoPath, "utf-8"),
      ) as Record<string, unknown>;
      const parentNorm = normalizePhonologyObject(
        parentRaw,
        parentEntry.language_id,
      );
      const parentAnnots =
        parentNorm.glyph_annotations && parentNorm.glyph_annotations.length > 0
          ? parentNorm.glyph_annotations
          : migrateLegacyGlyphAnnotations(parentRaw).map((g) =>
              normalizeGlyphAnnotation(g as unknown as Record<string, unknown>),
            );
      if (parentAnnots.length > 0) {
        inheritedAnnotations = {
          ownerId: parentEntry.language_id,
          annotations: parentAnnots,
        };
      }
    }
    currentParentId = parentEntry.parent_id;
  }

  const localAnnots = localConfig.glyph_annotations ?? [];
  let effectiveAnnotations: GlyphAnnotation[] = [];
  let annotationsSource: GlyphAnnotationsSource = "none";
  let annotationsOwnerId: string | null = null;

  if (localAnnots.length > 0) {
    effectiveAnnotations = localAnnots;
    annotationsSource = localMigrated ? "legacy_migrated" : "local";
    annotationsOwnerId = language.language_id;
  } else if (inheritedAnnotations !== null) {
    effectiveAnnotations = inheritedAnnotations.annotations;
    annotationsSource = "inherited";
    annotationsOwnerId = inheritedAnnotations.ownerId;
  }

  const effectiveConfig: PhonologyConfig = { ...localConfig };
  if (effectiveAnnotations.length > 0) {
    effectiveConfig.glyph_annotations = effectiveAnnotations;
  } else {
    delete effectiveConfig.glyph_annotations;
  }

  const sortedDeps: Record<string, string> = {};
  let depSignature = "";
  for (const k of Object.keys(dependencies).sort()) {
    sortedDeps[k] = dependencies[k];
    depSignature += `${k}=${dependencies[k]}\n`;
  }
  const effectiveRevision = sha256Prefix16(Buffer.from(depSignature, "utf-8"));

  return {
    config: effectiveConfig,
    revision: localRev,
    local_config: localConfig,
    effective_config: effectiveConfig,
    annotations_source: annotationsSource,
    annotations_owner_id: annotationsOwnerId,
    effective_revision: effectiveRevision,
    dependencies: sortedDeps,
    legacy_fields_present: legacyInspection.present,
  };
}

export async function readPhonology(
  projectDir: string,
  conlangFilePath: string,
  language: LanguageEntry,
  mode: PermissionMode,
): Promise<PhonologyLoadResult> {
  return await withConsistentProjectRead(
    projectDir,
    mode,
    "read_phonology",
    () => readPhonologyUnlocked(projectDir, conlangFilePath, language),
  );
}

export function isValidWordEntryCompat(word: WordEntry): boolean {
  const rom = (word.con_word_romanized ?? "").trim();
  if (!rom || rom === "new_word") return false;
  if (!Array.isArray(word.senses)) return false;
  return word.senses.some(
    (s) => typeof s?.gloss === "string" && s.gloss.trim().length > 0,
  );
}

export function normalizeWordEntryFromRaw(
  raw: Record<string, unknown>,
  fallbackLanguageId: string = "",
): WordEntry {
  const rawSenses = Array.isArray(raw.senses)
    ? (raw.senses as Record<string, unknown>[])
    : [];
  const senses: Sense[] = rawSenses.map((s) => {
    const posId =
      typeof s.pos_id === "string"
        ? s.pos_id
        : typeof s.pos === "string"
          ? s.pos
          : "";
    const copy: Record<string, unknown> = { ...s };
    delete copy.pos;
    if (copy.grammatical_function === null || copy.grammatical_function === undefined) {
      delete copy.grammatical_function;
    }
    if (copy.concept_id === null || copy.concept_id === undefined) {
      delete copy.concept_id;
    }
    // Roadmap v3：义项级用法说明与变位类覆盖，空值不落键（与 Rust skip_serializing_if 对齐）
    if (copy.usage_note === null || copy.usage_note === undefined) {
      delete copy.usage_note;
    }
    if (copy.inflection_class_id === null || copy.inflection_class_id === undefined) {
      delete copy.inflection_class_id;
    }
    return {
      ...(copy as unknown as Sense),
      sense_id: typeof s.sense_id === "string" ? s.sense_id : "",
      pos_id: posId,
      gloss: typeof s.gloss === "string" ? s.gloss : "",
      definitions: Array.isArray(s.definitions) ? (s.definitions as string[]) : [],
      examples: Array.isArray(s.examples) ? (s.examples as string[]) : [],
    };
  });

  const rawEtym = (raw.etymology ?? {}) as Record<string, unknown>;
  const etymology: Etymology = {
    ...(rawEtym as unknown as Etymology),
    origin_type:
      typeof rawEtym.origin_type === "string" && rawEtym.origin_type
        ? (rawEtym.origin_type as Etymology["origin_type"])
        : "a_priori",
    parent_entry_id:
      typeof rawEtym.parent_entry_id === "string" ? rawEtym.parent_entry_id : null,
    source_language_id:
      typeof rawEtym.source_language_id === "string"
        ? rawEtym.source_language_id
        : null,
    applied_sound_changes: Array.isArray(rawEtym.applied_sound_changes)
      ? (rawEtym.applied_sound_changes as string[])
      : [],
    semantic_shift_note:
      typeof rawEtym.semantic_shift_note === "string"
        ? rawEtym.semantic_shift_note
        : "",
  };
  // 与 Rust `skip_serializing_if` 对齐：空构词成分与空摘要不落空键
  if (!Array.isArray(etymology.components) || etymology.components.length === 0) {
    delete etymology.components;
  }
  if (etymology.compounds_stale_digest == null) {
    delete etymology.compounds_stale_digest;
  }
  // Roadmap v3：语义变化分类与借词快照，空值不落键
  if (etymology.semantic_change_kind == null) {
    delete etymology.semantic_change_kind;
  }
  if (
    etymology.borrowed_source == null ||
    typeof etymology.borrowed_source !== "object"
  ) {
    delete etymology.borrowed_source;
  }

  const rawMeta = (raw.metadata ?? {}) as Record<string, unknown>;
  const metadata: EntryMetadata = {
    ...(rawMeta as unknown as EntryMetadata),
    tags: Array.isArray(rawMeta.tags) ? (rawMeta.tags as string[]) : [],
    created_at: typeof rawMeta.created_at === "string" ? rawMeta.created_at : "",
    updated_at: typeof rawMeta.updated_at === "string" ? rawMeta.updated_at : "",
  };

  const rawEvo = (raw.evolution ?? {}) as Record<string, unknown>;
  const evolution: WordEvolution = {
    ...(rawEvo as unknown as WordEvolution),
    is_deprecated: Boolean(rawEvo.is_deprecated),
    deprecated_since_language_id:
      typeof rawEvo.deprecated_since_language_id === "string"
        ? rawEvo.deprecated_since_language_id
        : null,
    parent_snapshot_hash:
      typeof rawEvo.parent_snapshot_hash === "string"
        ? rawEvo.parent_snapshot_hash
        : null,
    last_synced_word_hash:
      typeof rawEvo.last_synced_word_hash === "string"
        ? rawEvo.last_synced_word_hash
        : null,
  };

  const entry: WordEntry = {
    ...(raw as unknown as WordEntry),
    entry_id: typeof raw.entry_id === "string" ? raw.entry_id : "",
    language_id:
      typeof raw.language_id === "string" && raw.language_id
        ? raw.language_id
        : fallbackLanguageId,
    con_word_romanized:
      typeof raw.con_word_romanized === "string" ? raw.con_word_romanized : "",
    phonetic_ipa: typeof raw.phonetic_ipa === "string" ? raw.phonetic_ipa : "",
    phonetic_override: Boolean(raw.phonetic_override),
    senses,
    etymology,
    metadata,
    evolution,
  };
  // Roadmap v3：词条级变位类绑定，空值不落键（与 Rust skip_serializing_if 对齐）
  if (entry.inflection_class_id == null) {
    delete entry.inflection_class_id;
  }
  return entry;
}

export function readLexiconUnlocked(
  projectDir: string,
  language: LanguageEntry,
): LexiconLoadResult {
  const langDir = assertSafeRelativeLanguagePath(projectDir, language.path);
  const lexiconDir = path.join(langDir, "lexicon");
  const revision = computeLexiconRevision(lexiconDir);

  if (!fs.existsSync(lexiconDir)) {
    return { words: [], revision, skipped: [] };
  }

  const files = fs
    .readdirSync(lexiconDir)
    .filter((f) => f.endsWith(".ndjson"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const words: WordEntry[] = [];
  const skipped: LexiconSkippedLine[] = [];

  for (const file of files) {
    const filePath = path.join(lexiconDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const rawLines = content.split(/\r?\n/);

    for (let i = 0; i < rawLines.length; i++) {
      const trimmed = rawLines[i].trim();
      if (!trimmed) continue;

      let parsedRaw: Record<string, unknown>;
      try {
        parsedRaw = JSON.parse(trimmed) as Record<string, unknown>;
      } catch (err) {
        skipped.push({
          file,
          line: i + 1,
          reason: `invalid_json: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      const normalized = normalizeWordEntryFromRaw(parsedRaw, language.language_id);
      if (!isValidWordEntryCompat(normalized)) {
        skipped.push({
          file,
          line: i + 1,
          reason:
            "invalid_entry: missing non-empty sense gloss or placeholder 'new_word'",
        });
        continue;
      }

      words.push(normalized);
    }
  }

  words.sort((a, b) =>
    Buffer.compare(
      Buffer.from(a.con_word_romanized, "utf-8"),
      Buffer.from(b.con_word_romanized, "utf-8"),
    ),
  );

  return { words, revision, skipped };
}

export async function readLexicon(
  projectDir: string,
  language: LanguageEntry,
  mode: PermissionMode,
): Promise<LexiconLoadResult> {
  return await withConsistentProjectRead(
    projectDir,
    mode,
    "read_lexicon",
    () => readLexiconUnlocked(projectDir, language),
  );
}

function normalizeInflectionRuleFromRaw(raw: Record<string, unknown>): InflectionRule {
  const posId =
    typeof raw.pos_id === "string"
      ? raw.pos_id
      : typeof raw.pos === "string"
        ? raw.pos
        : "";
  const copy: Record<string, unknown> = { ...raw };
  delete copy.pos;
  for (const optKey of [
    "infix_config",
    "circumfix_config",
    "reduplication_config",
    "ablaut_config",
    "slot_id",
    "conjugation_class_id",
    "fused_dimensions",
  ]) {
    if (copy[optKey] === null || copy[optKey] === undefined) {
      delete copy[optKey];
    }
  }
  // Roadmap v3：显式规则优先级，仅保留合法数字（与 Rust skip_serializing_if 对齐）
  if (typeof copy.priority !== "number" || !Number.isFinite(copy.priority)) {
    delete copy.priority;
  }
  return {
    ...(copy as unknown as InflectionRule),
    rule_id: typeof raw.rule_id === "string" ? raw.rule_id : "",
    pos_id: posId,
    dimension_values:
      typeof raw.dimension_values === "object" && raw.dimension_values !== null
        ? (raw.dimension_values as Record<string, string>)
        : {},
    tag: typeof raw.tag === "string" ? raw.tag : "",
    type:
      typeof raw.type === "string"
        ? (raw.type as InflectionRule["type"])
        : "suffix",
    affix: typeof raw.affix === "string" ? raw.affix : "",
    match_regex: typeof raw.match_regex === "string" ? raw.match_regex : ".*",
    disabled: Boolean(raw.disabled),
    condition:
      raw.condition !== undefined && raw.condition !== null
        ? (raw.condition as InflectionRule["condition"])
        : null,
    sca_mutable: Boolean(raw.sca_mutable),
  };
}

export function readGrammarUnlocked(
  projectDir: string,
  language: LanguageEntry,
): GrammarLoadResult {
  const langDir = assertSafeRelativeLanguagePath(projectDir, language.path);
  const grammarPath = path.join(langDir, "grammar.json");
  if (!fs.existsSync(grammarPath)) {
    return {
      config: defaultGrammarConfig("lang_proto"),
      revision: MISSING_REVISION,
    };
  }
  const revision = computeFileRevision(grammarPath);
  const raw = JSON.parse(
    fs.readFileSync(grammarPath, "utf-8"),
  ) as Record<string, unknown>;
  const defaults = defaultGrammarConfig("lang_proto");

  const rawRules = Array.isArray(raw.inflection_rules)
    ? (raw.inflection_rules as Record<string, unknown>[])
    : Array.isArray(raw.inflections)
      ? (raw.inflections as Record<string, unknown>[])
      : [];

  const copy: Record<string, unknown> = { ...raw };
  delete copy.inflections;

  const config: GrammarConfig = {
    ...defaults,
    ...(copy as unknown as GrammarConfig),
    language_id:
      typeof raw.language_id === "string" && raw.language_id
        ? raw.language_id
        : "lang_proto",
    syntax: {
      ...defaults.syntax,
      ...((raw.syntax ?? {}) as GrammarConfig["syntax"]),
    },
    parts_of_speech: Array.isArray(raw.parts_of_speech)
      ? (raw.parts_of_speech as Record<string, unknown>[]).map((p) => ({
          ...(p as unknown as GrammarConfig["parts_of_speech"][number]),
          pos_id: typeof p.pos_id === "string" ? p.pos_id : "",
          name: typeof p.name === "string" ? p.name : "",
          gloss_abbr: typeof p.gloss_abbr === "string" ? p.gloss_abbr : "",
          word_pattern: typeof p.word_pattern === "string" ? p.word_pattern : "",
          requires_definition: Boolean(p.requires_definition),
          requires_pronunciation: Boolean(p.requires_pronunciation),
        }))
      : [],
    inflection_dimensions: Array.isArray(raw.inflection_dimensions)
      ? (raw.inflection_dimensions as GrammarConfig["inflection_dimensions"])
      : [],
    inflection_rules: rawRules.map(normalizeInflectionRuleFromRaw),
    derivation_rules: Array.isArray(raw.derivation_rules)
      ? (raw.derivation_rules as Record<string, unknown>[]).map((d) => {
          const dCopy: Record<string, unknown> = { ...d };
          for (const optKey of [
            "infix_config",
            "circumfix_config",
            "reduplication_config",
            "ablaut_config",
          ]) {
            if (dCopy[optKey] === null || dCopy[optKey] === undefined) {
              delete dCopy[optKey];
            }
          }
          return {
            ...(dCopy as unknown as GrammarConfig["derivation_rules"][number]),
            rule_id: typeof d.rule_id === "string" ? d.rule_id : "",
            name: typeof d.name === "string" ? d.name : "",
            source_pos_id: typeof d.source_pos_id === "string" ? d.source_pos_id : "",
            target_pos_id: typeof d.target_pos_id === "string" ? d.target_pos_id : "",
            type:
              typeof d.type === "string"
                ? (d.type as GrammarConfig["derivation_rules"][number]["type"])
                : "suffix",
            affix: typeof d.affix === "string" ? d.affix : "",
            condition:
              d.condition !== undefined && d.condition !== null
                ? (d.condition as GrammarConfig["derivation_rules"][number]["condition"])
                : null,
            semantic_note: typeof d.semantic_note === "string" ? d.semantic_note : "",
            sca_mutable: Boolean(d.sca_mutable),
          };
        })
      : [],
    grammar_manual: Array.isArray(raw.grammar_manual)
      ? (raw.grammar_manual as Record<string, unknown>[]).map((c) => ({
          ...(c as unknown as GrammarConfig["grammar_manual"][number]),
          chapter_id: typeof c.chapter_id === "string" ? c.chapter_id : "",
          title: typeof c.title === "string" ? c.title : "",
          content: typeof c.content === "string" ? c.content : "",
          order: typeof c.order === "number" ? c.order : 0,
          embedded_paradigms: Array.isArray(c.embedded_paradigms)
            ? (c.embedded_paradigms as GrammarConfig["grammar_manual"][number]["embedded_paradigms"])
            : [],
        }))
      : [],
    typology: {
      ...defaults.typology,
      ...((raw.typology ?? {}) as GrammarConfig["typology"]),
    },
    affix_slots: Array.isArray(raw.affix_slots)
      ? (raw.affix_slots as GrammarConfig["affix_slots"])
      : [],
    conjugation_classes: Array.isArray(raw.conjugation_classes)
      ? (raw.conjugation_classes as GrammarConfig["conjugation_classes"])
      : [],
    irregular_overrides: Array.isArray(raw.irregular_overrides)
      ? (raw.irregular_overrides as GrammarConfig["irregular_overrides"])
      : [],
    ...(Array.isArray(raw.morphophonology_rules) && raw.morphophonology_rules.length > 0
      ? { morphophonology_rules: raw.morphophonology_rules as MorphophonologyRule[] }
      : {}),
  };
  return { config, revision };
}

export async function readGrammar(
  projectDir: string,
  language: LanguageEntry,
  mode: PermissionMode,
): Promise<GrammarLoadResult> {
  return await withConsistentProjectRead(
    projectDir,
    mode,
    "read_grammar",
    () => readGrammarUnlocked(projectDir, language),
  );
}

export function readScaUnlocked(
  projectDir: string,
  language: LanguageEntry,
): ScaLoadResult {
  const langDir = assertSafeRelativeLanguagePath(projectDir, language.path);
  const scaPath = path.join(langDir, "sca_rules.json");
  if (!fs.existsSync(scaPath)) {
    return {
      config: defaultScaConfig("lang_proto"),
      revision: MISSING_REVISION,
    };
  }
  const revision = computeFileRevision(scaPath);
  const raw = JSON.parse(fs.readFileSync(scaPath, "utf-8")) as Partial<SCAConfig> &
    Record<string, unknown>;
  const config: SCAConfig = {
    ...raw,
    language_id: typeof raw.language_id === "string" ? raw.language_id : "",
    rule_sets: Array.isArray(raw.rule_sets)
      ? (raw.rule_sets as unknown as Record<string, unknown>[]).map((rs) => ({
          ...(rs as unknown as SCAConfig["rule_sets"][number]),
          ruleset_id: typeof rs.ruleset_id === "string" ? rs.ruleset_id : "",
          name: typeof rs.name === "string" ? rs.name : "",
          order: typeof rs.order === "number" ? rs.order : 0,
          rules: Array.isArray(rs.rules)
            ? (rs.rules as Record<string, unknown>[]).map((r) => ({
                ...(r as unknown as SCAConfig["rule_sets"][number]["rules"][number]),
                rule_id: typeof r.rule_id === "string" ? r.rule_id : "",
                description: typeof r.description === "string" ? r.description : "",
                target: typeof r.target === "string" ? r.target : "",
                replacement: typeof r.replacement === "string" ? r.replacement : "",
                context_before:
                  typeof r.context_before === "string" ? r.context_before : "",
                context_after:
                  typeof r.context_after === "string" ? r.context_after : "",
                exceptions: Array.isArray(r.exceptions)
                  ? (r.exceptions as string[])
                  : [],
                feature_mode: Boolean(r.feature_mode),
                target_features:
                  r.target_features !== undefined && r.target_features !== null
                    ? (r.target_features as SCAConfig["rule_sets"][number]["rules"][number]["target_features"])
                    : null,
                replacement_features:
                  r.replacement_features !== undefined &&
                  r.replacement_features !== null
                    ? (r.replacement_features as SCAConfig["rule_sets"][number]["rules"][number]["replacement_features"])
                    : null,
                context_before_features:
                  r.context_before_features !== undefined &&
                  r.context_before_features !== null
                    ? (r.context_before_features as SCAConfig["rule_sets"][number]["rules"][number]["context_before_features"])
                    : null,
                context_after_features:
                  r.context_after_features !== undefined &&
                  r.context_after_features !== null
                    ? (r.context_after_features as SCAConfig["rule_sets"][number]["rules"][number]["context_after_features"])
                    : null,
              }))
            : [],
        }))
      : [],
  };
  return { config, revision };
}

export async function readSca(
  projectDir: string,
  language: LanguageEntry,
  mode: PermissionMode,
): Promise<ScaLoadResult> {
  return await withConsistentProjectRead(projectDir, mode, "read_sca", () =>
    readScaUnlocked(projectDir, language),
  );
}

export function readCorpusIndexUnlocked(
  projectDir: string,
  language: LanguageEntry,
): CorpusIndexLoadResult {
  const langDir = assertSafeRelativeLanguagePath(projectDir, language.path);
  const indexPath = path.join(langDir, "corpus", "corpus_index.json");
  if (!fs.existsSync(indexPath)) {
    return { entries: [], revision: MISSING_REVISION };
  }
  const revision = computeFileRevision(indexPath);
  const entries = JSON.parse(
    fs.readFileSync(indexPath, "utf-8"),
  ) as CorpusIndexEntry[];
  return { entries: Array.isArray(entries) ? entries : [], revision };
}

export async function readCorpusIndex(
  projectDir: string,
  language: LanguageEntry,
  mode: PermissionMode,
): Promise<CorpusIndexLoadResult> {
  return await withConsistentProjectRead(
    projectDir,
    mode,
    "read_corpus_index",
    () => readCorpusIndexUnlocked(projectDir, language),
  );
}

/**
 * `corpus_id` 必须是单层安全标识符：禁止空串、`.`、`..`、`corpus_index`、
 * 路径分隔符与 NUL，避免 `<corpus_id>.json` 逃逸出 corpus 目录或命中索引文件。
 */
function assertSafeCorpusTextId(rawId: string): string {
  const id = rawId.trim().replace(/\.json$/i, "");
  if (
    !id ||
    id === "." ||
    id === ".." ||
    id === "corpus_index" ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\0") ||
    id.includes("..")
  ) {
    throw new McpError(
      "VALIDATION",
      `Invalid corpus_id "${rawId}". Must be a single safe identifier (not "corpus_index" or a path).`,
    );
  }
  return id;
}

/**
 * 可选字段若以 `null` 落盘（旧版 MCP 写入），读侧统一删除该键，
 * 保证 GUI 侧的可选类型不会被 `null` 污染（`linked_sense_id` / `status`）。
 */
function stripNullTokenOptionals(corpus: CorpusText): void {
  if (!Array.isArray(corpus.glossed_lines)) return;
  for (const line of corpus.glossed_lines) {
    if (!line || !Array.isArray(line.tokens)) continue;
    for (const token of line.tokens) {
      if (!token) continue;
      if ((token.linked_sense_id as string | null | undefined) === null) {
        delete token.linked_sense_id;
      }
      if ((token.status as GlossTokenStatus | null | undefined) === null) {
        delete token.status;
      }
    }
  }
}

export function readCorpusTextUnlocked(
  projectDir: string,
  language: LanguageEntry,
  corpusId: string,
): CorpusTextLoadResult {
  const safeCorpusId = assertSafeCorpusTextId(corpusId);
  const langDir = assertSafeRelativeLanguagePath(projectDir, language.path);
  const corpusDir = path.join(langDir, "corpus");
  const filePath = path.join(corpusDir, `${safeCorpusId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new McpError(
      "NOT_FOUND",
      `Corpus text "${safeCorpusId}" not found in language "${language.name}".`,
    );
  }
  const indexPath = path.join(corpusDir, "corpus_index.json");
  const revision = computeFileRevision(filePath);
  const index_revision = computeFileRevision(indexPath);
  const corpus = JSON.parse(fs.readFileSync(filePath, "utf-8")) as CorpusText;
  stripNullTokenOptionals(corpus);
  return { corpus, revision, index_revision };
}

export async function readCorpusText(
  projectDir: string,
  language: LanguageEntry,
  corpusId: string,
  mode: PermissionMode,
): Promise<CorpusTextLoadResult> {
  return await withConsistentProjectRead(
    projectDir,
    mode,
    "read_corpus_text",
    () => readCorpusTextUnlocked(projectDir, language, corpusId),
  );
}

export interface ResolvedFontFile {
  owner_language_id: string;
  owner_name: string;
  owner_path: string;
  inherited: boolean;
  has_own: boolean;
  file_name: string;
  file_path: string;
  revision: string;
  bytes: Buffer;
}

export function findOwnFontFile(langDir: string): string | null {
  for (const name of ["font.otf", "font.ttf"]) {
    const candidate = path.join(langDir, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

export function resolveFontFileUnlocked(
  projectDir: string,
  languages: readonly LanguageEntry[],
  languageId: string,
): ResolvedFontFile | null {
  const start = languages.find((l) => l.language_id === languageId);
  if (!start) return null;

  const startDir = assertSafeRelativeLanguagePath(projectDir, start.path);
  const ownFont = findOwnFontFile(startDir);

  const seen = new Set<string>();
  let currentId: string | null = languageId;
  while (currentId) {
    if (seen.has(currentId)) break;
    seen.add(currentId);
    const lang = languages.find((l) => l.language_id === currentId);
    if (!lang) break;
    const dir = assertSafeRelativeLanguagePath(projectDir, lang.path);
    const found = findOwnFontFile(dir);
    if (found) {
      return {
        owner_language_id: lang.language_id,
        owner_name: lang.name,
        owner_path: lang.path,
        inherited: lang.language_id !== languageId,
        has_own: ownFont !== null,
        file_name: path.basename(found),
        file_path: found,
        revision: computeFileRevision(found),
        bytes: fs.readFileSync(found),
      };
    }
    currentId = lang.parent_id;
  }
  return null;
}

export interface LanguageFontStatusWithRevision extends LanguageFontStatus {
  revision: string;
  resolved_revision: string | null;
}

export interface FontInspectionCompat {
  present: boolean;
  has_own: boolean;
  inherited: boolean;
  revision: string;
  resolved_revision: string | null;
  owner_language_id: string | null;
  owner_name: string | null;
  owner_path: string | null;
  file_name: string | null;
  family_name: string | null;
  version: string | null;
  codepoints: number[];
  glyphs: number[][];
  /** OpenType GSUB 特性标签；空时省略该键（与 Rust `skip_serializing_if = "Vec::is_empty"` 对齐，保证 golden 字节一致）。 */
  substitution_features?: string[];
  /** OpenType GPOS 特性标签；空时省略该键。 */
  positioning_features?: string[];
  warning: string | null;
}

export function listLanguageFontStatusesUnlocked(
  projectDir: string,
  languages: readonly LanguageEntry[],
): LanguageFontStatusWithRevision[] {
  return languages.map((lang) => {
    const dir = assertSafeRelativeLanguagePath(projectDir, lang.path);
    const own = findOwnFontFile(dir);
    const resolved = resolveFontFileUnlocked(
      projectDir,
      languages,
      lang.language_id,
    );
    return {
      language_id: lang.language_id,
      has_own: own !== null,
      own_file_name: own ? path.basename(own) : null,
      revision: own ? computeFileRevision(own) : MISSING_REVISION,
      resolved_owner_id: resolved ? resolved.owner_language_id : null,
      resolved_owner_name: resolved ? resolved.owner_name : null,
      resolved_file_name: resolved ? resolved.file_name : null,
      resolved_revision: resolved ? resolved.revision : null,
    };
  });
}

export async function listLanguageFontStatuses(
  projectDir: string,
  conlangFilePath: string,
  mode: PermissionMode,
): Promise<LanguageFontStatusWithRevision[]> {
  return await withConsistentProjectRead(
    projectDir,
    mode,
    "list_language_font_statuses",
    () => {
      const ws = readWorkspaceUnlocked(conlangFilePath);
      return listLanguageFontStatusesUnlocked(projectDir, ws.config.languages);
    },
  );
}

export function inspectLanguageFontUnlocked(
  projectDir: string,
  languages: readonly LanguageEntry[],
  languageId: string,
): FontInspectionCompat {
  const start = languages.find((l) => l.language_id === languageId);
  if (!start) {
    throw new McpError(
      "NOT_FOUND",
      `Language "${languageId}" not found in workspace.`,
    );
  }
  const startDir = assertSafeRelativeLanguagePath(projectDir, start.path);
  const own = findOwnFontFile(startDir);
  const ownRevision = own ? computeFileRevision(own) : MISSING_REVISION;
  const resolved = resolveFontFileUnlocked(projectDir, languages, languageId);

  if (!resolved) {
    return {
      present: false,
      has_own: own !== null,
      inherited: false,
      revision: ownRevision,
      resolved_revision: null,
      owner_language_id: null,
      owner_name: null,
      owner_path: null,
      file_name: null,
      family_name: null,
      version: null,
      codepoints: [],
      glyphs: [],
      warning: null,
    };
  }

  try {
    const info = inspectFontBytesCompat(resolved.bytes);
    return {
      present: true,
      has_own: resolved.has_own,
      inherited: resolved.inherited,
      revision: ownRevision,
      resolved_revision: resolved.revision,
      owner_language_id: resolved.owner_language_id,
      owner_name: resolved.owner_name,
      owner_path: resolved.owner_path,
      file_name: resolved.file_name,
      family_name: info.family_name,
      version: info.version,
      codepoints: info.codepoints,
      glyphs: info.glyphs,
      ...(info.substitution_features.length > 0
        ? { substitution_features: info.substitution_features }
        : {}),
      ...(info.positioning_features.length > 0
        ? { positioning_features: info.positioning_features }
        : {}),
      warning: null,
    };
  } catch (err) {
    return {
      present: true,
      has_own: resolved.has_own,
      inherited: resolved.inherited,
      revision: ownRevision,
      resolved_revision: resolved.revision,
      owner_language_id: resolved.owner_language_id,
      owner_name: resolved.owner_name,
      owner_path: resolved.owner_path,
      file_name: resolved.file_name,
      family_name: null,
      version: null,
      codepoints: [],
      glyphs: [],
      warning: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function inspectLanguageFont(
  projectDir: string,
  conlangFilePath: string,
  languageId: string,
  mode: PermissionMode,
): Promise<FontInspectionCompat> {
  return await withConsistentProjectRead(
    projectDir,
    mode,
    "inspect_language_font",
    () => {
      const ws = readWorkspaceUnlocked(conlangFilePath);
      return inspectLanguageFontUnlocked(
        projectDir,
        ws.config.languages,
        languageId,
      );
    },
  );
}
