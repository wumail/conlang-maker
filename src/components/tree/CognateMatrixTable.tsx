import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CognateMatrixCell, CognateMatrixRow } from "../../core/engines/cognateMatrix";
import { cognateColor } from "../../core/engines/cognateMatrix";
import { INPUT_MONO } from "../../lib/ui";
import { ScriptLine } from "../writing/ScriptText";

const LABEL_WIDTH = 176;
const CELL_WIDTH = 116;

interface CognateMatrixTableProps {
  rows: CognateMatrixRow[];
  languages: { languageId: string; name: string; depth: number }[];
  /** 当前激活语言（该列额外渲染本族文字预览） */
  activeLanguageId?: string;
  /** 在指定语言 + 概念下补词 */
  onCreate: (languageId: string, conceptId: string, romanized: string) => Promise<void>;
}

interface EditingCell {
  column: number;
  rowIndex: number;
  value: string;
}

/** 虚拟滚动的同源词对照表：首列概念名 sticky，空单元格可原地补词 */
export const CognateMatrixTable: React.FC<CognateMatrixTableProps> = ({
  rows,
  languages,
  activeLanguageId,
  onCreate,
}) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [saving, setSaving] = useState(false);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });

  const gridTemplate = `${LABEL_WIDTH}px repeat(${languages.length}, ${CELL_WIDTH}px)`;
  const totalWidth = LABEL_WIDTH + languages.length * CELL_WIDTH;

  const commit = async (row: CognateMatrixRow, languageId: string) => {
    const value = editing?.value.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      await onCreate(languageId, row.conceptId, value);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const renderCell = (cell: CognateMatrixCell, row: CognateMatrixRow, rowIndex: number) => {
    const column = languages.findIndex((lang) => lang.languageId === cell.languageId);
    const isEditing = editing?.rowIndex === rowIndex && editing.column === column;

    if (isEditing) {
      return (
        <input
          autoFocus
          className={`${INPUT_MONO} h-7 w-full text-xs`}
          value={editing.value}
          placeholder={row.glossZh || row.glossEn}
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commit(row, cell.languageId);
            if (event.key === "Escape") setEditing(null);
          }}
          onBlur={() => setEditing(null)}
        />
      );
    }

    if (cell.kind === "empty") {
      return (
        <button
          type="button"
          className="h-7 w-full rounded border border-dashed border-base-300 text-xs text-base-content/30 hover:border-primary hover:text-primary"
          title={t("cognate.addHint", { concept: row.glossZh || row.glossEn })}
          onClick={() => setEditing({ rowIndex, column, value: "" })}
        >
          +
        </button>
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
    const isActiveColumn = cell.languageId === activeLanguageId;

    return (
      <div
        className="flex min-h-7 items-center gap-1 rounded px-1"
        style={{
          borderLeft: `3px solid ${color ?? "transparent"}`,
          background: color ? `${color}12` : undefined,
        }}
        title={`${cell.form}${ipa ? ` ${ipa}` : ""} · ${kindLabel}`}
      >
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-mono text-xs">{cell.form}</div>
          {ipa && (
            <div className="truncate font-mono text-[9px] text-base-content/45">{ipa}</div>
          )}
          {isActiveColumn && (
            <ScriptLine
              text={cell.form}
              entryId={cell.entryId ?? undefined}
              ipa={cell.ipa || undefined}
              className="block truncate text-[10px] leading-tight"
            />
          )}
        </div>
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
      </div>
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-base-300" ref={scrollRef}>
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        <div
          className="sticky top-0 z-20 grid border-b border-base-300 bg-base-200"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <div className="sticky left-0 z-30 bg-base-200 px-2 py-1.5 text-xs font-medium text-base-content/70">
            {t("cognate.concept")}
          </div>
          {languages.map((language) => (
            <div
              key={language.languageId}
              className="truncate px-2 py-1.5 text-xs font-medium text-base-content/70"
              title={language.name}
              style={{ paddingLeft: 8 + language.depth * 6 }}
            >
              {language.name}
            </div>
          ))}
        </div>

        <div
          style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={row.conceptId}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className="grid items-center border-b border-base-200 pb-1 hover:bg-base-200/40"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <div className="sticky left-0 z-10 bg-base-100 px-2 py-1">
                    <div className="truncate text-sm">{row.glossZh || row.glossEn}</div>
                    <div className="truncate font-mono text-[10px] text-base-content/40">
                      {row.conceptId}
                    </div>
                  </div>
                  {row.cells.map((cell) => (
                    <div key={cell.languageId} className="px-1 py-1">
                      {renderCell(cell, row, virtualRow.index)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {rows.length === 0 && (
        <p className="px-4 py-6 text-sm text-base-content/50">{t("cognate.empty")}</p>
      )}
    </div>
  );
};
