import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { createDraftWord, isDraftWord } from "../../utils/lexiconDraft";
import { useLineageLexicon } from "../../store/lineageLexiconStore";
import { exportToCSV } from "../../utils/exportCSV";
import { ipaFuzzySearch } from "../../utils/ipaSearch";
import type { WordEntry } from "../../types";
import { BatchEditPanel } from "./BatchEditPanel";
import { ConfirmModal } from "../common/ConfirmModal";
import {
  LexiconFilterBar,
  type LexiconLifecycleFilter,
  type LexiconSortMode,
} from "./LexiconFilterBar";
import { LexiconVirtualList } from "./LexiconVirtualList";
import {
  getWordEvolution,
  getInheritedParentEntryId,
  getWordChangeDetails,
  type WordLifecycleFlags,
} from "../../utils/wordLifecycle";

const EMPTY_WORDS: Record<string, WordEntry> = {};

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const workspaceLanguages = useWorkspaceStore((s) => s.config.languages);
  const {
    wordsList,
    wordsMap,
    searchTerm,
    setSearchTerm,
    activeWordId,
    setActiveWordId,
    upsertWord,
    deleteWord,
  } = useLexiconStore();
  const config = usePhonoStore((s) => s.config);
  const partsOfSpeech = useGrammarStore((s) => s.config.parts_of_speech);

  const [ipaMode, setIpaMode] = useState(false);
  const [sortMode, setSortMode] = useState<LexiconSortMode>("az");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filterPos, setFilterPos] = useState("");
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterOrigin, setFilterOrigin] = useState("");
  const [filterLifecycle, setFilterLifecycle] = useState<LexiconLifecycleFilter>("");
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);

  const activeLanguage = useMemo(
    () => workspaceLanguages.find((lang) => lang.language_id === activeLanguageId),
    [workspaceLanguages, activeLanguageId],
  );

  const parentLanguage = useMemo(() => {
    if (!activeLanguage?.parent_id) return null;
    return (
      workspaceLanguages.find((lang) => lang.language_id === activeLanguage.parent_id) ??
      null
    );
  }, [workspaceLanguages, activeLanguage]);

  // 父语言词表统一走谱系缓存：同一父语言只 IPC 拉取一次，切换词条不再重复请求
  const { snapshot: parentSnapshot, loading: parentLoading } = useLineageLexicon(
    parentLanguage ? projectPath : null,
    parentLanguage?.path ?? null,
  );
  const parentWordsById = parentSnapshot?.wordsById ?? EMPTY_WORDS;
  const parentPhonoConfig = parentSnapshot?.phonoConfig ?? null;
  const parentWordsLoaded = parentLanguage ? !parentLoading && !!parentSnapshot : true;

  const lifecycleMap = useMemo<Record<string, WordLifecycleFlags>>(() => {
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
        ? getWordChangeDetails(word, parentWord, config, parentPhonoConfig)
        : undefined;
      const isChanged = changes ? Object.values(changes).some(Boolean) : false;
      const isDeprecated = evolution.is_deprecated;
      result[word.entry_id] = {
        isNew,
        isDeprecated,
        isChanged: isDeprecated ? false : isChanged,
        changes,
      };
    });

    return result;
  }, [wordsList, parentLanguage, parentWordsById, parentPhonoConfig, config, parentWordsLoaded]);

  const inventory = useMemo(
    () => [...config.phoneme_inventory.consonants, ...config.phoneme_inventory.vowels],
    [config.phoneme_inventory],
  );

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    wordsList.forEach((word) => {
      word.metadata?.tags?.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [wordsList]);

  const filteredWords = useMemo<WordEntry[]>(() => {
    let result: WordEntry[];
    if (!searchTerm.trim()) {
      result = [...wordsList];
    } else if (ipaMode) {
      result = ipaFuzzySearch(searchTerm, wordsList, inventory, 0.6).map((hit) => hit.entry);
    } else {
      const query = searchTerm.toLowerCase();
      result = wordsList.filter(
        (word) =>
          word.con_word_romanized.toLowerCase().includes(query) ||
          word.senses.some((sense) => sense.gloss.toLowerCase().includes(query)),
      );
    }

    if (filterPos) {
      result = result.filter((word) => word.senses.some((sense) => sense.pos_id === filterPos));
    }
    if (filterOrigin) {
      result = result.filter((word) => word.etymology?.origin_type === filterOrigin);
    }
    if (filterTags.length > 0) {
      result = result.filter((word) =>
        word.metadata?.tags?.some((tag) =>
          filterTags.some((ft) => tag.toLowerCase().includes(ft.toLowerCase())),
        ),
      );
    }

    if (sortMode === "az") {
      result.sort((a, b) => a.con_word_romanized.localeCompare(b.con_word_romanized));
    } else {
      result.sort((a, b) => b.con_word_romanized.localeCompare(a.con_word_romanized));
    }
    return result;
  }, [searchTerm, wordsList, ipaMode, inventory, sortMode, filterPos, filterOrigin, filterTags]);

  const displayWords = useMemo(() => {
    if (!filterLifecycle) return filteredWords;
    return filteredWords.filter((word) => {
      const lifecycle = lifecycleMap[word.entry_id];
      if (!lifecycle) return false;
      if (filterLifecycle === "added") return lifecycle.isNew;
      if (filterLifecycle === "deprecated") return lifecycle.isDeprecated;
      return lifecycle.isChanged;
    });
  }, [filteredWords, lifecycleMap, filterLifecycle]);

  const cleanupEmptyWord = () => {
    if (!activeWordId) return;
    const prev = wordsMap[activeWordId];
    if (prev && isDraftWord(prev)) deleteWord(prev.entry_id);
  };

  // 卸载时清理未成形的空词条（例如直接切页离开）
  React.useEffect(() => {
    return () => {
      const store = useLexiconStore.getState();
      const id = store.activeWordId;
      if (!id) return;
      const word = store.wordsMap[id];
      if (word && isDraftWord(word)) store.deleteWord(word.entry_id);
    };
  }, []);

  const handleAddWord = () => {
    cleanupEmptyWord();
    const draft = createDraftWord(t("lexicon.newMeaning"));
    upsertWord(draft);
    setActiveWordId(draft.entry_id);
  };

  const handleSelectWord = (entryId: string) => {
    cleanupEmptyWord();
    setActiveWordId(entryId);
  };

  const handleToggleSelection = (entryId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const handleDeleteSelected = () => {
    Array.from(selectedIds).forEach((id) => deleteWord(id));
    setSelectedIds(new Set());
    setBatchMode(false);
  };

  return (
    <div className="w-64 border-r border-base-300 h-full flex flex-col bg-base-200">
      <LexiconFilterBar
        ipaMode={ipaMode}
        onToggleIpaMode={() => setIpaMode(!ipaMode)}
        sortMode={sortMode}
        onToggleSortMode={() => setSortMode(sortMode === "az" ? "za" : "az")}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        showAdvanced={showAdvanced}
        onToggleAdvanced={() => setShowAdvanced(!showAdvanced)}
        filterPos={filterPos}
        onFilterPosChange={setFilterPos}
        filterOrigin={filterOrigin}
        onFilterOriginChange={setFilterOrigin}
        filterLifecycle={filterLifecycle}
        onFilterLifecycleChange={setFilterLifecycle}
        filterTags={filterTags}
        onFilterTagsChange={setFilterTags}
        allTags={allTags}
        partsOfSpeech={partsOfSpeech}
        batchMode={batchMode}
        selectedCount={selectedIds.size}
        visibleCount={displayWords.length}
        onToggleBatchMode={() => setBatchMode(!batchMode)}
        onSelectAll={() => setSelectedIds(new Set(displayWords.map((word) => word.entry_id)))}
        onClearSelection={() => setSelectedIds(new Set())}
        onRequestDeleteSelected={() => setShowDeleteSelectedConfirm(true)}
        onAddWord={handleAddWord}
        onExportCsv={() => exportToCSV(wordsList)}
      />

      <LexiconVirtualList
        entries={displayWords}
        lifecycleMap={lifecycleMap}
        activeWordId={activeWordId}
        batchMode={batchMode}
        selectedIds={selectedIds}
        ipaMode={ipaMode}
        onSelectWord={handleSelectWord}
        onToggleSelection={handleToggleSelection}
        emptyHint={t("lexicon.noMatches")}
      />

      {batchMode && selectedIds.size > 0 && (
        <BatchEditPanel
          selectedIds={selectedIds}
          onClose={() => {
            setBatchMode(false);
            setSelectedIds(new Set());
          }}
        />
      )}

      <ConfirmModal
        open={showDeleteSelectedConfirm}
        title={t("lexicon.deleteSelected")}
        message={t("lexicon.deleteSelectedConfirm", { count: selectedIds.size })}
        onConfirm={() => {
          handleDeleteSelected();
          setShowDeleteSelectedConfirm(false);
        }}
        onCancel={() => setShowDeleteSelectedConfirm(false)}
      />
    </div>
  );
};
