import { create } from 'zustand';
import {
  GrammarConfig,
  InflectionRule,
  InflectionDimension,
  DerivationRule,
  GrammarChapter,
  PartOfSpeech,
  SyntaxConfig,
  MorphologyType,
  TypologyConfig,
  AffixSlot,
  ConjugationClass,
  IrregularOverride,
} from '../types';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_LANGUAGE_ID } from '../constants';

interface GrammarStore {
  config: GrammarConfig;
  projectPath: string;
  languagePath: string;

  setProjectPath: (path: string) => void;
  setLanguagePath: (path: string) => void;
  loadConfig: (projectPath: string, languagePath: string) => Promise<void>;
  saveConfig: () => void;

  // Syntax
  updateSyntax: (syntax: SyntaxConfig) => void;

  // Typology
  updateTypology: (typology: TypologyConfig) => void;

  // Affix slots (agglutinative)
  setAffixSlots: (slots: AffixSlot[]) => void;

  // Conjugation classes (fusional)
  setConjugationClasses: (classes: ConjugationClass[]) => void;

  // Irregular overrides (fusional)
  setIrregularOverrides: (overrides: IrregularOverride[]) => void;

  // Parts of Speech
  addPartOfSpeech: (pos: PartOfSpeech) => void;
  updatePartOfSpeech: (posId: string, pos: PartOfSpeech) => void;
  deletePartOfSpeech: (posId: string) => void;
  setPartsOfSpeech: (parts: PartOfSpeech[]) => void;

  // Inflection rules
  addInflection: (rule: InflectionRule) => void;
  updateInflection: (ruleId: string, rule: InflectionRule) => void;
  deleteInflection: (ruleId: string) => void;
  setInflections: (rules: InflectionRule[]) => void;

  // Inflection dimensions (Phase 2)
  addDimension: (dim: InflectionDimension) => void;
  updateDimension: (dimId: string, dim: InflectionDimension) => void;
  deleteDimension: (dimId: string) => void;

  // Derivation rules (Phase 2)
  addDerivation: (rule: DerivationRule) => void;
  updateDerivation: (ruleId: string, rule: DerivationRule) => void;
  deleteDerivation: (ruleId: string) => void;
  setDerivations: (rules: DerivationRule[]) => void;

  // Grammar manual (Phase 2)
  addChapter: (chapter: GrammarChapter) => void;
  updateChapter: (chapterId: string, chapter: GrammarChapter) => void;
  deleteChapter: (chapterId: string) => void;
  reorderChapters: (chapters: GrammarChapter[]) => void;
}

const DEFAULT_TYPOLOGY: TypologyConfig = {
  morphological_type: 'fusional',
  synthesis_index: 2.0,
  fusion_index: 2.0,
  head_marking: 'dependent',
  auto_estimated: true,
};

const defaultConfig: GrammarConfig = {
  language_id: DEFAULT_LANGUAGE_ID,
  syntax: {
    word_order: 'SVO',
    modifier_position: 'before_head',
    adposition_type: 'preposition',
  },
  parts_of_speech: [
    { pos_id: 'pos_noun', name: 'Noun', gloss_abbr: 'n', word_pattern: '', requires_definition: true, requires_pronunciation: false },
    { pos_id: 'pos_verb', name: 'Verb', gloss_abbr: 'v', word_pattern: '', requires_definition: true, requires_pronunciation: false },
    { pos_id: 'pos_adj', name: 'Adjective', gloss_abbr: 'adj', word_pattern: '', requires_definition: false, requires_pronunciation: false },
    { pos_id: 'pos_adv', name: 'Adverb', gloss_abbr: 'adv', word_pattern: '', requires_definition: false, requires_pronunciation: false },
    { pos_id: 'pos_pron', name: 'Pronoun', gloss_abbr: 'pron', word_pattern: '', requires_definition: false, requires_pronunciation: false },
    { pos_id: 'pos_prep', name: 'Preposition', gloss_abbr: 'prep', word_pattern: '', requires_definition: false, requires_pronunciation: false },
    { pos_id: 'pos_conj', name: 'Conjunction', gloss_abbr: 'conj', word_pattern: '', requires_definition: false, requires_pronunciation: false },
    { pos_id: 'pos_interj', name: 'Interjection', gloss_abbr: 'interj', word_pattern: '', requires_definition: false, requires_pronunciation: false },
  ],
  inflection_dimensions: [],
  inflection_rules: [],
  derivation_rules: [],
  grammar_manual: [],
  typology: DEFAULT_TYPOLOGY,
  affix_slots: [],
  conjugation_classes: [],
  irregular_overrides: [],
};

