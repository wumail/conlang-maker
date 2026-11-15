import { create } from "zustand";
import { pushUndoEntry, type HistoryOpts } from "./undoManager";
import { reportSaveError, reportSaveSuccess } from "./saveStatusTracker";
import { invoke } from "@tauri-apps/api/core";
import {
  CorpusIndexEntry,
  CorpusIndexLoadResult,
  CorpusText,
  CorpusTextLoadResult,
  GlossedLine,
  WriteResult,
} from "../types";
import {
  computeJsonDiffSummary,
  generateOperationId,
  isConflictError,
  mergeById,
  recordGuiOperationId,
  useConflictStore,
} from "./conflictStore";

interface CorpusStore {
  index: CorpusIndexEntry[];
  activeCorpusId: string | null;
  activeCorpus: CorpusText | null;
  projectPath: string;
  languagePath: string;
  indexRevision: string;
  corpusRevisions: Record<string, string>;
  dirty: boolean;
  paused: boolean;

  loadIndex: (projectPath: string, languagePath: string) => Promise<void>;
  loadCorpus: (corpusId: string) => Promise<void>;
  /** 读取当前语言全部语料正文（反向索引用；已打开的语料复用内存副本） */
  loadAllCorpusTexts: () => Promise<CorpusText[]>;
  upsertCorpus: (text: CorpusText, opts?: HistoryOpts) => void;
  deleteCorpus: (corpusId: string) => Promise<void>;
  setActiveCorpusId: (id: string | null) => void;
  flushSaves: () => Promise<void>;
  isDirty: (projectPath?: string, languagePath?: string) => boolean;
  pauseAutoSave: (projectPath?: string, languagePath?: string) => void;
  triggerExternalConflict: (
    projectPath: string,
    languagePath: string,
    origin?: "gui" | "mcp" | "external",
  ) => Promise<void>;

  // Gloss editing helpers
  updateGlossedLine: (lineId: string, line: GlossedLine, opts?: HistoryOpts) => void;
  addGlossedLine: (line: GlossedLine) => void;
  deleteGlossedLine: (lineId: string) => void;
}

interface PendingCorpusTimer {
  projectPath: string;
  languagePath: string;
  corpusId: string;
  operationId: string;
  version: number;
  timer: ReturnType<typeof setTimeout>;
}

interface LanguageCorpusTracker {
  indexRevision: string;
  corpusRevisions: Map<string, string>;
  corpusVersions: Map<string, number>;
  dirtyTexts: Map<string, CorpusText>;
  paused: boolean;
}

const saveTimers = new Map<string, PendingCorpusTimer>();
const langTrackers = new Map<string, LanguageCorpusTracker>();
const writeChains = new Map<string, Promise<void>>();

function makeLangKey(projectPath: string, languagePath: string): string {
  return JSON.stringify([projectPath, languagePath]);
}

function makeCorpusKey(
  projectPath: string,
  languagePath: string,
  corpusId: string,
): string {
  return JSON.stringify([projectPath, languagePath, corpusId]);
}

function getTracker(
  projectPath: string,
  languagePath: string,
): LanguageCorpusTracker {
  const key = makeLangKey(projectPath, languagePath);
  let tracker = langTrackers.get(key);
  if (!tracker) {
    tracker = {
      indexRevision: "missing",
      corpusRevisions: new Map(),
      corpusVersions: new Map(),
      dirtyTexts: new Map(),
      paused: false,
    };
    langTrackers.set(key, tracker);
  }
  return tracker;
}

function mergeGlossedLines(
  existing: GlossedLine[] | undefined,
  incoming: GlossedLine[],
): GlossedLine[] {
  if (!existing || existing.length === 0) return incoming;
  const byId = new Map<string, GlossedLine>();
  for (const line of existing) {
    byId.set(line.line_id, line);
  }
  return incoming.map((line) => {
    const prev = byId.get(line.line_id);
    if (!prev) return line;
    return {
      ...prev,
      ...line,
      tokens: mergeById(prev.tokens, line.tokens, "token_id"),
    };
  });
}

function mergeCorpusText(
  existing: CorpusText | null | undefined,
  incoming: CorpusText,
): CorpusText {
  if (!existing || existing.corpus_id !== incoming.corpus_id) {
    return incoming;
  }
  return {
    ...existing,
    ...incoming,
    glossed_lines: mergeGlossedLines(
      existing.glossed_lines,
      incoming.glossed_lines,
    ),
    metadata: {
      ...existing.metadata,
      ...incoming.metadata,
    },
  };
}

