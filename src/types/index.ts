// ── 音系相关 ──────────────────────────────────────────────

export interface PhonemeInventory {
  consonants: string[];
  vowels: string[];
}

export interface RomanizationRule {
  rule_id: string;
  input: string;
  output_phoneme: string;
  context_before: string;
  context_after: string;
  /** A transcription separator contributes no phoneme of its own. */
  output_type?: "phoneme" | "separator";
}

export interface RomanizationMap {
  map_id: string;
  name: string;
  is_default: boolean;
  rules: RomanizationRule[];
}

export type GlyphKind = "base" | "vowel" | "carrier" | "mark" | "punctuation";

export interface GlyphAnnotation {
  /** Representative Unicode codepoint of the glyph in the font cmap. */
  codepoint: number;
  /** Reference label or romanized name for documentation. */
  label: string;
  /** Optional glyph structural category for reference. */
  kind?: GlyphKind;
  /** Optional phoneme / empty-set (∅) reference tokens. */
  phonemes?: string[];
}

export interface VowelHarmony {
  enabled: boolean;
  group_a: string[];
  group_b: string[];
}

export interface ToneDefinition {
  tone_id: string;
  name: string;
  marker: string; // 正字法标记符号，如 "ˊ"
}

export interface ToneSystem {
  enabled: boolean;
  tones: ToneDefinition[];
}

// ── P2 扩展类型（T2.1：全部为可选字段，旧工作区零破坏）─────────────

/** CLDF / Concepticon 兼容概念定义 */
export interface ConceptDefinition {
  concept_id: string;
  gloss_en: string;
  gloss_zh: string;
  semantic_field: string;
  concepticon_id?: string;
  standard_lists?: ("swadesh_100" | "leipzig_jakarta_100")[];
}

/** 多词素构词成分的关系类型 */
export type CompoundRelation = "root" | "modifier" | "head" | "affix" | "reduplicant";

/** 共时构词成分（A + B -> AB） */
export interface MorphemeComponent {
  entry_id?: string;
  derivation_rule_id?: string;
  surface_override?: string;
  relation: CompoundRelation;
}

/** 重音模式（向后兼容旧的 `{ position: "initial" }`） */
export type StressPattern =
  | "initial"
  | "ultimate"
  | "penultimate"
  | "antepenultimate"
  | "weight_sensitive";

export interface StressConfig {
  position: StressPattern;
  domain: "word" | "entry";
  weight_fallback?: "initial" | "penultimate" | "antepenultimate";
}

/** 共时形态音位规则（复用 SCARule 的规则体，语境可用 `+` 表示词素边界） */
export interface MorphophonologyRule {
  rule_id: string;
  description: string;
  disabled?: boolean;
  priority: number;
  target: string;
  replacement: string;
  context_before: string;
  context_after: string;
  feature_mode: boolean;
  target_features: FeatureExpression | null;
  replacement_features: FeatureReplacement | null;
  context_before_features: FeatureExpression | null;
  context_after_features: FeatureExpression | null;
}

/** 形态句法对齐类型 */
export type MorphosyntacticAlignment = "nom_acc" | "erg_abs" | "tripartite";

/** 显式绑定的格维度值 */
export interface CaseDimBinding {
  dim_id: string;
  val_id: string;
}

export interface Phonotactics {
  macros: Record<string, string[]>;
  syllable_structure: string;
  blacklist_patterns: string[];
  vowel_harmony: VowelHarmony;
  tone_system: ToneSystem;
  stress?: StressConfig | null;
}

export interface AllophonyRule {
  rule_id: string;
  description: string;
  target: string;
  replacement: string;
  context_before: string;
  context_after: string;
  priority: number;
}

export interface PhonologyConfig {
  language_id: string;
  phoneme_inventory: PhonemeInventory;
  romanization_maps: RomanizationMap[];
  glyph_annotations?: GlyphAnnotation[];
  /** Language-local OpenType feature overrides, for example ss01=1. */
  font_features?: string[];
  /** Convert phonemes to explicit font input. OpenType still composes the glyphs. */
  font_input?: FontInputConfig;
  phonotactics: Phonotactics;
  allophony_rules: AllophonyRule[];
}

