import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useSCAStore } from "../../store/scaStore";
import {
  getLineageLexicon,
  loadLineageLexicon,
  useLineageLexicon,
  useLineageLexiconCacheVersion,
} from "../../store/lineageLexiconStore";
import type { LanguageEntry, Sense, WordEntry } from "../../types";
import { generateIPA } from "../../utils/ipaGenerator";
import {
  getWordEvolution,
  getInheritedParentEntryId,
  getWordChangeDetails,
  type WordLifecycleFlags,
} from "../../utils/wordLifecycle";
import { ConfirmModal } from "../common/ConfirmModal";
import { WordHeaderSection } from "./WordHeaderSection";
import { WordSensesSection } from "./WordSensesSection";
import { WordEtymologySection } from "./WordEtymologySection";

export const EditorPane: React.FC = () => {
  const { t } = useTranslation();
  const { activeWordId, wordsMap, wordsList, upsertWord, deleteWord } = useLexiconStore();
  const phonoConfig = usePhonoStore((s) => s.config);
  const partsOfSpeech = useGrammarStore((s) => s.config.parts_of_speech);
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const workspaceLanguages = useWorkspaceStore((s) => s.config.languages);
  const scaConfig = useSCAStore((s) => s.config);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteSenseIdx, setConfirmDeleteSenseIdx] = useState<number | null>(null);

  const prevRomanizedRef = useRef<string>("");
  const cacheVersion = useLineageLexiconCacheVersion();

  const word = activeWordId ? wordsMap[activeWordId] : null;
  const evolution = word ? getWordEvolution(word) : null;

  const activeLanguage = useMemo(
    () => workspaceLanguages.find((l) => l.language_id === activeLanguageId),
    [workspaceLanguages, activeLanguageId],
  );
  const parentLanguage = useMemo(() => {
    if (!activeLanguage?.parent_id) return null;
    return workspaceLanguages.find((l) => l.language_id === activeLanguage.parent_id) ?? null;
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
        ? (workspaceLanguages.find((l) => l.language_id === parentId) ?? null)
        : null;
    }

    return chain.reverse();
  }, [activeLanguage, workspaceLanguages]);

  // 父语言词表走谱系缓存（与 Sidebar 共用同一次 IPC）
  const { snapshot: parentSnapshot } = useLineageLexicon(
    parentLanguage ? projectPath : null,
    parentLanguage?.path ?? null,
  );
  const parentPhonoConfig = parentSnapshot?.phonoConfig ?? null;

  // 祖先链按需加载（同一语言只加载一次）
  const ancestorLanguages = useMemo(
    () => lineageLanguages.filter((lang) => lang.language_id !== activeLanguageId),
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
    // cacheVersion 参与依赖，缓存更新时重算
  }, [projectPath, ancestorLanguages, cacheVersion]);

  const inheritedParentId =
    word && parentLanguage
      ? getInheritedParentEntryId(word, parentLanguage.language_id)
      : null;
  const parentWord =
    inheritedParentId && parentSnapshot
      ? (parentSnapshot.wordsById[inheritedParentId] ?? null)
      : null;

  const evolutionPathWords = useMemo(() => {
    if (!word || !activeLanguageId) return [] as string[];
    const path = [word.con_word_romanized.trim()];
    let current: WordEntry = word;
    for (let index = lineageLanguages.length - 1; index > 0; index -= 1) {
      const parent = lineageLanguages[index - 1];
      if (!parent) break;
      const parentId = getInheritedParentEntryId(current, parent.language_id);
      const ancestor = parentId
        ? (ancestorWordsByLanguage[parent.language_id]?.[parentId] ?? null)
        : null;
      if (!ancestor) break;
      path.push(ancestor.con_word_romanized.trim());
      current = ancestor;
    }
    return path
      .reverse()
      .filter((value, index, values) => value && (index === 0 || value !== values[index - 1]));
  }, [word, activeLanguageId, lineageLanguages, ancestorWordsByLanguage]);

  const lifecycleFlags = useMemo<WordLifecycleFlags | null>(() => {
    if (!word) return null;
    const isDeprecated = getWordEvolution(word).is_deprecated;
    const changes = parentWord
      ? getWordChangeDetails(word, parentWord, phonoConfig, parentPhonoConfig)
      : undefined;
    return {
      isNew: !!parentLanguage && !parentWord,
      isDeprecated,
      isChanged: !isDeprecated && !!changes && Object.values(changes).some(Boolean),
      changes,
    };
  }, [word, parentLanguage, parentWord, parentPhonoConfig, phonoConfig]);

  const scaRuleLookup = useMemo(() => {
    const map = new Map<string, string>();
    scaConfig.rule_sets.forEach((ruleSet) => {
      ruleSet.rules.forEach((rule) => {
        map.set(rule.rule_id, rule.description || ruleSet.name);
      });
    });
    return map;
  }, [scaConfig]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    wordsList.forEach((entry) => {
      entry.metadata?.tags?.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [wordsList]);

  // 词形变化且未手动锁定 IPA 时自动重算音位转写
  useEffect(() => {
    if (!word || word.phonetic_override) return;
    if (word.con_word_romanized === prevRomanizedRef.current) return;
    prevRomanizedRef.current = word.con_word_romanized;

    const { phonemic } = generateIPA(word.con_word_romanized, phonoConfig);
    const cleanIpa = phonemic.replace(/^\/|\/$/g, "");
    if (cleanIpa && cleanIpa !== word.phonetic_ipa) {
      upsertWord({ ...word, phonetic_ipa: cleanIpa });
    }
  }, [word?.con_word_romanized, word?.phonetic_override, phonoConfig]);

  if (!word) {
    return (
      <div className="flex-1 flex items-center justify-center text-base-content/50 mt-16 italic">
        {t("lexicon.selectWord")}
      </div>
    );
  }

  const handleChange = (
    field: keyof WordEntry,
    value: WordEntry[keyof WordEntry],
  ) => {
    upsertWord({ ...word, [field]: value });
  };

  const handleSenseChange = (
    index: number,
    field: keyof Sense,
    value: Sense[keyof Sense],
  ) => {
    const nextSenses = [...word.senses];
    nextSenses[index] = { ...nextSenses[index], [field]: value };
    handleChange("senses", nextSenses);
  };

  const addSense = () => {
    handleChange("senses", [
      ...word.senses,
      {
        sense_id: crypto.randomUUID(),
        pos_id: partsOfSpeech[0]?.pos_id || "",
        gloss: "",
        definitions: [],
        examples: [],
      },
    ]);
  };

  const removeSense = (index: number) => {
    handleChange(
      "senses",
      word.senses.filter((_, i) => i !== index),
    );
  };

  const { surface } = generateIPA(word.con_word_romanized, phonoConfig);

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-base-100">
      <WordHeaderSection
        word={word}
        surface={surface}
        lifecycleFlags={lifecycleFlags}
        allTags={allTags}
        onChange={handleChange}
        onTagsChange={(tags) => handleChange("metadata", { ...word.metadata, tags })}
        onRequestDelete={() => setConfirmDelete(true)}
      />

      <WordSensesSection
        senses={word.senses}
        partsOfSpeech={partsOfSpeech}
        onChangeSense={handleSenseChange}
        onAddSense={addSense}
        onRequestDeleteSense={setConfirmDeleteSenseIdx}
      />

      <WordEtymologySection
        word={word}
        evolution={evolution}
        evolutionPathWords={evolutionPathWords}
        scaRuleLookup={scaRuleLookup}
        workspaceLanguages={workspaceLanguages}
        activeLanguageId={activeLanguageId}
        onChange={handleChange}
      />

      <ConfirmModal
        open={confirmDelete}
        title={t("lexicon.deleteWord")}
        message={t("lexicon.deleteWordConfirm", { word: word.con_word_romanized })}
        onConfirm={() => {
          deleteWord(word.entry_id);
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmModal
        open={confirmDeleteSenseIdx !== null}
        title={t("common.delete")}
        message={t("lexicon.deleteMeaningConfirm")}
        onConfirm={() => {
          if (confirmDeleteSenseIdx !== null) {
            removeSense(confirmDeleteSenseIdx);
            setConfirmDeleteSenseIdx(null);
          }
        }}
        onCancel={() => setConfirmDeleteSenseIdx(null)}
      />
    </div>
  );
};
