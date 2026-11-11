import { create } from 'zustand';
import { CorpusText, CorpusIndexEntry, GlossedLine } from '../types';
import { invoke } from '@tauri-apps/api/core';

interface CorpusStore {
    index: CorpusIndexEntry[];
    activeCorpusId: string | null;
    activeCorpus: CorpusText | null;
    projectPath: string;
    languagePath: string;

    loadIndex: (projectPath: string, languagePath: string) => Promise<void>;
    loadCorpus: (corpusId: string) => Promise<void>;
    upsertCorpus: (text: CorpusText) => void;
    deleteCorpus: (corpusId: string) => Promise<void>;
    setActiveCorpusId: (id: string | null) => void;

    // Gloss editing helpers
    updateGlossedLine: (lineId: string, line: GlossedLine) => void;
    addGlossedLine: (line: GlossedLine) => void;
    deleteGlossedLine: (lineId: string) => void;
}

/** Per-entity debounce map for corpus saves */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function debouncedSave(projectPath: string, languagePath: string, text: CorpusText) {
    const key = JSON.stringify([projectPath, languagePath, text.corpus_id]);
    const existing = saveTimers.get(key);
    if (existing) clearTimeout(existing);
    saveTimers.set(key, setTimeout(async () => {
        try {
            await invoke('save_corpus_text', { projectPath, languagePath, text });
        } catch (err) {
            console.warn(`语料保存失败：${err}`);
        }
        saveTimers.delete(key);
    }, 500));
}

let loadGeneration = 0;
let corpusGeneration = 0;

export const useCorpusStore = create<CorpusStore>((set, get) => ({
    index: [],
    activeCorpusId: null,
    activeCorpus: null,
    projectPath: '.',
    languagePath: 'proto_language',

    loadIndex: async (projectPath, languagePath) => {
        const generation = ++loadGeneration;
        corpusGeneration += 1;
        try {
            const index = await invoke<CorpusIndexEntry[]>('load_corpus_index', { projectPath, languagePath });
            if (generation !== loadGeneration) return;
            set({ index, projectPath, languagePath, activeCorpus: null, activeCorpusId: null });
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
            const text = await invoke<CorpusText>('load_corpus_text', { projectPath, languagePath, corpusId });
            if (generation !== corpusGeneration || get().projectPath !== projectPath || get().languagePath !== languagePath || get().activeCorpusId !== corpusId) return;
            set({ activeCorpus: text, activeCorpusId: corpusId });
        } catch (err) {
            console.warn(`加载语料失败：${err}`);
        }
    },

    upsertCorpus: (text) => {
        const { projectPath, languagePath, index } = get();
        set({ activeCorpus: text });
        // Update index optimistically
        const newIndexEntry: CorpusIndexEntry = {
            corpus_id: text.corpus_id,
            title: text.title,
            description: text.description,
            metadata: { ...text.metadata },
        };
        const idx = index.findIndex((e) => e.corpus_id === text.corpus_id);
        const newIndex = idx >= 0
            ? index.map((e, i) => i === idx ? newIndexEntry : e)
            : [...index, newIndexEntry];
        set({ index: newIndex });
        debouncedSave(projectPath, languagePath, text);
    },

    deleteCorpus: async (corpusId) => {
        const { projectPath, languagePath } = get();
        // Cancel any pending debounced save for this corpus
        const saveKey = JSON.stringify([projectPath, languagePath, corpusId]);
        const pendingTimer = saveTimers.get(saveKey);
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            saveTimers.delete(saveKey);
        }
        // Optimistic UI update first
        set((state) => ({
            index: state.index.filter((e) => e.corpus_id !== corpusId),
            activeCorpusId: state.activeCorpusId === corpusId ? null : state.activeCorpusId,
            activeCorpus: state.activeCorpusId === corpusId ? null : state.activeCorpus,
        }));
        try {
            await invoke('delete_corpus_text', { projectPath, languagePath, corpusId });
        } catch (err) {
            console.warn(`删除语料失败：${err}`);
            // Reload index to restore consistent state on failure
            get().loadIndex(projectPath, languagePath);
        }
    },

    setActiveCorpusId: (id) => {
        set({ activeCorpusId: id });
        if (id) get().loadCorpus(id);
        else set({ activeCorpus: null });
    },

    // ── Gloss editing helpers ──

    updateGlossedLine: (lineId, line) => {
        const corpus = get().activeCorpus;
        if (!corpus) return;
        const updated: CorpusText = {
            ...corpus,
            glossed_lines: corpus.glossed_lines.map((l) => l.line_id === lineId ? line : l),
            metadata: { ...corpus.metadata, updated_at: new Date().toISOString() },
        };
        get().upsertCorpus(updated);
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
}));