export interface FontInputConfig {
  phonemes: Record<string, string>;
  vowels: string[];
  multigraphs: string[];
  separator: string;
  use_parent_phonemes?: boolean;
  source_substitutions?: Record<string, string>;
}

export type GlyphAnnotationsSource =
  | "local"
  | "inherited"
  | "legacy_migrated"
  | "none";

export interface PhonologyLoadResult {
  config: PhonologyConfig;
  revision: string;
  local_config?: PhonologyConfig;
  effective_config?: PhonologyConfig;
  annotations_source?: GlyphAnnotationsSource;
  annotations_owner_id?: string | null;
  effective_revision?: string;
  dependencies?: Record<string, string>;
  legacy_fields_present?: boolean;
}

// ── 词典相关 ──────────────────────────────────────────────

export interface Sense {
  sense_id: string;
  pos_id: string;
  gloss: string;
  definitions: string[];
  examples: string[];
  grammatical_function?: string; // 孤立语虚词功能标签（如 particle / topic / aspect_marker）
  /** 绑定跨语言概念锚点（T2.2） */
  concept_id?: string;
}

export type OriginType =
  | "a_priori"
  | "a_posteriori"
  | "mixed"
  | "derived"
  | "borrowed"
  | "evolved";

export interface Etymology {
  origin_type: OriginType;
  parent_entry_id: string | null;
  source_language_id: string | null;
  applied_sound_changes: string[];
  semantic_shift_note: string;
  /** 共时构词成分（DAG 多词素，T2.4） */
  components?: MorphemeComponent[];
  /** 上次核验时各成分词根读音摘要（级联过期检测） */
  compounds_stale_digest?: string;
}

