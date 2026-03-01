import { create } from 'zustand';
import { PhonologyConfig, RomanizationMap, AllophonyRule, VowelHarmony, ToneSystem } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_LANGUAGE_ID } from '../constants';

interface PhonoStore {
  config: PhonologyConfig;
  projectPath: string;
  languagePath: string;

  setProjectPath: (path: string) => void;
  setLanguagePath: (path: string) => void;
  loadConfig: (projectPath: string, languagePath: string) => Promise<void>;
  saveConfig: () => void;

  // Phoneme inventory
  togglePhoneme: (phoneme: string, kind: 'consonants' | 'vowels') => void;
  setPhonemeInventory: (inventory: { consonants: string[]; vowels: string[] }) => void;

  // Romanization
  setRomanizationMaps: (maps: RomanizationMap[]) => void;
  updateRomanizationMap: (mapId: string, map: RomanizationMap) => void;
  addRomanizationMap: (map: RomanizationMap) => void;
  deleteRomanizationMap: (mapId: string) => void;

  // Phonotactics
  updateSyllableStructure: (structure: string) => void;
  updateMacros: (macros: Record<string, string[]>) => void;
  updateBlacklistPatterns: (patterns: string[]) => void;
  updateVowelHarmony: (vh: VowelHarmony) => void;
  updateToneSystem: (ts: ToneSystem) => void;

  // Allophony
  setAllophonyRules: (rules: AllophonyRule[]) => void;
  addAllophonyRule: (rule: AllophonyRule) => void;
  updateAllophonyRule: (ruleId: string, rule: AllophonyRule) => void;
  deleteAllophonyRule: (ruleId: string) => void;
}

const defaultConfig: PhonologyConfig = {
  language_id: DEFAULT_LANGUAGE_ID,
  phoneme_inventory: { consonants: [], vowels: [] },
  romanization_maps: [],
  phonotactics: {
    macros: {},
    syllable_structure: '(C)V(C)',
    blacklist_patterns: [],
    vowel_harmony: { enabled: false, group_a: [], group_b: [] },
    tone_system: { enabled: false, tones: [] },
  },
  allophony_rules: [],
};

/** 单一配置实体，共享 timer 无风险 */
let saveTimeout: ReturnType<typeof setTimeout>;

const debouncedSave = (projectPath: string, languagePath: string, config: PhonologyConfig) => {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await invoke('save_phonology', { projectPath, languagePath, config });
    } catch (err) {
      console.warn(`音系配置保存失败：${err}`);
    }
  }, 500);
};

export const usePhonoStore = create<PhonoStore>((set, get) => ({
  config: defaultConfig,
  projectPath: '.',
  languagePath: 'proto_language',

  setProjectPath: (path) => set({ projectPath: path }),
  setLanguagePath: (path) => set({ languagePath: path }),

  loadConfig: async (projectPath: string, languagePath: string) => {
    try {
      const config = await invoke<PhonologyConfig>('load_phonology', { projectPath, languagePath });
      set({ config, projectPath, languagePath });
    } catch (err) {
      console.error(`加载音系配置失败：${err}`);
    }
  },

  saveConfig: () => {
    const { projectPath, languagePath, config } = get();
    debouncedSave(projectPath, languagePath, config);
  },

  togglePhoneme: (phoneme, kind) => {
    set(state => {
      const list = [...state.config.phoneme_inventory[kind]];
      const idx = list.indexOf(phoneme);
      if (idx >= 0) {
        list.splice(idx, 1);
      } else {
        list.push(phoneme);
      }
      const config = {
        ...state.config,
        phoneme_inventory: { ...state.config.phoneme_inventory, [kind]: list },
      };
      return { config };
    });
    get().saveConfig();
  },

  setPhonemeInventory: (inventory) => {
    set(state => ({
      config: {
        ...state.config,
        phoneme_inventory: { consonants: inventory.consonants, vowels: inventory.vowels },
      },
    }));
    get().saveConfig();
  },

  setRomanizationMaps: (maps) => {
    set(state => ({ config: { ...state.config, romanization_maps: maps } }));
    get().saveConfig();
  },

  updateRomanizationMap: (mapId, map) => {
    set(state => ({
      config: {
        ...state.config,
        romanization_maps: state.config.romanization_maps.map(m =>
          m.map_id === mapId ? map : m
        ),
      },
    }));
    get().saveConfig();
  },

  addRomanizationMap: (map) => {
    set(state => ({
      config: {
        ...state.config,
        romanization_maps: [...state.config.romanization_maps, map],
      },
    }));
    get().saveConfig();
  },

  deleteRomanizationMap: (mapId) => {
    set(state => ({
      config: {
        ...state.config,
        romanization_maps: state.config.romanization_maps.filter(m => m.map_id !== mapId),
      },
    }));
    get().saveConfig();
  },

  updateSyllableStructure: (structure) => {
    set(state => ({
      config: {
        ...state.config,
        phonotactics: { ...state.config.phonotactics, syllable_structure: structure },
      },
    }));
    get().saveConfig();
  },

  updateMacros: (macros) => {
    set(state => ({
      config: {
        ...state.config,
        phonotactics: { ...state.config.phonotactics, macros },
      },
    }));
    get().saveConfig();
  },

  updateBlacklistPatterns: (patterns) => {
    set(state => ({
      config: {
        ...state.config,
        phonotactics: { ...state.config.phonotactics, blacklist_patterns: patterns },
      },
    }));
    get().saveConfig();
  },

  updateVowelHarmony: (vh) => {
    set(state => ({
      config: {
        ...state.config,
        phonotactics: { ...state.config.phonotactics, vowel_harmony: vh },
      },
    }));
    get().saveConfig();
  },

  updateToneSystem: (ts) => {
    set(state => ({
      config: {
        ...state.config,
        phonotactics: { ...state.config.phonotactics, tone_system: ts },
      },
    }));
    get().saveConfig();
  },

  setAllophonyRules: (rules) => {
    set(state => ({ config: { ...state.config, allophony_rules: rules } }));
    get().saveConfig();
  },

  addAllophonyRule: (rule) => {
    set(state => ({
      config: {
        ...state.config,
        allophony_rules: [...state.config.allophony_rules, rule],
      },
    }));
    get().saveConfig();
  },

  updateAllophonyRule: (ruleId, rule) => {
    set(state => ({
      config: {
        ...state.config,
        allophony_rules: state.config.allophony_rules.map(r =>
          r.rule_id === ruleId ? rule : r
        ),
      },
    }));
    get().saveConfig();
  },

  deleteAllophonyRule: (ruleId) => {
    set(state => ({
      config: {
        ...state.config,
        allophony_rules: state.config.allophony_rules.filter(r => r.rule_id !== ruleId),
      },
    }));
    get().saveConfig();
  },
}));