/** 单一配置实体，共享 timer 无风险 */
let saveTimeout: ReturnType<typeof setTimeout>;

const debouncedSave = (projectPath: string, languagePath: string, config: GrammarConfig) => {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await invoke('save_grammar', { projectPath, languagePath, config });
    } catch (err) {
      console.warn(`语法配置保存失败：${err}`);
    }
  }, 500);
};

/** Phase 1 → Phase 2 → Typology 数据迁移：补充缺失的新字段 */
interface RawGrammarConfig {
  language_id?: string;
  syntax?: SyntaxConfig;
  parts_of_speech?: PartOfSpeech[];
  inflection_dimensions?: InflectionDimension[];
  inflection_rules?: RawInflectionRule[];
  inflections?: RawInflectionRule[];
  derivation_rules?: DerivationRule[];
  grammar_manual?: GrammarChapter[];
  typology?: TypologyConfig;
  affix_slots?: AffixSlot[];
  conjugation_classes?: ConjugationClass[];
  irregular_overrides?: IrregularOverride[];
}

/** Phase 1 遗留格式：缺少 dimension_values / condition 等字段 */
interface RawInflectionRule {
  rule_id: string;
  pos_id: string;
  dimension_values?: Record<string, string>;
  type: MorphologyType | string;
  affix: string;
  tag: string;
  match_regex?: string;
  disabled?: boolean;
  condition?: InflectionRule['condition'];
  infix_config?: InflectionRule['infix_config'];
  circumfix_config?: InflectionRule['circumfix_config'];
  reduplication_config?: InflectionRule['reduplication_config'];
  ablaut_config?: InflectionRule['ablaut_config'];
  slot_id?: string;
  conjugation_class_id?: string;
  fused_dimensions?: Record<string, string>[];
}

function migrateInflectionRule(raw: RawInflectionRule): InflectionRule {
  return {
    rule_id: raw.rule_id,
    pos_id: raw.pos_id,
    dimension_values: raw.dimension_values ?? {},
    type: (raw.type as MorphologyType) || 'suffix',
    affix: raw.affix ?? '',
    tag: raw.tag ?? '',
    match_regex: raw.match_regex ?? '.*',
    disabled: raw.disabled ?? false,
    condition: raw.condition ?? null,
    infix_config: raw.infix_config,
    circumfix_config: raw.circumfix_config,
    reduplication_config: raw.reduplication_config,
    ablaut_config: raw.ablaut_config,
    slot_id: raw.slot_id,
    conjugation_class_id: raw.conjugation_class_id,
    fused_dimensions: raw.fused_dimensions,
  };
}

