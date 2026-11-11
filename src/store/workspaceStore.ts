import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  CreateProjectResult,
  LanguageEntry,
  WorkspaceConfig,
  WorkspaceLoadResult,
  WriteResult,
} from "../types";
import { usePhonoStore } from "./phonoStore";
import { useLexiconStore } from "./lexiconStore";
import { useGrammarStore } from "./grammarStore";
import { useSCAStore } from "./scaStore";
import { useCorpusStore } from "./corpusStore";
import {
  computeJsonDiffSummary,
  generateOperationId,
  isConflictError,
  recordGuiOperationId,
  useConflictStore,
} from "./conflictStore";
import { openPathSafely } from "../utils/safeDialog";
import {
  DEFAULT_LANGUAGE_ID,
  DEFAULT_LANGUAGE_PATH,
  WORKSPACE_VERSION,
} from "../constants";

interface WorkspaceStore {
  config: WorkspaceConfig;
  activeLanguageId: string;
  activeLanguagePath: string;
  /** Absolute path to the .conlang file — primary identifier */
  conlangFilePath: string;
  /** Derived: directory containing the .conlang file */
  projectPath: string;
  revision: string;
  dirty: boolean;
  paused: boolean;

  setConlangFilePath: (path: string) => void;
  loadWorkspace: (conlangFilePath: string) => Promise<void>;
  saveWorkspace: () => void;
  flushSaves: () => Promise<void>;
  isDirty: (conlangFilePath?: string) => boolean;
  pauseAutoSave: (conlangFilePath?: string) => void;
  triggerExternalConflict: (
    conlangFilePath: string,
    origin?: "gui" | "mcp" | "external",
  ) => Promise<void>;
  setActiveLanguage: (languageId: string) => void;
  forkLanguage: (
    parentId: string,
    newName: string,
    newId: string,
    newPath: string,
  ) => Promise<void>;
  deleteLanguage: (languageId: string) => Promise<void>;
  createRootLanguage: (name: string) => Promise<CreateProjectResult | null>;
  renameLanguage: (languageId: string, newName: string) => void;
  getLanguageById: (languageId: string) => LanguageEntry | undefined;
  getChildLanguages: (parentId: string) => LanguageEntry[];
  copyProject: (
    sourceConlangFilePath: string,
    destDir: string,
    newName: string,
  ) => Promise<string>;
  clearWorkspace: () => void;
}

const defaultConfig: WorkspaceConfig = {
  workspace_version: WORKSPACE_VERSION,
  languages: [
    {
      language_id: DEFAULT_LANGUAGE_ID,
      name: "Proto Language",
      path: DEFAULT_LANGUAGE_PATH,
      parent_id: null,
    },
  ],
};

/** Derive projectPath (directory) from conlangFilePath */
export function deriveProjectPath(conlangFilePath: string): string {
  const idx = Math.max(
    conlangFilePath.lastIndexOf("/"),
    conlangFilePath.lastIndexOf("\\"),
  );
  return idx > 0 ? conlangFilePath.substring(0, idx) : ".";
}

/** Flush pending debounced writes across all domain stores. */
export async function flushAllDomainStores(): Promise<void> {
  await Promise.all([
    useWorkspaceStore.getState().flushSaves(),
    usePhonoStore.getState().flushSaves(),
    useLexiconStore.getState().flushSaves(),
    useGrammarStore.getState().flushSaves(),
    useSCAStore.getState().flushSaves(),
    useCorpusStore.getState().flushSaves(),
  ]);
}

interface PendingWorkspaceSave {
  conlangFilePath: string;
  config: WorkspaceConfig;
  expectedRevision: string;
  operationId: string;
  version: number;
}

