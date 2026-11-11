import { create } from 'zustand';
import { PhonologyConfig, RomanizationMap, AllophonyRule, VowelHarmony, ToneSystem, GlyphAnnotation } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_LANGUAGE_ID } from '../constants';

interface PhonoStore {
  config: PhonologyConfig;
  projectPath: string;
  languagePath: string;
  loading: boolean;
  loadError: string | null;
  saveError: string | null;

  setProjectPath: (path: string) => void;
  setLanguagePath: (path: string) => void;
  loadConfig: (projectPath: string, languagePath: string) => Promise<void>;
  saveConfig: () => void;
  flushSaves: () => Promise<void>;

  // Phoneme inventory
  togglePhoneme: (phoneme: string, kind: 'consonants' | 'vowels') => void;
  setPhonemeInventory: (inventory: { consonants: string[]; vowels: string[] }) => void;

  // Romanization
  setRomanizationMaps: (maps: RomanizationMap[]) => void;
  updateRomanizationMap: (mapId: string, map: RomanizationMap) => void;
  addRomanizationMap: (map: RomanizationMap) => void;
  deleteRomanizationMap: (mapId: string) => void;
  setGlyphAnnotations: (annotations: GlyphAnnotation[]) => void;

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
  glyph_annotations: [],
  phonotactics: {
    macros: {},
    syllable_structure: '(C)V(C)',
    blacklist_patterns: [],
    vowel_harmony: { enabled: false, group_a: [], group_b: [] },
    tone_system: { enabled: false, tones: [] },
  },
  allophony_rules: [],
};

interface PendingSave {
  projectPath: string;
  languagePath: string;
  config: PhonologyConfig;
  timer: ReturnType<typeof setTimeout> | null;
  revision: number;
}
const pendingSaves = new Map<string, PendingSave>();
const saveRevisions = new Map<string, number>();
const writes = new Map<string, Promise<void>>();
const saveErrors = new Map<string, string>();
let loadGeneration = 0;

async function flushSave(key: string): Promise<void> {
  const pending = pendingSaves.get(key);
  if (!pending) return writes.get(key);
  if (pending.timer) clearTimeout(pending.timer);
  pendingSaves.delete(key);
  const write = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await invoke('save_phonology', { projectPath: pending.projectPath, languagePath: pending.languagePath, config: pending.config });
  });
  writes.set(key, write);
  try {
    await write;
    saveErrors.delete(key);
  } catch (error) {
    if (saveRevisions.get(key) === pending.revision && !pendingSaves.has(key)) {
      pendingSaves.set(key, { ...pending, timer: null });
    }
    saveErrors.set(key, `${pending.languagePath}: ${String(error)}`);
    throw error;
  } finally {
    if (writes.get(key) === write) writes.delete(key);
    usePhonoStore.setState({ saveError: saveErrors.size ? [...saveErrors.values()].join("\n") : null });
  }
}

async function flushSaves(): Promise<void> {
  await Promise.all([...new Set([...pendingSaves.keys(), ...writes.keys()])].map(flushSave));
}

const debouncedSave = (projectPath: string, languagePath: string, config: PhonologyConfig) => {
  const key = JSON.stringify([projectPath, languagePath]);
  const previous = pendingSaves.get(key);
  if (previous?.timer) clearTimeout(previous.timer);
  const revision = (saveRevisions.get(key) ?? 0) + 1;
  saveRevisions.set(key, revision);
  const timer = setTimeout(() => { void flushSave(key).catch(() => {}); }, 500);
  pendingSaves.set(key, { projectPath, languagePath, config, timer, revision });
};

export const usePhonoStore = create<PhonoStore>((set, get) => ({
  config: defaultConfig,
  projectPath: '.',
  languagePath: 'proto_language',
  loading: false,
  loadError: null,
  saveError: null,
  flushSaves,

  setProjectPath: (path) => set({ projectPath: path }),
  setLanguagePath: (path) => set({ languagePath: path }),

  loadConfig: async (projectPath: string, languagePath: string) => {
    const generation = ++loadGeneration;
    set({ config: { ...defaultConfig }, projectPath, languagePath, loading: true, loadError: null });
    try {
      await flushSaves();
      if (generation !== loadGeneration) return;
      const loaded = await invoke<PhonologyConfig>('load_phonology', { projectPath, languagePath });
      if (generation !== loadGeneration) return;
      const config: PhonologyConfig = {
        ...loaded,
        romanization_maps: (loaded.romanization_maps ?? []).map((map) => ({
          ...map,
          rules: (map.rules ?? []).map((rule) => ({
            ...rule,
            rule_id: rule.rule_id || crypto.randomUUID(),
          })),
        })),
        glyph_annotations: loaded.glyph_annotations ?? [],
      };
      set({ config, projectPath, languagePath, loading: false });
    } catch (err) {
      if (generation !== loadGeneration) return;
      set({ loading: false, loadError: String(err) });
      throw err;
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

  setGlyphAnnotations: (annotations) => {
    set(state => ({ config: { ...state.config, glyph_annotations: annotations } }));
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
