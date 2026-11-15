import { create } from "zustand";
import { pushUndoEntry, type HistoryOpts } from "./undoManager";
import { invalidateLineageLexicon } from "./lineageLexiconStore";
import { reportSaveError, reportSaveSuccess } from "./saveStatusTracker";
import { invoke } from "@tauri-apps/api/core";
import {
  LexiconLoadResult,
  Sense,
  WordEntry,
  WriteResult,
} from "../types";
import { isValidWordEntry } from "../core/lexicon/utils";
import {
  computeJsonDiffSummary,
  generateOperationId,
  isConflictError,
  mergeById,
  recordGuiOperationId,
  useConflictStore,
} from "./conflictStore";

interface LexiconStore {
  wordsMap: Record<string, WordEntry>;
  wordsList: WordEntry[];
  searchTerm: string;
  activeWordId: string | null;
  projectPath: string;
  languagePath: string;
  revision: string;
  skipped: number;
  dirty: boolean;
  paused: boolean;

  setProjectPath: (path: string) => void;
  setLanguagePath: (path: string) => void;
  loadWords: (words: WordEntry[]) => void;
  loadFromBackend: (projectPath: string, languagePath: string) => Promise<void>;
  upsertWord: (word: WordEntry, opts?: HistoryOpts) => void;
  deleteWord: (entryId: string, opts?: HistoryOpts) => void;
  deleteWordsBatch: (entryIds: string[]) => Promise<void>;
  setSearchTerm: (term: string) => void;
  setActiveWordId: (id: string | null) => void;
  /** 批量导入词条（走单次 Tauri command，不触发逐条 debounce） */
  importWords: (words: WordEntry[]) => void;

  flushSaves: () => Promise<void>;
  isDirty: (projectPath?: string, languagePath?: string) => boolean;
  pauseAutoSave: (projectPath?: string, languagePath?: string) => void;
  triggerExternalConflict: (
    projectPath: string,
    languagePath: string,
    origin?: "gui" | "mcp" | "external",
  ) => Promise<void>;
}

interface PendingWordTimer {
  projectPath: string;
  languagePath: string;
  entryId: string;
  operationId: string;
  version: number;
  timer: ReturnType<typeof setTimeout>;
}

interface LanguageLexiconTracker {
  revision: string;
  paused: boolean;
  wordVersions: Map<string, number>;
  dirtyWords: Map<string, WordEntry>;
  deletedWords: Map<string, string>;
}

/** 以实体 ID 为粒度的 debounce timers，防止不同词条的保存互相取消 */
const saveTimers = new Map<string, PendingWordTimer>();
/** 记录每个词条在当前 debounce 周期内的首个旧拼写，避免后续 upsert 覆盖丢失 */
const pendingOldRomanized = new Map<string, string>();
/** Per-language revision & dirty tracking */
const langTrackers = new Map<string, LanguageLexiconTracker>();
/** Per-language serialized write queue so expectedRevision chains cleanly */
const writeChains = new Map<string, Promise<void>>();

function makeLangKey(projectPath: string, languagePath: string): string {
  return JSON.stringify([projectPath, languagePath]);
}

function makeWordKey(
  projectPath: string,
  languagePath: string,
  entryId: string,
): string {
  return JSON.stringify([projectPath, languagePath, entryId]);
}

function getTracker(
  projectPath: string,
  languagePath: string,
): LanguageLexiconTracker {
  const key = makeLangKey(projectPath, languagePath);
  let tracker = langTrackers.get(key);
  if (!tracker) {
    tracker = {
      revision: "missing",
      paused: false,
      wordVersions: new Map(),
      dirtyWords: new Map(),
      deletedWords: new Map(),
    };
    langTrackers.set(key, tracker);
  }
  return tracker;
}

function hasPendingWork(projectPath: string, languagePath: string): boolean {
  const tracker = langTrackers.get(makeLangKey(projectPath, languagePath));
  if (tracker && (tracker.dirtyWords.size > 0 || tracker.deletedWords.size > 0)) {
    return true;
  }
  for (const item of saveTimers.values()) {
    if (item.projectPath === projectPath && item.languagePath === languagePath) {
      return true;
    }
  }
  return writeChains.has(makeLangKey(projectPath, languagePath));
}