export interface EntryMetadata {
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface WordEvolution {
  is_deprecated: boolean;
  deprecated_since_language_id: string | null;
  parent_snapshot_hash?: string | null;
  last_synced_word_hash?: string | null;
}

export interface WordEntry {
  entry_id: string;
  language_id: string;
  con_word_romanized: string;
  phonetic_ipa: string;
  phonetic_override: boolean;
  senses: Sense[];
  etymology: Etymology;
  metadata: EntryMetadata;
  evolution?: WordEvolution;
}

// ── 语法相关 ──────────────────────────────────────────────

export type WordOrder = "SVO" | "SOV" | "VSO" | "VOS" | "OVS" | "OSV";
export type ModifierPosition = "before_head" | "after_head";
export type AdpositionType = "preposition" | "postposition";

export interface SyntaxConfig {
  word_order: WordOrder;
  modifier_position: ModifierPosition;
  adposition_type: AdpositionType;
  /** 形态句法对齐；缺省视为 "nom_acc" */
  alignment?: MorphosyntacticAlignment;
  /** 可选显式绑定格维度值 */
  case_gloss_map?: Partial<Record<"nom" | "acc" | "erg" | "abs" | "gen", CaseDimBinding>>;
}

export interface PartOfSpeech {
  pos_id: string;
  name: string;
  gloss_abbr: string;
  word_pattern: string; // 词形合法性正则，空字符串表示无约束
  requires_definition: boolean;
  requires_pronunciation: boolean;
}

// ── 屈折维度 (Phase 2) ───────────────────────────────────

export interface DimensionValue {
  val_id: string;
  name: string;
  gloss: string; // 如 "NOM", "ACC", "PRS", "PST"
}

export interface InflectionDimension {
  dim_id: string;
  name: string; // 如 "Case", "Number", "Tense"
  applies_to_pos: string[]; // 关联的词性 pos_id 列表
  values: DimensionValue[];
}

// ── 屈折规则 (Phase 2 完整形态) ──────────────────────────

export type MorphologyType =
  | "prefix"
  | "suffix"
  | "infix"
  | "circumfix"
  | "reduplication"
  | "ablaut";

export type ConditionType =
  | "ends_with_phoneme_class"
  | "starts_with_phoneme_class"
  | "matches_regex";

export type PhonemeClass = "vowel" | "consonant";

export interface ConditionClause {
  type: ConditionType;
  class?: PhonemeClass;
  regex?: string;
  then_affix: string;
  else_affix: string;
}

export interface InfixConfig {
  position_regex: string; // 正则指定插入位置
  morpheme: string;
}

export interface CircumfixConfig {
  prefix_part: string;
  suffix_part: string;
}

export type ReduplicationMode = "full" | "partial_onset" | "partial_coda";

export interface ReduplicationConfig {
  mode: ReduplicationMode;
}

export interface AblautConfig {
  target_vowel: string;
  replacement_vowel: string;
}

export interface InflectionRule {
  rule_id: string;
  pos_id: string;
  dimension_values: Record<string, string>; // dim_id → val_id
  type: MorphologyType;
  affix: string;
  tag: string;
  match_regex: string;
  disabled: boolean;
  condition: ConditionClause | null;
  infix_config?: InfixConfig;
  circumfix_config?: CircumfixConfig;
  reduplication_config?: ReduplicationConfig;
  ablaut_config?: AblautConfig;
  // ── Typology 扩展 ──
  slot_id?: string; // 黏着语：关联的词缀槽位
  conjugation_class_id?: string; // 屈折语：关联的变位类
  fused_dimensions?: Record<string, string>[]; // 屈折语：融合规则映射多组维度值
  sca_mutable?: boolean; // 是否允许被 SCA 批量改写
}

// ── 派生规则 (Phase 2) ───────────────────────────────────

export interface DerivationRule {
  rule_id: string;
  name: string;
  source_pos_id: string;
  target_pos_id: string;
  type: MorphologyType;
  affix: string;
  condition: ConditionClause | null;
  infix_config?: InfixConfig;
  circumfix_config?: CircumfixConfig;
  semantic_note: string;
  sca_mutable?: boolean; // 是否允许被 SCA 批量改写
}

// ── 语法手册 (Phase 2) ──────────────────────────────────

export interface EmbeddedParadigm {
  paradigm_id: string;
  pos_id: string;
  dimension_ids: string[];
  test_word: string;
}

export interface GrammarChapter {
  chapter_id: string;
  title: string;
  content: string; // Markdown
  order: number;
  embedded_paradigms: EmbeddedParadigm[];
}

// ── 语言类型学 (Typology) ────────────────────────────────

export type MorphologicalTypology =
  | "isolating"
  | "agglutinative"
  | "fusional"
  | "polysynthetic";
export type HeadMarking = "head" | "dependent" | "double" | "none";

export interface TypologyConfig {
  morphological_type: MorphologicalTypology;
  synthesis_index: number; // 1.0 ~ 5.0
  fusion_index: number; // 1.0 ~ 3.0
  head_marking: HeadMarking;
  auto_estimated: boolean; // true=由系统统计推断, false=用户手动设定
}

export interface AffixSlot {
  slot_id: string;
  position: number; // <0 前缀槽位, >0 后缀槽位
  dimension_id: string; // 关联的屈折维度
  is_obligatory: boolean;
  label: string;
}

export interface ConjugationClass {
  class_id: string;
  name: string;
  applies_to_pos: string;
  stem_pattern: string; // 词干识别规则
  rule_ids: string[]; // 属于此类的屈折规则 ID
}

export interface IrregularOverride {
  entry_id: string; // 关联词条 ID
  dimension_values: Record<string, string>;
  surface_form: string; // 手动指定的词形
  /** Codepoint offset of the stem in surface_form, after any grammatical prefixes. */
  stem_start?: number;
}

// ── GrammarConfig ────────────────────────────────────────

export interface GrammarConfig {
  language_id: string;
  syntax: SyntaxConfig;
  parts_of_speech: PartOfSpeech[];
  inflection_dimensions: InflectionDimension[];
  inflection_rules: InflectionRule[];
  derivation_rules: DerivationRule[];
  grammar_manual: GrammarChapter[];
  typology: TypologyConfig;
  affix_slots: AffixSlot[];
  conjugation_classes: ConjugationClass[];
  irregular_overrides: IrregularOverride[];
  /** 共时形态音位规则（T2.5） */
  morphophonology_rules?: MorphophonologyRule[];
}

// ── Workspace & Language Registry (Phase 2 Sprint 6) ─────

export interface LanguageEntry {
  language_id: string;
  name: string;
  path: string; // relative dir name, e.g. "proto_language"
  parent_id: string | null;
}

/** Which font file a language displays, after walking parent_id. */
export interface LanguageFontStatus {
  language_id: string;
  has_own: boolean;
  own_file_name: string | null;
  revision?: string;
  resolved_owner_id: string | null;
  resolved_owner_name: string | null;
  resolved_file_name: string | null;
  resolved_revision?: string | null;
}

/** Parsed face for the active language, after walking parent_id. */
export interface FontInspection {
  substitution_features?: string[];
  positioning_features?: string[];
  present: boolean;
  has_own: boolean;
  inherited: boolean;
  owner_language_id: string | null;
  owner_name: string | null;
  owner_path: string | null;
  file_name: string | null;
  family_name: string | null;
  version: string | null;
  codepoints: number[];
  /** Codepoints that draw the same glyph, one group per glyph. */
  glyphs?: number[][];
  warning: string | null;
  revision?: string;
  resolved_revision?: string | null;
}

export interface ResolvedFontBytes {
  owner_language_id: string;
  owner_name: string;
  inherited: boolean;
  file_name: string;
  bytes_base64: string;
  revision?: string;
}

export interface WorkspaceConfig {
  workspace_version: string;
  languages: LanguageEntry[];
  /** 用户自定义概念表（T2.2） */
  custom_concepts?: ConceptDefinition[];
}

// ── Global Registry ──────────────────────────────────────

export interface FamilyEntry {
  name: string;
  conlang_file_path: string;
  last_opened: string;
}

export interface GlobalRegistry {
  registry_version: string;
  families: FamilyEntry[];
  active_family_index: number | null;
}

// ── Operation Log & Snapshots ────────────────────────────

export type SnapshotScope =
  | "lexicon"
  | "phonology"
  | "grammar"
  | "sca"
  | "corpus"
  | "font"
  | "project";

export type SnapshotOrigin = "gui" | "mcp" | "system";
export type SnapshotLevel = "language" | "project";

export type OperationType =
  | "pull_sync"
  | "borrowing"
  | "manual_snapshot"
  | "auto_snapshot"
  | "rollback_recovery"
  | "fork_language"
  | "delete_language"
  | "restore_language"
  | "update_language"
  | "import_bundle"
  | "batch_font";

export interface OperationLogEntry {
  log_id: string;
  operation_type: OperationType;
  timestamp: string;
  source_language_id: string;
  target_language_id: string;
  description: string;
  snapshot_dir: string;
  origin?: SnapshotOrigin;
  scope?: SnapshotScope;
  level?: SnapshotLevel;
  restored_from?: string | null;
}

export interface OperationLog {
  max_snapshots: number;
  entries: OperationLogEntry[];
}

// ── Create Project Result ────────────────────────────────

export interface CreateProjectResult {
  config: WorkspaceConfig;
  conlang_file_path: string;
}

// ── SCA (Sound Change Applier) (Phase 2 Sprint 6, Phase 3 升级) ──

/** SCA 特征匹配表达式，如 [+voiced, -stop] */
export interface FeatureExpression {
  /** 要求具备的特征 (+ 前缀) */
  positive: string[];
  /** 要求不具备的特征 (- 前缀) */
  negative: string[];
}

/** SCA 特征级替换操作 */
export interface FeatureReplacement {
  /** 要设置的特征 */
  set_features: string[];
  /** 要移除的特征 */
  remove_features: string[];
}

export interface SCARule {
  rule_id: string;
  description: string;
  // 字符模式（Phase 2）
  target: string; // space-separated phonemes "p t k"
  replacement: string; // corresponding replacements "b d g"
  context_before: string;
  context_after: string;
  exceptions: string[];
  // 特征模式（Phase 3）
  feature_mode: boolean;
  target_features: FeatureExpression | null;
  replacement_features: FeatureReplacement | null;
  context_before_features: FeatureExpression | null;
  context_after_features: FeatureExpression | null;
}

export interface SCARuleSet {
  ruleset_id: string;
  name: string;
  order: number;
  rules: SCARule[];
}

export interface SCAConfig {
  language_id: string;
  rule_sets: SCARuleSet[];
}

export interface SCAStepLog {
  rule_id: string;
  description: string;
  before: string;
  after: string;
  /** 特征模式下的详细匹配信息 */
  feature_detail?: string;
}

// ── 语料库 (Phase 3) ────────────────────────────────────

/** 单个 token 的莱比锡标注 */
export interface GlossToken {
  token_id: string;
  /** Conlang 表层形式 */
  surface_form: string;
  /** 语素拆解（用 - 分隔语素） */
  morpheme_break: string;
  /** 语法缩写标注（用 - 分隔，与语素一一对应） */
  gloss_labels: string;
  /** 关联词典 entry_id（可选） */
  linked_entry_id: string;
  /** IPA 发音 */
  ipa: string;
}

/** 一行注释数据（对应一个句子/从句） */
export interface GlossedLine {
  line_id: string;
  /** 原文文本 */
  original: string;
  /** token 级标注 */
  tokens: GlossToken[];
  /** 该行的自由翻译 */
  translation: string;
}

/** 语料库文本条目 */
export interface CorpusText {
  corpus_id: string;
  language_id: string;
  title: string;
  description: string;
  /** 原始 Conlang 文本 */
  original_text: string;
  /** 行间注释数据 */
  glossed_lines: GlossedLine[];
  /** 自由翻译 */
  free_translation: string;
  metadata: {
    tags: string[];
    created_at: string;
    updated_at: string;
    auto_gloss_report?: {
      total: number;
      autoApplied: number;
      pending: number;
      unresolved: number;
    } | null;
  };
}

/** 语料库索引条目 */
export interface CorpusIndexEntry {
  corpus_id: string;
  title: string;
  description: string;
  metadata: {
    tags: string[];
    created_at: string;
    updated_at: string;
    auto_gloss_report?: {
      total: number;
      autoApplied: number;
      pending: number;
      unresolved: number;
    } | null;
  };
}

export interface ParsedInflection {
  entry: WordEntry;
  morphemeBreak: string;
  glossLabels: string;
  score: number;
  confidence: number;
  trace: string;
}

export interface AffixRuleInfo {
  rule: InflectionRule;
  affix: string;
  label: string;
}

// ── Versioned Storage, Recovery, Watcher & MCP DTOs ──────

export interface WriteResult {
  operation_id: string;
  revision: string;
  revisions?: Record<string, string>;
  snapshot_id?: string | null;
  warnings?: string[];
}

export interface WorkspaceLoadResult {
  config: WorkspaceConfig;
  revision: string;
}

export interface GrammarLoadResult {
  config: GrammarConfig;
  revision: string;
}

export interface ScaLoadResult {
  config: SCAConfig;
  revision: string;
}

export interface LexiconSkippedLine {
  file: string;
  line: number;
  reason: string;
}

export interface LexiconLoadResult {
  words: WordEntry[];
  revision: string;
  skipped: LexiconSkippedLine[];
}

export interface CorpusIndexLoadResult {
  entries: CorpusIndexEntry[];
  revision: string;
}

export interface CorpusTextLoadResult {
  corpus: CorpusText;
  revision: string;
  index_revision: string;
}

export interface LegacyReviewItem {
  map_id: string;
  rule_id: string;
  input: string;
  output_phoneme: string;
  reason: string;
}

export interface LegacyWritingInspection {
  present: boolean;
  fields: string[];
  needs_review: LegacyReviewItem[];
}

export interface TrashedLanguageEntry {
  trash_id: string;
  language_id: string;
  name: string;
  original_path: string;
  parent_id: string | null;
  deleted_at: string;
  operation_id: string;
  project_snapshot_id?: string | null;
  original_entry?: LanguageEntry;
}

export interface RestoreLanguageResult {
  dry_run: boolean;
  restored?: LanguageEntry;
  conflicts: string[];
  revision: string;
  operation_id: string;
}

export interface SnapshotSummary {
  snapshot_id: string;
  level: SnapshotLevel;
  scope: SnapshotScope;
  origin: SnapshotOrigin;
  language_id: string | null;
  operation_type: string;
  description: string;
  timestamp: string;
  restored_from?: string | null;
  archived_language?: boolean;
}

export interface SnapshotDiffSummary {
  snapshot_id: string;
  level: SnapshotLevel;
  scope: SnapshotScope;
  changed_files: string[];
  added_files: string[];
  removed_files: string[];
  conflicts: string[];
}

export interface SnapshotRollbackResult {
  dry_run: boolean;
  operation_id: string;
  recovery_snapshot_id?: string | null;
  revision: string;
  revisions?: Record<string, string>;
  diff: SnapshotDiffSummary;
}

export type WorkspaceChangeKind =
  | "workspace"
  | "phonology"
  | "lexicon"
  | "grammar"
  | "sca"
  | "corpus"
  | "font"
  | "snapshots"
  | "trash";

export interface WorkspaceFileChangedEvent {
  project_path: string;
  operation_id: string | null;
  origin: "gui" | "mcp" | "external";
  language_path: string | null;
  language_id: string | null;
  kind: WorkspaceChangeKind;
  revisions: Record<string, string>;
  affected_language_ids: string[];
}

export interface McpAuditLogEntry {
  timestamp: string;
  operation_id: string;
  tool: string;
  origin: string;
  /** HTTP mode: name of the access token (Agent) that performed the call. */
  client?: string | null;
  family_path?: string;
  language_id?: string | null;
  summary: string;
  snapshot_id?: string | null;
  status: "committed" | "rolled_back" | "dry_run" | "error";
}

export type McpPermissionMode = "read-only" | "write" | "write+destructive";

/** One access token stored in `<app data>/mcp-server.json` (HTTP transport). */
export interface McpTokenSettings {
  id: string;
  name: string;
  /** Plaintext secret (`cmk_…`); the settings file is mode 0600. */
  token: string;
  mode: McpPermissionMode;
  /** "default" (derived from mode), "all", or a comma separated toolset list. */
  toolsets: string;
  /** Default family `.conlang` path for this Agent, or null for dynamic discovery. */
  family: string | null;
  enabled: boolean;
  created_at: string;
}

export interface McpServerSettings {
  version: number;
  port: number;
  tokens: McpTokenSettings[];
}

export interface McpServerSettingsPayload {
  settings: McpServerSettings;
  url: string;
  /** Token id → ISO timestamp of the last authenticated request. */
  token_last_used: Record<string, string>;
  log_path: string;
  settings_path: string;
  state_path: string;
}

export type McpServerRunState =
  | "running"
  | "stopped"
  | "starting"
  | "port_in_use"
  | "error";

export interface McpServerStatus {
  state: McpServerRunState;
  /** True when this GUI instance started the process. */
  owned: boolean;
  pid: number | null;
  port: number | null;
  url: string | null;
  version: string | null;
  sessions: number | null;
  last_error: string | null;
  log_path: string;
}

export interface RegistryLoadResult {
  registry: GlobalRegistry;
  revision: string;
}

export interface MigrationStats {
  dry_run: boolean;
  languages_processed: number;
  words_scanned: number;
  parent_link_filled: number;
  source_language_filled: number;
  origin_fixed: number;
  files_changed: number;
}

export interface LanguageWordStats {
  word_count: number;
  created_at: number | null;
  updated_at: number | null;
}

export type ConflictResourceKind =
  | "workspace"
  | "phonology"
  | "lexicon"
  | "grammar"
  | "sca"
  | "corpus"
  | "font"
  | "registry";

export interface ExternalConflictItem {
  key: string;
  kind: ConflictResourceKind;
  projectPath: string;
  languagePath: string | null;
  languageId: string | null;
  corpusId: string | null;
  origin: "gui" | "mcp" | "external";
  diskRevision: string;
  reason: string;
  changedFields: string[];
  localPreview: string;
  diskPreview: string;
}



