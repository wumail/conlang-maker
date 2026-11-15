/**
 * languageViewMemory.ts — 每门语言最近查看上下文的纯前端内存表（Roadmap v3 / Pillar 7）
 *
 * 切换语言时记录当前语言正在看的词条/语料/语法子页签，
 * 切回该语言时自动恢复（若目标词条仍存在）。
 * 纯内存实现：不落盘、不进 Store，应用重启后自然清空。
 */
import { useLexiconStore } from "../store/lexiconStore";
import { useCorpusStore } from "../store/corpusStore";

export interface LanguageViewSnapshot {
  activeWordId?: string | null;
  activeCorpusId?: string | null;
  grammarTab?: string;
}

const memory = new Map<string, LanguageViewSnapshot>();

/** 记录/局部更新某语言的视图上下文（patch 合并，不覆盖未提及字段） */
export function saveLanguageViewMemory(
  languageId: string,
  patch: Partial<LanguageViewSnapshot>,
): void {
  if (!languageId) return;
  const prev = memory.get(languageId) ?? {};
  memory.set(languageId, { ...prev, ...patch });
}

/** 读取某语言的视图上下文快照（无记录时返回空对象） */
export function getLanguageViewMemory(languageId: string): LanguageViewSnapshot {
  return memory.get(languageId) ?? {};
}

/**
 * 语言数据加载完成后恢复该语言的视图上下文。
 *
 * - 词条：记忆中的词条仍存在则选中它，否则回落到首个词条（绝不残留上一门语言的 ID）；
 * - 语料：记忆中的语料仍存在于索引中则异步载入。
 */
export function restoreLanguageViewMemory(languageId: string): void {
  if (!languageId) return;
  const snapshot = getLanguageViewMemory(languageId);

  const lexicon = useLexiconStore.getState();
  const rememberedWordId = snapshot.activeWordId;
  const rememberedWord = rememberedWordId ? lexicon.wordsMap[rememberedWordId] : undefined;
  lexicon.setActiveWordId(rememberedWord?.entry_id ?? lexicon.wordsList[0]?.entry_id ?? null);

  const corpus = useCorpusStore.getState();
  const rememberedCorpusId = snapshot.activeCorpusId;
  if (
    rememberedCorpusId &&
    corpus.index.some((entry) => entry.corpus_id === rememberedCorpusId)
  ) {
    void corpus.loadCorpus(rememberedCorpusId).catch((err: unknown) => {
      console.warn(`Restore corpus view failed: ${String(err)}`);
    });
  }
}

/** 测试与调试用：清空全部记忆 */
export function resetLanguageViewMemory(): void {
  memory.clear();
}
