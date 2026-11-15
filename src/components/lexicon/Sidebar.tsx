import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { createDraftWord, isDraftWord } from "../../utils/lexiconDraft";
import { exportToCSV } from "../../utils/exportCSV";
import { pushUndoEntry } from "../../store/undoManager";
import { buildConceptOptions } from "../../lib/lexiconConcepts";
import { ConceptMigrationButton } from "./ConceptMigrationButton";
import { filterAndSearchWords } from "../../core/lexicon/searchLexicon";
import type { BuiltinQuickFilterKind, OriginType, WordEntry } from "../../types";
import { BatchEditPanel } from "./BatchEditPanel";
import { ConfirmModal } from "../common/ConfirmModal";
import {
  LexiconFilterBar,
  type LexiconLifecycleFilter,
  type LexiconSortMode,
} from "./LexiconFilterBar";
import { LexiconVirtualList } from "./LexiconVirtualList";
import { HiddenSelectionBanner } from "./HiddenSelectionBanner";
import { useWordLifecycleFlags } from "./useWordLifecycleFlags";

interface SidebarProps {
  /** 打开右侧表格视图弹窗（由词典页承载） */
  onOpenTable: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenTable }) => {
  const { t } = useTranslation();
  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const workspaceConfig = useWorkspaceStore((s) => s.config);
  const workspaceLanguages = workspaceConfig.languages;
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
  const [filterConcept, setFilterConcept] = useState("");
  const [filterOrigin, setFilterOrigin] = useState("");
  const [filterLifecycle, setFilterLifecycle] = useState<LexiconLifecycleFilter>("");
  const [quickKind, setQuickKind] = useState<BuiltinQuickFilterKind | "">("");
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);

  const activeLanguage = useMemo(
    () => workspaceLanguages.find((lang) => lang.language_id === activeLanguageId),
    [workspaceLanguages, activeLanguageId],
  );
  const lifecycleMap = useWordLifecycleFlags({
    wordsList, activeLanguage, workspaceLanguages, projectPath, phonoConfig: config,
  });

  const conceptOptions = useMemo(
    () => buildConceptOptions(wordsList, workspaceConfig.custom_concepts ?? []),
    [wordsList, workspaceConfig],
  );
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    wordsList.forEach((word) => word.metadata?.tags?.forEach((tag) => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [wordsList]);

  const filteredWords = useMemo<WordEntry[]>(() => {
    const conceptsMap = new Map(
      (workspaceConfig.custom_concepts ?? []).map((concept) => [concept.concept_id, concept]),
    );
    let result = filterAndSearchWords(
      wordsList,
      {
        searchTerm,
        ipaMode,
        posId: filterPos,
        originType: filterOrigin as OriginType | "",
        quickKind,
      },
      conceptsMap,
    );
    if (filterTags.length > 0) {
      result = result.filter((word) =>
        word.metadata?.tags?.some((tag) =>
          filterTags.some((needle) => tag.toLowerCase().includes(needle.toLowerCase())),
        ),
      );
    }
    if (filterConcept) {
      result = result.filter((word) =>
        word.senses.some((sense) => sense.concept_id === filterConcept),
      );
    }
    const sorted = [...result];
    sorted.sort((a, b) =>
      sortMode === "az"
        ? a.con_word_romanized.localeCompare(b.con_word_romanized)
        : b.con_word_romanized.localeCompare(a.con_word_romanized),
    );
    return sorted;
  }, [
    wordsList,
    searchTerm,
    ipaMode,
    filterPos,
    filterOrigin,
    filterTags,
    filterConcept,
    quickKind,
    sortMode,
    workspaceConfig.custom_concepts,
  ]);

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

  const hiddenSelectedCount = useMemo(() => {
    const visible = new Set(displayWords.map((word) => word.entry_id));
    return [...selectedIds].filter((id) => !visible.has(id)).length;
  }, [displayWords, selectedIds]);

  /** 确认弹窗与实际删除集合必须完全一致：只删「当前筛选后可见」的选中项 */
  const deleteTargetIds = useMemo(
    () => displayWords.filter((word) => selectedIds.has(word.entry_id)).map((word) => word.entry_id),
    [displayWords, selectedIds],
  );

  const cleanupEmptyWord = () => {
    if (!activeWordId) return;
    const prev = wordsMap[activeWordId];
    if (prev && isDraftWord(prev)) deleteWord(prev.entry_id);
  };

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

  const clearHiddenSelection = () => {
    const visible = new Set(displayWords.map((word) => word.entry_id));
    setSelectedIds((prev) => new Set([...prev].filter((id) => visible.has(id))));
  };

  /** 批量删除：单次 deleteWordsBatch 落盘 + 单条撤销记录（前像为被删词条快照） */
  const handleDeleteSelected = async () => {
    const store = useLexiconStore.getState();
    const snapshots = deleteTargetIds
      .map((id) => store.wordsMap[id])
      .filter((word): word is WordEntry => Boolean(word))
      .map((word) => structuredClone(word));
    if (snapshots.length === 0) return;
    const deletedIds = snapshots.map((word) => word.entry_id);
    await store.deleteWordsBatch(deletedIds);
    pushUndoEntry({
      languageId: store.languagePath,
      domain: "lexicon",
      labelKey: "lexicon.deleteSelected",
      undo: () => useLexiconStore.getState().importWords(snapshots),
      redo: () => useLexiconStore.getState().deleteWordsBatch(deletedIds),
    });
    setSelectedIds(new Set());
  };

  return (
    <div className="flex h-full w-64 flex-col border-r border-base-300 bg-base-200">
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
        filterConcept={filterConcept}
        onFilterConceptChange={setFilterConcept}
        quickKind={quickKind}
        onQuickKindChange={setQuickKind}
        conceptOptions={conceptOptions}
        conceptMigrationSlot={<ConceptMigrationButton />}
        allTags={allTags}
        partsOfSpeech={partsOfSpeech}
        batchMode={batchMode}
        selectedCount={selectedIds.size}
        visibleCount={displayWords.length}
        onToggleBatchMode={() => setBatchMode(!batchMode)}
        onSelectAll={() => setSelectedIds(new Set(displayWords.map((word) => word.entry_id)))}
        onClearSelection={() => setSelectedIds(new Set())}
        onRequestDeleteSelected={() => {
          if (deleteTargetIds.length > 0) setShowDeleteSelectedConfirm(true);
        }}
        onAddWord={handleAddWord}
        onExportCsv={() => void exportToCSV(wordsList)}
        onOpenTable={onOpenTable}
      />

      {batchMode && (
        <HiddenSelectionBanner selectedCount={selectedIds.size} hiddenCount={hiddenSelectedCount} onClearHidden={clearHiddenSelection} />
      )}

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
          hiddenSelectedCount={hiddenSelectedCount}
          onClose={() => {
            setBatchMode(false);
            setSelectedIds(new Set());
          }}
        />
      )}

      <ConfirmModal
        open={showDeleteSelectedConfirm}
        title={t("lexicon.deleteSelected")}
        message={t("lexicon.deleteSelectedConfirm", { count: deleteTargetIds.length })}
        onConfirm={() => {
          void handleDeleteSelected();
          setShowDeleteSelectedConfirm(false);
        }}
        onCancel={() => setShowDeleteSelectedConfirm(false)}
      />
    </div>
  );
};
