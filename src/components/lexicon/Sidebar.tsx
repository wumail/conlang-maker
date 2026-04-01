import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import { DEFAULT_LANGUAGE_ID } from "../../constants";
import {
  Search,
  Plus,
  Download,
  AudioLines,
  CheckSquare,
  Filter,
  ArrowDownAZ,
  ArrowUpZA,
  // Trash2,
} from "lucide-react";
import { exportToCSV } from "../../utils/exportCSV";
import { ipaFuzzySearch } from "../../utils/ipaSearch";
import { BTN_GHOST_SQ, TOGGLE, SELECT } from "../../lib/ui";
import { WordEntry } from "../../types";
import { BatchEditPanel } from "./BatchEditPanel";
import { TagSelector } from "../common/TagSelector";
import { ConfirmModal } from "../common/ConfirmModal";

type SortMode = "az" | "za";

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
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
  const [sortMode, setSortMode] = useState<SortMode>("az");

  // Advanced search state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filterPos, setFilterPos] = useState("");
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterOrigin, setFilterOrigin] = useState("");

  // Batch edit state
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] =
    useState(false);
  const [showCleanBlankConfirm, setShowCleanBlankConfirm] = useState(false);

  const inventory = useMemo(
    () => [
      ...config.phoneme_inventory.consonants,
      ...config.phoneme_inventory.vowels,
    ],
    [config.phoneme_inventory],
  );

  // Collect all unique tags from all words
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    wordsList.forEach((w) => {
      w.metadata?.tags?.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [wordsList]);

  const blankWordIds = useMemo(
    () =>
      wordsList
        .filter((w) => {
          const rom = (w.con_word_romanized || "").trim();
          const hasMeaning = w.senses.some(
            (s) => (s.gloss || "").trim().length > 0,
          );
          return rom === "" && !hasMeaning;
        })
        .map((w) => w.entry_id),
    [wordsList],
  );

  const handleDeleteSelected = () => {
    const ids = Array.from(selectedIds);
    ids.forEach((id) => deleteWord(id));
    setSelectedIds(new Set());
    setBatchMode(false);
  };

  const handleCleanBlankWords = () => {
    blankWordIds.forEach((id) => deleteWord(id));
  };

  /**
   * If the currently active word is still the default "new_word" or blank,
   * remove it so we don't accumulate ghost entries.
   */
  const cleanupEmptyWord = () => {
    if (!activeWordId) return;
    const prev = wordsMap[activeWordId];
    if (!prev) return;
    const rom = prev.con_word_romanized.trim();
    const hasMeaning = prev.senses.some((s) => s.gloss.trim().length > 0);
    // Keep existing edited entries that temporarily have empty spelling but still carry meaning.
    if (rom === "new_word" || (rom === "" && !hasMeaning)) {
      deleteWord(prev.entry_id);
    }
  };

  // Cleanup on unmount (e.g. navigating to another page)
  React.useEffect(() => {
    return () => {
      const store = useLexiconStore.getState();
      const id = store.activeWordId;
      if (!id) return;
      const w = store.wordsMap[id];
      if (!w) return;
      const rom = w.con_word_romanized.trim();
      const hasMeaning = w.senses.some((s) => s.gloss.trim().length > 0);
      if (rom === "new_word" || (rom === "" && !hasMeaning)) {
        store.deleteWord(w.entry_id);
      }
    };
  }, []);

  const filteredWords: WordEntry[] = useMemo(() => {
    let result: WordEntry[];
    if (!searchTerm.trim()) {
      result = [...wordsList];
    } else if (ipaMode) {
      result = ipaFuzzySearch(searchTerm, wordsList, inventory, 0.6).map(
        (r) => r.entry,
      );
    } else {
      const q = searchTerm.toLowerCase();
      result = wordsList.filter(
        (w) =>
          w.con_word_romanized.toLowerCase().includes(q) ||
          w.senses.some((s) => s.gloss.toLowerCase().includes(q)),
      );
    }

    // Apply advanced filters
    if (filterPos) {
      result = result.filter((w) =>
        w.senses.some((s) => s.pos_id === filterPos),
      );
    }
    if (filterOrigin) {
      result = result.filter((w) => w.etymology?.origin_type === filterOrigin);
    }
    if (filterTags.length > 0) {
      result = result.filter((w) =>
        w.metadata?.tags?.some((tag) =>
          filterTags.some((ft) => tag.toLowerCase().includes(ft.toLowerCase())),
        ),
      );
    }

    if (sortMode === "az") {
      result.sort((a, b) =>
        a.con_word_romanized.localeCompare(b.con_word_romanized),
      );
    } else if (sortMode === "za") {
      result.sort((a, b) =>
        b.con_word_romanized.localeCompare(a.con_word_romanized),
      );
    }
    return result;
  }, [
    searchTerm,
    wordsList,
    ipaMode,
    inventory,
    sortMode,
    filterPos,
    filterOrigin,
    filterTags,
  ]);

  const handleAddWord = () => {
    cleanupEmptyWord();
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    upsertWord({
      entry_id: newId,
      language_id: DEFAULT_LANGUAGE_ID,
      con_word_romanized: "new_word",
      phonetic_ipa: "",
      phonetic_override: false,
      senses: [
        {
          sense_id: crypto.randomUUID(),
          pos_id: "pos_noun",
          gloss: t("lexicon.newMeaning"),
          definitions: [],
          examples: [],
        },
      ],
      etymology: {
        origin_type: "a_priori",
        parent_entry_id: null,
        source_language_id: null,
        applied_sound_changes: [],
        semantic_shift_note: "",
      },
      metadata: { tags: [], created_at: now, updated_at: now },
    });
    setActiveWordId(newId);
  };

  return (
    <div className="w-64 border-r border-base-300 h-full flex flex-col bg-base-200">
      <div className="p-4 border-b border-base-300 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-lg text-base-content/80">
            {t("lexicon.title")}
          </h2>
          <div className="flex gap-1">
            <button
              onClick={handleAddWord}
              className={BTN_GHOST_SQ}
              title={t("lexicon.addWord")}
            >
              <Plus size={18} />
            </button>
            <button
              onClick={() => setBatchMode(!batchMode)}
              className={`${BTN_GHOST_SQ} ${batchMode ? "text-primary bg-primary/10" : ""}`}
              title={t("lexicon.batchEdit")}
            >
              <CheckSquare size={18} />
            </button>
            <button
              onClick={() => exportToCSV(wordsList)}
              className={BTN_GHOST_SQ}
              title={t("lexicon.exportCsv")}
            >
              <Download size={18} />
            </button>
            {/* <button
              onClick={() => setShowCleanBlankConfirm(true)}
              className={`${BTN_GHOST_SQ} ${blankWordIds.length > 0 ? "text-warning" : "opacity-50"}`}
              title={t("lexicon.cleanBlankWords")}
              disabled={blankWordIds.length === 0}
            >
              <Trash2 size={18} />
            </button> */}
          </div>
        </div>

        {batchMode && (
          <div className="flex items-center justify-between text-xs bg-base-300/50 p-2 rounded-lg">
            <span>
              {selectedIds.size} {t("common.selected", "selected")}
            </span>
            <div className="flex gap-2">
              <button
                className="hover:underline text-primary"
                onClick={() =>
                  setSelectedIds(new Set(filteredWords.map((w) => w.entry_id)))
                }
              >
                {t("common.selectAll", "All")}
              </button>
              <button
                className="hover:underline text-base-content/50"
                onClick={() => setSelectedIds(new Set())}
              >
                {t("common.clear", "Clear")}
              </button>
              <button
                className="hover:underline text-error"
                onClick={() => setShowDeleteSelectedConfirm(true)}
                disabled={selectedIds.size === 0}
              >
                {t("lexicon.deleteSelected")}
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              className={TOGGLE}
              checked={ipaMode}
              onChange={() => setIpaMode(!ipaMode)}
            />
            <AudioLines size={14} />
            <span>{t("lexicon.ipaSearch")}</span>
          </label>
          <div className="flex-1" />
          <button
            className="btn btn-ghost btn-xs gap-1 font-mono text-xs"
            onClick={() => setSortMode(sortMode === "az" ? "za" : "az")}
            title={t("lexicon.sort")}
          >
            {sortMode === "az" ? (
              <ArrowDownAZ size={14} />
            ) : (
              <ArrowUpZA size={14} />
            )}
          </button>
        </div>
        <div className="relative flex gap-1">
          <div className="input input-sm">
            <Search className="text-base-content" size={16} />
            <input
              type="text"
              placeholder={
                ipaMode ? t("lexicon.ipaSearchPlaceholder") : t("common.search")
              }
              className={`w-full pr-2 grow`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`btn btn-sm btn-square ${showAdvanced ? "btn-primary" : "btn-ghost"}`}
            title={t("lexicon.advancedSearch", "Advanced Search")}
          >
            <Filter size={16} />
          </button>
        </div>

        {showAdvanced && (
          <div className="bg-base-300/30 p-2 rounded-lg space-y-2 text-xs border border-base-300">
            <div>
              <label className="block text-base-content/60 mb-1">
                {t("lexicon.pos")}
              </label>
              <select
                className={`${SELECT} select-xs w-full`}
                value={filterPos}
                onChange={(e) => setFilterPos(e.target.value)}
              >
                <option value="">{t("common.all", "All")}</option>
                {partsOfSpeech.map((p) => (
                  <option key={p.pos_id} value={p.pos_id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-base-content/60 mb-1">
                {t("lexicon.originType")}
              </label>
              <select
                className={`${SELECT} select-xs w-full`}
                value={filterOrigin}
                onChange={(e) => setFilterOrigin(e.target.value)}
              >
                <option value="">{t("common.all", "All")}</option>
                <option value="a_priori">{t("lexicon.originAPriori")}</option>
                <option value="a_posteriori">
                  {t("lexicon.originAPosteriori")}
                </option>
                <option value="evolved">{t("lexicon.originEvolved")}</option>
                <option value="borrowed">{t("lexicon.originBorrowed")}</option>
              </select>
            </div>
            <div>
              <label className="block text-base-content/60 mb-1">
                {t("lexicon.tags")}
              </label>
              <TagSelector
                selected={filterTags}
                options={allTags}
                onChange={setFilterTags}
                placeholder={t("lexicon.tags")}
              />
            </div>
            {(filterPos || filterOrigin || filterTags.length > 0) && (
              <div className="flex justify-end mt-1">
                <button
                  className="text-primary hover:underline"
                  onClick={() => {
                    setFilterPos("");
                    setFilterTags([]);
                    setFilterOrigin("");
                  }}
                >
                  {t("common.clear", "Clear")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto relative p-2 space-y-2">
        {filteredWords.map((word) => {
          const isSelected = selectedIds.has(word.entry_id);
          const isActive =
            activeWordId === word.entry_id &&
            (!batchMode || selectedIds.size === 0);

          return (
            <div
              key={word.entry_id}
              onClick={() => {
                if (batchMode) {
                  const next = new Set(selectedIds);
                  if (next.has(word.entry_id)) next.delete(word.entry_id);
                  else next.add(word.entry_id);
                  setSelectedIds(next);
                } else {
                  cleanupEmptyWord();
                  setActiveWordId(word.entry_id);
                }
              }}
              className={`p-3 border-b border-base-200 rounded cursor-pointer flex gap-3 ${
                batchMode ? "hover:bg-base-200" : "hover:bg-info/10"
              } ${isActive ? "bg-primary/15" : ""} ${isSelected && batchMode ? "bg-primary/5" : ""}`}
            >
              {batchMode && (
                <div className="pt-1">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm checkbox-primary"
                    checked={isSelected}
                    readOnly
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-base-content truncate">
                  {word.con_word_romanized}
                </div>
                {ipaMode && word.phonetic_ipa && (
                  <div className="text-xs font-mono text-primary truncate">
                    /{word.phonetic_ipa}/
                  </div>
                )}
                <div className="text-xs text-base-content/60 truncate">
                  {word.senses.map((s) => s.gloss).join("; ")}
                </div>
              </div>
            </div>
          );
        })}
      </div>

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
        message={t("lexicon.deleteSelectedConfirm", {
          count: selectedIds.size,
        })}
        onConfirm={() => {
          handleDeleteSelected();
          setShowDeleteSelectedConfirm(false);
        }}
        onCancel={() => setShowDeleteSelectedConfirm(false)}
      />

      <ConfirmModal
        open={showCleanBlankConfirm}
        title={t("lexicon.cleanBlankWords")}
        message={t("lexicon.cleanBlankWordsConfirm", {
          count: blankWordIds.length,
        })}
        onConfirm={() => {
          handleCleanBlankWords();
          setShowCleanBlankConfirm(false);
        }}
        onCancel={() => setShowCleanBlankConfirm(false)}
      />
    </div>
  );
};
