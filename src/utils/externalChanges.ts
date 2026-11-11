import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { WorkspaceFileChangedEvent } from "../types";
import { useWorkspaceStore } from "../store/workspaceStore";
import { usePhonoStore } from "../store/phonoStore";
import { useLexiconStore } from "../store/lexiconStore";
import { useGrammarStore } from "../store/grammarStore";
import { useSCAStore } from "../store/scaStore";
import { useCorpusStore } from "../store/corpusStore";
import { isOwnGuiOperationId } from "../store/conflictStore";
import { invalidateFontCache } from "./conlangFont";

export const EXTERNAL_FONT_CHANGED_DOM_EVENT = "conlang-external-font-changed";

function hasTauriRuntime(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    "__TAURI_INTERNALS__" in (globalThis as Record<string, unknown>)
  );
}

function normalizePath(p: string): string {
  return p.replace(/[\\/]+$/, "");
}

function notifyExternalFontChanged(): void {
  invalidateFontCache();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EXTERNAL_FONT_CHANGED_DOM_EVENT));
  }
}

/**
 * Reload all active stores and font cache after an out-of-band bulk change
 * (such as snapshot rollback or language restore).
 */
export async function reloadAllActiveStoresAndFonts(): Promise<void> {
  const ws = useWorkspaceStore.getState();
  if (!ws.conlangFilePath) return;

  await ws.loadWorkspace(ws.conlangFilePath);
  const refreshedWs = useWorkspaceStore.getState();
  const projectPath = refreshedWs.projectPath;
  const languagePath = refreshedWs.activeLanguagePath;
  if (!projectPath || !languagePath) {
    notifyExternalFontChanged();
    return;
  }

  const prevCorpusId = useCorpusStore.getState().activeCorpusId;
  await Promise.all([
    usePhonoStore.getState().loadConfig(projectPath, languagePath),
    useLexiconStore.getState().loadFromBackend(projectPath, languagePath),
    useGrammarStore.getState().loadConfig(projectPath, languagePath),
    useSCAStore.getState().loadConfig(projectPath, languagePath),
    useCorpusStore.getState().loadIndex(projectPath, languagePath),
  ]);
  if (prevCorpusId) {
    const exists = useCorpusStore
      .getState()
      .index.some((item) => item.corpus_id === prevCorpusId);
    if (exists) {
      await useCorpusStore.getState().loadCorpus(prevCorpusId);
    }
  }
  notifyExternalFontChanged();
}

async function refreshActivePhonologyRespectingDirty(
  projectPath: string,
  activeLanguagePath: string,
): Promise<void> {
  const phono = usePhonoStore.getState();
  if (phono.isDirty(projectPath, activeLanguagePath)) {
    await phono.refreshInheritedFromBackend(projectPath, activeLanguagePath);
  } else {
    await phono.loadConfig(projectPath, activeLanguagePath);
  }
}

async function syncDomainStore(
  kind: "phonology" | "lexicon" | "grammar" | "sca" | "corpus",
  projectPath: string,
  targetLanguagePath: string,
  origin: "gui" | "mcp" | "external",
  isActiveLanguage: boolean,
): Promise<void> {
  if (!targetLanguagePath) return;

  if (kind === "phonology") {
    const store = usePhonoStore.getState();
    if (store.isDirty(projectPath, targetLanguagePath)) {
      await store.triggerExternalConflict(
        projectPath,
        targetLanguagePath,
        origin,
      );
    } else if (isActiveLanguage) {
      await store.loadConfig(projectPath, targetLanguagePath);
    }
    return;
  }

  if (kind === "lexicon") {
    const store = useLexiconStore.getState();
    if (store.isDirty(projectPath, targetLanguagePath)) {
      await store.triggerExternalConflict(
        projectPath,
        targetLanguagePath,
        origin,
      );
    } else if (isActiveLanguage) {
      await store.loadFromBackend(projectPath, targetLanguagePath);
    }
    return;
  }

  if (kind === "grammar") {
    const store = useGrammarStore.getState();
    if (store.isDirty(projectPath, targetLanguagePath)) {
      await store.triggerExternalConflict(
        projectPath,
        targetLanguagePath,
        origin,
      );
    } else if (isActiveLanguage) {
      await store.loadConfig(projectPath, targetLanguagePath);
    }
    return;
  }

  if (kind === "sca") {
    const store = useSCAStore.getState();
    if (store.isDirty(projectPath, targetLanguagePath)) {
      await store.triggerExternalConflict(
        projectPath,
        targetLanguagePath,
        origin,
      );
    } else if (isActiveLanguage) {
      await store.loadConfig(projectPath, targetLanguagePath);
    }
    return;
  }

  if (kind === "corpus") {
    const store = useCorpusStore.getState();
    if (store.isDirty(projectPath, targetLanguagePath)) {
      await store.triggerExternalConflict(
        projectPath,
        targetLanguagePath,
        origin,
      );
    } else if (isActiveLanguage) {
      const prevCorpusId = store.activeCorpusId;
      await store.loadIndex(projectPath, targetLanguagePath);
      if (
        prevCorpusId &&
        useCorpusStore
          .getState()
          .index.some((entry) => entry.corpus_id === prevCorpusId)
      ) {
        await useCorpusStore.getState().loadCorpus(prevCorpusId);
      }
    }
  }
}