const pendingSaves = new Map<string, PendingWorkspaceSave>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightSaves = new Map<string, Promise<void>>();
const saveVersions = new Map<string, number>();

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  const clearTimer = (key: string): void => {
    const t = saveTimers.get(key);
    if (t) {
      clearTimeout(t);
      saveTimers.delete(key);
    }
  };

  const raiseConflict = async (
    conlangFilePath: string,
    localConfig: WorkspaceConfig,
    localRevision: string,
    origin: "gui" | "mcp" | "external" = "external",
    reason = "CONFLICT",
  ): Promise<void> => {
    clearTimer(conlangFilePath);
    if (get().conlangFilePath === conlangFilePath) {
      set({ paused: true, dirty: true });
    }

    let diskConfig = localConfig;
    let diskRevision = localRevision;
    try {
      const latest = await invoke<WorkspaceLoadResult>(
        "load_workspace_with_revision",
        { conlangFilePath },
      );
      diskConfig = latest.config;
      diskRevision = latest.revision;
    } catch (err) {
      console.warn(`Failed to read latest workspace on conflict: ${err}`);
    }

    const projectPath = deriveProjectPath(conlangFilePath);
    const diff = computeJsonDiffSummary(localConfig, diskConfig);
    useConflictStore.getState().upsertConflict(
      {
        key: `workspace:${conlangFilePath}`,
        kind: "workspace",
        projectPath,
        languagePath: null,
        languageId: null,
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
          const latest = await invoke<WorkspaceLoadResult>(
            "load_workspace_with_revision",
            { conlangFilePath },
          );
          const currentConfig =
            get().conlangFilePath === conlangFilePath
              ? get().config
              : localConfig;
          const opId = generateOperationId();
          recordGuiOperationId(opId);
          const writeRes = await invoke<WriteResult>("save_workspace", {
            conlangFilePath,
            config: currentConfig,
            expectedRevision: latest.revision,
            operationId: opId,
          });
          pendingSaves.delete(conlangFilePath);
          if (get().conlangFilePath === conlangFilePath) {
            set({
              revision: writeRes.revision,
              dirty: false,
              paused: false,
            });
          }
        },
        useDisk: async () => {
          pendingSaves.delete(conlangFilePath);
          clearTimer(conlangFilePath);
          if (get().conlangFilePath === conlangFilePath) {
            set({ paused: false, dirty: false });
            await get().loadWorkspace(conlangFilePath);
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
      if (get().paused && get().conlangFilePath === next.conlangFilePath) {
        return;
      }

      pendingSaves.delete(key);
      const run = (async () => {
        recordGuiOperationId(next.operationId);
        try {
          const result = await invoke<WriteResult>("save_workspace", {
            conlangFilePath: next.conlangFilePath,
            config: next.config,
            expectedRevision: next.expectedRevision,
            operationId: next.operationId,
          });
          const queued = pendingSaves.get(key);
          if (queued && queued.expectedRevision === next.expectedRevision) {
            queued.expectedRevision = result.revision;
          }
          if (get().conlangFilePath === next.conlangFilePath) {
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
              next.conlangFilePath,
              next.config,
              next.expectedRevision,
            );
            return;
          }
          console.warn(`工作区配置保存失败：${err}`);
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

  return {
    config: defaultConfig,
    activeLanguageId: DEFAULT_LANGUAGE_ID,
    activeLanguagePath: DEFAULT_LANGUAGE_PATH,
    conlangFilePath: "",
    projectPath: ".",
    revision: "missing",
    dirty: false,
    paused: false,

    setConlangFilePath: (path) =>
      set({
        conlangFilePath: path,
        projectPath: deriveProjectPath(path),
      }),

    clearWorkspace: () => {
      set({
        projectPath: "",
        conlangFilePath: "",
        config: defaultConfig,
        activeLanguageId: "",
        activeLanguagePath: "",
        revision: "missing",
        dirty: false,
        paused: false,
      });
    },

    loadWorkspace: async (conlangFilePath: string) => {
      await get().flushSaves();
      try {
        const loaded = await invoke<WorkspaceLoadResult>(
          "load_workspace_with_revision",
          { conlangFilePath },
        );
        const languages =
          loaded.config.languages.length > 0
            ? loaded.config.languages
            : defaultConfig.languages;
        const resolvedConfig: WorkspaceConfig = {
          ...loaded.config,
          languages,
        };
        const projectPath = deriveProjectPath(conlangFilePath);
        const prevState = get();
        const sameWorkspace = prevState.conlangFilePath === conlangFilePath;
        const existingLang = sameWorkspace
          ? resolvedConfig.languages.find(
              (l) => l.language_id === prevState.activeLanguageId,
            )
          : undefined;
        const selectedLang = existingLang ?? resolvedConfig.languages[0];

        set({
          config: resolvedConfig,
          conlangFilePath,
          projectPath,
          activeLanguageId: selectedLang?.language_id || "",
          activeLanguagePath: selectedLang?.path || "",
          revision: loaded.revision,
          dirty: false,
          paused: false,
        });
      } catch (err) {
        console.warn(`加载工作区配置失败：${err}`);
      }
    },

    saveWorkspace: () => {
      const { conlangFilePath, config, revision, paused } = get();
      if (!conlangFilePath) return;
      const nextVer = (saveVersions.get(conlangFilePath) ?? 0) + 1;
      saveVersions.set(conlangFilePath, nextVer);
      pendingSaves.set(conlangFilePath, {
        conlangFilePath,
        config,
        expectedRevision: revision,
        operationId: generateOperationId(),
        version: nextVer,
      });
      set({ dirty: true });
      if (paused) return;
      clearTimer(conlangFilePath);
      saveTimers.set(
        conlangFilePath,
        setTimeout(() => {
          void flushKey(conlangFilePath);
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

    isDirty: (conlangFilePath) => {
      const key = conlangFilePath ?? get().conlangFilePath;
      if (!key) return false;
      if (pendingSaves.has(key) || saveTimers.has(key) || inFlightSaves.has(key)) {
        return true;
      }
      return get().conlangFilePath === key && get().dirty;
    },

    pauseAutoSave: (conlangFilePath) => {
      const key = conlangFilePath ?? get().conlangFilePath;
      if (!key) return;
      clearTimer(key);
      if (get().conlangFilePath === key) {
        set({ paused: true });
      }
    },

    triggerExternalConflict: async (
      conlangFilePath,
      origin = "external",
    ) => {
      const pending = pendingSaves.get(conlangFilePath);
      const localCfg = pending?.config ?? get().config;
      const localRev = pending?.expectedRevision ?? get().revision;
      await raiseConflict(
        conlangFilePath,
        localCfg,
        localRev,
        origin,
        "External file change detected while local workspace has unsaved edits",
      );
    },

    setActiveLanguage: (languageId: string) => {
      const { config } = get();
      const lang = config.languages.find(
        (item) => item.language_id === languageId,
      );
      if (lang) {
        set({
          activeLanguageId: lang.language_id,
          activeLanguagePath: lang.path,
        });
      }
    },

    forkLanguage: async (parentId, newName, newId, newPath) => {
      await flushAllDomainStores();
      const { projectPath, conlangFilePath, revision, config } = get();
      const operationId = generateOperationId();
      recordGuiOperationId(operationId);
      try {
        await invoke<WriteResult>("fork_language", {
          projectPath,
          conlangFilePath,
          parentId,
          newName,
          newId,
          newPath,
          expectedRevision: revision,
          operationId,
        });
        await get().loadWorkspace(conlangFilePath);
        get().setActiveLanguage(newId);
      } catch (err) {
        if (isConflictError(err)) {
          await raiseConflict(conlangFilePath, config, revision);
          return;
        }
        throw err;
      }
    },

    deleteLanguage: async (languageId: string) => {
      await flushAllDomainStores();
      const { projectPath, conlangFilePath, activeLanguageId, config, revision } =
        get();
      const operationId = generateOperationId();
      recordGuiOperationId(operationId);
      try {
        await invoke<WriteResult>("delete_language", {
          projectPath,
          conlangFilePath,
          languageId,
          expectedRevision: revision,
          operationId,
        });
      } catch (err) {
        if (isConflictError(err)) {
          await raiseConflict(conlangFilePath, config, revision);
          return;
        }
        throw err;
      }
      if (activeLanguageId === languageId) {
        const remaining = config.languages.filter(
          (item) => item.language_id !== languageId,
        );
        if (remaining.length > 0) {
          set({
            activeLanguageId: remaining[0].language_id,
            activeLanguagePath: remaining[0].path,
          });
        }
      }
      await get().loadWorkspace(conlangFilePath);
    },

    createRootLanguage: async (name: string) => {
      const selected = await openPathSafely({
        directory: true,
        title: "Choose project directory",
      });
      if (!selected) return null;

      try {
        const result = await invoke<CreateProjectResult>("create_new_project", {
          projectPath: selected,
          langName: name,
        });
        const conlangFilePath = result.conlang_file_path;
        await get().loadWorkspace(conlangFilePath);
        return result;
      } catch (err) {
        console.warn(`创建根语言失败：${err}`);
        return null;
      }
    },

    renameLanguage: (languageId: string, newName: string) => {
      const { config, conlangFilePath } = get();
      const updatedConfig: WorkspaceConfig = {
        ...config,
        languages: config.languages.map((item) =>
          item.language_id === languageId ? { ...item, name: newName } : item,
        ),
      };
      set({ config: updatedConfig, dirty: true });
      if (conlangFilePath) {
        get().saveWorkspace();
      }
    },

    getLanguageById: (languageId: string) => {
      return get().config.languages.find(
        (item) => item.language_id === languageId,
      );
    },

    getChildLanguages: (parentId: string) => {
      return get().config.languages.filter((item) => item.parent_id === parentId);
    },

    copyProject: async (
      sourceConlangFilePath: string,
      destDir: string,
      newName: string,
    ) => {
      await flushAllDomainStores();
      const newConlangPath = await invoke<string>("copy_project", {
        sourceConlangFilePath,
        destDir,
        newName,
      });
      return newConlangPath;
    },
  };
});
