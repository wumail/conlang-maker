/**
 * GlossingToolbar.tsx — 语料标注工具栏（Roadmap v3 / Pillar 6）
 *
 * 三模式自动标注下拉（默认 fill_empty）+ 句子筛选芯片 + 上次标注报告。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { Plus, Wand2 } from "lucide-react";
import type { AutoGlossReport, AutoGlossScopeMode } from "../../core/workflows/autoGloss";
import { BTN_GHOST, BTN_PRIMARY, SELECT, BADGE } from "../../lib/ui";

export type LineFilter = "all" | "unresolved" | "multi_candidate" | "broken_ref";

const MODE_KEYS: Record<AutoGlossScopeMode, string> = {
  fill_empty: "corpus.v3.modeFillEmpty",
  recompute_auto: "corpus.v3.modeRecomputeAuto",
  reanalyze_selected: "corpus.v3.modeReanalyzeSelected",
};

const FILTER_KEYS: Record<LineFilter, string> = {
  all: "corpus.v3.filterAllLines",
  unresolved: "corpus.v3.filterUnresolved",
  multi_candidate: "corpus.v3.filterAmbiguous",
  broken_ref: "corpus.v3.filterBrokenLinks",
};

interface GlossingToolbarProps {
  mode: AutoGlossScopeMode;
  onModeChange: (mode: AutoGlossScopeMode) => void;
  filter: LineFilter;
  onFilterChange: (filter: LineFilter) => void;
  counts: Record<LineFilter, number>;
  report: AutoGlossReport | null;
  onRunAutoGloss: () => void;
  onPreviewSca: () => void;
  onAddLine: () => void;
}

export const GlossingToolbar: React.FC<GlossingToolbarProps> = ({
  mode,
  onModeChange,
  filter,
  onFilterChange,
  counts,
  report,
  onRunAutoGloss,
  onPreviewSca,
  onAddLine,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{t("corpus.glossing")}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={`${SELECT} select-sm w-44 text-xs`}
            value={mode}
            onChange={(event) => onModeChange(event.target.value as AutoGlossScopeMode)}
            title={t("corpus.v3.modeHint")}
          >
            {(Object.keys(MODE_KEYS) as AutoGlossScopeMode[]).map((item) => (
              <option key={item} value={item}>
                {t(MODE_KEYS[item])}
              </option>
            ))}
          </select>
          <button className={BTN_PRIMARY} onClick={onRunAutoGloss}>
            <Wand2 className="w-4 h-4" /> {t("corpus.autoGloss")}
          </button>
          <button className={BTN_GHOST} onClick={onPreviewSca}>
            <Wand2 className="w-4 h-4" /> {t("corpus.applyScaPreview")}
          </button>
          <button className={BTN_GHOST} onClick={onAddLine}>
            <Plus className="w-4 h-4" /> {t("corpus.addLine")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {(Object.keys(FILTER_KEYS) as LineFilter[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`${BADGE} badge-sm cursor-pointer ${
              filter === item ? "badge-primary" : "badge-ghost"
            }`}
            onClick={() => onFilterChange(item)}
          >
            {t(FILTER_KEYS[item])} ({counts[item] ?? 0})
          </button>
        ))}
      </div>

      {report && (
        <div className="rounded-lg border border-base-300 bg-base-200 px-3 py-2 text-xs text-base-content/70">
          {t("corpus.autoGlossReport", {
            total: report.total,
            autoApplied: report.autoApplied,
            pending: report.pending,
            unresolved: report.unresolved,
          })}
        </div>
      )}
    </div>
  );
};
