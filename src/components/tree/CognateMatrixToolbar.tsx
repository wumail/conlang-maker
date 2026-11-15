/**
 * CognateMatrixToolbar.tsx — 同源矩阵工具栏（Roadmap v3 / Pillar 5）
 *
 * 展示 `showing X / Y`、固定参考列（Pin Column）、历时比较筛选与失败重试。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Pin, RotateCw } from "lucide-react";
import type {
  CognateComparisonFilter,
  CognateMatrixLanguage,
} from "../../core/engines/cognateMatrix";
import { SELECT, BTN_GHOST, BADGE } from "../../lib/ui";

const FILTER_OPTIONS: CognateComparisonFilter[] = [
  "all",
  "borrowing_replacement",
  "form_changed",
  "multi_candidate",
  "broken_chain",
];

interface CognateMatrixToolbarProps {
  languages: CognateMatrixLanguage[];
  shown: number;
  total: number;
  pinnedLanguageId: string;
  comparisonFilter: CognateComparisonFilter;
  failedLanguages: string[];
  loading: boolean;
  onPinChange: (languageId: string) => void;
  onFilterChange: (filter: CognateComparisonFilter) => void;
  onRetry: () => void;
}

export const CognateMatrixToolbar: React.FC<CognateMatrixToolbarProps> = ({
  languages,
  shown,
  total,
  pinnedLanguageId,
  comparisonFilter,
  failedLanguages,
  loading,
  onPinChange,
  onFilterChange,
  onRetry,
}) => {
  const { t } = useTranslation();

  /** 比较模式标签：显式逐项 t() 调用（含 multi_candidate 的插值参数） */
  const filterLabel = (filter: CognateComparisonFilter): string => {
    switch (filter) {
      case "all":
        return t("cognates.v3.filterAll");
      case "borrowing_replacement":
        return t("cognates.v3.filterBorrowingReplacement");
      case "form_changed":
        return t("cognates.v3.filterFormChanged");
      case "multi_candidate":
        return t("cognates.v3.filterMultiCandidate", { plus: 1 });
      case "broken_chain":
        return t("cognates.v3.filterBrokenChain");
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
      <span className="whitespace-nowrap text-base-content/60">
        {t("cognates.v3.showingCount", { shown, total })}
      </span>

      <span className="flex items-center gap-1 whitespace-nowrap text-base-content/60">
        <Pin size={12} />
        {t("cognates.v3.pinColumn")}
      </span>
      <select
        className={`${SELECT} select-xs w-36 text-xs`}
        value={pinnedLanguageId}
        onChange={(event) => onPinChange(event.target.value)}
      >
        <option value="">—</option>
        {languages.map((language) => (
          <option key={language.languageId} value={language.languageId}>
            {language.name}
          </option>
        ))}
      </select>

      <select
        className={`${SELECT} select-xs w-48 text-xs`}
        value={comparisonFilter}
        onChange={(event) => onFilterChange(event.target.value as CognateComparisonFilter)}
      >
        {FILTER_OPTIONS.map((filter) => (
          <option key={filter} value={filter}>
            {filterLabel(filter)}
          </option>
        ))}
      </select>

      {failedLanguages.length > 0 && (
        <span className={`${BADGE} badge-error badge-sm gap-1`}>
          <AlertTriangle size={11} />
          {t("cognates.v3.loadFailed")}: {failedLanguages.join(", ")}
        </span>
      )}

      <button
        type="button"
        className={BTN_GHOST}
        onClick={onRetry}
        disabled={loading}
        title={t("cognates.v3.retryLoad")}
      >
        <RotateCw size={13} className={loading ? "animate-spin" : undefined} />
        {t("cognates.v3.retryLoad")}
      </button>
    </div>
  );
};
