import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  CognateMatrixCell,
  CognateMatrixLanguage,
  CognateMatrixRow,
} from "../../core/engines/cognateMatrix";
import { CognateMatrixCellView, type EditingCellState } from "./CognateMatrixCell";

const LABEL_WIDTH = 176;
const CELL_WIDTH = 116;

interface CognateMatrixTableProps {
  rows: CognateMatrixRow[];
  languages: CognateMatrixLanguage[];
  activeLanguageId?: string;
  pinnedLanguageId?: string;
  onCreate: (languageId: string, conceptId: string, romanized: string) => Promise<void>;
  onOpenCell: (row: CognateMatrixRow, cell: CognateMatrixCell) => void;
  onOpenTrace: (row: CognateMatrixRow, setId: string) => void;
  onRetryLanguage: (languageId: string) => void;
}

/** 虚拟滚动的同源词对照表：首列概念名 sticky + 可选固定参考列 */
export const CognateMatrixTable: React.FC<CognateMatrixTableProps> = ({
  rows,
  languages,
  activeLanguageId,
  pinnedLanguageId,
  onCreate,
  onOpenCell,
  onOpenTrace,
  onRetryLanguage,
}) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<EditingCellState | null>(null);
  const [saving, setSaving] = useState(false);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 12,
    initialRect: { width: 900, height: 520 },
  });

  const pinned = languages.find((language) => language.languageId === pinnedLanguageId);
  const ordered = pinned
    ? [pinned, ...languages.filter((language) => language.languageId !== pinned.languageId)]
    : languages;
  const gridTemplate = `${LABEL_WIDTH}px repeat(${ordered.length}, ${CELL_WIDTH}px)`;
  const totalWidth = LABEL_WIDTH + ordered.length * CELL_WIDTH;

  const commit = async (row: CognateMatrixRow, cell: CognateMatrixCell, value: string) => {
    const trimmed = value.trim();
    setEditing(null);
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onCreate(cell.languageId, row.conceptId, trimmed);
    } finally {
      setSaving(false);
    }
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
          {ordered.map((language, index) => (
            <div
              key={language.languageId}
              className={`truncate px-2 py-1.5 text-xs font-medium ${
                language.languageId === pinnedLanguageId
                  ? "sticky z-30 bg-base-200 text-primary"
                  : "text-base-content/70"
              }`}
              title={language.name}
              style={{
                paddingLeft: 8 + language.depth * 6,
                ...(index === 0 && pinned ? { left: LABEL_WIDTH } : {}),
              }}
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
            const cellByLanguage = new Map(row.cells.map((cell) => [cell.languageId, cell]));
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
                  {ordered.map((language, index) => {
                    const cell = cellByLanguage.get(language.languageId);
                    if (!cell) return <div key={language.languageId} />;
                    return (
                      <div
                        key={language.languageId}
                        className={`px-1 py-1 ${
                          index === 0 && pinned ? "sticky z-10 bg-base-100" : ""
                        }`}
                        style={index === 0 && pinned ? { left: LABEL_WIDTH } : undefined}
                      >
                        <CognateMatrixCellView
                          cell={cell}
                          row={row}
                          rowIndex={virtualRow.index}
                          column={index}
                          editing={editing}
                          activeLanguageId={activeLanguageId}
                          onEditingChange={setEditing}
                          onCommit={(target, value) => void commit(row, target, value)}
                          onOpenCell={onOpenCell}
                          onOpenTrace={onOpenTrace}
                          onRetryLanguage={onRetryLanguage}
                        />
                      </div>
                    );
                  })}
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