function enqueueCorpusWrite(
  projectPath: string,
  languagePath: string,
  task: () => Promise<void>,
): Promise<void> {
  const key = makeLangKey(projectPath, languagePath);
  const prev = writeChains.get(key) ?? Promise.resolve();
  const next = prev
    .catch((err) => {
      console.warn(`Previous corpus write error: ${err}`);
    })
    .then(task)
    .finally(() => {
      if (writeChains.get(key) === next) {
        writeChains.delete(key);
      }
    });
  writeChains.set(key, next);
  return next;
}

let loadGeneration = 0;
let corpusGeneration = 0;

export const useCorpusStore = create<CorpusStore>((set, get) => {
  const syncActiveState = (projectPath: string, languagePath: string): void => {
    if (get().projectPath === projectPath && get().languagePath === languagePath) {
      const tracker = getTracker(projectPath, languagePath);
      set({
        indexRevision: tracker.indexRevision,
        corpusRevisions: Object.fromEntries(tracker.corpusRevisions.entries()),
        dirty: tracker.dirtyTexts.size > 0,
        paused: tracker.paused,
      });
    }
  };

  const raiseConflict = async (
    projectPath: string,
    languagePath: string,
    origin: "gui" | "mcp" | "external" = "external",
    reason = "CONFLICT",
  ): Promise<void> => {
    const tracker = getTracker(projectPath, languagePath);
    tracker.paused = true;
    for (const [key, item] of saveTimers.entries()) {
      if (item.projectPath === projectPath && item.languagePath === languagePath) {
        clearTimeout(item.timer);
        saveTimers.delete(key);
      }
    }
    syncActiveState(projectPath, languagePath);

    let diskIndex: CorpusIndexEntry[] = [];
    let diskIndexRevision = tracker.indexRevision;
    try {
      const latestIdx = await invoke<CorpusIndexLoadResult>(
        "load_corpus_index_with_revision",
        { projectPath, languagePath },
      );
      diskIndex = latestIdx.entries;
      diskIndexRevision = latestIdx.revision;
    } catch (err) {
      console.warn(`Failed to load latest corpus index on conflict: ${err}`);
    }

    const dirtyArray = Array.from(tracker.dirtyTexts.values());
    const diskTexts: Record<string, CorpusText | "missing"> = {};
    for (const item of dirtyArray) {
      try {
        const res = await invoke<CorpusTextLoadResult>(
          "load_corpus_text_with_revision",
          { projectPath, languagePath, corpusId: item.corpus_id },
        );
        diskTexts[item.corpus_id] = res.corpus;
      } catch (err) {
        console.warn(`Corpus ${item.corpus_id} missing on disk during conflict check: ${err}`);
        diskTexts[item.corpus_id] = "missing";
      }
    }

    const localSummary = { dirty_texts: dirtyArray };
    const diskSummary = { index: diskIndex, texts: diskTexts };
    const diff = computeJsonDiffSummary(localSummary, diskSummary);

    useConflictStore.getState().upsertConflict(
      {
        key: `corpus:${makeLangKey(projectPath, languagePath)}`,
        kind: "corpus",
        projectPath,
        languagePath,
        languageId: dirtyArray[0]?.language_id ?? null,
        corpusId: dirtyArray[0]?.corpus_id ?? null,
        origin,
        diskRevision: diskIndexRevision,
        reason,
        changedFields: diff.changedFields,
        localPreview: diff.localPreview,
        diskPreview: diff.diskPreview,
      },
      {
        keepLocal: async () => {
          const latestIdx = await invoke<CorpusIndexLoadResult>(
            "load_corpus_index_with_revision",
            { projectPath, languagePath },
          );
          let idxRev = latestIdx.revision;
          for (const text of Array.from(tracker.dirtyTexts.values())) {
            let textRev = "missing";
            try {
              const loadedText = await invoke<CorpusTextLoadResult>(
                "load_corpus_text_with_revision",
                { projectPath, languagePath, corpusId: text.corpus_id },
              );
              textRev = loadedText.revision;
            } catch (err) {
              console.warn(`Corpus ${text.corpus_id} not yet on disk before Keep Local: ${err}`);
              textRev = "missing";
            }
            const opId = generateOperationId();
            recordGuiOperationId(opId);
            const writeRes = await invoke<WriteResult>("save_corpus_text", {
              projectPath,
              languagePath,
              text,
              expectedRevision: textRev,
              expectedIndexRevision: idxRev,
              operationId: opId,
            });
            tracker.corpusRevisions.set(
              text.corpus_id,
              writeRes.revisions?.corpus ?? writeRes.revision,
            );
            idxRev = writeRes.revisions?.corpus_index ?? idxRev;
          }
          tracker.indexRevision = idxRev;
          tracker.dirtyTexts.clear();
          tracker.paused = false;

          if (
            get().projectPath === projectPath &&
            get().languagePath === languagePath
          ) {
            const activeId = get().activeCorpusId;
            await get().loadIndex(projectPath, languagePath);
            if (activeId) {
              await get().loadCorpus(activeId);
            }
          }
        },
        useDisk: async () => {
          tracker.dirtyTexts.clear();
          tracker.paused = false;
          if (
            get().projectPath === projectPath &&
            get().languagePath === languagePath
          ) {
            const activeId = get().activeCorpusId;
            await get().loadIndex(projectPath, languagePath);
            if (activeId) {
              await get().loadCorpus(activeId);
            }
          } else {
            syncActiveState(projectPath, languagePath);
          }
        },
      },
    );
  };

  const executeCorpusSave = (
    projectPath: string,
    languagePath: string,
    corpusId: string,
    operationId: string,
    scheduledVersion: number,
  ): Promise<void> => {
    return enqueueCorpusWrite(projectPath, languagePath, async () => {
      const tracker = getTracker(projectPath, languagePath);
      if (tracker.paused) return;
      const text = tracker.dirtyTexts.get(corpusId);
      if (!text) return;

      const expectedRevision = tracker.corpusRevisions.get(corpusId) ?? "missing";
      const expectedIndexRevision = tracker.indexRevision;
      recordGuiOperationId(operationId);
      try {
        const res = await invoke<WriteResult>("save_corpus_text", {
          projectPath,
          languagePath,
          text,
          expectedRevision,
          expectedIndexRevision,
          operationId,
        });
        tracker.corpusRevisions.set(
          corpusId,
          res.revisions?.corpus ?? res.revision,
        );
        if (res.revisions?.corpus_index) {
          tracker.indexRevision = res.revisions.corpus_index;
        }
        if ((tracker.corpusVersions.get(corpusId) ?? 0) <= scheduledVersion) {
          tracker.dirtyTexts.delete(corpusId);
        }
        syncActiveState(projectPath, languagePath);
        reportSaveSuccess("corpus");
      } catch (err) {
        if (isConflictError(err)) {
          await raiseConflict(projectPath, languagePath);
          return;
        }
        console.warn(`语料保存失败：${err}`);
        reportSaveError("corpus", err instanceof Error ? err.message : String(err));
        if (
          (tracker.corpusVersions.get(corpusId) ?? 0) <= scheduledVersion &&
          !tracker.paused
        ) {
          scheduleDebouncedCorpusSave(
            projectPath,
            languagePath,
            corpusId,
            operationId,
          );
        }
      }
    });
  };

  const scheduleDebouncedCorpusSave = (
    projectPath: string,
    languagePath: string,
    corpusId: string,
    reuseOperationId?: string,
  ): void => {
    const tracker = getTracker(projectPath, languagePath);
    if (tracker.paused) return;
    const key = makeCorpusKey(projectPath, languagePath, corpusId);
    const existing = saveTimers.get(key);
    if (existing) clearTimeout(existing.timer);
    const operationId = reuseOperationId ?? generateOperationId();
    const version = tracker.corpusVersions.get(corpusId) ?? 0;

    const timer = setTimeout(() => {
      saveTimers.delete(key);
      void executeCorpusSave(
        projectPath,
        languagePath,
        corpusId,
        operationId,
        version,
      );
    }, 500);

    saveTimers.set(key, {
      projectPath,
      languagePath,
      corpusId,
      operationId,
      version,
      timer,
    });
  };

  return {
    index: [],
    activeCorpusId: null,
    activeCorpus: null,
    projectPath: ".",
    languagePath: "proto_language",
    indexRevision: "missing",
    corpusRevisions: {},
    dirty: false,
    paused: false,

    loadIndex: async (projectPath, languagePath) => {
      await get().flushSaves();
      const generation = ++loadGeneration;
      corpusGeneration += 1;
      try {
        const loaded = await invoke<CorpusIndexLoadResult>(
          "load_corpus_index_with_revision",
          { projectPath, languagePath },
        );
        if (generation !== loadGeneration) return;
        const tracker = getTracker(projectPath, languagePath);
        tracker.indexRevision = loaded.revision;
        tracker.dirtyTexts.clear();
        tracker.paused = false;
        set({
          index: loaded.entries,
          projectPath,
          languagePath,
          activeCorpus: null,
          activeCorpusId: null,
          indexRevision: loaded.revision,
          corpusRevisions: Object.fromEntries(tracker.corpusRevisions.entries()),
          dirty: false,
          paused: false,
        });
      } catch (err) {
        if (generation !== loadGeneration) return;
        console.warn(`加载语料索引失败：${err}`);
        throw err;
      }
    },

    loadCorpus: async (corpusId) => {
      const generation = ++corpusGeneration;
      const { projectPath, languagePath } = get();
      set({ activeCorpusId: corpusId, activeCorpus: null });
      try {
        const loaded = await invoke<CorpusTextLoadResult>(
          "load_corpus_text_with_revision",
          { projectPath, languagePath, corpusId },
        );
        if (
          generation !== corpusGeneration ||
          get().projectPath !== projectPath ||
          get().languagePath !== languagePath ||
          get().activeCorpusId !== corpusId
        ) {
          return;
        }
        const tracker = getTracker(projectPath, languagePath);
        tracker.corpusRevisions.set(corpusId, loaded.revision);
        set({
          activeCorpus: loaded.corpus,
          activeCorpusId: corpusId,
          corpusRevisions: Object.fromEntries(tracker.corpusRevisions.entries()),
        });
      } catch (err) {
        console.warn(`加载语料失败：${err}`);
      }
    },

    upsertCorpus: (text, opts) => {
      const { projectPath, languagePath, index, activeCorpus } = get();
      const prevCorpus =
        activeCorpus && activeCorpus.corpus_id === text.corpus_id ? activeCorpus : null;
      const tracker = getTracker(projectPath, languagePath);
      const mergedText = mergeCorpusText(
        tracker.dirtyTexts.get(text.corpus_id) ?? activeCorpus,
        text,
      );

      const idx = index.findIndex((e) => e.corpus_id === mergedText.corpus_id);
      const prevEntry = idx >= 0 ? index[idx] : undefined;
      const newIndexEntry: CorpusIndexEntry = {
        ...(prevEntry ?? {}),
        corpus_id: mergedText.corpus_id,
        title: mergedText.title,
        description: mergedText.description,
        metadata: {
          ...(prevEntry?.metadata ?? {}),
          ...mergedText.metadata,
        },
      };
      const newIndex =
        idx >= 0
          ? index.map((e, i) => (i === idx ? newIndexEntry : e))
          : [...index, newIndexEntry];

      const nextVer = (tracker.corpusVersions.get(mergedText.corpus_id) ?? 0) + 1;
      tracker.corpusVersions.set(mergedText.corpus_id, nextVer);
      tracker.dirtyTexts.set(mergedText.corpus_id, mergedText);

      set({
        activeCorpus: mergedText,
        activeCorpusId: mergedText.corpus_id,
        index: newIndex,
        dirty: true,
      });

      scheduleDebouncedCorpusSave(projectPath, languagePath, mergedText.corpus_id);

      if (!opts?.skipHistory) {
        const nextSnapshot = structuredClone(mergedText);
        const prevSnapshot = prevCorpus ? structuredClone(prevCorpus) : null;
        pushUndoEntry({
          languageId: languagePath,
          domain: "corpus",
          labelKey: opts?.labelKey ?? "undo.label.corpus.edit",
          coalesceKey:
            opts?.coalesceKey ?? `corpus:${mergedText.corpus_id}:${mergedText.glossed_lines.length}`,
          undo: () => {
            if (prevSnapshot) {
              get().upsertCorpus(structuredClone(prevSnapshot), { skipHistory: true });
              return;
            }
            // 新建语料的撤销：没有前像可恢复，只能把刚创建的语料删掉
            return get().deleteCorpus(text.corpus_id);
          },
          redo: () => get().upsertCorpus(structuredClone(nextSnapshot), { skipHistory: true }),
        });
      }
    },

    loadAllCorpusTexts: async () => {
      const { projectPath, languagePath, index, activeCorpus } = get();
      const texts: CorpusText[] = [];
      for (const entry of index) {
        if (activeCorpus && activeCorpus.corpus_id === entry.corpus_id) {
          texts.push(activeCorpus);
          continue;
        }
        try {
          const loaded = await invoke<CorpusTextLoadResult>(
            "load_corpus_text_with_revision",
            { projectPath, languagePath, corpusId: entry.corpus_id },
          );
          texts.push(loaded.corpus);
        } catch (err) {
          console.warn(`加载语料 ${entry.corpus_id} 失败：${err}`);
        }
      }
      return texts;
    },

    deleteCorpus: async (corpusId) => {
      const { projectPath, languagePath } = get();
      const tracker = getTracker(projectPath, languagePath);
      const saveKey = makeCorpusKey(projectPath, languagePath, corpusId);
      const pendingTimer = saveTimers.get(saveKey);
      if (pendingTimer) {
        clearTimeout(pendingTimer.timer);
        saveTimers.delete(saveKey);
      }
      tracker.dirtyTexts.delete(corpusId);

      set((state) => ({
        index: state.index.filter((e) => e.corpus_id !== corpusId),
        activeCorpusId:
          state.activeCorpusId === corpusId ? null : state.activeCorpusId,
        activeCorpus:
          state.activeCorpusId === corpusId ? null : state.activeCorpus,
      }));
      syncActiveState(projectPath, languagePath);

      const expectedRevision = tracker.corpusRevisions.get(corpusId);
      const operationId = generateOperationId();
      await enqueueCorpusWrite(projectPath, languagePath, async () => {
        if (tracker.paused) return;
        recordGuiOperationId(operationId);
        try {
          const res = await invoke<WriteResult>("delete_corpus_text", {
            projectPath,
            languagePath,
            corpusId,
            expectedRevision,
            expectedIndexRevision: tracker.indexRevision,
            operationId,
          });
          tracker.corpusRevisions.delete(corpusId);
          tracker.indexRevision =
            res.revisions?.corpus_index ?? res.revision ?? tracker.indexRevision;
          syncActiveState(projectPath, languagePath);
        } catch (err) {
          if (isConflictError(err)) {
            await raiseConflict(projectPath, languagePath);
            return;
          }
          console.warn(`删除语料失败：${err}`);
          reportSaveError("corpus", err instanceof Error ? err.message : String(err));
          await get().loadIndex(projectPath, languagePath);
        }
      });
    },

    setActiveCorpusId: (id) => {
      set({ activeCorpusId: id });
      if (id) {
        void get().loadCorpus(id);
      } else {
        set({ activeCorpus: null });
      }
    },

    flushSaves: async () => {
      const due = Array.from(saveTimers.entries());
      for (const [key, item] of due) {
        clearTimeout(item.timer);
        saveTimers.delete(key);
        void executeCorpusSave(
          item.projectPath,
          item.languagePath,
          item.corpusId,
          item.operationId,
          item.version,
        );
      }
      await Promise.all(Array.from(writeChains.values()));
    },

    isDirty: (projectPath, languagePath) => {
      const p = projectPath ?? get().projectPath;
      const l = languagePath ?? get().languagePath;
      const tracker = langTrackers.get(makeLangKey(p, l));
      if (tracker && tracker.dirtyTexts.size > 0) return true;
      for (const item of saveTimers.values()) {
        if (item.projectPath === p && item.languagePath === l) return true;
      }
      return writeChains.has(makeLangKey(p, l));
    },

    pauseAutoSave: (projectPath, languagePath) => {
      const p = projectPath ?? get().projectPath;
      const l = languagePath ?? get().languagePath;
      const tracker = getTracker(p, l);
      tracker.paused = true;
      for (const [key, item] of saveTimers.entries()) {
        if (item.projectPath === p && item.languagePath === l) {
          clearTimeout(item.timer);
          saveTimers.delete(key);
        }
      }
      syncActiveState(p, l);
    },

    triggerExternalConflict: async (
      projectPath,
      languagePath,
      origin = "external",
    ) => {
      await raiseConflict(
        projectPath,
        languagePath,
        origin,
        "External file change detected while local corpus has unsaved edits",
      );
    },

    // ── Gloss editing helpers ──

    updateGlossedLine: (lineId, line, opts) => {
      const corpus = get().activeCorpus;
      if (!corpus) return;
      const updated: CorpusText = {
        ...corpus,
        glossed_lines: corpus.glossed_lines.map((l) =>
          l.line_id === lineId
            ? {
                ...l,
                ...line,
                tokens: mergeById(l.tokens, line.tokens, "token_id"),
              }
            : l,
        ),
        metadata: { ...corpus.metadata, updated_at: new Date().toISOString() },
      };
      get().upsertCorpus(updated, opts);
    },

    addGlossedLine: (line) => {
      const corpus = get().activeCorpus;
      if (!corpus) return;
      const updated: CorpusText = {
        ...corpus,
        glossed_lines: [...corpus.glossed_lines, line],
        metadata: { ...corpus.metadata, updated_at: new Date().toISOString() },
      };
      get().upsertCorpus(updated);
    },

    deleteGlossedLine: (lineId) => {
      const corpus = get().activeCorpus;
      if (!corpus) return;
      const updated: CorpusText = {
        ...corpus,
        glossed_lines: corpus.glossed_lines.filter((l) => l.line_id !== lineId),
        metadata: { ...corpus.metadata, updated_at: new Date().toISOString() },
      };
      get().upsertCorpus(updated);
    },
  };
});
