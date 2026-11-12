import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  AllophonyRule,
  GlyphAnnotation,
  GlyphAnnotationsSource,
  PhonologyConfig,
  PhonologyLoadResult,
  RomanizationMap,
  RomanizationRule,
  ToneSystem,
  VowelHarmony,
  WriteResult,
} from "../types";
import { DEFAULT_LANGUAGE_ID } from "../constants";
import {
  computeJsonDiffSummary,
  generateOperationId,
  isConflictError,
  mergeById,
  recordGuiOperationId,
  useConflictStore,
} from "./conflictStore";

interface PhonoStore {
  /** Effective phonology configuration (includes inherited glyph_annotations when local is empty). */
  config: PhonologyConfig;
  /** Strictly local phonology.json configuration (never contains un-localized parent annotations). */
  localConfig: PhonologyConfig;
  /** Effective phonology configuration alias matching `config`. */
  effectiveConfig: PhonologyConfig;
  /** Cached ancestor glyph annotations when `annotationsSource === 'inherited'`. */
  inheritedGlyphAnnotations: GlyphAnnotation[];
  inheritedAnnotationsOwnerId: string | null;
  annotationsSource: GlyphAnnotationsSource;
  annotationsOwnerId: string | null;
  revision: string;
  effectiveRevision: string;
  dependencies: Record<string, string>;
  legacyFieldsPresent: boolean;
  dirty: boolean;
  paused: boolean;
  projectPath: string;
  languagePath: string;
  loading: boolean;
  loadError: string | null;
  saveError: string | null;

  setProjectPath: (path: string) => void;
  setLanguagePath: (path: string) => void;
  loadConfig: (projectPath: string, languagePath: string) => Promise<void>;
  refreshInheritedFromBackend: (
    projectPath: string,
    languagePath: string,
  ) => Promise<void>;
  saveConfig: () => void;
  flushSaves: () => Promise<void>;
  isDirty: (projectPath?: string, languagePath?: string) => boolean;
  pauseAutoSave: (projectPath: string, languagePath: string) => void;
  triggerExternalConflict: (
    projectPath: string,
    languagePath: string,
    origin?: "gui" | "mcp" | "external",
  ) => Promise<void>;
  localizeInheritedAnnotations: () => void;

  // Phoneme inventory
  togglePhoneme: (phoneme: string, kind: "consonants" | "vowels") => void;
  setPhonemeInventory: (inventory: {
    consonants: string[];
    vowels: string[];
  }) => void;

  // Romanization & glyph annotations
  setRomanizationMaps: (maps: RomanizationMap[]) => void;
  updateRomanizationMap: (mapId: string, map: RomanizationMap) => void;
  addRomanizationMap: (map: RomanizationMap) => void;
  deleteRomanizationMap: (mapId: string) => void;
  setGlyphAnnotations: (annotations: GlyphAnnotation[]) => void;
  setFontFeatures: (features: string[]) => void;

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
    syllable_structure: "(C)V(C)",
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
  operationId: string;
}

const pendingSaves = new Map<string, PendingSave>();
const saveRevisions = new Map<string, number>();
const revisionsByKey = new Map<string, string>();
const pausedKeys = new Set<string>();
const writes = new Map<string, Promise<void>>();
const saveErrors = new Map<string, string>();
let loadGeneration = 0;

function makeKey(projectPath: string, languagePath: string): string {
  return JSON.stringify([projectPath, languagePath]);
}

function normalizeConfig(raw: PhonologyConfig): PhonologyConfig {
  const defaultPt = defaultConfig.phonotactics;
  const rawPt = raw.phonotactics ?? defaultPt;
  return {
    ...defaultConfig,
    ...raw,
    phoneme_inventory: {
      ...(raw.phoneme_inventory ?? {}),
      consonants: raw.phoneme_inventory?.consonants ?? [],
      vowels: raw.phoneme_inventory?.vowels ?? [],
    },
    romanization_maps: (raw.romanization_maps ?? []).map((map) => ({
      ...map,
      rules: (map.rules ?? []).map((rule) => ({
        ...rule,
        rule_id: rule.rule_id || generateOperationId(),
      })),
    })),
    glyph_annotations: raw.glyph_annotations ?? [],
    phonotactics: {
      ...defaultPt,
      ...rawPt,
      macros: rawPt.macros ?? {},
      syllable_structure: rawPt.syllable_structure ?? defaultPt.syllable_structure,
      blacklist_patterns: rawPt.blacklist_patterns ?? [],
      vowel_harmony: {
        ...defaultPt.vowel_harmony,
        ...(rawPt.vowel_harmony ?? {}),
      },
      tone_system: {
        ...defaultPt.tone_system,
        ...(rawPt.tone_system ?? {}),
        tones: rawPt.tone_system?.tones ?? [],
      },
    },
    allophony_rules: raw.allophony_rules ?? [],
  };
}

