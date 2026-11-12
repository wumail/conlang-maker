import { create } from "zustand";
import { recordConfigChange } from "./configHistory";
import type { HistoryOpts } from "./undoManager";
import { invoke } from "@tauri-apps/api/core";
import {
  SCAConfig,
  SCARule,
  SCARuleSet,
  ScaLoadResult,
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

interface SCAStore {
  config: SCAConfig;
  projectPath: string;
  languagePath: string;
  revision: string;
  dirty: boolean;
  paused: boolean;

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

  // Rule Sets
  addRuleSet: (ruleSet: SCARuleSet) => void;
  updateRuleSet: (rulesetId: string, ruleSet: SCARuleSet) => void;
  deleteRuleSet: (rulesetId: string) => void;
  reorderRuleSets: (ruleSets: SCARuleSet[]) => void;

  // Individual Rules
  addRule: (rulesetId: string, rule: SCARule) => void;
  updateRule: (rulesetId: string, ruleId: string, rule: SCARule) => void;
  deleteRule: (rulesetId: string, ruleId: string) => void;
}

const defaultConfig: SCAConfig = {
  language_id: DEFAULT_LANGUAGE_ID,
  rule_sets: [],
};

interface PendingScaSave {
  projectPath: string;
  languagePath: string;
  config: SCAConfig;
  expectedRevision: string;
  operationId: string;
  version: number;
}

const pendingSaves = new Map<string, PendingScaSave>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightSaves = new Map<string, Promise<void>>();
const saveVersions = new Map<string, number>();

function makeKey(projectPath: string, languagePath: string): string {
  return JSON.stringify([projectPath, languagePath]);
}

function mergeRuleSets(
  existing: SCARuleSet[] | undefined,
  incoming: SCARuleSet[],
): SCARuleSet[] {
  if (!existing || existing.length === 0) return incoming;
  const byId = new Map<string, SCARuleSet>();
  for (const rs of existing) {
    byId.set(rs.ruleset_id, rs);
  }
  return incoming.map((rs) => {
    const prev = byId.get(rs.ruleset_id);
    if (!prev) return rs;
    return {
      ...prev,
      ...rs,
      rules: mergeById(prev.rules, rs.rules, "rule_id"),
    };
  });
}

let loadGeneration = 0;

export const useSCAStore = create<SCAStore>((set, get) => {
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
    localConfig: SCAConfig,
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
      const latest = await invoke<ScaLoadResult>("load_sca_with_revision", {
        projectPath,
        languagePath,
      });
      diskConfig = latest.config;
      diskRevision = latest.revision;
    } catch (err) {
      console.warn(`Failed to fetch latest SCA on conflict: ${err}`);
    }

    const diff = computeJsonDiffSummary(localConfig, diskConfig);
    useConflictStore.getState().upsertConflict(
      {
        key: `sca:${key}`,
        kind: "sca",
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
          const latest = await invoke<ScaLoadResult>("load_sca_with_revision", {
            projectPath,
            languagePath,
          });
          const currentConfig =
            get().projectPath === projectPath &&
            get().languagePath === languagePath
              ? get().config
              : localConfig;
          const opId = generateOperationId();
          recordGuiOperationId(opId);
          const writeRes = await invoke<WriteResult>("save_sca", {
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
          const result = await invoke<WriteResult>("save_sca", {
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
          console.warn(`SCA 配置保存失败：${err}`);
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
    updater: (prev: SCAConfig) => SCAConfig,
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
      recordConfigChange<SCAConfig>({
        domain: "sca",
        labelKey: opts?.labelKey ?? "undo.label.sca.edit",
        languageId: get().languagePath,
        coalesceKey: opts?.coalesceKey ?? `sca:${get().languagePath}`,
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

    loadConfig: async (projectPath: string, languagePath: string) => {
      await get().flushSaves();
      const generation = ++loadGeneration;
      try {
        const loaded = await invoke<ScaLoadResult>("load_sca_with_revision", {
          projectPath,
          languagePath,
        });
        if (generation !== loadGeneration) return;
        set({
          config: {
            ...loaded.config,
            language_id: loaded.config.language_id || DEFAULT_LANGUAGE_ID,
            rule_sets: loaded.config.rule_sets ?? [],
          },
          projectPath,
          languagePath,
          revision: loaded.revision,
          dirty: false,
          paused: false,
        });
      } catch (err) {
        if (generation !== loadGeneration) return;
        console.warn(`加载 SCA 配置失败：${err}`);
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
        "External file change detected while local SCA has unsaved edits",
      );
    },

    // ── Rule Sets ──────────────────────────────────────────

    addRuleSet: (ruleSet) => {
      applyEdit((prev) => ({
        ...prev,
        rule_sets: [...prev.rule_sets, ruleSet],
      }));
    },

    updateRuleSet: (rulesetId, ruleSet) => {
      applyEdit((prev) => ({
        ...prev,
        rule_sets: prev.rule_sets.map((rs) =>
          rs.ruleset_id === rulesetId
            ? {
                ...rs,
                ...ruleSet,
                rules: mergeById(rs.rules, ruleSet.rules, "rule_id"),
              }
            : rs,
        ),
      }));
    },

    deleteRuleSet: (rulesetId) => {
      applyEdit((prev) => ({
        ...prev,
        rule_sets: prev.rule_sets.filter((rs) => rs.ruleset_id !== rulesetId),
      }));
    },

    reorderRuleSets: (ruleSets) => {
      applyEdit((prev) => ({
        ...prev,
        rule_sets: mergeRuleSets(prev.rule_sets, ruleSets),
      }));
    },

    // ── Individual Rules ───────────────────────────────────

    addRule: (rulesetId, rule) => {
      applyEdit((prev) => ({
        ...prev,
        rule_sets: prev.rule_sets.map((rs) =>
          rs.ruleset_id === rulesetId
            ? { ...rs, rules: [...rs.rules, rule] }
            : rs,
        ),
      }));
    },

    updateRule: (rulesetId, ruleId, rule) => {
      applyEdit((prev) => ({
        ...prev,
        rule_sets: prev.rule_sets.map((rs) =>
          rs.ruleset_id === rulesetId
            ? {
                ...rs,
                rules: rs.rules.map((r) =>
                  r.rule_id === ruleId ? { ...r, ...rule } : r,
                ),
              }
            : rs,
        ),
      }));
    },

    deleteRule: (rulesetId, ruleId) => {
      applyEdit((prev) => ({
        ...prev,
        rule_sets: prev.rule_sets.map((rs) =>
          rs.ruleset_id === rulesetId
            ? { ...rs, rules: rs.rules.filter((r) => r.rule_id !== ruleId) }
            : rs,
        ),
      }));
    },
  };
});
