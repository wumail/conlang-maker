/**
 * useWordLifecycleFlags.ts — 词典侧边栏的生命周期标记聚合（Roadmap v3 拆分）
 *
 * 父语言词表统一走谱系缓存（同父语言只 IPC 拉取一次），
 * 为每个词条计算「新增 / 已废弃 / 继承后有变化」三类标记。
 */
import { useMemo } from "react";
import { useLineageLexicon } from "../../store/lineageLexiconStore";
import type { LanguageEntry, PhonologyConfig, WordEntry } from "../../types";
import {
  getWordChangeDetails,
  getWordEvolution,
  getInheritedParentEntryId,
  type WordLifecycleFlags,
} from "../../utils/wordLifecycle";

const EMPTY_WORDS: Record<string, WordEntry> = {};

export function useWordLifecycleFlags(params: {
  wordsList: WordEntry[];
  activeLanguage: LanguageEntry | undefined;
  workspaceLanguages: LanguageEntry[];
  projectPath: string;
  phonoConfig: PhonologyConfig;
}): Record<string, WordLifecycleFlags> {
  const { wordsList, activeLanguage, workspaceLanguages, projectPath, phonoConfig } = params;

  const parentLanguage = useMemo(() => {
    if (!activeLanguage?.parent_id) return null;
    return workspaceLanguages.find((lang) => lang.language_id === activeLanguage.parent_id) ?? null;
  }, [workspaceLanguages, activeLanguage]);

  const { snapshot: parentSnapshot, loading: parentLoading } = useLineageLexicon(
    parentLanguage ? projectPath : null,
    parentLanguage?.path ?? null,
  );
  const parentWordsById = parentSnapshot?.wordsById ?? EMPTY_WORDS;
  const parentPhonoConfig = parentSnapshot?.phonoConfig ?? null;
  const parentWordsLoaded = parentLanguage ? !parentLoading && !!parentSnapshot : true;

  return useMemo<Record<string, WordLifecycleFlags>>(() => {
    if (parentLanguage && !parentWordsLoaded) return {};
    const result: Record<string, WordLifecycleFlags> = {};
    wordsList.forEach((word) => {
      const parentEntryId = parentLanguage
        ? getInheritedParentEntryId(word, parentLanguage.language_id)
        : null;
      const parentWord = parentEntryId ? parentWordsById[parentEntryId] : null;
      const evolution = getWordEvolution(word);
      const isNew = !!parentLanguage && !parentWord;
      const changes = parentWord
        ? getWordChangeDetails(word, parentWord, phonoConfig, parentPhonoConfig)
        : undefined;
      const isChanged = changes ? Object.values(changes).some(Boolean) : false;
      result[word.entry_id] = {
        isNew,
        isDeprecated: evolution.is_deprecated,
        isChanged: evolution.is_deprecated ? false : isChanged,
        changes,
      };
    });
    return result;
  }, [wordsList, parentLanguage, parentWordsById, parentPhonoConfig, phonoConfig, parentWordsLoaded]);
}