function deriveEffectiveState(
  localConfig: PhonologyConfig,
  inheritedAnnotations: GlyphAnnotation[],
  inheritedOwnerId: string | null,
  preferredLocalSource: GlyphAnnotationsSource = "local",
): {
  effectiveConfig: PhonologyConfig;
  annotationsSource: GlyphAnnotationsSource;
  annotationsOwnerId: string | null;
} {
  const localNotes = localConfig.glyph_annotations ?? [];
  if (localNotes.length > 0) {
    const effectiveConfig: PhonologyConfig = {
      ...localConfig,
      glyph_annotations: localNotes,
    };
    const source: GlyphAnnotationsSource =
      preferredLocalSource === "legacy_migrated" ? "legacy_migrated" : "local";
    return {
      effectiveConfig,
      annotationsSource: source,
      annotationsOwnerId: localConfig.language_id,
    };
  }
  if (inheritedAnnotations.length > 0) {
    return {
      effectiveConfig: {
        ...localConfig,
        glyph_annotations: inheritedAnnotations,
      },
      annotationsSource: "inherited",
      annotationsOwnerId: inheritedOwnerId,
    };
  }
  return {
    effectiveConfig: {
      ...localConfig,
      glyph_annotations: [],
    },
    annotationsSource: "none",
    annotationsOwnerId: null,
  };
}

function getBaseLocalConfig(state: PhonoStore): PhonologyConfig {
  // Support direct `store.setState({ config })` in legacy unit tests while
  // keeping `localConfig` authoritative whenever `config === effectiveConfig`.
  if (state.config !== state.effectiveConfig) {
    return state.config;
  }
  return state.localConfig;
}

function mergeRomanizationRules(
  existingRules: readonly RomanizationRule[] | undefined,
  incomingRules: readonly RomanizationRule[],
): RomanizationRule[] {
  return mergeById(existingRules, incomingRules, "rule_id");
}

function mergeRomanizationMaps(
  existingMaps: readonly RomanizationMap[] | undefined,
  incomingMaps: readonly RomanizationMap[],
): RomanizationMap[] {
  return mergeById(existingMaps, incomingMaps, "map_id", (prev, next) => ({
    ...prev,
    ...next,
    rules: mergeRomanizationRules(prev.rules, next.rules),
  }));
}

function syncStoreFlags(projectPath: string, languagePath: string): void {
  const state = usePhonoStore.getState();
  if (state.projectPath !== projectPath || state.languagePath !== languagePath) {
    return;
  }
  const key = makeKey(projectPath, languagePath);
  usePhonoStore.setState({
    dirty: pendingSaves.has(key) || writes.has(key),
    paused: pausedKeys.has(key),
  });
}

