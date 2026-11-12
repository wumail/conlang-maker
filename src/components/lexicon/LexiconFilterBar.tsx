import React from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  Plus,
  Download,
  AudioLines,
  CheckSquare,
  Filter,
  ArrowDownAZ,
  ArrowUpZA,
} from "lucide-react";
import type { PartOfSpeech } from "../../types";
import { BTN_GHOST_SQ, TOGGLE, SELECT } from "../../lib/ui";
import { TagSelector } from "../common/TagSelector";

export type LexiconSortMode = "az" | "za";
export type LexiconLifecycleFilter = "" | "added" | "deprecated" | "changed";

interface LexiconFilterBarProps {
  ipaMode: boolean;
  onToggleIpaMode: () => void;
  sortMode: LexiconSortMode;
  onToggleSortMode: () => void;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  filterPos: string;
  onFilterPosChange: (value: string) => void;
  filterOrigin: string;
  onFilterOriginChange: (value: string) => void;
  filterLifecycle: LexiconLifecycleFilter;
  onFilterLifecycleChange: (value: LexiconLifecycleFilter) => void;
  filterTags: string[];
  onFilterTagsChange: (tags: string[]) => void;
  allTags: string[];
  partsOfSpeech: PartOfSpeech[];
  batchMode: boolean;
  selectedCount: number;
  visibleCount: number;
  onToggleBatchMode: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRequestDeleteSelected: () => void;
  onAddWord: () => void;
  onExportCsv: () => void;
}

/** 词典侧边栏的筛选/搜索/批量操作条（纯受控） */
export const LexiconFilterBar: React.FC<LexiconFilterBarProps> = ({
  ipaMode,
  onToggleIpaMode,
  sortMode,
  onToggleSortMode,
  searchTerm,
  onSearchTermChange,
  showAdvanced,
  onToggleAdvanced,
  filterPos,
  onFilterPosChange,
  filterOrigin,
  onFilterOriginChange,
  filterLifecycle,
  onFilterLifecycleChange,
  filterTags,
  onFilterTagsChange,
  allTags,
  partsOfSpeech,
  batchMode,
  selectedCount,
  visibleCount,
  onToggleBatchMode,
  onSelectAll,
  onClearSelection,
  onRequestDeleteSelected,
  onAddWord,
  onExportCsv,
}) => {
  const { t } = useTranslation();
  const hasFilters = Boolean(
    filterPos || filterOrigin || filterTags.length > 0 || filterLifecycle,
  );

  return (
    <div className="p-4 border-b border-base-300 flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <h2 className="font-bold text-lg text-base-content/80">
          {t("lexicon.title")}
        </h2>
        <div className="flex gap-1">
          <button onClick={onAddWord} className={BTN_GHOST_SQ} title={t("lexicon.addWord")}>
            <Plus size={18} />
          </button>
          <button
            onClick={onToggleBatchMode}
            className={`${BTN_GHOST_SQ} ${batchMode ? "text-primary bg-primary/10" : ""}`}
            title={t("lexicon.batchEdit")}
          >
            <CheckSquare size={18} />
          </button>
          <button onClick={onExportCsv} className={BTN_GHOST_SQ} title={t("lexicon.exportCsv")}>
            <Download size={18} />
          </button>
        </div>
      </div>

      {batchMode && (
        <div className="flex items-center justify-between text-xs bg-base-300/50 p-2 rounded-lg">
          <span>
            {selectedCount} {t("common.selected")}
          </span>
          <div className="flex gap-2">
            <button className="hover:underline text-primary" onClick={onSelectAll}>
              {t("common.selectAll")}
            </button>
            <button className="hover:underline text-base-content/50" onClick={onClearSelection}>
              {t("common.clear")}
            </button>
            <button
              className="hover:underline text-error"
              onClick={onRequestDeleteSelected}
              disabled={selectedCount === 0}
            >
              {t("lexicon.deleteSelected")}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" className={TOGGLE} checked={ipaMode} onChange={onToggleIpaMode} />
          <AudioLines size={14} />
          <span>{t("lexicon.ipaSearch")}</span>
        </label>
        <div className="flex-1" />
        <button
          className="btn btn-ghost btn-xs gap-1 font-mono text-xs"
          onClick={onToggleSortMode}
          title={t("lexicon.sort")}
        >
          {sortMode === "az" ? <ArrowDownAZ size={14} /> : <ArrowUpZA size={14} />}
        </button>
      </div>

      <div className="relative flex gap-1">
        <div className="input input-sm">
          <Search className="text-base-content" size={16} />
          <input
            type="text"
            placeholder={ipaMode ? t("lexicon.ipaSearchPlaceholder") : t("common.search")}
            className="w-full pr-2 grow"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
          />
        </div>
        <button
          onClick={onToggleAdvanced}
          className={`btn btn-sm btn-square ${showAdvanced ? "btn-primary" : "btn-ghost"}`}
          title={t("lexicon.advancedSearch")}
        >
          <Filter size={16} />
        </button>
      </div>

      {showAdvanced && (
        <div className="bg-base-300/30 p-2 rounded-lg space-y-2 text-xs border border-base-300">
          <div>
            <label className="block text-base-content/60 mb-1">{t("lexicon.pos")}</label>
            <select
              className={`${SELECT} select-xs w-full`}
              value={filterPos}
              onChange={(event) => onFilterPosChange(event.target.value)}
            >
              <option value="">{t("common.all")}</option>
              {partsOfSpeech.map((pos) => (
                <option key={pos.pos_id} value={pos.pos_id}>
                  {pos.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-base-content/60 mb-1">{t("lexicon.originType")}</label>
            <select
              className={`${SELECT} select-xs w-full`}
              value={filterOrigin}
              onChange={(event) => onFilterOriginChange(event.target.value)}
            >
              <option value="">{t("common.all")}</option>
              <option value="a_priori">{t("lexicon.originAPriori")}</option>
              <option value="a_posteriori">{t("lexicon.originAPosteriori")}</option>
              <option value="evolved">{t("lexicon.originEvolved")}</option>
              <option value="borrowed">{t("lexicon.originBorrowed")}</option>
            </select>
          </div>
          <div>
            <label className="block text-base-content/60 mb-1">
              {t("lexicon.lifecycle.filterLabel")}
            </label>
            <select
              className={`${SELECT} select-xs w-full`}
              value={filterLifecycle}
              onChange={(event) =>
                onFilterLifecycleChange(event.target.value as LexiconLifecycleFilter)
              }
            >
              <option value="">{t("common.all")}</option>
              <option value="added">{t("lexicon.lifecycle.added")}</option>
              <option value="deprecated">{t("lexicon.lifecycle.deprecated")}</option>
              <option value="changed">{t("lexicon.lifecycle.changed")}</option>
            </select>
          </div>
          <div>
            <label className="block text-base-content/60 mb-1">{t("lexicon.tags")}</label>
            <TagSelector
              selected={filterTags}
              options={allTags}
              onChange={onFilterTagsChange}
              placeholder={t("lexicon.tags")}
            />
          </div>
          {hasFilters && (
            <div className="flex justify-between items-center mt-1">
              <span className="text-base-content/50">
                {t("lexicon.resultCount", { count: visibleCount })}
              </span>
              <button
                className="text-primary hover:underline"
                onClick={() => {
                  onFilterPosChange("");
                  onFilterTagsChange([]);
                  onFilterOriginChange("");
                  onFilterLifecycleChange("");
                }}
              >
                {t("common.clear")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
