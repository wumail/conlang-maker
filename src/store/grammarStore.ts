import { create } from "zustand";
import { recordConfigChange } from "./configHistory";
import type { HistoryOpts } from "./undoManager";
import { invoke } from "@tauri-apps/api/core";
import {
  AffixSlot,
  ConjugationClass,
  DerivationRule,
  GrammarChapter,
  GrammarConfig,
  GrammarLoadResult,
  InflectionDimension,
  InflectionRule,
  IrregularOverride,
  MorphologyType,
  MorphophonologyRule,
  PartOfSpeech,
  SyntaxConfig,
  TypologyConfig,
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

interface GrammarStore {
  config: GrammarConfig;
  projectPath: string;
  languagePath: string;
  revision: string;
  dirty: boolean;
  paused: boolean;

  setProjectPath: (path: string) => void;
  setLanguagePath: (path: string) => void;
  loadConfig: (projectPath: string, languagePath: string) => Promise<void>;
  saveConfig: () => void;
  flushSaves: () => Promise<void>;
  isDirty: (projectPath?: string, languagePath?: string) => boolean;
  pauseAutoSave: (projectPath?: string, languagePath?: string) => void;
  triggerExternalConflict: (
    projectPath: string,
    languagePath: string,
    origin?: "gui" | "mcp" | "external",
  ) => Promise<void>;

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
  /** 整组替换形态音位规则（T2.5，支持删除） */
  setMorphophonologyRules: (rules: MorphophonologyRule[]) => void;

  // Inflection dimensions (Phase 2)
  addDimension: (dim: InflectionDimension) => void;
  updateDimension: (dimId: string, dim: InflectionDimension) => void;
  deleteDimension: (dimId: string) => void;

  // Derivation rules (Phase 2)
  addDerivation: (rule: DerivationRule) => void;
  updateDerivation: (ruleId: string, rule: DerivationRule) => void;
  deleteDerivation: (ruleId: string) => void;
  setDerivations: (rules: DerivationRule[]) => void;

  /**
   * 语法同步原子提交：三组规则在**同一次** applyEdit 内写入，
   * 使 Cmd+Z 只需一次即可完整撤回整次同步。
   */
  applyGrammarSyncPatch: (
    patch: Pick<
      GrammarConfig,
      "inflection_rules" | "derivation_rules" | "irregular_overrides"
    >,
  ) => void;

  // Grammar manual (Phase 2)
  addChapter: (chapter: GrammarChapter) => void;
  updateChapter: (chapterId: string, chapter: GrammarChapter) => void;
  deleteChapter: (chapterId: string) => void;
  reorderChapters: (chapters: GrammarChapter[]) => void;
}

const DEFAULT_TYPOLOGY: TypologyConfig = {
  morphological_type: "fusional",
  synthesis_index: 2.0,
  fusion_index: 2.0,
  head_marking: "dependent",
  auto_estimated: true,
};

const defaultConfig: GrammarConfig = {
  language_id: DEFAULT_LANGUAGE_ID,
  syntax: {
    word_order: "SVO",
    modifier_position: "before_head",
    adposition_type: "preposition",
  },
  parts_of_speech: [
    {
      pos_id: "pos_noun",
      name: "Noun",
      gloss_abbr: "n",
      word_pattern: "",
      requires_definition: true,
      requires_pronunciation: false,
    },
    {
      pos_id: "pos_verb",
      name: "Verb",
      gloss_abbr: "v",
      word_pattern: "",
      requires_definition: true,
      requires_pronunciation: false,
    },
    {
      pos_id: "pos_adj",
      name: "Adjective",
      gloss_abbr: "adj",
      word_pattern: "",
      requires_definition: false,
      requires_pronunciation: false,
    },
    {
      pos_id: "pos_adv",
      name: "Adverb",
      gloss_abbr: "adv",
      word_pattern: "",
      requires_definition: false,
      requires_pronunciation: false,
    },
    {
      pos_id: "pos_pron",
      name: "Pronoun",
      gloss_abbr: "pron",
      word_pattern: "",
      requires_definition: false,
      requires_pronunciation: false,
    },
    {
      pos_id: "pos_prep",
      name: "Preposition",
      gloss_abbr: "prep",
      word_pattern: "",
      requires_definition: false,
      requires_pronunciation: false,
    },
    {
      pos_id: "pos_conj",
      name: "Conjunction",
      gloss_abbr: "conj",
      word_pattern: "",
      requires_definition: false,
      requires_pronunciation: false,
    },
    {
      pos_id: "pos_interj",
      name: "Interjection",
      gloss_abbr: "interj",
      word_pattern: "",
      requires_definition: false,
      requires_pronunciation: false,
    },
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

interface LegacyGrammarShape extends Partial<GrammarConfig> {
  inflections?: Partial<InflectionRule>[];
}

function migrateInflectionRule(raw: Partial<InflectionRule>): InflectionRule {
  return {
    ...raw,
    rule_id: raw.rule_id ?? "",
    pos_id: raw.pos_id ?? "",
    dimension_values: raw.dimension_values ?? {},
    type: (raw.type as MorphologyType) || "suffix",
    affix: raw.affix ?? "",
    tag: raw.tag ?? "",
    match_regex: raw.match_regex ?? ".*",
    disabled: raw.disabled ?? false,
    condition: raw.condition ?? null,
    infix_config: raw.infix_config,
    circumfix_config: raw.circumfix_config,
    reduplication_config: raw.reduplication_config,
    ablaut_config: raw.ablaut_config,
    slot_id: raw.slot_id,
    conjugation_class_id: raw.conjugation_class_id,
    fused_dimensions: raw.fused_dimensions,
    sca_mutable: raw.sca_mutable ?? false,
  };
}

function normalizeLoadedGrammar(raw: GrammarConfig): GrammarConfig {
  const legacy = raw as LegacyGrammarShape;
  const rawRules = legacy.inflection_rules ?? legacy.inflections ?? [];
  return {
    ...raw,
    language_id: legacy.language_id || DEFAULT_LANGUAGE_ID,
    syntax: legacy.syntax
      ? { ...defaultConfig.syntax, ...legacy.syntax }
      : defaultConfig.syntax,
    parts_of_speech: legacy.parts_of_speech?.length
      ? legacy.parts_of_speech
      : defaultConfig.parts_of_speech,
    inflection_dimensions: legacy.inflection_dimensions ?? [],
    inflection_rules: rawRules.map(migrateInflectionRule),
    derivation_rules: legacy.derivation_rules ?? [],
    grammar_manual: legacy.grammar_manual ?? [],
    typology: legacy.typology
      ? { ...DEFAULT_TYPOLOGY, ...legacy.typology }
      : DEFAULT_TYPOLOGY,
    affix_slots: legacy.affix_slots ?? [],
    conjugation_classes: legacy.conjugation_classes ?? [],
    irregular_overrides: legacy.irregular_overrides ?? [],
  };
}

function mergeIrregularOverrides(
  existing: IrregularOverride[] | undefined,
  incoming: IrregularOverride[],
): IrregularOverride[] {
  if (!existing || existing.length === 0) return incoming;
  const byKey = new Map<string, IrregularOverride>();
  for (const item of existing) {
    byKey.set(
      JSON.stringify([item.entry_id, item.dimension_values]),
      item,
    );
  }
  return incoming.map((item) => {
    const prev = byKey.get(
      JSON.stringify([item.entry_id, item.dimension_values]),
    );
    return prev ? { ...prev, ...item } : item;
  });
}

interface PendingGrammarSave {
  projectPath: string;
  languagePath: string;
  config: GrammarConfig;
  expectedRevision: string;
  operationId: string;
  version: number;
}

const pendingSaves = new Map<string, PendingGrammarSave>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightSaves = new Map<string, Promise<void>>();
const saveVersions = new Map<string, number>();

function makeKey(projectPath: string, languagePath: string): string {
  return JSON.stringify([projectPath, languagePath]);
}

let loadGeneration = 0;

export const useGrammarStore = create<GrammarStore>((set, get) => {
  const clearTimer = (key: string): void => {
    const t = saveTimers.get(key);
    if (t) {
      clearTimeout(t);
      saveTimers.delete(key);
    }
  };

  const raiseConflict = async (
    projectPath: string,
    languagePath: string,
    localConfig: GrammarConfig,
    localRevision: string,
    origin: "gui" | "mcp" | "external" = "external",
    reason = "CONFLICT",
  ): Promise<void> => {
    const key = makeKey(projectPath, languagePath);
    clearTimer(key);
    if (get().projectPath === projectPath && get().languagePath === languagePath) {
      set({ paused: true, dirty: true });
    }

    let diskConfig = localConfig;
    let diskRevision = localRevision;
    try {
      const latest = await invoke<GrammarLoadResult>(
        "load_grammar_with_revision",
        { projectPath, languagePath },
      );
      diskConfig = normalizeLoadedGrammar(latest.config);
      diskRevision = latest.revision;
    } catch (err) {
      console.warn(`Failed to read latest grammar on conflict: ${err}`);
    }

    const diff = computeJsonDiffSummary(localConfig, diskConfig);
    useConflictStore.getState().upsertConflict(
      {
        key: `grammar:${key}`,
        kind: "grammar",
        projectPath,
        languagePath,
        languageId: localConfig.language_id || null,
        corpusId: null,
        origin,
        diskRevision,
        reason,
        changedFields: diff.changedFields,
        localPreview: diff.localPreview,
        diskPreview: diff.diskPreview,
      },
      {
        keepLocal: async () => {
          const latest = await invoke<GrammarLoadResult>(
            "load_grammar_with_revision",
            { projectPath, languagePath },
          );
          const currentConfig =
            get().projectPath === projectPath &&
            get().languagePath === languagePath
              ? get().config
              : localConfig;
          const opId = generateOperationId();
          recordGuiOperationId(opId);
          const writeRes = await invoke<WriteResult>("save_grammar", {
            projectPath,
            languagePath,
            config: currentConfig,
            expectedRevision: latest.revision,
            operationId: opId,
          });
          pendingSaves.delete(key);
          if (
            get().projectPath === projectPath &&
            get().languagePath === languagePath
          ) {
            set({
              revision: writeRes.revision,
              dirty: false,
              paused: false,
            });
          }
        },
        useDisk: async () => {
          pendingSaves.delete(key);
          clearTimer(key);
          if (
            get().projectPath === projectPath &&
            get().languagePath === languagePath
          ) {
            set({ paused: false, dirty: false });
            await get().loadConfig(projectPath, languagePath);
          }
        },
      },
    );
  };

  const flushKey = async (key: string): Promise<void> => {
    clearTimer(key);
    while (true) {
      const active = inFlightSaves.get(key);
      if (active) {
        await active;
        continue;
      }
      const next = pendingSaves.get(key);
      if (!next) return;
      if (
        get().paused &&
        get().projectPath === next.projectPath &&
        get().languagePath === next.languagePath
      ) {
        return;
      }

      pendingSaves.delete(key);
      const run = (async () => {
        recordGuiOperationId(next.operationId);
        try {
          const result = await invoke<WriteResult>("save_grammar", {
            projectPath: next.projectPath,
            languagePath: next.languagePath,
            config: next.config,
            expectedRevision: next.expectedRevision,
            operationId: next.operationId,
          });
          const queued = pendingSaves.get(key);
          if (queued && queued.expectedRevision === next.expectedRevision) {
            queued.expectedRevision = result.revision;
          }
          if (
            get().projectPath === next.projectPath &&
            get().languagePath === next.languagePath
          ) {
            const latestVer = saveVersions.get(key) ?? 0;
            set({
              revision: result.revision,
              dirty: queued !== undefined || latestVer > next.version,
            });
          }
        } catch (err) {
          if (isConflictError(err)) {
            pendingSaves.set(key, next);
            await raiseConflict(
              next.projectPath,
              next.languagePath,
              next.config,
              next.expectedRevision,
            );
            return;
          }
          console.warn(`语法配置保存失败：${err}`);
          const latestVersion = saveVersions.get(key) ?? 0;
          if (!pendingSaves.has(key) && latestVersion === next.version) {
            pendingSaves.set(key, next);
          }
        } finally {
          inFlightSaves.delete(key);
        }
      })();
      inFlightSaves.set(key, run);
      await run;

      if (pendingSaves.get(key)?.version === next.version) {
        return;
      }
    }
  };

  const applyEdit = (
    updater: (prev: GrammarConfig) => GrammarConfig,
    opts?: HistoryOpts,
  ): void => {
    const prevConfig = get().config;
    const nextConfig = updater(prevConfig);
    set({
      config: nextConfig,
      dirty: true,
    });
    get().saveConfig();

    if (!opts?.skipHistory && nextConfig !== prevConfig) {
      recordConfigChange<GrammarConfig>({
        domain: "grammar",
        labelKey: opts?.labelKey ?? "undo.label.grammar.edit",
        languageId: get().languagePath,
        coalesceKey: opts?.coalesceKey ?? `grammar:${get().languagePath}`,
        prev: prevConfig,
        next: nextConfig,
        restore: (snapshot) => applyEdit(() => snapshot, { skipHistory: true }),
      });
    }
  };

  return {
    config: defaultConfig,
    projectPath: ".",
    languagePath: "proto_language",
    revision: "missing",
    dirty: false,
    paused: false,

    setProjectPath: (path) => set({ projectPath: path }),
    setLanguagePath: (path) => set({ languagePath: path }),

    loadConfig: async (projectPath: string, languagePath: string) => {
      await get().flushSaves();
      const generation = ++loadGeneration;
      try {
        const loaded = await invoke<GrammarLoadResult>(
          "load_grammar_with_revision",
          {
            projectPath,
            languagePath,
          },
        );
        if (generation !== loadGeneration) return;
        const config = normalizeLoadedGrammar(loaded.config);
        set({
          config,
          projectPath,
          languagePath,
          revision: loaded.revision,
          dirty: false,
          paused: false,
        });
      } catch (err) {
        if (generation !== loadGeneration) return;
        console.warn(`加载语法配置失败：${err}`);
        throw err;
      }
    },

    saveConfig: () => {
      const { projectPath, languagePath, config, revision, paused } = get();
      const key = makeKey(projectPath, languagePath);
      const nextVer = (saveVersions.get(key) ?? 0) + 1;
      saveVersions.set(key, nextVer);
      pendingSaves.set(key, {
        projectPath,
        languagePath,
        config,
        expectedRevision: revision,
        operationId: generateOperationId(),
        version: nextVer,
      });
      set({ dirty: true });
      if (paused) return;
      clearTimer(key);
      saveTimers.set(
        key,
        setTimeout(() => {
          void flushKey(key);
        }, 500),
      );
    },

    flushSaves: async () => {
      const keys = new Set<string>([
        ...pendingSaves.keys(),
        ...saveTimers.keys(),
        ...inFlightSaves.keys(),
      ]);
      await Promise.all(Array.from(keys, (k) => flushKey(k)));
    },

    isDirty: (projectPath, languagePath) => {
      const p = projectPath ?? get().projectPath;
      const l = languagePath ?? get().languagePath;
      const key = makeKey(p, l);
      if (pendingSaves.has(key) || saveTimers.has(key) || inFlightSaves.has(key)) {
        return true;
      }
      return get().projectPath === p && get().languagePath === l && get().dirty;
    },

    pauseAutoSave: (projectPath, languagePath) => {
      const p = projectPath ?? get().projectPath;
      const l = languagePath ?? get().languagePath;
      clearTimer(makeKey(p, l));
      if (get().projectPath === p && get().languagePath === l) {
        set({ paused: true });
      }
    },

    triggerExternalConflict: async (
      projectPath,
      languagePath,
      origin = "external",
    ) => {
      const key = makeKey(projectPath, languagePath);
      const pending = pendingSaves.get(key);
      const localCfg = pending?.config ?? get().config;
      const localRev = pending?.expectedRevision ?? get().revision;
      await raiseConflict(
        projectPath,
        languagePath,
        localCfg,
        localRev,
        origin,
        "External file change detected while local grammar has unsaved edits",
      );
    },

    updateSyntax: (syntax) => {
      applyEdit((prev) => ({
        ...prev,
        syntax: { ...prev.syntax, ...syntax },
      }));
    },

    updateTypology: (typology) => {
      applyEdit((prev) => ({
        ...prev,
        typology: { ...(prev.typology ?? DEFAULT_TYPOLOGY), ...typology },
      }));
    },

    setAffixSlots: (slots) => {
      applyEdit((prev) => ({
        ...prev,
        affix_slots: mergeById(prev.affix_slots, slots, "slot_id"),
      }));
    },

    setConjugationClasses: (classes) => {
      applyEdit((prev) => ({
        ...prev,
        conjugation_classes: mergeById(
          prev.conjugation_classes,
          classes,
          "class_id",
        ),
      }));
    },

    setIrregularOverrides: (overrides) => {
      applyEdit((prev) => ({
        ...prev,
        irregular_overrides: mergeIrregularOverrides(
          prev.irregular_overrides,
          overrides,
        ),
      }));
    },

    // ── Parts of Speech ────────────────────────────────────

    addPartOfSpeech: (pos) => {
      applyEdit((prev) => ({
        ...prev,
        parts_of_speech: [...prev.parts_of_speech, pos],
      }));
    },

    updatePartOfSpeech: (posId, pos) => {
      applyEdit((prev) => ({
        ...prev,
        parts_of_speech: prev.parts_of_speech.map((p) =>
          p.pos_id === posId ? { ...p, ...pos } : p,
        ),
      }));
    },

    deletePartOfSpeech: (posId) => {
      applyEdit((prev) => ({
        ...prev,
        parts_of_speech: prev.parts_of_speech.filter((p) => p.pos_id !== posId),
      }));
    },

    setPartsOfSpeech: (parts) => {
      applyEdit((prev) => ({
        ...prev,
        parts_of_speech: mergeById(prev.parts_of_speech, parts, "pos_id"),
      }));
    },

    // ── Inflection rules ──────────────────────────────────

    addInflection: (rule) => {
      applyEdit((prev) => ({
        ...prev,
        inflection_rules: [...prev.inflection_rules, rule],
      }));
    },

    updateInflection: (ruleId, rule) => {
      applyEdit((prev) => ({
        ...prev,
        inflection_rules: prev.inflection_rules.map((r) =>
          r.rule_id === ruleId ? { ...r, ...rule } : r,
        ),
      }));
    },

    deleteInflection: (ruleId) => {
      applyEdit((prev) => ({
        ...prev,
        inflection_rules: prev.inflection_rules.filter(
          (r) => r.rule_id !== ruleId,
        ),
      }));
    },

    setInflections: (rules) => {
      applyEdit((prev) => ({
        ...prev,
        inflection_rules: mergeById(prev.inflection_rules, rules, "rule_id"),
      }));
    },

    applyGrammarSyncPatch: (patch) => {
      applyEdit((prev) => ({
        ...prev,
        inflection_rules: mergeById(prev.inflection_rules, patch.inflection_rules, "rule_id"),
        derivation_rules: mergeById(prev.derivation_rules, patch.derivation_rules, "rule_id"),
        irregular_overrides: mergeIrregularOverrides(
          prev.irregular_overrides,
          patch.irregular_overrides,
        ),
      }));
    },

    setMorphophonologyRules: (rules) => {
      applyEdit((prev) => ({
        ...prev,
        morphophonology_rules: rules,
      }));
    },

    // ── Inflection dimensions (Phase 2) ───────────────────

    addDimension: (dim) => {
      applyEdit((prev) => ({
        ...prev,
        inflection_dimensions: [...prev.inflection_dimensions, dim],
      }));
    },

    updateDimension: (dimId, dim) => {
      applyEdit((prev) => ({
        ...prev,
        inflection_dimensions: prev.inflection_dimensions.map((d) =>
          d.dim_id === dimId
            ? { ...d, ...dim, values: mergeById(d.values, dim.values, "val_id") }
            : d,
        ),
      }));
    },

    deleteDimension: (dimId) => {
      applyEdit((prev) => ({
        ...prev,
        inflection_dimensions: prev.inflection_dimensions.filter(
          (d) => d.dim_id !== dimId,
        ),
      }));
    },

    // ── Derivation rules (Phase 2) ────────────────────────

    addDerivation: (rule) => {
      applyEdit((prev) => ({
        ...prev,
        derivation_rules: [...prev.derivation_rules, rule],
      }));
    },

    updateDerivation: (ruleId, rule) => {
      applyEdit((prev) => ({
        ...prev,
        derivation_rules: prev.derivation_rules.map((r) =>
          r.rule_id === ruleId ? { ...r, ...rule } : r,
        ),
      }));
    },

    deleteDerivation: (ruleId) => {
      applyEdit((prev) => ({
        ...prev,
        derivation_rules: prev.derivation_rules.filter(
          (r) => r.rule_id !== ruleId,
        ),
      }));
    },

    setDerivations: (rules) => {
      applyEdit((prev) => ({
        ...prev,
        derivation_rules: mergeById(prev.derivation_rules, rules, "rule_id"),
      }));
    },

    // ── Grammar manual (Phase 2) ──────────────────────────

    addChapter: (chapter) => {
      applyEdit((prev) => ({
        ...prev,
        grammar_manual: [...prev.grammar_manual, chapter],
      }));
    },

    updateChapter: (chapterId, chapter) => {
      applyEdit((prev) => ({
        ...prev,
        grammar_manual: prev.grammar_manual.map((c) =>
          c.chapter_id === chapterId
            ? {
                ...c,
                ...chapter,
                embedded_paradigms: mergeById(
                  c.embedded_paradigms,
                  chapter.embedded_paradigms,
                  "paradigm_id",
                ),
              }
            : c,
        ),
      }));
    },

    deleteChapter: (chapterId) => {
      applyEdit((prev) => ({
        ...prev,
        grammar_manual: prev.grammar_manual.filter(
          (c) => c.chapter_id !== chapterId,
        ),
      }));
    },

    reorderChapters: (chapters) => {
      applyEdit((prev) => ({
        ...prev,
        grammar_manual: mergeById(prev.grammar_manual, chapters, "chapter_id"),
      }));
    },
  };
});