export async function handleWorkspaceFileChanged(
  event: WorkspaceFileChangedEvent,
): Promise<void> {
  if (event.origin === "gui" && isOwnGuiOperationId(event.operation_id)) {
    return;
  }

  const ws = useWorkspaceStore.getState();
  if (!ws.conlangFilePath || !ws.projectPath) return;
  if (normalizePath(ws.projectPath) !== normalizePath(event.project_path)) {
    return;
  }

  const activeLangId = ws.activeLanguageId;
  const activeLangPath = ws.activeLanguagePath;
  const matchedLang = event.language_id
    ? ws.getLanguageById(event.language_id)
    : ws.config.languages.find((l) => l.path === event.language_path);
  const targetLangPath =
    event.language_path ?? matchedLang?.path ?? activeLangPath;

  const isDirectActive = Boolean(
    (event.language_id && event.language_id === activeLangId) ||
      (event.language_path && event.language_path === activeLangPath),
  );
  const isActiveInAffectedChain = Boolean(
    event.affected_language_ids?.includes(activeLangId),
  );

  if (event.kind === "workspace" || event.kind === "trash") {
    if (ws.isDirty(ws.conlangFilePath)) {
      await ws.triggerExternalConflict(ws.conlangFilePath, event.origin);
    } else {
      await ws.loadWorkspace(ws.conlangFilePath);
    }
    const updatedWs = useWorkspaceStore.getState();
    if (updatedWs.activeLanguagePath) {
      await refreshActivePhonologyRespectingDirty(
        updatedWs.projectPath,
        updatedWs.activeLanguagePath,
      );
    }
    notifyExternalFontChanged();
    return;
  }

  if (event.kind === "font") {
    notifyExternalFontChanged();
    return;
  }

  if (event.kind === "phonology") {
    if (isDirectActive || event.language_path) {
      await syncDomainStore(
        "phonology",
        ws.projectPath,
        targetLangPath,
        event.origin,
        isDirectActive,
      );
    }
    if (!isDirectActive && isActiveInAffectedChain && activeLangPath) {
      await refreshActivePhonologyRespectingDirty(
        ws.projectPath,
        activeLangPath,
      );
    }
    return;
  }

  if (
    event.kind === "lexicon" ||
    event.kind === "grammar" ||
    event.kind === "sca" ||
    event.kind === "corpus"
  ) {
    await syncDomainStore(
      event.kind,
      ws.projectPath,
      targetLangPath,
      event.origin,
      isDirectActive,
    );
    return;
  }

  if (event.kind === "snapshots") {
    if (ws.isDirty(ws.conlangFilePath)) {
      await ws.triggerExternalConflict(ws.conlangFilePath, event.origin);
    } else {
      await ws.loadWorkspace(ws.conlangFilePath);
    }
    const updatedWs = useWorkspaceStore.getState();
    const curPath = updatedWs.activeLanguagePath;
    if (curPath) {
      await Promise.all([
        syncDomainStore("phonology", updatedWs.projectPath, curPath, event.origin, true),
        syncDomainStore("lexicon", updatedWs.projectPath, curPath, event.origin, true),
        syncDomainStore("grammar", updatedWs.projectPath, curPath, event.origin, true),
        syncDomainStore("sca", updatedWs.projectPath, curPath, event.origin, true),
        syncDomainStore("corpus", updatedWs.projectPath, curPath, event.origin, true),
      ]);
    }
    notifyExternalFontChanged();
  }
}

/**
 * Subscribe to Rust filesystem watcher events for the currently open project.
 */
export function useProjectWatcher(
  projectPath: string,
  conlangFilePath: string,
): void {
  useEffect(() => {
    if (!conlangFilePath || !projectPath || !hasTauriRuntime()) {
      return;
    }

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    const setup = async (): Promise<void> => {
      try {
        unlisten = await listen<WorkspaceFileChangedEvent>(
          "workspace-file-changed",
          (evt) => {
            if (!cancelled) {
              void handleWorkspaceFileChanged(evt.payload);
            }
          },
        );
        await invoke("watch_project", { projectPath });
      } catch (err) {
        console.warn(`Failed to initialize project watcher: ${err}`);
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
      invoke("unwatch_project").catch((err) => {
        console.warn(`Failed to stop project watcher: ${err}`);
      });
    };
  }, [projectPath, conlangFilePath]);
}
