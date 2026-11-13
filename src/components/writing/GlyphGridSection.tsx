import React from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import type { FontMetricsInput } from "../../core/engines/fontGeometryAudit";
import { GlyphCellRuler } from "./GlyphCellRuler";
import type { UnicodeBlockId } from "../../utils/unicodeBlocks";
import { BTN_GHOST, CARD, CARD_BODY, SECTION_HEADER } from "../../lib/ui";
import {
  blockLabel,
  glyphText,
  type BlockFilter,
  type ResolvedCellInfo,
} from "./glyphUtils";

interface GlyphGridSectionProps {
  hasFontPresent: boolean;
  parentSourceName: string | null;
  onSyncFromParent: () => void;
  totalCellsCount: number;
  filteredCount: number;
  annotationsCount: number;
  presentBlocks: UnicodeBlockId[];
  blockFilter: BlockFilter;
  onBlockFilterChange: (next: BlockFilter) => void;
  query: string;
  onQueryChange: (next: string) => void;
  copyFailed: boolean;
  visibleCells: number[][];
  selectedCode: number | null;
  selectedCell: number[] | null;
  resolveCellInfo: (cell: number[]) => ResolvedCellInfo;
  onSelectCell: (cell: number[], element: HTMLElement) => void;
  safePage: number;
  pageCount: number;
  onPageChange: (next: number) => void;
  showRulers?: boolean;
  metrics?: FontMetricsInput | null;
}

export const GlyphGridSection: React.FC<GlyphGridSectionProps> = ({
  hasFontPresent,
  parentSourceName,
  onSyncFromParent,
  totalCellsCount,
  filteredCount,
  annotationsCount,
  presentBlocks,
  blockFilter,
  onBlockFilterChange,
  query,
  onQueryChange,
  copyFailed,
  visibleCells,
  selectedCode,
  selectedCell,
  resolveCellInfo,
  onSelectCell,
  safePage,
  pageCount,
  onPageChange,
  showRulers = false,
  metrics = null,
}) => {
  const { t } = useTranslation();
  const showEmptyFont = totalCellsCount === 0;
  const showGrid = filteredCount > 0;

  return (
    <section className={CARD}>
      <div className={`${CARD_BODY} gap-3`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5 max-w-2xl">
            <h2 className={`${SECTION_HEADER} mb-0`}>
              {t("writing.glyphsTab")}
            </h2>
            <p className="text-xs text-base-content/60">
              {t("writing.glyphsHint")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {parentSourceName && (
              <button
                type="button"
                className={BTN_GHOST}
                onClick={onSyncFromParent}
                title={t("writing.syncParentHint")}
                data-testid="sync-parent-annotations"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t("writing.syncParent", { name: parentSourceName })}
              </button>
            )}

            {totalCellsCount > 0 && (
              <select
                className="select select-sm bg-base-200/30 border-base-300 focus:border-primary focus:outline-none"
                value={blockFilter}
                data-testid="glyph-block-filter"
                onChange={(event) => {
                  onBlockFilterChange(event.target.value as BlockFilter);
                }}
              >
                <option value="all">{t("writing.filterAll")}</option>
                {annotationsCount > 0 && (
                  <option value="annotated">
                    {t("writing.filterAnnotated")}
                  </option>
                )}
                {presentBlocks.map((block) => (
                  <option key={block} value={block}>
                    {blockLabel(t, block)}
                  </option>
                ))}
              </select>
            )}

            {totalCellsCount > 0 && (
              <span className="text-xs font-mono text-base-content/50">
                {t("writing.showing", {
                  shown: filteredCount,
                  total: totalCellsCount,
                })}
              </span>
            )}

            <input
              className="input input-sm w-60 bg-base-200/30 border-base-300 focus:border-primary focus:outline-none"
              value={query}
              placeholder={t("writing.search")}
              data-testid="glyph-search"
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </div>
        </div>

        {copyFailed && (
          <p className="text-xs text-error" data-testid="glyph-copy-failed">
            {t("writing.copyFailed")}
          </p>
        )}

        {showEmptyFont ? (
          <p className="text-xs text-base-content/60 py-4">
            {hasFontPresent
              ? t("writing.emptyGlyphs")
              : t("writing.noFontGlyphs")}
          </p>
        ) : totalCellsCount > 0 && filteredCount === 0 ? (
          <p className="text-xs text-base-content/60 py-4">
            {t("writing.noMatches")}
          </p>
        ) : showGrid ? (
          <div
            className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-2"
            data-testid="glyph-grid"
          >
            {visibleCells.map((cell) => {
              const info = resolveCellInfo(cell);
              const { codepoint, label, compositionText, annotated, inFont } =
                info;
              const selected =
                selectedCell !== null && cell.includes(selectedCode ?? -1);
              const note =
                codepoint === 0x20
                  ? t("writing.space")
                  : codepoint === 0x00a0
                    ? t("writing.nbsp")
                    : null;
              return (
                <button
                  key={cell[0]}
                  type="button"
                  title={
                    !inFont && hasFontPresent
                      ? t("writing.notInFont")
                      : undefined
                  }
                  className={`rounded-lg border px-1.5 py-2 flex flex-col items-center gap-0.5 min-w-0 overflow-hidden transition-colors cursor-pointer ${
                    selected
                      ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                      : annotated
                        ? "border-base-300 bg-base-100 hover:border-primary/60"
                        : "border-base-200 bg-base-200/20 hover:border-base-300"
                  } ${!inFont && hasFontPresent ? "opacity-60 border-dashed" : ""}`}
                  data-testid="glyph-cell"
                  data-annotate-anchor
                  data-cp={codepoint}
                  aria-pressed={selected}
                  onClick={(event) => onSelectCell(cell, event.currentTarget)}
                >
                  <span
                    className={`conlang-script text-2xl leading-none min-h-8 min-w-6 flex items-center justify-center ${
                      codepoint === 0x20 || codepoint === 0x00a0
                        ? "border-b border-dashed border-base-content/30"
                        : ""
                    }`}
                  >
                    {showRulers && metrics ? (
                      <GlyphCellRuler char={glyphText(codepoint)} metrics={metrics} />
                    ) : (
                      glyphText(codepoint)
                    )}
                  </span>
                  <span
                    className={`text-xs truncate max-w-full ${
                      label
                        ? "font-medium text-base-content"
                        : "text-base-content/40"
                    }`}
                    data-testid="glyph-label"
                  >
                    {label || note || t("writing.unassigned")}
                  </span>
                  <span
                    className="text-[10px] font-mono text-primary/80 truncate max-w-full min-h-3"
                    data-testid="glyph-composition"
                  >
                    {compositionText || "\u00a0"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {pageCount > 1 && showGrid && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              className={BTN_GHOST}
              disabled={safePage === 0}
              onClick={() => onPageChange(safePage - 1)}
            >
              {t("writing.prev")}
            </button>
            <span className="text-xs font-mono text-base-content/60">
              {t("writing.page", { page: safePage + 1, pages: pageCount })}
            </span>
            <button
              className={BTN_GHOST}
              disabled={safePage >= pageCount - 1}
              onClick={() => onPageChange(safePage + 1)}
            >
              {t("writing.next")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
