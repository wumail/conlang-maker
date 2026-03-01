use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── 音系相关 ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PhonemeInventory {
    pub consonants: Vec<String>,
    pub vowels: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RomanizationRule {
    pub input: String,
    pub output_phoneme: String,
    #[serde(default)]
    pub context_before: String,
    #[serde(default)]
    pub context_after: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RomanizationMap {
    pub map_id: String,
    pub name: String,
    pub is_default: bool,
    pub rules: Vec<RomanizationRule>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VowelHarmony {
    pub enabled: bool,
    #[serde(default)]
    pub group_a: Vec<String>,
    #[serde(default)]
    pub group_b: Vec<String>,
}

impl Default for VowelHarmony {
    fn default() -> Self {
        Self {
            enabled: false,
            group_a: Vec::new(),
            group_b: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToneDefinition {
    pub tone_id: String,
    pub name: String,
    #[serde(default)]
    pub marker: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToneSystem {
    pub enabled: bool,
    #[serde(default)]
    pub tones: Vec<ToneDefinition>,
}

impl Default for ToneSystem {
    fn default() -> Self {
        Self {
            enabled: false,
            tones: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Phonotactics {
    pub macros: HashMap<String, Vec<String>>,
    pub syllable_structure: String,
    #[serde(default)]
    pub blacklist_patterns: Vec<String>,
    #[serde(default)]
    pub vowel_harmony: VowelHarmony,
    #[serde(default)]
    pub tone_system: ToneSystem,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AllophonyRule {
    pub rule_id: String,
    pub description: String,
    pub target: String,
    pub replacement: String,
    #[serde(default)]
    pub context_before: String,
    #[serde(default)]
    pub context_after: String,
    #[serde(default)]
    pub priority: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PhonologyConfig {
    pub language_id: String,
    pub phoneme_inventory: PhonemeInventory,
    #[serde(default)]
    pub romanization_maps: Vec<RomanizationMap>,
    pub phonotactics: Phonotactics,
    #[serde(default)]
    pub allophony_rules: Vec<AllophonyRule>,
}

// ── 词典相关 ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Sense {
    #[serde(default)]
    pub sense_id: String,
    /// pos_id 关联 grammar.json 中的词性定义；兼容旧数据中的 "pos" 字段
    #[serde(alias = "pos")]
    pub pos_id: String,
    pub gloss: String,
    #[serde(default)]
    pub definitions: Vec<String>,
    #[serde(default)]
    pub examples: Vec<String>,
    #[serde(default)]
    pub grammatical_function: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Etymology {
    #[serde(default = "default_origin_type")]
    pub origin_type: String,
    #[serde(default)]
    pub parent_entry_id: Option<String>,
    #[serde(default)]
    pub source_language_id: Option<String>,
    #[serde(default)]
    pub applied_sound_changes: Vec<String>,
    #[serde(default)]
    pub semantic_shift_note: String,
}

fn default_origin_type() -> String {
    "a_priori".to_string()
}

impl Default for Etymology {
    fn default() -> Self {
        Self {
            origin_type: default_origin_type(),
            parent_entry_id: None,
            source_language_id: None,
            applied_sound_changes: Vec::new(),
            semantic_shift_note: String::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EntryMetadata {
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

impl Default for EntryMetadata {
    fn default() -> Self {
        Self {
            tags: Vec::new(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WordEntry {
    pub entry_id: String,
    pub language_id: String,
    pub con_word_romanized: String,
    #[serde(default)]
    pub phonetic_ipa: String,
    #[serde(default)]
    pub phonetic_override: bool,
    #[serde(default)]
    pub senses: Vec<Sense>,
    #[serde(default)]
    pub etymology: Etymology,
    #[serde(default)]
    pub metadata: EntryMetadata,
}

// ── 语法相关 ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyntaxConfig {
    #[serde(default = "default_word_order")]
    pub word_order: String,
    #[serde(default = "default_modifier_position")]
    pub modifier_position: String,
    #[serde(default = "default_adposition_type")]
    pub adposition_type: String,
}

fn default_word_order() -> String {
    "SVO".to_string()
}
fn default_modifier_position() -> String {
    "before_head".to_string()
}
fn default_adposition_type() -> String {
    "preposition".to_string()
}

impl Default for SyntaxConfig {
    fn default() -> Self {
        Self {
            word_order: default_word_order(),
            modifier_position: default_modifier_position(),
            adposition_type: default_adposition_type(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PartOfSpeech {
    pub pos_id: String,
    pub name: String,
    #[serde(default)]
    pub gloss_abbr: String,
    #[serde(default)]
    pub word_pattern: String,
    #[serde(default)]
    pub requires_definition: bool,
    #[serde(default)]
    pub requires_pronunciation: bool,
}

// ── 屈折维度 (Phase 2) ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DimensionValue {
    pub val_id: String,
    pub name: String,
    #[serde(default)]
    pub gloss: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InflectionDimension {
    pub dim_id: String,
    pub name: String,
    #[serde(default)]
    pub applies_to_pos: Vec<String>,
    #[serde(default)]
    pub values: Vec<DimensionValue>,
}

// ── 屈折规则 (Phase 2 完整形态) ─────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConditionClause {
    #[serde(rename = "type")]
    pub condition_type: String, // "ends_with_phoneme_class" | "starts_with_phoneme_class" | "matches_regex"
    #[serde(default)]
    pub class: Option<String>, // "vowel" | "consonant"
    #[serde(default)]
    pub regex: Option<String>,
    #[serde(default)]
    pub then_affix: String,
    #[serde(default)]
    pub else_affix: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InfixConfig {
    #[serde(default)]
    pub position_regex: String,
    #[serde(default)]
    pub morpheme: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CircumfixConfig {
    #[serde(default)]
    pub prefix_part: String,
    #[serde(default)]
    pub suffix_part: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReduplicationConfig {
    #[serde(default = "default_reduplication_mode")]
    pub mode: String, // "full" | "partial_onset" | "partial_coda"
}

fn default_reduplication_mode() -> String {
    "full".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AblautConfig {
    #[serde(default)]
    pub target_vowel: String,
    #[serde(default)]
    pub replacement_vowel: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InflectionRule {
    pub rule_id: String,
    /// pos_id 关联词性；兼容旧数据中的 "pos" 字段
    #[serde(alias = "pos")]
    pub pos_id: String,
    #[serde(default)]
    pub dimension_values: HashMap<String, String>,
    pub tag: String,
    #[serde(rename = "type")]
    pub affix_type: String, // "suffix" | "prefix" | "infix" | "circumfix" | "reduplication" | "ablaut"
    #[serde(default)]
    pub affix: String,
    #[serde(default = "default_match_regex")]
    pub match_regex: String,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub condition: Option<ConditionClause>,
    #[serde(default)]
    pub infix_config: Option<InfixConfig>,
    #[serde(default)]
    pub circumfix_config: Option<CircumfixConfig>,
    #[serde(default)]
    pub reduplication_config: Option<ReduplicationConfig>,
    #[serde(default)]
    pub ablaut_config: Option<AblautConfig>,
    // Typology 扩展
    #[serde(default)]
    pub slot_id: Option<String>,
    #[serde(default)]
    pub conjugation_class_id: Option<String>,
    #[serde(default)]
    pub fused_dimensions: Option<Vec<HashMap<String, String>>>,
}

fn default_match_regex() -> String {
    ".*".to_string()
}

// ── 派生规则 (Phase 2) ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DerivationRule {
    pub rule_id: String,
    #[serde(default)]
    pub name: String,
    pub source_pos_id: String,
    pub target_pos_id: String,
    #[serde(rename = "type")]
    pub affix_type: String,
    #[serde(default)]
    pub affix: String,
    #[serde(default)]
    pub condition: Option<ConditionClause>,
    #[serde(default)]
    pub infix_config: Option<InfixConfig>,
    #[serde(default)]
    pub circumfix_config: Option<CircumfixConfig>,
    #[serde(default)]
    pub semantic_note: String,
}

// ── 语法手册 (Phase 2) ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmbeddedParadigm {
    pub paradigm_id: String,
    pub pos_id: String,
    #[serde(default)]
    pub dimension_ids: Vec<String>,
    #[serde(default)]
    pub test_word: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GrammarChapter {
    pub chapter_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub order: u32,
    #[serde(default)]
    pub embedded_paradigms: Vec<EmbeddedParadigm>,
}

// ── 语言类型学 (Typology) ──────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TypologyConfig {
    #[serde(default = "default_morphological_type")]
    pub morphological_type: String,
    #[serde(default = "default_synthesis_index")]
    pub synthesis_index: f64,
    #[serde(default = "default_fusion_index")]
    pub fusion_index: f64,
    #[serde(default = "default_head_marking")]
    pub head_marking: String,
    #[serde(default = "default_auto_estimated")]
    pub auto_estimated: bool,
}

fn default_morphological_type() -> String {
    "fusional".to_string()
}
fn default_synthesis_index() -> f64 {
    2.0
}
fn default_fusion_index() -> f64 {
    2.0
}
fn default_head_marking() -> String {
    "dependent".to_string()
}
fn default_auto_estimated() -> bool {
    true
}

impl Default for TypologyConfig {
    fn default() -> Self {
        Self {
            morphological_type: default_morphological_type(),
            synthesis_index: default_synthesis_index(),
            fusion_index: default_fusion_index(),
            head_marking: default_head_marking(),
            auto_estimated: default_auto_estimated(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AffixSlot {
    pub slot_id: String,
    #[serde(default)]
    pub position: i32,
    #[serde(default)]
    pub dimension_id: String,
    #[serde(default)]
    pub is_obligatory: bool,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConjugationClass {
    pub class_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub applies_to_pos: String,
    #[serde(default)]
    pub stem_pattern: String,
    #[serde(default)]
    pub rule_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IrregularOverride {
    pub entry_id: String,
    #[serde(default)]
    pub dimension_values: HashMap<String, String>,
    #[serde(default)]
    pub surface_form: String,
}

// ── GrammarConfig ───────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GrammarConfig {
    #[serde(default = "default_language_id")]
    pub language_id: String,
    #[serde(default)]
    pub syntax: SyntaxConfig,
    #[serde(default)]
    pub parts_of_speech: Vec<PartOfSpeech>,
    #[serde(default)]
    pub inflection_dimensions: Vec<InflectionDimension>,
    /// 兼容旧数据：旧格式为 "inflections"，新格式为 "inflection_rules"
    #[serde(default, alias = "inflections")]
    pub inflection_rules: Vec<InflectionRule>,
    #[serde(default)]
    pub derivation_rules: Vec<DerivationRule>,
    #[serde(default)]
    pub grammar_manual: Vec<GrammarChapter>,
    #[serde(default)]
    pub typology: TypologyConfig,
    #[serde(default)]
    pub affix_slots: Vec<AffixSlot>,
    #[serde(default)]
    pub conjugation_classes: Vec<ConjugationClass>,
    #[serde(default)]
    pub irregular_overrides: Vec<IrregularOverride>,
}

fn default_language_id() -> String {
    "lang_proto".to_string()
}

impl Default for GrammarConfig {
    fn default() -> Self {
        GrammarConfig {
            language_id: default_language_id(),
            syntax: SyntaxConfig::default(),
            parts_of_speech: Vec::new(),
            inflection_dimensions: Vec::new(),
            inflection_rules: Vec::new(),
            derivation_rules: Vec::new(),
            grammar_manual: Vec::new(),
            typology: TypologyConfig::default(),
            affix_slots: Vec::new(),
            conjugation_classes: Vec::new(),
            irregular_overrides: Vec::new(),
        }
    }
}

// ── Workspace & Language Registry (Phase 2 Sprint 6) ────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LanguageEntry {
    pub language_id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceConfig {
    #[serde(default = "default_workspace_version")]
    pub workspace_version: String,
    #[serde(default)]
    pub languages: Vec<LanguageEntry>,
}

fn default_workspace_version() -> String {
    "3.0".to_string()
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            workspace_version: default_workspace_version(),
            languages: vec![LanguageEntry {
                language_id: default_language_id(),
                name: "Proto Language".to_string(),
                path: "proto_language".to_string(),
                parent_id: None,
            }],
        }
    }
}

// ── SCA (Sound Change Applier) (Phase 2 Sprint 6, Phase 3 升级) ──

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct FeatureExpression {
    #[serde(default)]
    pub positive: Vec<String>,
    #[serde(default)]
    pub negative: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct FeatureReplacement {
    #[serde(default)]
    pub set_features: Vec<String>,
    #[serde(default)]
    pub remove_features: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SCARule {
    pub rule_id: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub replacement: String,
    #[serde(default)]
    pub context_before: String,
    #[serde(default)]
    pub context_after: String,
    #[serde(default)]
    pub exceptions: Vec<String>,
    // Phase 3: feature mode
    #[serde(default)]
    pub feature_mode: bool,
    #[serde(default)]
    pub target_features: Option<FeatureExpression>,
    #[serde(default)]
    pub replacement_features: Option<FeatureReplacement>,
    #[serde(default)]
    pub context_before_features: Option<FeatureExpression>,
    #[serde(default)]
    pub context_after_features: Option<FeatureExpression>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SCARuleSet {
    pub ruleset_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub order: u32,
    #[serde(default)]
    pub rules: Vec<SCARule>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SCAConfig {
    #[serde(default)]
    pub language_id: String,
    #[serde(default)]
    pub rule_sets: Vec<SCARuleSet>,
}

impl Default for SCAConfig {
    fn default() -> Self {
        Self {
            language_id: default_language_id(),
            rule_sets: Vec::new(),
        }
    }
}

// ── Corpus (Phase 3) ────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct GlossToken {
    pub token_id: String,
    #[serde(default)]
    pub surface_form: String,
    #[serde(default)]
    pub morpheme_break: String,
    #[serde(default)]
    pub gloss_labels: String,
    #[serde(default)]
    pub linked_entry_id: String,
    #[serde(default)]
    pub ipa: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct GlossedLine {
    pub line_id: String,
    #[serde(default)]
    pub original: String,
    #[serde(default)]
    pub tokens: Vec<GlossToken>,
    #[serde(default)]
    pub translation: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CorpusTextMeta {
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CorpusText {
    pub corpus_id: String,
    #[serde(default)]
    pub language_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub original_text: String,
    #[serde(default)]
    pub glossed_lines: Vec<GlossedLine>,
    #[serde(default)]
    pub free_translation: String,
    #[serde(default)]
    pub metadata: CorpusTextMeta,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CorpusIndexEntry {
    pub corpus_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub metadata: CorpusTextMeta,
}

// ── Global Registry (app data dir) ──────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FamilyEntry {
    pub name: String,
    pub conlang_file_path: String,
    #[serde(default)]
    pub last_opened: String,
}

fn default_registry_version() -> String {
    "1.0".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GlobalRegistry {
    #[serde(default = "default_registry_version")]
    pub registry_version: String,
    #[serde(default)]
    pub families: Vec<FamilyEntry>,
    #[serde(default)]
    pub active_family_index: Option<usize>,
}

impl Default for GlobalRegistry {
    fn default() -> Self {
        Self {
            registry_version: default_registry_version(),
            families: Vec::new(),
            active_family_index: None,
        }
    }
}

// ── Operation Log & Snapshots ───────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OperationLogEntry {
    pub log_id: String,
    pub operation_type: String, // "pull_sync" | "borrowing"
    pub timestamp: String,
    pub source_language_id: String,
    pub target_language_id: String,
    pub description: String,
    pub snapshot_dir: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OperationLog {
    #[serde(default = "default_max_snapshots")]
    pub max_snapshots: u32,
    #[serde(default)]
    pub entries: Vec<OperationLogEntry>,
}

fn default_max_snapshots() -> u32 {
    10
}

impl Default for OperationLog {
    fn default() -> Self {
        Self {
            max_snapshots: default_max_snapshots(),
            entries: Vec::new(),
        }
    }
}

// ── Create Project Result ───────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateProjectResult {
    pub config: WorkspaceConfig,
    pub conlang_file_path: String,
}
