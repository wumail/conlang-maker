/**
 * CognateMatrixCell.tsx — 同源矩阵单元格渲染（Roadmap v3 / Pillar 5）
 *
 * 空单元格（+ 补词 / ⋯ 打开抽屉）、加载失败、词汇空缺状态、以及
 * 带同源组徽章的已填单元格。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import type { CognateMatrixCell, CognateMatrixRow } from "../../core/engines/cognateMatrix";
import { cognateColor } from "../../core/engines/cognateMatrix";
import type { LexicalGapStatus } from "../../types";
import { INPUT_MONO, BADGE } from "../../lib/ui";
import { ScriptLine } from "../writing/ScriptText";

export interface EditingCellState {
  column: number;
  rowIndex: number;
  value: string;
}

interface CognateMatrixCellViewProps {
  cell: CognateMatrixCell;
  row: CognateMatrixRow;
  rowIndex: number;
  column: number;
  editing: EditingCellState | null;
  activeLanguageId?: string;
  onEditingChange: (next: EditingCellState | null) => void;
  onCommit: (cell: CognateMatrixCell, value: string) => void;
  onOpenCell: (row: CognateMatrixRow, cell: CognateMatrixCell) => void;
  onOpenTrace: (row: CognateMatrixRow, setId: string) => void;
  onRetryLanguage: (languageId: string) => void;
}

export const CognateMatrixCellView: React.FC<CognateMatrixCellViewProps> = ({
  cell,
  row,
  rowIndex,
  column,
  editing,
  activeLanguageId,
  onEditingChange,
  onCommit,
  onOpenCell,
  onOpenTrace,
  onRetryLanguage,
}) => {
  const { t } = useTranslation();

  /** 词汇空缺状态标签：显式逐项 t() 调用，避免间接 key 字典漏掉静态校验 */
  const gapStatusLabel = (status: LexicalGapStatus): string => {
    switch (status) {
      case "unrecorded":
        return t("lexicon.conceptsV3.gapUnrecorded");
      case "tbd":
        return t("lexicon.conceptsV3.gapTbd");
      case "periphrastic":
        return t("lexicon.conceptsV3.gapPeriphrastic");
      case "confirmed_absent":
        return t("lexicon.conceptsV3.gapConfirmedAbsent");
    }
  };

  if (editing?.rowIndex === rowIndex && editing.column === column) {
    return (
      <input
        autoFocus
        className={`${INPUT_MONO} h-7 w-full text-xs`}
        value={editing.value}
        placeholder={row.glossZh || row.glossEn}
        onChange={(event) => onEditingChange({ ...editing, value: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit(cell, editing.value);
          if (event.key === "Escape") onEditingChange(null);
        }}
        onBlur={() => onEditingChange(null)}
      />
    );
  }

  if (cell.loadFailed) {
    return (
      <button
        type="button"
        className={`${BADGE} badge-error badge-xs w-full`}
        onClick={() => onRetryLanguage(cell.languageId)}
        title={t("cognates.v3.retryLoad")}
      >
        {t("cognates.v3.loadFailed")}
      </button>
    );
  }

  if (cell.kind === "empty") {
    if (cell.gap) {
      return (
        <button
          type="button"
          className={`${BADGE} badge-outline badge-xs w-full`}
          onClick={() => onOpenCell(row, cell)}
          title={cell.gap.note ?? ""}
        >
          {gapStatusLabel(cell.gap.status)}
        </button>
      );
    }
    return (
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="h-7 flex-1 rounded border border-dashed border-base-300 text-xs text-base-content/30 hover:border-primary hover:text-primary"
          title={t("cognates.v3.createWordHere")}
          onClick={() => onEditingChange({ rowIndex, column, value: "" })}
        >
          +
        </button>
        <button
          type="button"
          className="h-7 w-5 rounded text-[10px] text-base-content/30 hover:text-primary"
          title={t("cognates.v3.candidatesDrawerTitle", {
            concept: row.glossZh || row.glossEn,
          })}
          onClick={() => onOpenCell(row, cell)}
        >
          ⋯
        </button>
      </div>
    );
  }

  const color = cognateColor(cell.cognateIndex);
  const kindLabel =
    cell.kind === "borrowed"
      ? t("cognate.borrowed")
      : cell.kind === "innovation"
        ? t("cognate.innovation")
        : t("cognate.inherited");
  const ipa = cell.ipa
    ? cell.ipa.startsWith("/") || cell.ipa.startsWith("[")
      ? cell.ipa
      : `/${cell.ipa}/`
    : "";

  return (
    <div className="flex items-stretch gap-0.5">
      <button
        type="button"
        className="flex min-h-7 flex-1 items-center gap-1 rounded px-1 text-left hover:brightness-95"
        style={{
          borderLeft: `3px solid ${color ?? "transparent"}`,
          background: color ? `${color}12` : undefined,
        }}
        title={`${cell.form}${ipa ? ` ${ipa}` : ""} · ${kindLabel}`}
        onClick={() => onOpenCell(row, cell)}
      >
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate font-mono text-xs">{cell.form}</span>
          {ipa && (
            <span className="block truncate font-mono text-[9px] text-base-content/45">{ipa}</span>
          )}
          {cell.languageId === activeLanguageId && (
            <ScriptLine
              text={cell.form}
              entryId={cell.entryId ?? undefined}
              ipa={cell.ipa || undefined}
              className="block truncate text-[10px] leading-tight"
            />
          )}
        </span>
        {cell.kind !== "inherited" && (
          <span
            className={`shrink-0 text-[9px] ${
              cell.kind === "borrowed" ? "text-warning" : "text-info"
            }`}
          >
            {cell.kind === "borrowed" ? "↩" : "✦"}
          </span>
        )}
        {cell.variants > 1 && (
          <span className="shrink-0 text-[9px] text-base-content/40">+{cell.variants - 1}</span>
        )}
      </button>
      {cell.cognateSetId && (
        <button
          type="button"
          className="w-4 shrink-0 rounded text-[9px] text-base-content/40 hover:text-primary"
          title={t("cognates.v3.tracePopoverTitle", { setId: cell.cognateSetId })}
          onClick={() => onOpenTrace(row, cell.cognateSetId as string)}
        >
          ⬤
        </button>
      )}
    </div>
  );
};
