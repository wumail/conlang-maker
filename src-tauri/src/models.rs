use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

pub type ExtraFields = BTreeMap<String, serde_json::Value>;

// ── 音系相关 ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct PhonemeInventory {
    #[serde(default)]
    pub consonants: Vec<String>,
    #[serde(default)]
    pub vowels: Vec<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct RomanizationRule {
    #[serde(default)]
    pub rule_id: String,
    #[serde(default)]
    pub input: String,
    #[serde(default)]
    pub output_phoneme: String,
    #[serde(default)]
    pub context_before: String,
    #[serde(default)]
    pub context_after: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct RomanizationMap {
    #[serde(default)]
    pub map_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub rules: Vec<RomanizationRule>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct GlyphAnnotation {
    #[serde(default)]
    pub codepoint: u32,
    #[serde(default)]
    pub label: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub phonemes: Vec<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct VowelHarmony {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub group_a: Vec<String>,
    #[serde(default)]
    pub group_b: Vec<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl Default for VowelHarmony {
    fn default() -> Self {
        Self {
            enabled: false,
            group_a: Vec::new(),
            group_b: Vec::new(),
            extra: ExtraFields::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct ToneDefinition {
    #[serde(default)]
    pub tone_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub marker: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ToneSystem {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub tones: Vec<ToneDefinition>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl Default for ToneSystem {
    fn default() -> Self {
        Self {
            enabled: false,
            tones: Vec::new(),
            extra: ExtraFields::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Phonotactics {
    #[serde(default)]
    pub macros: HashMap<String, Vec<String>>,
    #[serde(default = "default_syllable_structure")]
    pub syllable_structure: String,
    #[serde(default)]
    pub blacklist_patterns: Vec<String>,
    #[serde(default)]
    pub vowel_harmony: VowelHarmony,
    #[serde(default)]
    pub tone_system: ToneSystem,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

fn default_syllable_structure() -> String {
    "(C)V(C)".to_string()
}

impl Default for Phonotactics {
    fn default() -> Self {
        Self {
            macros: HashMap::new(),
            syllable_structure: default_syllable_structure(),
            blacklist_patterns: Vec::new(),
            vowel_harmony: VowelHarmony::default(),
            tone_system: ToneSystem::default(),
            extra: ExtraFields::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct AllophonyRule {
    #[serde(default)]
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
    pub priority: u32,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct PhonologyConfig {
    #[serde(default = "default_language_id")]
    pub language_id: String,
    #[serde(default)]
    pub phoneme_inventory: PhonemeInventory,
    #[serde(default)]
    pub romanization_maps: Vec<RomanizationMap>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub glyph_annotations: Vec<GlyphAnnotation>,
    #[serde(default)]
    pub phonotactics: Phonotactics,
    #[serde(default)]
    pub allophony_rules: Vec<AllophonyRule>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl Default for PhonologyConfig {
    fn default() -> Self {
        Self {
            language_id: default_language_id(),
            phoneme_inventory: PhonemeInventory::default(),
            romanization_maps: Vec::new(),
            glyph_annotations: Vec::new(),
            phonotactics: Phonotactics::default(),
            allophony_rules: Vec::new(),
            extra: ExtraFields::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PhonologyLoadResult {
    /// Effective phonology config (kept as `config` for existing GUI callers).
    pub config: PhonologyConfig,
    /// Local `phonology.json` 16-hex revision (or `"missing"`).
    #[serde(default)]
    pub revision: String,
    /// Raw local phonology config (including locally migrated legacy annotations, excluding ancestor inheritance).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_config: Option<PhonologyConfig>,
    /// Effective phonology config with ancestor glyph annotations resolved when local is empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_config: Option<PhonologyConfig>,
    /// `"local" | "inherited" | "legacy_migrated" | "none"`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotations_source: Option<String>,
    /// Language ID owning the active glyph annotations, if any.
    #[serde(default)]
    pub annotations_owner_id: Option<String>,
    /// 16-hex digest combining local revision + ancestor phonology/font revisions + `.conlang` revision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_revision: Option<String>,
    /// Sorted map of dependency targets to their 16-hex revisions.
    #[serde(default)]
    pub dependencies: BTreeMap<String, String>,
    /// Whether the local `phonology.json` on disk still contains deprecated writing fields.
    #[serde(default)]
    pub legacy_fields_present: bool,
}

// ── 词典相关 ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct Sense {
    #[serde(default)]
    pub sense_id: String,
    /// pos_id 关联 grammar.json 中的词性定义；兼容旧数据中的 "pos" 字段
    #[serde(default, alias = "pos")]
    pub pos_id: String,
    #[serde(default)]
    pub gloss: String,
    #[serde(default)]
    pub definitions: Vec<String>,
    #[serde(default)]
    pub examples: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grammatical_function: Option<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
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
    #[serde(default, flatten)]
    pub extra: ExtraFields,
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
            extra: ExtraFields::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct EntryMetadata {
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct WordEvolution {
    #[serde(default)]
    pub is_deprecated: bool,
    #[serde(default)]
    pub deprecated_since_language_id: Option<String>,
    #[serde(default)]
    pub parent_snapshot_hash: Option<String>,
    #[serde(default)]
    pub last_synced_word_hash: Option<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
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
    #[serde(default)]
    pub evolution: WordEvolution,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

// ── 语法相关 ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SyntaxConfig {
    #[serde(default = "default_word_order")]
    pub word_order: String,
    #[serde(default = "default_modifier_position")]
    pub modifier_position: String,
    #[serde(default = "default_adposition_type")]
    pub adposition_type: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
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
            extra: ExtraFields::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
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
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

// ── 屈折维度 (Phase 2) ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct DimensionValue {
    pub val_id: String,
    pub name: String,
    #[serde(default)]
    pub gloss: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct InflectionDimension {
    pub dim_id: String,
    pub name: String,
    #[serde(default)]
    pub applies_to_pos: Vec<String>,
    #[serde(default)]
    pub values: Vec<DimensionValue>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

// ── 屈折规则 (Phase 2 完整形态) ─────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct ConditionClause {
    #[serde(rename = "type", default)]
    pub condition_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regex: Option<String>,
    #[serde(default)]
    pub then_affix: String,
    #[serde(default)]
    pub else_affix: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct InfixConfig {
    #[serde(default)]
    pub position_regex: String,
    #[serde(default)]
    pub morpheme: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct CircumfixConfig {
    #[serde(default)]
    pub prefix_part: String,
    #[serde(default)]
    pub suffix_part: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ReduplicationConfig {
    #[serde(default = "default_reduplication_mode")]
    pub mode: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

fn default_reduplication_mode() -> String {
    "full".to_string()
}

impl Default for ReduplicationConfig {
    fn default() -> Self {
        Self {
            mode: default_reduplication_mode(),
            extra: ExtraFields::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct AblautConfig {
    #[serde(default)]
    pub target_vowel: String,
    #[serde(default)]
    pub replacement_vowel: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct InflectionRule {
    pub rule_id: String,
    /// pos_id 关联词性；兼容旧数据中的 "pos" 字段
    #[serde(default, alias = "pos")]
    pub pos_id: String,
    #[serde(default)]
    pub dimension_values: HashMap<String, String>,
    #[serde(default)]
    pub tag: String,
    #[serde(rename = "type", default)]
    pub affix_type: String,
    #[serde(default)]
    pub affix: String,
    #[serde(default = "default_match_regex")]
    pub match_regex: String,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub condition: Option<ConditionClause>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub infix_config: Option<InfixConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub circumfix_config: Option<CircumfixConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduplication_config: Option<ReduplicationConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ablaut_config: Option<AblautConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conjugation_class_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fused_dimensions: Option<Vec<HashMap<String, String>>>,
    #[serde(default)]
    pub sca_mutable: bool,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

fn default_match_regex() -> String {
    ".*".to_string()
}

impl Default for InflectionRule {
    fn default() -> Self {
        Self {
            rule_id: String::new(),
            pos_id: String::new(),
            dimension_values: HashMap::new(),
            tag: String::new(),
            affix_type: String::new(),
            affix: String::new(),
            match_regex: default_match_regex(),
            disabled: false,
            condition: None,
            infix_config: None,
            circumfix_config: None,
            reduplication_config: None,
            ablaut_config: None,
            slot_id: None,
            conjugation_class_id: None,
            fused_dimensions: None,
            sca_mutable: false,
            extra: ExtraFields::new(),
        }
    }
}

// ── 派生规则 (Phase 2) ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct DerivationRule {
    pub rule_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub source_pos_id: String,
    #[serde(default)]
    pub target_pos_id: String,
    #[serde(rename = "type", default)]
    pub affix_type: String,
    #[serde(default)]
    pub affix: String,
    #[serde(default)]
    pub condition: Option<ConditionClause>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub infix_config: Option<InfixConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub circumfix_config: Option<CircumfixConfig>,
    #[serde(default)]
    pub semantic_note: String,
    #[serde(default)]
    pub sca_mutable: bool,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

// ── 语法手册 (Phase 2) ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct EmbeddedParadigm {
    pub paradigm_id: String,
    #[serde(default)]
    pub pos_id: String,
    #[serde(default)]
    pub dimension_ids: Vec<String>,
    #[serde(default)]
    pub test_word: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
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
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

// ── 语言类型学 (Typology) ──────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
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
    #[serde(default, flatten)]
    pub extra: ExtraFields,
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
            extra: ExtraFields::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
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
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
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
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct IrregularOverride {
    pub entry_id: String,
    #[serde(default)]
    pub dimension_values: HashMap<String, String>,
    #[serde(default)]
    pub surface_form: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

// ── GrammarConfig ───────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
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
    #[serde(default, flatten)]
    pub extra: ExtraFields,
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
            extra: ExtraFields::new(),
        }
    }
}

// ── Workspace & Language Registry (Phase 2 Sprint 6) ────

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct LanguageEntry {
    pub language_id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct WorkspaceConfig {
    #[serde(default = "default_workspace_version")]
    pub workspace_version: String,
    #[serde(default)]
    pub languages: Vec<LanguageEntry>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
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
                extra: ExtraFields::new(),
            }],
            extra: ExtraFields::new(),
        }
    }
}

// ── SCA (Sound Change Applier) (Phase 2 Sprint 6, Phase 3 升级) ──

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct FeatureExpression {
    #[serde(default)]
    pub positive: Vec<String>,
    #[serde(default)]
    pub negative: Vec<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct FeatureReplacement {
    #[serde(default)]
    pub set_features: Vec<String>,
    #[serde(default)]
    pub remove_features: Vec<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
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
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct SCARuleSet {
    pub ruleset_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub order: u32,
    #[serde(default)]
    pub rules: Vec<SCARule>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SCAConfig {
    #[serde(default)]
    pub language_id: String,
    #[serde(default)]
    pub rule_sets: Vec<SCARuleSet>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl Default for SCAConfig {
    fn default() -> Self {
        Self {
            language_id: default_language_id(),
            rule_sets: Vec::new(),
            extra: ExtraFields::new(),
        }
    }
}

// ── Corpus (Phase 3) ────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
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
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct GlossedLine {
    pub line_id: String,
    #[serde(default)]
    pub original: String,
    #[serde(default)]
    pub tokens: Vec<GlossToken>,
    #[serde(default)]
    pub translation: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct AutoGlossReport {
    #[serde(default)]
    pub total: u32,
    #[serde(default, rename = "autoApplied", alias = "auto_applied")]
    pub auto_applied: u32,
    #[serde(default)]
    pub pending: u32,
    #[serde(default)]
    pub unresolved: u32,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct CorpusTextMeta {
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_gloss_report: Option<AutoGlossReport>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

pub type CorpusMetadata = CorpusTextMeta;

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
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
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct CorpusIndexEntry {
    pub corpus_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub metadata: CorpusTextMeta,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

// ── Global Registry (app data dir) ──────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct FamilyEntry {
    pub name: String,
    pub conlang_file_path: String,
    #[serde(default)]
    pub last_opened: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

fn default_registry_version() -> String {
    "1.0".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct GlobalRegistry {
    #[serde(default = "default_registry_version")]
    pub registry_version: String,
    #[serde(default)]
    pub families: Vec<FamilyEntry>,
    #[serde(default)]
    pub active_family_index: Option<usize>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

impl Default for GlobalRegistry {
    fn default() -> Self {
        Self {
            registry_version: default_registry_version(),
            families: Vec::new(),
            active_family_index: None,
            extra: ExtraFields::new(),
        }
    }
}

// ── Operation Log & Snapshots ───────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct OperationLogEntry {
    pub log_id: String,
    pub operation_type: String,
    pub timestamp: String,
    #[serde(default)]
    pub source_language_id: String,
    #[serde(default)]
    pub target_language_id: String,
    #[serde(default)]
    pub description: String,
    pub snapshot_dir: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restored_from: Option<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct OperationLog {
    #[serde(default = "default_max_snapshots")]
    pub max_snapshots: u32,
    #[serde(default)]
    pub entries: Vec<OperationLogEntry>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

fn default_max_snapshots() -> u32 {
    10
}

impl Default for OperationLog {
    fn default() -> Self {
        Self {
            max_snapshots: default_max_snapshots(),
            entries: Vec::new(),
            extra: ExtraFields::new(),
        }
    }
}

// ── Create Project Result ───────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateProjectResult {
    pub config: WorkspaceConfig,
    pub conlang_file_path: String,
}

// ── Versioned Storage, Recovery, Watcher & MCP DTOs ─────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct WriteResult {
    pub operation_id: String,
    pub revision: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceLoadResult {
    pub config: WorkspaceConfig,
    pub revision: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GrammarLoadResult {
    pub config: GrammarConfig,
    pub revision: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScaLoadResult {
    pub config: SCAConfig,
    pub revision: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct LexiconSkippedLine {
    pub file: String,
    pub line: usize,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LexiconLoadResult {
    pub words: Vec<WordEntry>,
    pub revision: String,
    #[serde(default)]
    pub skipped: Vec<LexiconSkippedLine>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CorpusIndexLoadResult {
    pub entries: Vec<CorpusIndexEntry>,
    pub revision: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CorpusTextLoadResult {
    pub corpus: CorpusText,
    pub revision: String,
    pub index_revision: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct LegacyReviewItem {
    pub map_id: String,
    pub rule_id: String,
    pub input: String,
    pub output_phoneme: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct LegacyWritingInspection {
    pub present: bool,
    #[serde(default)]
    pub fields: Vec<String>,
    #[serde(default)]
    pub needs_review: Vec<LegacyReviewItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrashedLanguageEntry {
    pub trash_id: String,
    pub language_id: String,
    pub name: String,
    pub original_path: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub deleted_at: String,
    pub operation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_snapshot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_entry: Option<LanguageEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RestoreLanguageResult {
    pub dry_run: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restored: Option<LanguageEntry>,
    #[serde(default)]
    pub conflicts: Vec<String>,
    pub revision: String,
    pub operation_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SnapshotSummary {
    pub snapshot_id: String,
    pub level: String,
    pub scope: String,
    pub origin: String,
    #[serde(default)]
    pub language_id: Option<String>,
    pub operation_type: String,
    pub description: String,
    pub timestamp: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restored_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_language: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SnapshotDiffSummary {
    pub snapshot_id: String,
    pub level: String,
    pub scope: String,
    #[serde(default)]
    pub changed_files: Vec<String>,
    #[serde(default)]
    pub added_files: Vec<String>,
    #[serde(default)]
    pub removed_files: Vec<String>,
    #[serde(default)]
    pub conflicts: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SnapshotRollbackResult {
    pub dry_run: bool,
    pub operation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery_snapshot_id: Option<String>,
    pub revision: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions: Option<BTreeMap<String, String>>,
    pub diff: SnapshotDiffSummary,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceChangeKind {
    Workspace,
    Phonology,
    Lexicon,
    Grammar,
    Sca,
    Corpus,
    Font,
    Snapshots,
    Trash,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceFileChangedEvent {
    pub project_path: String,
    pub operation_id: Option<String>,
    pub origin: String,
    pub language_path: Option<String>,
    pub language_id: Option<String>,
    pub kind: WorkspaceChangeKind,
    pub revisions: BTreeMap<String, String>,
    pub affected_language_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct McpAuditLogEntry {
    pub timestamp: String,
    pub operation_id: String,
    pub tool: String,
    pub origin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family_path: Option<String>,
    #[serde(default)]
    pub language_id: Option<String>,
    pub summary: String,
    #[serde(default)]
    pub snapshot_id: Option<String>,
    pub status: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t1_13_unknown_fields_preserved_across_all_persisted_models_and_aliases() {
        let ws_raw = serde_json::json!({
            "workspace_version": "3.0",
            "unknown_ws_flag": { "nested": 42 },
            "languages": [{
                "language_id": "lang_root",
                "name": "Root",
                "path": "roots/root",
                "parent_id": null,
                "custom_lang_meta": "keep-me"
            }]
        });
        let ws: WorkspaceConfig = serde_json::from_value(ws_raw.clone()).unwrap();
        let ws_out = serde_json::to_value(&ws).unwrap();
        assert_eq!(ws_out["unknown_ws_flag"]["nested"], 42);
        assert_eq!(ws_out["languages"][0]["custom_lang_meta"], "keep-me");

        let word_raw = serde_json::json!({
            "entry_id": "w1",
            "language_id": "lang_root",
            "con_word_romanized": "ata",
            "word_sentinel": true,
            "senses": [{
                "sense_id": "s1",
                "pos": "pos_n",
                "gloss": "water",
                "sense_sentinel": "s_keep"
            }],
            "etymology": {
                "origin_type": "a_priori",
                "etym_sentinel": [1, 2, 3]
            },
            "metadata": {
                "tags": [],
                "meta_sentinel": "m_keep"
            },
            "evolution": {
                "is_deprecated": false,
                "evo_sentinel": "e_keep"
            }
        });
        let word: WordEntry = serde_json::from_value(word_raw).unwrap();
        assert_eq!(word.senses[0].pos_id, "pos_n");
        let word_out = serde_json::to_value(&word).unwrap();
        assert_eq!(word_out["word_sentinel"], true);
        assert_eq!(word_out["senses"][0]["sense_sentinel"], "s_keep");
        assert_eq!(word_out["senses"][0]["pos_id"], "pos_n");
        assert!(word_out["senses"][0].get("pos").is_none());
        assert_eq!(word_out["etymology"]["etym_sentinel"], serde_json::json!([1, 2, 3]));
        assert_eq!(word_out["metadata"]["meta_sentinel"], "m_keep");
        assert_eq!(word_out["evolution"]["evo_sentinel"], "e_keep");

        let gram_raw = serde_json::json!({
            "language_id": "lang_root",
            "gram_sentinel": "g_keep",
            "inflections": [{
                "rule_id": "r1",
                "pos": "pos_v",
                "type": "suffix",
                "tag": "PST",
                "rule_sentinel": 99
            }]
        });
        let gram: GrammarConfig = serde_json::from_value(gram_raw).unwrap();
        assert_eq!(gram.inflection_rules.len(), 1);
        assert_eq!(gram.inflection_rules[0].pos_id, "pos_v");
        let gram_out = serde_json::to_value(&gram).unwrap();
        assert_eq!(gram_out["gram_sentinel"], "g_keep");
        assert_eq!(gram_out["inflection_rules"][0]["rule_sentinel"], 99);
    }
}