/**
 * 已知标准字段集合。
 *
 * 合并 `existing` 与 `incoming` 时只有**不在这些集合中的未知扩展字段**才从旧值保留；
 * 已知可选字段（`inflection_class_id`、`usage_note`、`concept_id`、`semantic_change_kind`、
 * `borrowed_source`、`components` …）一律以 `incoming` 为准，避免「置空后又复活」。
 */
const KNOWN_WORD_KEYS = new Set<string>([
  "entry_id",
  "language_id",
  "con_word_romanized",
  "phonetic_ipa",
  "phonetic_override",
  "inflection_class_id",
  "senses",
  "etymology",
  "metadata",
  "evolution",
]);

const KNOWN_ETYMOLOGY_KEYS = new Set<string>([
  "origin_type",
  "parent_entry_id",
  "source_language_id",
  "applied_sound_changes",
  "semantic_shift_note",
  "semantic_change_kind",
  "borrowed_source",
  "components",
  "compounds_stale_digest",
]);

const KNOWN_SENSE_KEYS = new Set<string>([
  "sense_id",
  "pos_id",
  "gloss",
  "definitions",
  "examples",
  "grammatical_function",
  "concept_id",
  "usage_note",
  "inflection_class_id",
]);

const KNOWN_METADATA_KEYS = new Set<string>(["tags", "created_at", "updated_at"]);

/** 只挑出 `source` 中不属于标准字段的未知扩展字段（用于向后兼容外部写入） */
function pickUnknown<T extends object>(source: T, known: Set<string>): Partial<T> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!known.has(key)) extra[key] = value;
  }
  return extra as Partial<T>;
}

function mergeSenseEntry(existing: Sense, incoming: Sense): Sense {
  return {
    ...pickUnknown(existing, KNOWN_SENSE_KEYS),
    ...incoming,
  };
}

function mergeWordEntry(
  existing: WordEntry | undefined,
  incoming: WordEntry,
): WordEntry {
  if (!existing) return incoming;
  return {
    ...pickUnknown(existing, KNOWN_WORD_KEYS),
    ...incoming,
    senses: mergeById(existing.senses, incoming.senses, "sense_id", mergeSenseEntry),
    etymology: {
      ...pickUnknown(existing.etymology, KNOWN_ETYMOLOGY_KEYS),
      ...incoming.etymology,
    },
    metadata: {
      ...pickUnknown(existing.metadata, KNOWN_METADATA_KEYS),
      ...incoming.metadata,
    },
    evolution: incoming.evolution
      ? { ...(existing.evolution ?? {}), ...incoming.evolution }
      : existing.evolution,
  };
}

function rebuildList(wordsMap: Record<string, WordEntry>): WordEntry[] {
  return Object.values(wordsMap).sort((a, b) =>
    a.con_word_romanized.localeCompare(b.con_word_romanized),
  );
}