async function openPhonoConflict(
  projectPath: string,
  languagePath: string,
  localCandidate: PhonologyConfig,
  origin: "gui" | "mcp" | "external",
  reason: string,
): Promise<void> {
  const key = makeKey(projectPath, languagePath);
  pausedKeys.add(key);
  const existingPending = pendingSaves.get(key);
  if (existingPending?.timer) {
    clearTimeout(existingPending.timer);
    pendingSaves.set(key, { ...existingPending, timer: null });
  }
  syncStoreFlags(projectPath, languagePath);

  let diskRevision = revisionsByKey.get(key) ?? "";
  let diskConfig: unknown = null;
  let languageId: string | null = localCandidate.language_id || null;
  try {
    const loaded = await invoke<PhonologyLoadResult>("load_phonology", {
      projectPath,
      languagePath,
    });
    if (loaded) {
      diskRevision = loaded.revision || diskRevision;
      const rawDisk = loaded.local_config ?? loaded.config;
      diskConfig = rawDisk;
      languageId = rawDisk?.language_id ?? languageId;
    }
  } catch (err) {
    console.warn("Failed to read disk phonology for conflict modal:", err);
  }

  const diff = computeJsonDiffSummary(localCandidate, diskConfig);
  const conflictKey = `phonology:${key}`;
  useConflictStore.getState().upsertConflict(
    {
      key: conflictKey,
      kind: "phonology",
      projectPath,
      languagePath,
      languageId,
      corpusId: null,
      origin,
      diskRevision,
      reason,
      changedFields: diff.changedFields,
      localPreview: diff.localPreview,
      diskPreview: diff.diskPreview,
    },
    {
      keepLocal: async (confirmedDiskRevision: string) => {
        revisionsByKey.set(key, confirmedDiskRevision);
        pausedKeys.delete(key);
        saveErrors.delete(key);
        const currentState = usePhonoStore.getState();
        const latestLocal =
          currentState.projectPath === projectPath &&
          currentState.languagePath === languagePath
            ? getBaseLocalConfig(currentState)
            : (pendingSaves.get(key)?.config ?? localCandidate);
        if (
          currentState.projectPath === projectPath &&
          currentState.languagePath === languagePath
        ) {
          usePhonoStore.setState({
            revision: confirmedDiskRevision,
            paused: false,
            saveError: saveErrors.size ? [...saveErrors.values()].join("\n") : null,
          });
        }
        const revNum = (saveRevisions.get(key) ?? 0) + 1;
        saveRevisions.set(key, revNum);
        pendingSaves.set(key, {
          projectPath,
          languagePath,
          config: latestLocal,
          timer: null,
          revision: revNum,
          operationId: generateOperationId(),
        });
        await flushSave(key);
      },
      useDisk: async () => {
        const pending = pendingSaves.get(key);
        if (pending?.timer) clearTimeout(pending.timer);
        pendingSaves.delete(key);
        pausedKeys.delete(key);
        saveErrors.delete(key);
        usePhonoStore.setState({
          paused: false,
          dirty: false,
          saveError: saveErrors.size ? [...saveErrors.values()].join("\n") : null,
        });
        const currentState = usePhonoStore.getState();
        if (
          currentState.projectPath === projectPath &&
          currentState.languagePath === languagePath
        ) {
          await usePhonoStore.getState().loadConfig(projectPath, languagePath);
        }
      },
    },
  );
}

async function flushSave(key: string): Promise<void> {
  if (pausedKeys.has(key)) return writes.get(key);
  const pending = pendingSaves.get(key);
  if (!pending) return writes.get(key);
  if (pending.timer) clearTimeout(pending.timer);
  pendingSaves.delete(key);

  const expectedRevision = revisionsByKey.get(key) || undefined;
  recordGuiOperationId(pending.operationId);

  const write = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const args: {
        projectPath: string;
        languagePath: string;
        config: PhonologyConfig;
        expectedRevision?: string;
        operationId: string;
      } = {
        projectPath: pending.projectPath,
        languagePath: pending.languagePath,
        config: pending.config,
        operationId: pending.operationId,
      };
      if (expectedRevision) {
        args.expectedRevision = expectedRevision;
      }
      const res = await invoke<WriteResult | undefined>("save_phonology", args);
      if (res && typeof res.revision === "string" && res.revision.length > 0) {
        revisionsByKey.set(key, res.revision);
        const cur = usePhonoStore.getState();
        if (
          cur.projectPath === pending.projectPath &&
          cur.languagePath === pending.languagePath
        ) {
          usePhonoStore.setState({
            revision: res.revision,
            legacyFieldsPresent: false,
          });
        }
      }
    });
  writes.set(key, write);
  try {
    await write;
    saveErrors.delete(key);
  } catch (error) {
    if (saveRevisions.get(key) === pending.revision && !pendingSaves.has(key)) {
      pendingSaves.set(key, { ...pending, timer: null });
    }
    if (isConflictError(error)) {
      await openPhonoConflict(
        pending.projectPath,
        pending.languagePath,
        pending.config,
        "gui",
        String(error),
      );
      return;
    }
    saveErrors.set(key, `${pending.languagePath}: ${String(error)}`);
    throw error;
  } finally {
    if (writes.get(key) === write) writes.delete(key);
    syncStoreFlags(pending.projectPath, pending.languagePath);
    usePhonoStore.setState({
      saveError: saveErrors.size ? [...saveErrors.values()].join("\n") : null,
    });
  }
}

async function flushSaves(): Promise<void> {
  await Promise.all(
    [...new Set([...pendingSaves.keys(), ...writes.keys()])].map(flushSave),
  );
}

