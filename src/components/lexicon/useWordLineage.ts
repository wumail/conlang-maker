import { useEffect, useMemo } from "react";
import type { LanguageEntry, PhonologyConfig, WordEntry } from "../../types";
import {
  getLineageLexicon,
  loadLineageLexicon,
  useLineageLexicon,
  useLineageLexiconCacheVersion,
} from "../../store/lineageLexiconStore";
import {
  getInheritedParentEntryId,
  getWordChangeDetails,
  getWordEvolution,
  type WordLifecycleFlags,
} from "../../utils/wordLifecycle";
import { generateIPA } from "../../utils/ipaGenerator";
import type { EvolutionChainEntry } from "../lexicon/EvolutionChainCards";

export interface WordLineageInput {
  word: WordEntry | null;
  activeLanguageId: string;
  projectPath: string;
  workspaceLanguages: LanguageEntry[];
  phonoConfig: PhonologyConfig;
}

export interface WordLineageResult {
  activeLanguage: LanguageEntry | null;
  parentLanguage: LanguageEntry | null;
  parentPhonoConfig: PhonologyConfig | null;
  lifecycleFlags: WordLifecycleFlags | null;
  evolutionChain: EvolutionChainEntry[];
}

function phonemicIpa(romanized: string, phono: PhonologyConfig): string {
  if (!romanized.trim()) return "";
  const { phonemic } = generateIPA(romanized, phono);
  return phonemic.replace(/^\/|\/$/g, "");
}

/**
 * 词典详情的谱系派生数据：父语言状态、生命周期标记与富信息演化链。
 *
 * 父语言/祖先词表统一走 `lineageLexiconStore`，与侧边栏共享同一次 IPC 读取。
 */
export function useWordLineage(input: WordLineageInput): WordLineageResult {
  const { word, activeLanguageId, projectPath, workspaceLanguages, phonoConfig } = input;
  const cacheVersion = useLineageLexiconCacheVersion();

  const activeLanguage = useMemo(
    () => workspaceLanguages.find((language) => language.language_id === activeLanguageId) ?? null,
    [workspaceLanguages, activeLanguageId],
  );

  const parentLanguage = useMemo(() => {
    if (!activeLanguage?.parent_id) return null;
    return (
      workspaceLanguages.find((language) => language.language_id === activeLanguage.parent_id) ??
      null
    );
  }, [workspaceLanguages, activeLanguage]);

  const lineageLanguages = useMemo<LanguageEntry[]>(() => {
    if (!activeLanguage) return [];
    const chain: LanguageEntry[] = [];
    const visited = new Set<string>();
    let current: LanguageEntry | null = activeLanguage;

    while (current && !visited.has(current.language_id)) {
      chain.push(current);
      visited.add(current.language_id);
      const parentId: string | null = current.parent_id;
      current = parentId
        ? (workspaceLanguages.find((language) => language.language_id === parentId) ?? null)
        : null;
    }

    return chain.reverse();
  }, [activeLanguage, workspaceLanguages]);

  const { snapshot: parentSnapshot } = useLineageLexicon(
    parentLanguage ? projectPath : null,
    parentLanguage?.path ?? null,
  );
  const parentPhonoConfig = parentSnapshot?.phonoConfig ?? null;

  const ancestorLanguages = useMemo(
    () => lineageLanguages.filter((language) => language.language_id !== activeLanguageId),
    [lineageLanguages, activeLanguageId],
  );

  useEffect(() => {
    if (!projectPath) return;
    for (const ancestor of ancestorLanguages) {
      void loadLineageLexicon(projectPath, ancestor.path);
    }
  }, [projectPath, ancestorLanguages]);

  const ancestorWordsByLanguage = useMemo<Record<string, Record<string, WordEntry>>>(() => {
    if (!projectPath) return {};
    const result: Record<string, Record<string, WordEntry>> = {};
    for (const ancestor of ancestorLanguages) {
      const snapshot = getLineageLexicon(projectPath, ancestor.path);
      if (snapshot) result[ancestor.language_id] = snapshot.wordsById;
    }
    return result;
    // cacheVersion 参与依赖，缓存更新后重算
  }, [projectPath, ancestorLanguages, cacheVersion]);

  const parentWord = useMemo<WordEntry | null>(() => {
    if (!word || !parentLanguage) return null;
    const parentEntryId = getInheritedParentEntryId(word, parentLanguage.language_id);
    if (!parentEntryId || !parentSnapshot) return null;
    return parentSnapshot.wordsById[parentEntryId] ?? null;
  }, [word, parentLanguage, parentSnapshot]);

  const lifecycleFlags = useMemo<WordLifecycleFlags | null>(() => {
    if (!word) return null;
    const isDeprecated = getWordEvolution(word).is_deprecated;
    const changes = parentWord
      ? getWordChangeDetails(word, parentWord, phonoConfig, parentPhonoConfig)
      : undefined;
    return {
      isNew: Boolean(parentLanguage) && !parentWord,
      isDeprecated,
      isChanged: !isDeprecated && Boolean(changes) && Object.values(changes ?? {}).some(Boolean),
      changes,
    };
  }, [word, parentLanguage, parentWord, parentPhonoConfig, phonoConfig]);

  const evolutionChain = useMemo<EvolutionChainEntry[]>(() => {
    if (!word || !activeLanguageId) return [];
    const collected: { languageId: string; entry: WordEntry }[] = [
      { languageId: activeLanguageId, entry: word },
    ];

    let cursor: WordEntry = word;
    for (let index = lineageLanguages.length - 1; index > 0; index -= 1) {
      const parent = lineageLanguages[index - 1];
      if (!parent) break;
      const parentEntryId = getInheritedParentEntryId(cursor, parent.language_id);
      const ancestor = parentEntryId
        ? (ancestorWordsByLanguage[parent.language_id]?.[parentEntryId] ?? null)
        : null;
      if (!ancestor) break;
      collected.push({ languageId: parent.language_id, entry: ancestor });
      cursor = ancestor;
    }

    return collected.reverse().map(({ languageId, entry }) => {
      const language =
        workspaceLanguages.find((item) => item.language_id === languageId) ?? null;
      const ancestorSnapshot =
        languageId === activeLanguageId
          ? null
          : language
            ? getLineageLexicon(projectPath, language.path)
            : null;
      const ancestorPhono = ancestorSnapshot?.phonoConfig ?? phonoConfig;
      return {
        languageId,
        languageName: language?.name || languageId,
        romanized: entry.con_word_romanized,
        ipa: phonemicIpa(entry.con_word_romanized, ancestorPhono),
      };
    });
  }, [
    word,
    activeLanguageId,
    lineageLanguages,
    ancestorWordsByLanguage,
    workspaceLanguages,
    projectPath,
    phonoConfig,
  ]);

  return {
    activeLanguage,
    parentLanguage,
    parentPhonoConfig,
    lifecycleFlags,
    evolutionChain,
  };
}