function enqueueLangWrite(
  projectPath: string,
  languagePath: string,
  task: () => Promise<void>,
): Promise<void> {
  const key = makeLangKey(projectPath, languagePath);
  const prev = writeChains.get(key) ?? Promise.resolve();
  const next = prev
    .catch((err) => {
      console.warn(`Previous lexicon write error: ${err}`);
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

export const useLexiconStore = create<LexiconStore>((set, get) => {
  const syncActiveFlags = (projectPath: string, languagePath: string): void => {
    const state = get();
    if (state.projectPath === projectPath && state.languagePath === languagePath) {
      const tracker = getTracker(projectPath, languagePath);
      set({
        revision: tracker.revision,
        paused: tracker.paused,
        dirty:
          tracker.dirtyWords.size > 0 || tracker.deletedWords.size > 0,
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
    syncActiveFlags(projectPath, languagePath);

    let diskWords: WordEntry[] = [];
    let diskRevision = tracker.revision;
    try {
      const latest = await invoke<LexiconLoadResult>(
        "load_all_words_with_revision",
        { projectPath, languagePath },
      );
      diskWords = latest.words;
      diskRevision = latest.revision;
    } catch (err) {
      console.warn(`Failed to fetch latest lexicon on conflict: ${err}`);
    }

    const dirtyEntries = Array.from(tracker.dirtyWords.values());
    const deletedIds = Array.from(tracker.deletedWords.keys());
    const diskSample = diskWords.filter(
      (w) => tracker.dirtyWords.has(w.entry_id) || tracker.deletedWords.has(w.entry_id),
    );
    const localSummary = {
      modified_words: dirtyEntries,
      deleted_entry_ids: deletedIds,
    };
    const diskSummary = {
      matching_disk_words: diskSample,
      total_disk_words: diskWords.length,
    };
    const diff = computeJsonDiffSummary(localSummary, diskSummary);
    const conflictKey = `lexicon:${makeLangKey(projectPath, languagePath)}`;

    useConflictStore.getState().upsertConflict(
      {
        key: conflictKey,
        kind: "lexicon",
        projectPath,
        languagePath,
        languageId: dirtyEntries[0]?.language_id ?? null,
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
          const latest = await invoke<LexiconLoadResult>(
            "load_all_words_with_revision",
            { projectPath, languagePath },
          );
          let rev = latest.revision;
          const wordsToSave = Array.from(tracker.dirtyWords.values()).filter(
            isValidWordEntry,
          );
          const idsToDelete = Array.from(tracker.deletedWords.keys());

          if (wordsToSave.length > 0) {
            const opId = generateOperationId();
            recordGuiOperationId(opId);
            const res = await invoke<WriteResult>("save_words_batch", {
              projectPath,
              languagePath,
              words: wordsToSave,
              expectedRevision: rev,
              operationId: opId,
            });
            rev = res.revision;
          }
          if (idsToDelete.length > 0) {
            const opId = generateOperationId();
            recordGuiOperationId(opId);
            const res = await invoke<WriteResult>("delete_words_batch", {
              projectPath,
              languagePath,
              entryIds: idsToDelete,
              expectedRevision: rev,
              operationId: opId,
            });
            rev = res.revision;
          }

          tracker.dirtyWords.clear();
          tracker.deletedWords.clear();
          tracker.paused = false;
          tracker.revision = rev;
          pendingOldRomanized.clear();

          if (get().projectPath === projectPath && get().languagePath === languagePath) {
            await get().loadFromBackend(projectPath, languagePath);
          }
        },
        useDisk: async () => {
          tracker.dirtyWords.clear();
          tracker.deletedWords.clear();
          tracker.paused = false;
          for (const key of Array.from(pendingOldRomanized.keys())) {
            if (key.includes(JSON.stringify(languagePath))) {
              pendingOldRomanized.delete(key);
            }
          }
          if (get().projectPath === projectPath && get().languagePath === languagePath) {
            await get().loadFromBackend(projectPath, languagePath);
          } else {
            syncActiveFlags(projectPath, languagePath);
          }
        },
      },
    );
  };

  const executeWordSave = (
    projectPath: string,
    languagePath: string,
    entryId: string,
    operationId: string,
    scheduledVersion: number,
  ): Promise<void> => {
    const wordKey = makeWordKey(projectPath, languagePath, entryId);
    const effectiveOldRomanized = pendingOldRomanized.get(wordKey) ?? null;

    return enqueueLangWrite(projectPath, languagePath, async () => {
      const tracker = getTracker(projectPath, languagePath);
      if (tracker.paused) return;
      const word = tracker.dirtyWords.get(entryId);
      if (!word || !isValidWordEntry(word)) return;

      recordGuiOperationId(operationId);
      try {
        const result = await invoke<WriteResult>("save_word", {
          projectPath,
          languagePath,
          word,
          oldRomanized: effectiveOldRomanized,
          expectedRevision: tracker.revision,
          operationId,
        });
        tracker.revision = result.revision;
        pendingOldRomanized.delete(wordKey);
        if ((tracker.wordVersions.get(entryId) ?? 0) <= scheduledVersion) {
          tracker.dirtyWords.delete(entryId);
        }
        syncActiveFlags(projectPath, languagePath);
        // 落盘成功：谱系词库缓存（跨语言检索/推演的数据源）已过期
        invalidateLineageLexicon(projectPath, languagePath);
        reportSaveSuccess("lexicon");
      } catch (err) {
        if (isConflictError(err)) {
          await raiseConflict(projectPath, languagePath);
          return;
        }
        console.warn(`保存词条失败：${err}`);
        reportSaveError("lexicon", err instanceof Error ? err.message : String(err));
        // 词条保留在 tracker.dirtyWords 中，由 flushSaves()／顶栏「重试」统一重试。
        // 严禁在此处再次 scheduleDebouncedWordSave：那会形成每秒 2 次的无限重试死循环。
      }
    });
  };

  const scheduleDebouncedWordSave = (
    projectPath: string,
    languagePath: string,
    entryId: string,
    reuseOperationId?: string,
  ): void => {
    const tracker = getTracker(projectPath, languagePath);
    if (tracker.paused) return;
    const wordKey = makeWordKey(projectPath, languagePath, entryId);
    const existing = saveTimers.get(wordKey);
    if (existing) clearTimeout(existing.timer);
    const operationId = reuseOperationId ?? generateOperationId();
    const version = tracker.wordVersions.get(entryId) ?? 0;

    const timer = setTimeout(() => {
      saveTimers.delete(wordKey);
      void executeWordSave(
        projectPath,
        languagePath,
        entryId,
        operationId,
        version,
      );
    }, 500);

    saveTimers.set(wordKey, {
      projectPath,
      languagePath,
      entryId,
      operationId,
      version,
      timer,
    });
  };

  /**
   * 把某语言下滞留的「脏词条 / 待删除词条」合并成一次批量落盘。
   *
   * 供 `flushSaves()` 复用：单条保存失败后词条只留在 `dirtyWords` 中、
   * 不再自动重排定时器，因此顶栏「重试」必须走这里才能真正重新写盘。
   */
  const retryPendingWrites = (
    projectPath: string,
    languagePath: string,
  ): Promise<void> => {
    const tracker = getTracker(projectPath, languagePath);
    if (tracker.paused) return Promise.resolve();

    const words = Array.from(tracker.dirtyWords.values()).filter(isValidWordEntry);
    const deletedIds = Array.from(tracker.deletedWords.keys());
    if (words.length === 0 && deletedIds.length === 0) return Promise.resolve();

    const versions = new Map<string, number>();
    words.forEach((word) => {
      versions.set(word.entry_id, tracker.wordVersions.get(word.entry_id) ?? 0);
    });
    const operationId = generateOperationId();

    return enqueueLangWrite(projectPath, languagePath, async () => {
      if (tracker.paused) return;
      recordGuiOperationId(operationId);
      try {
        let revision = tracker.revision;
        if (words.length > 0) {
          const saved = await invoke<WriteResult>("save_words_batch", {
            projectPath,
            languagePath,
            words,
            expectedRevision: revision,
            operationId,
          });
          revision = saved.revision;
          words.forEach((word) => {
            if ((tracker.wordVersions.get(word.entry_id) ?? 0) <= (versions.get(word.entry_id) ?? 0)) {
              tracker.dirtyWords.delete(word.entry_id);
            }
          });
        }
        if (deletedIds.length > 0) {
          const removed = await invoke<WriteResult>("delete_words_batch", {
            projectPath,
            languagePath,
            entryIds: deletedIds,
            expectedRevision: revision,
            operationId,
          });
          revision = removed.revision;
          deletedIds.forEach((id) => tracker.deletedWords.delete(id));
        }
        tracker.revision = revision;
        syncActiveFlags(projectPath, languagePath);
        invalidateLineageLexicon(projectPath, languagePath);
        reportSaveSuccess("lexicon");
      } catch (err) {
        if (isConflictError(err)) {
          await raiseConflict(projectPath, languagePath);
          return;
        }
        console.warn(`重试保存词条失败：${err}`);
        reportSaveError("lexicon", err instanceof Error ? err.message : String(err));
      }
    });
  };

  return {
    wordsMap: {},
    wordsList: [],
    searchTerm: "",
    activeWordId: null,
    projectPath: ".",
    languagePath: "proto_language",
    revision: "missing",
    skipped: 0,
    dirty: false,
    paused: false,

    setProjectPath: (path) => set({ projectPath: path }),
    setLanguagePath: (path) => set({ languagePath: path }),

    loadWords: (words) => {
      const wordsMap: Record<string, WordEntry> = {};
      words.forEach((w) => {
        wordsMap[w.entry_id] = w;
      });
      set({ wordsMap, wordsList: rebuildList(wordsMap) });
    },

    loadFromBackend: async (projectPath: string, languagePath: string) => {
      await get().flushSaves();
      const generation = ++loadGeneration;
      try {
        const loaded = await invoke<LexiconLoadResult>(
          "load_all_words_with_revision",
          {
            projectPath,
            languagePath,
          },
        );
        if (generation !== loadGeneration) return;
        const tracker = getTracker(projectPath, languagePath);
        tracker.revision = loaded.revision;
        tracker.paused = false;
        tracker.dirtyWords.clear();
        tracker.deletedWords.clear();

        const wordsMap: Record<string, WordEntry> = {};
        loaded.words.forEach((w) => {
          wordsMap[w.entry_id] = w;
        });
        set({
          wordsMap,
          wordsList: rebuildList(wordsMap),
          projectPath,
          languagePath,
          revision: loaded.revision,
          skipped: loaded.skipped.length,
          dirty: false,
          paused: false,
        });
      } catch (err) {
        if (generation !== loadGeneration) return;
        console.error("Failed to load words:", err);
        throw err;
      }
    },

    upsertWord: (word, opts) => {
      const { projectPath, languagePath } = get();
      const tracker = getTracker(projectPath, languagePath);
      const wordKey = makeWordKey(projectPath, languagePath, word.entry_id);
      const prevWord = get().wordsMap[word.entry_id] ?? null;
      let mergedWord = word;

      set((state) => {
        const existing = state.wordsMap[word.entry_id];
        if (
          existing &&
          existing.con_word_romanized !== word.con_word_romanized &&
          !pendingOldRomanized.has(wordKey)
        ) {
          pendingOldRomanized.set(wordKey, existing.con_word_romanized);
        }
        mergedWord = mergeWordEntry(existing, word);
        const wordsMap = { ...state.wordsMap, [word.entry_id]: mergedWord };
        return { wordsMap, wordsList: rebuildList(wordsMap) };
      });

      if (!isValidWordEntry(mergedWord)) {
        return;
      }

      const nextVer = (tracker.wordVersions.get(mergedWord.entry_id) ?? 0) + 1;
      tracker.wordVersions.set(mergedWord.entry_id, nextVer);
      tracker.dirtyWords.set(mergedWord.entry_id, mergedWord);
      tracker.deletedWords.delete(mergedWord.entry_id);
      syncActiveFlags(projectPath, languagePath);
      // 内存已改：立即失效谱系缓存，避免其它语言检索到修改前的词条
      invalidateLineageLexicon(projectPath, languagePath);

      scheduleDebouncedWordSave(projectPath, languagePath, mergedWord.entry_id);

      if (!opts?.skipHistory) {
        const nextSnapshot = structuredClone(mergedWord);
        const prevSnapshot = prevWord ? structuredClone(prevWord) : null;
        pushUndoEntry({
          languageId: languagePath,
          domain: "lexicon",
          labelKey: opts?.labelKey ?? "undo.label.lexicon.edit",
          // 空串表示离散/无合并动作；默认按词条合并连续输入
          coalesceKey:
            opts?.coalesceKey === ""
              ? undefined
              : (opts?.coalesceKey ?? `lex:${mergedWord.entry_id}`),
          undo: () => {
            if (prevSnapshot) {
              get().upsertWord(structuredClone(prevSnapshot), { skipHistory: true });
            } else {
              get().deleteWord(nextSnapshot.entry_id, { skipHistory: true });
            }
          },
          redo: () => {
            get().upsertWord(structuredClone(nextSnapshot), { skipHistory: true });
          },
        });
      }
    },

    importWords: (words) => {
      const { projectPath, languagePath } = get();
      const tracker = getTracker(projectPath, languagePath);
      const validIncoming = words.filter(isValidWordEntry);
      if (validIncoming.length === 0) return;

      const mergedBatch: WordEntry[] = [];
      set((state) => {
        const wordsMap = { ...state.wordsMap };
        validIncoming.forEach((w) => {
          const merged = mergeWordEntry(wordsMap[w.entry_id], w);
          wordsMap[w.entry_id] = merged;
          mergedBatch.push(merged);
          const nextVer = (tracker.wordVersions.get(merged.entry_id) ?? 0) + 1;
          tracker.wordVersions.set(merged.entry_id, nextVer);
          tracker.dirtyWords.set(merged.entry_id, merged);
          tracker.deletedWords.delete(merged.entry_id);

          const wordKey = makeWordKey(projectPath, languagePath, merged.entry_id);
          const pendingTimer = saveTimers.get(wordKey);
          if (pendingTimer) {
            clearTimeout(pendingTimer.timer);
            saveTimers.delete(wordKey);
          }
        });
        return { wordsMap, wordsList: rebuildList(wordsMap) };
      });
      syncActiveFlags(projectPath, languagePath);

      if (tracker.paused) return;
      const batchVersions = new Map<string, number>();
      mergedBatch.forEach((w) => {
        batchVersions.set(w.entry_id, tracker.wordVersions.get(w.entry_id) ?? 0);
      });
      const operationId = generateOperationId();

      void enqueueLangWrite(projectPath, languagePath, async () => {
        if (tracker.paused) return;
        recordGuiOperationId(operationId);
        try {
          const res = await invoke<WriteResult>("save_words_batch", {
            projectPath,
            languagePath,
            words: mergedBatch,
            expectedRevision: tracker.revision,
            operationId,
          });
          tracker.revision = res.revision;
          mergedBatch.forEach((w) => {
            const targetVer = batchVersions.get(w.entry_id) ?? 0;
            if ((tracker.wordVersions.get(w.entry_id) ?? 0) <= targetVer) {
              tracker.dirtyWords.delete(w.entry_id);
            }
          });
          syncActiveFlags(projectPath, languagePath);
          invalidateLineageLexicon(projectPath, languagePath);
          reportSaveSuccess("lexicon");
        } catch (err) {
          if (isConflictError(err)) {
            await raiseConflict(projectPath, languagePath);
            return;
          }
          console.warn(`批量保存词条失败：${err}`);
          reportSaveError("lexicon", err instanceof Error ? err.message : String(err));
        }
      });
    },

    deleteWord: (entryId, opts) => {
      const wordToDelete = get().wordsMap[entryId];
      if (!wordToDelete) return;

      const { projectPath, languagePath } = get();
      const tracker = getTracker(projectPath, languagePath);
      const saveKey = makeWordKey(projectPath, languagePath, entryId);
      const timer = saveTimers.get(saveKey);
      if (timer) {
        clearTimeout(timer.timer);
        saveTimers.delete(saveKey);
      }
      pendingOldRomanized.delete(saveKey);

      const nextVer = (tracker.wordVersions.get(entryId) ?? 0) + 1;
      tracker.wordVersions.set(entryId, nextVer);
      tracker.dirtyWords.delete(entryId);
      tracker.deletedWords.set(entryId, wordToDelete.con_word_romanized);

      set((state) => {
        const wordsMap = { ...state.wordsMap };
        delete wordsMap[entryId];
        return {
          wordsMap,
          wordsList: rebuildList(wordsMap),
          activeWordId: state.activeWordId === entryId ? null : state.activeWordId,
        };
      });
      syncActiveFlags(projectPath, languagePath);
      // 内存已改：立即失效谱系缓存，避免其它语言仍检索到已删除的词条
      invalidateLineageLexicon(projectPath, languagePath);

      if (!opts?.skipHistory) {
        const deletedSnapshot = structuredClone(wordToDelete);
        pushUndoEntry({
          languageId: languagePath,
          domain: "lexicon",
          labelKey: opts?.labelKey ?? "undo.label.lexicon.delete",
          coalesceKey: opts?.coalesceKey,
          undo: () => get().upsertWord(structuredClone(deletedSnapshot), { skipHistory: true }),
          redo: () => get().deleteWord(deletedSnapshot.entry_id, { skipHistory: true }),
        });
      }

      if (tracker.paused) return;
      const operationId = generateOperationId();
      void enqueueLangWrite(projectPath, languagePath, async () => {
        if (tracker.paused) return;
        recordGuiOperationId(operationId);
        try {
          const res = await invoke<WriteResult>("delete_word", {
            projectPath,
            languagePath,
            entryId,
            conWordRomanized: wordToDelete.con_word_romanized,
            expectedRevision: tracker.revision,
            operationId,
          });
          tracker.revision = res.revision;
          if ((tracker.wordVersions.get(entryId) ?? 0) <= nextVer) {
            tracker.deletedWords.delete(entryId);
          }
          syncActiveFlags(projectPath, languagePath);
          invalidateLineageLexicon(projectPath, languagePath);
          reportSaveSuccess("lexicon");
        } catch (err) {
          if (isConflictError(err)) {
            await raiseConflict(projectPath, languagePath);
            return;
          }
          console.warn(`删除失败：${err}`);
          reportSaveError("lexicon", err instanceof Error ? err.message : String(err));
        }
      });
    },

    deleteWordsBatch: async (entryIds) => {
      if (entryIds.length === 0) return;
      const { projectPath, languagePath, wordsMap } = get();
      const tracker = getTracker(projectPath, languagePath);
      const existingIds = entryIds.filter((id) => Boolean(wordsMap[id]));
      if (existingIds.length === 0) return;

      const versions = new Map<string, number>();
      existingIds.forEach((entryId) => {
        const saveKey = makeWordKey(projectPath, languagePath, entryId);
        const timer = saveTimers.get(saveKey);
        if (timer) {
          clearTimeout(timer.timer);
          saveTimers.delete(saveKey);
        }
        pendingOldRomanized.delete(saveKey);
        const nextVer = (tracker.wordVersions.get(entryId) ?? 0) + 1;
        tracker.wordVersions.set(entryId, nextVer);
        versions.set(entryId, nextVer);
        tracker.dirtyWords.delete(entryId);
        tracker.deletedWords.set(
          entryId,
          wordsMap[entryId]?.con_word_romanized ?? "",
        );
      });

      set((state) => {
        const nextMap = { ...state.wordsMap };
        const idSet = new Set(existingIds);
        existingIds.forEach((id) => {
          delete nextMap[id];
        });
        return {
          wordsMap: nextMap,
          wordsList: rebuildList(nextMap),
          activeWordId:
            state.activeWordId && idSet.has(state.activeWordId)
              ? null
              : state.activeWordId,
        };
      });
      syncActiveFlags(projectPath, languagePath);

      if (tracker.paused) return;
      const operationId = generateOperationId();
      await enqueueLangWrite(projectPath, languagePath, async () => {
        if (tracker.paused) return;
        recordGuiOperationId(operationId);
        try {
          const res = await invoke<WriteResult>("delete_words_batch", {
            projectPath,
            languagePath,
            entryIds: existingIds,
            expectedRevision: tracker.revision,
            operationId,
          });
          tracker.revision = res.revision;
          existingIds.forEach((id) => {
            if ((tracker.wordVersions.get(id) ?? 0) <= (versions.get(id) ?? 0)) {
              tracker.deletedWords.delete(id);
            }
          });
          syncActiveFlags(projectPath, languagePath);
          invalidateLineageLexicon(projectPath, languagePath);
          reportSaveSuccess("lexicon");
        } catch (err) {
          if (isConflictError(err)) {
            await raiseConflict(projectPath, languagePath);
            return;
          }
          console.warn(`批量删除词条失败：${err}`);
          reportSaveError("lexicon", err instanceof Error ? err.message : String(err));
        }
      });
    },

    setSearchTerm: (term) => set({ searchTerm: term }),
    setActiveWordId: (id) => set({ activeWordId: id }),

    flushSaves: async () => {
      const due = Array.from(saveTimers.entries());
      const { projectPath, languagePath } = get();
      const targets = new Map<string, { projectPath: string; languagePath: string }>();
      targets.set(makeLangKey(projectPath, languagePath), { projectPath, languagePath });

      for (const [key, item] of due) {
        clearTimeout(item.timer);
        saveTimers.delete(key);
        targets.set(makeLangKey(item.projectPath, item.languagePath), {
          projectPath: item.projectPath,
          languagePath: item.languagePath,
        });
        void executeWordSave(
          item.projectPath,
          item.languagePath,
          item.entryId,
          item.operationId,
          item.version,
        );
      }
      await Promise.all(Array.from(writeChains.values()));

      // 单条保存失败的词条只留在 dirtyWords / deletedWords 中：此处必须真正重试落盘一次
      for (const target of targets.values()) {
        await retryPendingWrites(target.projectPath, target.languagePath);
      }
      await Promise.all(Array.from(writeChains.values()));
    },

    isDirty: (projectPath, languagePath) => {
      const p = projectPath ?? get().projectPath;
      const l = languagePath ?? get().languagePath;
      return hasPendingWork(p, l);
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
      syncActiveFlags(p, l);
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
        "External file change detected while local lexicon has unsaved edits",
      );
    },
  };
});

// 向后兼容 — addWord / updateWord 是 upsertWord 的别名（避免外部引用断裂）
export const addWord = useLexiconStore.getState().upsertWord;
export const updateWord = useLexiconStore.getState().upsertWord;
