import { create } from 'zustand';
import { WordEntry } from '../types';
import { invoke } from '@tauri-apps/api/core';

interface LexiconStore {
  wordsMap: Record<string, WordEntry>;
  wordsList: WordEntry[];
  searchTerm: string;
  activeWordId: string | null;
  projectPath: string;
  languagePath: string;

  setProjectPath: (path: string) => void;
  setLanguagePath: (path: string) => void;
  loadWords: (words: WordEntry[]) => void;
  loadFromBackend: (projectPath: string, languagePath: string) => Promise<void>;
  upsertWord: (word: WordEntry) => void;
  deleteWord: (entryId: string) => void;
  setSearchTerm: (term: string) => void;
  setActiveWordId: (id: string | null) => void;
  /** 批量导入词条（走单次 Tauri command，不触发逐条 debounce） */
  importWords: (words: WordEntry[]) => void;
}

/** 以实体 ID 为粒度的 debounce timers，防止不同词条的保存互相取消 */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** 记录每个词条在当前 debounce 周期内的首个旧拼写，避免后续 upsert 覆盖丢失 */
const pendingOldRomanized = new Map<string, string>();

function debouncedSaveWord(
  projectPath: string,
  languagePath: string,
  word: WordEntry,
  old_romanized?: string
) {
  const key = word.entry_id;
  if (old_romanized && !pendingOldRomanized.has(key)) {
    pendingOldRomanized.set(key, old_romanized);
  }

  const effectiveOldRomanized = pendingOldRomanized.get(key) ?? null;
  const existing = saveTimers.get(key);
  if (existing) clearTimeout(existing);
  saveTimers.set(
    key,
    setTimeout(() => {
      invoke('save_word', { projectPath, languagePath, word, oldRomanized: effectiveOldRomanized }).catch(err =>
        console.warn(`保存词条失败：${err}`),
      );
      pendingOldRomanized.delete(key);
      saveTimers.delete(key);
    }, 500),
  );
};

function rebuildList(wordsMap: Record<string, WordEntry>): WordEntry[] {
  return Object.values(wordsMap).sort((a, b) =>
    a.con_word_romanized.localeCompare(b.con_word_romanized),
  );
}

export const useLexiconStore = create<LexiconStore>((set, get) => ({
  wordsMap: {},
  wordsList: [],
  searchTerm: '',
  activeWordId: null,
  projectPath: '.',
  languagePath: 'proto_language',

  setProjectPath: (path) => set({ projectPath: path }),
  setLanguagePath: (path) => set({ languagePath: path }),

  loadWords: (words) => {
    const wordsMap: Record<string, WordEntry> = {};
    words.forEach(w => { wordsMap[w.entry_id] = w; });
    set({ wordsMap, wordsList: rebuildList(wordsMap) });
  },

  loadFromBackend: async (projectPath: string, languagePath: string) => {
    try {
      const words = await invoke<WordEntry[]>('load_all_words', { projectPath, languagePath });
      const wordsMap: Record<string, WordEntry> = {};
      words.forEach(w => { wordsMap[w.entry_id] = w; });
      set({ wordsMap, wordsList: rebuildList(wordsMap), projectPath, languagePath });
    } catch (err) {
      console.error('Failed to load words:', err);
    }
  },

  upsertWord: (word) => {
    let old_romanized: string | undefined;
    set(state => {
      const existing = state.wordsMap[word.entry_id];
      if (existing && existing.con_word_romanized !== word.con_word_romanized) {
        old_romanized = existing.con_word_romanized;
      }
      const wordsMap = { ...state.wordsMap, [word.entry_id]: word };
      return { wordsMap, wordsList: rebuildList(wordsMap) };
    });
    const { projectPath, languagePath } = get();
    debouncedSaveWord(projectPath, languagePath, word, old_romanized);
  },

  importWords: (words) => {
    set(state => {
      const wordsMap = { ...state.wordsMap };
      words.forEach(w => { wordsMap[w.entry_id] = w; });
      return { wordsMap, wordsList: rebuildList(wordsMap) };
    });
    // 批量保存：逐词 invoke，但不走 debounce（这里数量有限且已是用户主动操作）
    const { projectPath, languagePath } = get();
    words.forEach(w => {
      invoke('save_word', { projectPath, languagePath, word: w, oldRomanized: null }).catch(err =>
        console.warn(`批量保存失败 [${w.entry_id}]：${err}`),
      );
    });
  },

  deleteWord: (entryId) => {
    const wordToDelete = get().wordsMap[entryId];
    if (!wordToDelete) return;

    // 取消该词条的任何待保存 timer
    const timer = saveTimers.get(entryId);
    if (timer) { clearTimeout(timer); saveTimers.delete(entryId); }
    pendingOldRomanized.delete(entryId);

    set(state => {
      const wordsMap = { ...state.wordsMap };
      delete wordsMap[entryId];
      return { wordsMap, wordsList: rebuildList(wordsMap), activeWordId: null };
    });

    const { projectPath, languagePath } = get();
    invoke('delete_word', {
      projectPath,
      languagePath,
      entryId,
      conWordRomanized: wordToDelete.con_word_romanized,
    }).catch(err => console.warn(`删除失败：${err}`));
  },

  setSearchTerm: (term) => set({ searchTerm: term }),
  setActiveWordId: (id) => set({ activeWordId: id }),
}));

// 向后兼容 — addWord / updateWord 是 upsertWord 的别名（避免外部引用断裂）
export const addWord = useLexiconStore.getState().upsertWord;
export const updateWord = useLexiconStore.getState().upsertWord;