export const useGrammarStore = create<GrammarStore>((set, get) => ({
  config: defaultConfig,
  projectPath: '.',
  languagePath: 'proto_language',

  setProjectPath: (path) => set({ projectPath: path }),
  setLanguagePath: (path) => set({ languagePath: path }),

  loadConfig: async (projectPath: string, languagePath: string) => {
    try {
      const raw = await invoke<RawGrammarConfig>('load_grammar', { projectPath, languagePath });
      const rawRules = raw.inflection_rules || raw.inflections || [];
      const config: GrammarConfig = {
        language_id: raw.language_id || DEFAULT_LANGUAGE_ID,
        syntax: raw.syntax || defaultConfig.syntax,
        parts_of_speech: raw.parts_of_speech?.length ? raw.parts_of_speech : defaultConfig.parts_of_speech,
        inflection_dimensions: raw.inflection_dimensions || [],
        inflection_rules: rawRules.map(migrateInflectionRule),
        derivation_rules: raw.derivation_rules || [],
        grammar_manual: raw.grammar_manual || [],
        typology: raw.typology ? { ...DEFAULT_TYPOLOGY, ...raw.typology } : DEFAULT_TYPOLOGY,
        affix_slots: raw.affix_slots || [],
        conjugation_classes: raw.conjugation_classes || [],
        irregular_overrides: raw.irregular_overrides || [],
      };
      set({ config, projectPath, languagePath });
    } catch (err) {
      console.warn(`加载语法配置失败：${err}`);
    }
  },

  saveConfig: () => {
    const { projectPath, languagePath, config } = get();
    debouncedSave(projectPath, languagePath, config);
  },

  updateSyntax: (syntax) => {
    set(state => ({ config: { ...state.config, syntax } }));
    get().saveConfig();
  },

  updateTypology: (typology) => {
    set(state => ({ config: { ...state.config, typology } }));
    get().saveConfig();
  },

  setAffixSlots: (slots) => {
    set(state => ({ config: { ...state.config, affix_slots: slots } }));
    get().saveConfig();
  },

  setConjugationClasses: (classes) => {
    set(state => ({ config: { ...state.config, conjugation_classes: classes } }));
    get().saveConfig();
  },

  setIrregularOverrides: (overrides) => {
    set(state => ({ config: { ...state.config, irregular_overrides: overrides } }));
    get().saveConfig();
  },

  // ── Parts of Speech ────────────────────────────────────

  addPartOfSpeech: (pos) => {
    set(state => ({
      config: { ...state.config, parts_of_speech: [...state.config.parts_of_speech, pos] },
    }));
    get().saveConfig();
  },

  updatePartOfSpeech: (posId, pos) => {
    set(state => ({
      config: {
        ...state.config,
        parts_of_speech: state.config.parts_of_speech.map(p => p.pos_id === posId ? pos : p),
      },
    }));
    get().saveConfig();
  },

  deletePartOfSpeech: (posId) => {
    set(state => ({
      config: {
        ...state.config,
        parts_of_speech: state.config.parts_of_speech.filter(p => p.pos_id !== posId),
      },
    }));
    get().saveConfig();
  },

  setPartsOfSpeech: (parts) => {
    set(state => ({ config: { ...state.config, parts_of_speech: parts } }));
    get().saveConfig();
  },

  // ── Inflection rules ──────────────────────────────────

  addInflection: (rule) => {
    set(state => ({
      config: { ...state.config, inflection_rules: [...state.config.inflection_rules, rule] },
    }));
    get().saveConfig();
  },

  updateInflection: (ruleId, rule) => {
    set(state => ({
      config: {
        ...state.config,
        inflection_rules: state.config.inflection_rules.map(r => r.rule_id === ruleId ? rule : r),
      },
    }));
    get().saveConfig();
  },

  deleteInflection: (ruleId) => {
    set(state => ({
      config: {
        ...state.config,
        inflection_rules: state.config.inflection_rules.filter(r => r.rule_id !== ruleId),
      },
    }));
    get().saveConfig();
  },

  setInflections: (rules) => {
    set(state => ({ config: { ...state.config, inflection_rules: rules } }));
    get().saveConfig();
  },

  // ── Inflection dimensions (Phase 2) ───────────────────

  addDimension: (dim) => {
    set(state => ({
      config: { ...state.config, inflection_dimensions: [...state.config.inflection_dimensions, dim] },
    }));
    get().saveConfig();
  },

  updateDimension: (dimId, dim) => {
    set(state => ({
      config: {
        ...state.config,
        inflection_dimensions: state.config.inflection_dimensions.map(d => d.dim_id === dimId ? dim : d),
      },
    }));
    get().saveConfig();
  },

  deleteDimension: (dimId) => {
    set(state => ({
      config: {
        ...state.config,
        inflection_dimensions: state.config.inflection_dimensions.filter(d => d.dim_id !== dimId),
      },
    }));
    get().saveConfig();
  },

  // ── Derivation rules (Phase 2) ────────────────────────

  addDerivation: (rule) => {
    set(state => ({
      config: { ...state.config, derivation_rules: [...state.config.derivation_rules, rule] },
    }));
    get().saveConfig();
  },

  updateDerivation: (ruleId, rule) => {
    set(state => ({
      config: {
        ...state.config,
        derivation_rules: state.config.derivation_rules.map(r => r.rule_id === ruleId ? rule : r),
      },
    }));
    get().saveConfig();
  },

  deleteDerivation: (ruleId) => {
    set(state => ({
      config: {
        ...state.config,
        derivation_rules: state.config.derivation_rules.filter(r => r.rule_id !== ruleId),
      },
    }));
    get().saveConfig();
  },

  setDerivations: (rules) => {
    set(state => ({ config: { ...state.config, derivation_rules: rules } }));
    get().saveConfig();
  },

  // ── Grammar manual (Phase 2) ──────────────────────────

  addChapter: (chapter) => {
    set(state => ({
      config: { ...state.config, grammar_manual: [...state.config.grammar_manual, chapter] },
    }));
    get().saveConfig();
  },

  updateChapter: (chapterId, chapter) => {
    set(state => ({
      config: {
        ...state.config,
        grammar_manual: state.config.grammar_manual.map(c => c.chapter_id === chapterId ? chapter : c),
      },
    }));
    get().saveConfig();
  },

  deleteChapter: (chapterId) => {
    set(state => ({
      config: {
        ...state.config,
        grammar_manual: state.config.grammar_manual.filter(c => c.chapter_id !== chapterId),
      },
    }));
    get().saveConfig();
  },

  reorderChapters: (chapters) => {
    set(state => ({ config: { ...state.config, grammar_manual: chapters } }));
    get().saveConfig();
  },
}));