const debouncedSave = (
  projectPath: string,
  languagePath: string,
  config: PhonologyConfig,
) => {
  const key = makeKey(projectPath, languagePath);
  const previous = pendingSaves.get(key);
  if (previous?.timer) clearTimeout(previous.timer);
  const revision = (saveRevisions.get(key) ?? 0) + 1;
  saveRevisions.set(key, revision);
  const operationId = generateOperationId();
  const timer = pausedKeys.has(key)
    ? null
    : setTimeout(() => {
        void flushSave(key).catch(() => {});
      }, 500);
  pendingSaves.set(key, {
    projectPath,
    languagePath,
    config,
    timer,
    revision,
    operationId,
  });
  syncStoreFlags(projectPath, languagePath);
};

function applyLocalUpdate(
  state: PhonoStore,
  updater: (baseLocal: PhonologyConfig) => PhonologyConfig,
  preferredLocalSource?: GlyphAnnotationsSource,
): Partial<PhonoStore> {
  const baseLocal = getBaseLocalConfig(state);
  const nextLocal = updater(baseLocal);
  const derived = deriveEffectiveState(
    nextLocal,
    state.inheritedGlyphAnnotations,
    state.inheritedAnnotationsOwnerId,
    preferredLocalSource ?? state.annotationsSource,
  );
  return {
    localConfig: nextLocal,
    effectiveConfig: derived.effectiveConfig,
    config: derived.effectiveConfig,
    annotationsSource: derived.annotationsSource,
    annotationsOwnerId: derived.annotationsOwnerId,
  };
}

