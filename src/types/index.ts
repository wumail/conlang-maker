// ── 音系相关 ──────────────────────────────────────────────

export interface PhonemeInventory {
  consonants: string[];
  vowels: string[];
}

export interface RomanizationRule {
  input: string;
  output_phoneme: string;
  context_before: string;
  context_after: string;
}

export interface RomanizationMap {
  map_id: string;
  name: string;
  is_default: boolean;
  rules: RomanizationRule[];
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

export interface Phonotactics {
  macros: Record<string, string[]>;
  syllable_structure: string;
  blacklist_patterns: string[];
  vowel_harmony: VowelHarmony;
  tone_system: ToneSystem;
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
  phonotactics: Phonotactics;
  allophony_rules: AllophonyRule[];
}

// ── 词典相关 ──────────────────────────────────────────────

export interface Sense {
  sense_id: string;
  pos_id: string;
  gloss: string;
  definitions: string[];
  examples: string[];
  grammatical_function?: string; // 孤立语虚词功能标签（如 particle / topic / aspect_marker）
}

export type OriginType = 'a_priori' | 'a_posteriori' | 'mixed' | 'derived' | 'borrowed' | 'evolved';

export interface Etymology {
  origin_type: OriginType;
  parent_entry_id: string | null;
  source_language_id: string | null;
  applied_sound_changes: string[];
  semantic_shift_note: string;
}

export interface EntryMetadata {
  tags: string[];
  created_at: string;
  updated_at: string;
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
}

// ── 语法相关 ──────────────────────────────────────────────

export type WordOrder = 'SVO' | 'SOV' | 'VSO' | 'VOS' | 'OVS' | 'OSV';
export type ModifierPosition = 'before_head' | 'after_head';
export type AdpositionType = 'preposition' | 'postposition';

export interface SyntaxConfig {
  word_order: WordOrder;
  modifier_position: ModifierPosition;
  adposition_type: AdpositionType;
}

export interface PartOfSpeech {
  pos_id: string;
  name: string;
  gloss_abbr: string;
  word_pattern: string;       // 词形合法性正则，空字符串表示无约束
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
  | 'prefix' | 'suffix'
  | 'infix'
  | 'circumfix'
  | 'reduplication'
  | 'ablaut';

export type ConditionType =
  | 'ends_with_phoneme_class'
  | 'starts_with_phoneme_class'
  | 'matches_regex';

export type PhonemeClass = 'vowel' | 'consonant';

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

export type ReduplicationMode = 'full' | 'partial_onset' | 'partial_coda';

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
  slot_id?: string;              // 黏着语：关联的词缀槽位
  conjugation_class_id?: string; // 屈折语：关联的变位类
  fused_dimensions?: Record<string, string>[]; // 屈折语：融合规则映射多组维度值
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

export type MorphologicalTypology = 'isolating' | 'agglutinative' | 'fusional' | 'polysynthetic';
export type HeadMarking = 'head' | 'dependent' | 'double' | 'none';

export interface TypologyConfig {
  morphological_type: MorphologicalTypology;
  synthesis_index: number;   // 1.0 ~ 5.0
  fusion_index: number;      // 1.0 ~ 3.0
  head_marking: HeadMarking;
  auto_estimated: boolean;   // true=由系统统计推断, false=用户手动设定
}

export interface AffixSlot {
  slot_id: string;
  position: number;          // <0 前缀槽位, >0 后缀槽位
  dimension_id: string;      // 关联的屈折维度
  is_obligatory: boolean;
  label: string;
}

export interface ConjugationClass {
  class_id: string;
  name: string;
  applies_to_pos: string;
  stem_pattern: string;      // 词干识别规则
  rule_ids: string[];        // 属于此类的屈折规则 ID
}

export interface IrregularOverride {
  entry_id: string;          // 关联词条 ID
  dimension_values: Record<string, string>;
  surface_form: string;      // 手动指定的词形
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
}

// ── Workspace & Language Registry (Phase 2 Sprint 6) ─────

export interface LanguageEntry {
  language_id: string;
  name: string;
  path: string;           // relative dir name, e.g. "proto_language"
  parent_id: string | null;
}

export interface WorkspaceConfig {
  workspace_version: string;
  languages: LanguageEntry[];
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

// ── Operation Log ────────────────────────────────────────

export type OperationType = 'pull_sync' | 'borrowing';

export interface OperationLogEntry {
  log_id: string;
  operation_type: OperationType;
  timestamp: string;
  source_language_id: string;
  target_language_id: string;
  description: string;
  snapshot_dir: string;
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
  target: string;         // space-separated phonemes "p t k"
  replacement: string;    // corresponding replacements "b d g"
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
  };
}
