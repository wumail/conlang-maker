import React from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  Plus,
  Download,
  AudioLines,
  CheckSquare,
  Table2,
  Filter,
  ArrowDownAZ,
  ArrowUpZA,
} from "lucide-react";
import type { BuiltinQuickFilterKind, PartOfSpeech } from "../../types";
import { BTN_GHOST_SQ, TOGGLE, SELECT } from "../../lib/ui";
import { TagSelector } from "../common/TagSelector";
import {
  LEXICON_LIFECYCLE_FILTERS,
  LEXICON_ORIGIN_FILTERS,
  LEXICON_QUICK_FILTERS,
} from "../../lib/lexiconQuickFilters";

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
  filterConcept: string;
  onFilterConceptChange: (value: string) => void;
  quickKind: BuiltinQuickFilterKind | "";
  onQuickKindChange: (value: BuiltinQuickFilterKind | "") => void;
  /** 当前语言中已绑定的概念（去重后按标签排序） */
  conceptOptions: { id: string; label: string }[];
  /** 概念迁移入口（自带弹窗的组件槽位） */
  conceptMigrationSlot?: React.ReactNode;
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
  /** 打开表格视图弹窗 */
  onOpenTable: () => void;
}

interface FilterOption {
  value: string;
  label: string;
}

/** 受控单选下拉（首项为「全部」），消掉 5 段重复的 select 样板 */
const FilterSelect: React.FC<{
  value: string;
  allLabel: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}> = ({ value, allLabel, options, onChange }) => (
  <select
    className={`${SELECT} select-xs w-full`}
    value={value}
    onChange={(event) => onChange(event.target.value)}
  >
    <option value="">{allLabel}</option>
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
);

/** 带标题的筛选项容器 */
const FilterField: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <label className="block text-base-content/60 mb-1">{label}</label>
    {children}
  </div>
);

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
  filterConcept,
  onFilterConceptChange,
  quickKind,
  onQuickKindChange,
  conceptOptions,
  conceptMigrationSlot,
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
  onOpenTable,
}) => {
  const { t } = useTranslation();
  const active = [filterPos, filterOrigin, filterLifecycle, filterConcept, quickKind];
  const hasFilters = active.some(Boolean) || filterTags.length > 0;
  const allLabel = t("common.all");

  const clearAllFilters = () => {
    onFilterPosChange("");
    onFilterTagsChange([]);
    onFilterOriginChange("");
    onFilterLifecycleChange("");
    onFilterConceptChange("");
    onQuickKindChange("");
  };

  return (
    <div className="p-4 border-b border-base-300 flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1">
          <h2 className="font-bold text-lg text-base-content/80">{t("lexicon.title")}</h2>
          <button onClick={onOpenTable} className={BTN_GHOST_SQ} title={t("lexicon.table.viewTable")}>
            <Table2 size={18} />
          </button>
        </div>
        <div className="flex gap-1">
          <button onClick={onAddWord} className={BTN_GHOST_SQ} title={t("lexicon.addWord")}><Plus size={18} /></button>
          <button
            onClick={onToggleBatchMode}
            className={`${BTN_GHOST_SQ} ${batchMode ? "text-primary bg-primary/10" : ""}`}
            title={t("lexicon.batchEdit")}
          >
            <CheckSquare size={18} />
          </button>
          <button onClick={onExportCsv} className={BTN_GHOST_SQ} title={t("lexicon.exportCsv")}><Download size={18} /></button>
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
            <button className="hover:underline text-error" onClick={onRequestDeleteSelected} disabled={selectedCount === 0}>
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
          <FilterField label={t("lexicon.pos")}>
            <FilterSelect value={filterPos} allLabel={allLabel} onChange={onFilterPosChange}
              options={partsOfSpeech.map((pos) => ({ value: pos.pos_id, label: pos.name }))} />
          </FilterField>
          <FilterField label={t("lexicon.originType")}>
            <FilterSelect value={filterOrigin} allLabel={allLabel} onChange={onFilterOriginChange}
              options={LEXICON_ORIGIN_FILTERS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} />
          </FilterField>
          <FilterField label={t("lexicon.lifecycle.filterLabel")}>
            <FilterSelect value={filterLifecycle} allLabel={allLabel}
              options={LEXICON_LIFECYCLE_FILTERS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              onChange={(value) => onFilterLifecycleChange(value as LexiconLifecycleFilter)} />
          </FilterField>
          <FilterField label={t("lexicon.concept.filterLabel")}>
            <FilterSelect value={filterConcept} allLabel={allLabel} onChange={onFilterConceptChange}
              options={conceptOptions.map((o) => ({ value: o.id, label: o.label }))} />
          </FilterField>
          <FilterField label={t("lexicon.filtersV3.quickFilterLabel")}>
            <FilterSelect value={quickKind} allLabel={allLabel}
              options={LEXICON_QUICK_FILTERS.map((f) => ({ value: f.kind, label: t(f.labelKey) }))}
              onChange={(value) => onQuickKindChange(value as BuiltinQuickFilterKind | "")} />
          </FilterField>
          <FilterField label={t("lexicon.tags")}>
            <TagSelector selected={filterTags} options={allTags} onChange={onFilterTagsChange}
              placeholder={t("lexicon.tags")} />
          </FilterField>
          {hasFilters && (
            <div className="flex justify-between items-center mt-1">
              <span className="text-base-content/50">
                {t("lexicon.resultCount", { count: visibleCount })}
              </span>
              <button className="text-primary hover:underline" onClick={clearAllFilters}>
                {t("common.clear")}
              </button>
            </div>
          )}
          {conceptMigrationSlot}
        </div>
      )}
    </div>
  );
};