export const usePhonoStore = create<PhonoStore>((set, get) => ({
  config: defaultConfig,
  localConfig: defaultConfig,
  effectiveConfig: defaultConfig,
  inheritedGlyphAnnotations: [],
  inheritedAnnotationsOwnerId: null,
  annotationsSource: "none",
  annotationsOwnerId: null,
  revision: "",
  effectiveRevision: "",
  dependencies: {},
  legacyFieldsPresent: false,
  dirty: false,
  paused: false,
  projectPath: ".",
  languagePath: "proto_language",
  loading: false,
  loadError: null,
  saveError: null,
  flushSaves,

  isDirty: (projectPath, languagePath) => {
    const p = projectPath ?? get().projectPath;
    const l = languagePath ?? get().languagePath;
    const key = makeKey(p, l);
    return pendingSaves.has(key) || writes.has(key);
  },

  pauseAutoSave: (projectPath, languagePath) => {
    const key = makeKey(projectPath, languagePath);
    pausedKeys.add(key);
    const pending = pendingSaves.get(key);
    if (pending?.timer) {
      clearTimeout(pending.timer);
      pendingSaves.set(key, { ...pending, timer: null });
    }
    syncStoreFlags(projectPath, languagePath);
  },

  triggerExternalConflict: async (
    projectPath,
    languagePath,
    origin = "external",
  ) => {
    const state = get();
    const key = makeKey(projectPath, languagePath);
    const localCandidate =
      state.projectPath === projectPath && state.languagePath === languagePath
        ? getBaseLocalConfig(state)
        : (pendingSaves.get(key)?.config ?? defaultConfig);
    await openPhonoConflict(
      projectPath,
      languagePath,
      localCandidate,
      origin,
      "External phonology modification detected while local edits are unsaved.",
    );
  },

  setProjectPath: (path) => set({ projectPath: path }),
  setLanguagePath: (path) => set({ languagePath: path }),

  loadConfig: async (projectPath: string, languagePath: string) => {
    const generation = ++loadGeneration;
    const empty = { ...defaultConfig };
    set({
      config: empty,
      localConfig: empty,
      effectiveConfig: empty,
      inheritedGlyphAnnotations: [],
      inheritedAnnotationsOwnerId: null,
      annotationsSource: "none",
      annotationsOwnerId: null,
      projectPath,
      languagePath,
      loading: true,
      loadError: null,
    });
    try {
      await flushSaves();
      if (generation !== loadGeneration) return;
      const result = await invoke<PhonologyLoadResult>("load_phonology", {
        projectPath,
        languagePath,
      });
      if (generation !== loadGeneration) return;

      const rawEffective = normalizeConfig(
        result.effective_config ?? result.config,
      );
      const rawLocal = result.local_config
        ? normalizeConfig(result.local_config)
        : normalizeConfig(result.config);

      const reportedSource: GlyphAnnotationsSource =
        result.annotations_source ??
        ((rawLocal.glyph_annotations?.length ?? 0) > 0
          ? "local"
          : (rawEffective.glyph_annotations?.length ?? 0) > 0
            ? "inherited"
            : "none");

      const localClean: PhonologyConfig =
        reportedSource === "inherited"
          ? { ...rawLocal, glyph_annotations: [] }
          : rawLocal;

      const inheritedAnnotations: GlyphAnnotation[] =
        reportedSource === "inherited"
          ? (rawEffective.glyph_annotations ?? [])
          : [];
      const inheritedOwnerId: string | null =
        reportedSource === "inherited"
          ? (result.annotations_owner_id ?? null)
          : null;

      const derived = deriveEffectiveState(
        localClean,
        inheritedAnnotations,
        inheritedOwnerId,
        reportedSource,
      );

      const key = makeKey(projectPath, languagePath);
      if (result.revision) {
        revisionsByKey.set(key, result.revision);
      }
      pausedKeys.delete(key);

      set({
        localConfig: localClean,
        effectiveConfig: derived.effectiveConfig,
        config: derived.effectiveConfig,
        inheritedGlyphAnnotations: inheritedAnnotations,
        inheritedAnnotationsOwnerId: inheritedOwnerId,
        annotationsSource: derived.annotationsSource,
        annotationsOwnerId:
          result.annotations_owner_id !== undefined
            ? result.annotations_owner_id
            : derived.annotationsOwnerId,
        revision: result.revision ?? "",
        effectiveRevision: result.effective_revision ?? result.revision ?? "",
        dependencies: result.dependencies ?? {},
        legacyFieldsPresent: Boolean(result.legacy_fields_present),
        dirty: pendingSaves.has(key) || writes.has(key),
        paused: false,
        projectPath,
        languagePath,
        loading: false,
      });
    } catch (err) {
      if (generation !== loadGeneration) return;
      set({ loading: false, loadError: String(err) });
      throw err;
    }
  },

  refreshInheritedFromBackend: async (
    projectPath: string,
    languagePath: string,
  ) => {
    try {
      const result = await invoke<PhonologyLoadResult>("load_phonology", {
        projectPath,
        languagePath,
      });
      const cur = get();
      if (cur.projectPath !== projectPath || cur.languagePath !== languagePath) {
        return;
      }
      const rawEffective = normalizeConfig(
        result.effective_config ?? result.config,
      );
      const inheritedAnnotations =
        result.annotations_source === "inherited"
          ? (rawEffective.glyph_annotations ?? [])
          : [];
      const inheritedOwnerId =
        result.annotations_source === "inherited"
          ? (result.annotations_owner_id ?? null)
          : null;
      const baseLocal = getBaseLocalConfig(cur);
      const derived = deriveEffectiveState(
        baseLocal,
        inheritedAnnotations,
        inheritedOwnerId,
        cur.annotationsSource,
      );
      set({
        effectiveConfig: derived.effectiveConfig,
        config: derived.effectiveConfig,
        inheritedGlyphAnnotations: inheritedAnnotations,
        inheritedAnnotationsOwnerId: inheritedOwnerId,
        annotationsSource: derived.annotationsSource,
        annotationsOwnerId: derived.annotationsOwnerId,
        effectiveRevision: result.effective_revision ?? cur.effectiveRevision,
        dependencies: result.dependencies ?? cur.dependencies,
      });
    } catch (err) {
      console.warn("Failed to refresh inherited phonology state:", err);
    }
  },

  saveConfig: () => {
    const state = get();
    const localToSave = getBaseLocalConfig(state);
    debouncedSave(state.projectPath, state.languagePath, localToSave);
  },

  localizeInheritedAnnotations: () => {
    set((state) => {
      const sourceNotes = state.effectiveConfig.glyph_annotations ?? [];
      if (sourceNotes.length === 0) return state;
      const copied = sourceNotes.map((item) => ({ ...item }));
      return applyLocalUpdate(
        state,
        (baseLocal) => ({
          ...baseLocal,
          glyph_annotations: copied,
        }),
        "local",
      );
    });
    get().saveConfig();
  },

  togglePhoneme: (phoneme, kind) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => {
        const list = [...baseLocal.phoneme_inventory[kind]];
        const idx = list.indexOf(phoneme);
        if (idx >= 0) {
          list.splice(idx, 1);
        } else {
          list.push(phoneme);
        }
        return {
          ...baseLocal,
          phoneme_inventory: {
            ...baseLocal.phoneme_inventory,
            [kind]: list,
          },
        };
      }),
    );
    get().saveConfig();
  },

  setPhonemeInventory: (inventory) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        phoneme_inventory: {
          ...baseLocal.phoneme_inventory,
          consonants: inventory.consonants,
          vowels: inventory.vowels,
        },
      })),
    );
    get().saveConfig();
  },

  setRomanizationMaps: (maps) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        romanization_maps: mergeRomanizationMaps(
          baseLocal.romanization_maps,
          maps,
        ),
      })),
    );
    get().saveConfig();
  },

  updateRomanizationMap: (mapId, map) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        romanization_maps: baseLocal.romanization_maps.map((m) =>
          m.map_id === mapId
            ? {
                ...m,
                ...map,
                rules: mergeRomanizationRules(m.rules, map.rules),
              }
            : m,
        ),
      })),
    );
    get().saveConfig();
  },

  addRomanizationMap: (map) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        romanization_maps: [...baseLocal.romanization_maps, map],
      })),
    );
    get().saveConfig();
  },

  deleteRomanizationMap: (mapId) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        romanization_maps: baseLocal.romanization_maps.filter(
          (m) => m.map_id !== mapId,
        ),
      })),
    );
    get().saveConfig();
  },

  setGlyphAnnotations: (annotations) => {
    set((state) =>
      applyLocalUpdate(
        state,
        (baseLocal) => {
          const fallbackPool = [
            ...(baseLocal.glyph_annotations ?? []),
            ...(state.effectiveConfig.glyph_annotations ?? []),
          ];
          const merged = mergeById(fallbackPool, annotations, "codepoint");
          return {
            ...baseLocal,
            glyph_annotations: merged,
          };
        },
        "local",
      ),
    );
    get().saveConfig();
  },

  setFontFeatures: (features) => {
    set((state) => applyLocalUpdate(state, (baseLocal) => ({
      ...baseLocal,
      font_features: [...features],
    })));
    get().saveConfig();
  },

  updateSyllableStructure: (structure) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        phonotactics: {
          ...baseLocal.phonotactics,
          syllable_structure: structure,
        },
      })),
    );
    get().saveConfig();
  },

  updateMacros: (macros) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        phonotactics: { ...baseLocal.phonotactics, macros },
      })),
    );
    get().saveConfig();
  },

  updateBlacklistPatterns: (patterns) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        phonotactics: {
          ...baseLocal.phonotactics,
          blacklist_patterns: patterns,
        },
      })),
    );
    get().saveConfig();
  },

  updateVowelHarmony: (vh) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        phonotactics: {
          ...baseLocal.phonotactics,
          vowel_harmony: { ...baseLocal.phonotactics.vowel_harmony, ...vh },
        },
      })),
    );
    get().saveConfig();
  },

  updateToneSystem: (ts) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        phonotactics: {
          ...baseLocal.phonotactics,
          tone_system: {
            ...baseLocal.phonotactics.tone_system,
            ...ts,
            tones: mergeById(
              baseLocal.phonotactics.tone_system?.tones,
              ts.tones,
              "tone_id",
            ),
          },
        },
      })),
    );
    get().saveConfig();
  },

  setAllophonyRules: (rules) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        allophony_rules: mergeById(
          baseLocal.allophony_rules,
          rules,
          "rule_id",
        ),
      })),
    );
    get().saveConfig();
  },

  addAllophonyRule: (rule) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        allophony_rules: [...baseLocal.allophony_rules, rule],
      })),
    );
    get().saveConfig();
  },

  updateAllophonyRule: (ruleId, rule) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        allophony_rules: baseLocal.allophony_rules.map((r) =>
          r.rule_id === ruleId ? { ...r, ...rule } : r,
        ),
      })),
    );
    get().saveConfig();
  },

  deleteAllophonyRule: (ruleId) => {
    set((state) =>
      applyLocalUpdate(state, (baseLocal) => ({
        ...baseLocal,
        allophony_rules: baseLocal.allophony_rules.filter(
          (r) => r.rule_id !== ruleId,
        ),
      })),
    );
    get().saveConfig();
  },
}));
