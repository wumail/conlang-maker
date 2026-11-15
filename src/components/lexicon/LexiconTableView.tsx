/**
 * LexiconTableView.tsx — Word × Sense 高密度表格视图（Roadmap v3 / Pillar 4）
 *
 * 虚拟行 + 列显隐 + 行内直接编辑（词形 / IPA / 词性 / 释义 / 概念 / 词源 / 用法），
 * Enter / ↓ / ↑ 在单元格间上下移动，Tab 交给浏览器默认顺序。
 */
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Columns3, ClipboardPaste, LocateFixed } from "lucide-react";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import type { OriginType, Sense, WordEntry } from "../../types";
import { LEXICON_ORIGIN_FILTERS } from "../../lib/lexiconQuickFilters";
import { BADGE, BTN_GHOST, BTN_GHOST_SQ, CHECKBOX, INPUT, SELECT } from "../../lib/ui";

type ColumnKey = "form" | "ipa" | "pos" | "gloss" | "concept" | "origin" | "usage";

const COLUMNS: Array<{ key: ColumnKey; labelKey: string; width: number }> = [
  { key: "form", labelKey: "lexicon.word", width: 150 },
  { key: "ipa", labelKey: "lexicon.table.ipa", width: 120 },
  { key: "pos", labelKey: "lexicon.pos", width: 110 },
  { key: "gloss", labelKey: "lexicon.gloss", width: 180 },
  { key: "concept", labelKey: "lexicon.concept.filterLabel", width: 150 },
  { key: "origin", labelKey: "lexicon.originType", width: 120 },
  { key: "usage", labelKey: "lexicon.table.usageNote", width: 200 },
];

/** 行级「定位到详情」按钮的固定列宽 */
const GUTTER_WIDTH = 26;

interface TableRow {
  word: WordEntry;
  sense: Sense;
  senseIndex: number;
}

interface LexiconTableViewProps {
  onOpenPaste: () => void;
  /** 关闭表格弹窗；行级「定位到详情」需先收起弹窗才能看到详情面板 */
  onClose?: () => void;
}

export const LexiconTableView: React.FC<LexiconTableViewProps> = ({ onOpenPaste, onClose }) => {
  const { t } = useTranslation();
  const wordsList = useLexiconStore((s) => s.wordsList);
  const upsertWord = useLexiconStore((s) => s.upsertWord);
  const setActiveWordId = useLexiconStore((s) => s.setActiveWordId);
  const partsOfSpeech = useGrammarStore((s) => s.config.parts_of_speech);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState<Set<ColumnKey>>(() => new Set(COLUMNS.map((c) => c.key)));
  const [showColumns, setShowColumns] = useState(false);

  const rows = useMemo<TableRow[]>(
    () => wordsList.flatMap((word) => word.senses.map((sense, senseIndex) => ({ word, sense, senseIndex }))),
    [wordsList],
  );

  const columns = COLUMNS.filter((column) => visible.has(column.key));
  const totalWidth =
    (onClose ? GUTTER_WIDTH : 0) + columns.reduce((sum, column) => sum + column.width, 0);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 14,
    initialRect: { width: 900, height: 520 },
  });

  /** 行内编辑统一走 `upsertWord`：复用 Store 的 500ms 按词防抖与单步撤销合并 */
  const commit = (row: TableRow, patch: Partial<WordEntry>) => {
    upsertWord({ ...row.word, ...patch }, { coalesceKey: `table:${row.word.entry_id}` });
  };

  const commitSense = (row: TableRow, patch: Partial<Sense>) => {
    const senses = row.word.senses.map((sense, index) =>
      index === row.senseIndex ? { ...sense, ...patch } : sense,
    );
    commit(row, { senses });
  };

  /** 词形：空值或无改动直接返回（不写盘），并回退输入框显示 */
  const commitRomanized = (row: TableRow, input: HTMLInputElement) => {
    const next = input.value.trim();
    if (next.length === 0 || next === row.word.con_word_romanized) {
      input.value = row.word.con_word_romanized;
      return;
    }
    commit(row, { con_word_romanized: next });
  };

  /** IPA：无改动绝不写盘、绝不改写 phonetic_override；仅真实变更时才同步 override 开关 */
  const commitIpa = (row: TableRow, input: HTMLInputElement) => {
    if (input.value === row.word.phonetic_ipa) return;
    commit(row, {
      phonetic_ipa: input.value,
      phonetic_override: input.value.trim().length > 0,
    });
  };

  const commitGloss = (row: TableRow, input: HTMLInputElement) => {
    if (input.value !== row.sense.gloss) commitSense(row, { gloss: input.value });
  };

  const commitConcept = (row: TableRow, input: HTMLInputElement) => {
    const next = input.value.trim();
    if (next === (row.sense.concept_id ?? "")) return;
    commitSense(row, { concept_id: next.length > 0 ? next : undefined });
  };

  const commitUsage = (row: TableRow, input: HTMLInputElement) => {
    if (input.value !== (row.sense.usage_note ?? "")) commitSense(row, { usage_note: input.value });
  };

  const moveFocus = (rowIndex: number, columnIndex: number) =>
    scrollRef.current?.querySelector<HTMLElement>(`[data-cell="${rowIndex}:${columnIndex}"]`)?.focus();

  const onKeyDown = (event: React.KeyboardEvent, rowIndex: number, columnIndex: number) => {
    const delta =
      event.key === "ArrowUp" ? -1 : event.key === "Enter" || event.key === "ArrowDown" ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    moveFocus(rowIndex + delta, columnIndex);
  };

  const toggleColumn = (key: ColumnKey, checked: boolean) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });

  const renderCell = (row: TableRow, column: ColumnKey, rowIndex: number, columnIndex: number) => {
    const shared = {
      "data-cell": `${rowIndex}:${columnIndex}`,
      className: `${INPUT} input-xs h-7 w-full text-xs`,
      onKeyDown: (event: React.KeyboardEvent) => onKeyDown(event, rowIndex, columnIndex),
    } as const;

    switch (column) {
      case "form":
        return (
          <input {...shared} key={`form:${row.word.con_word_romanized}`}
            className={`${INPUT} input-xs h-7 w-full font-mono text-xs`}
            defaultValue={row.word.con_word_romanized}
            onBlur={(event) => commitRomanized(row, event.target)} />
        );
      case "ipa":
        return (
          <input {...shared} key={`ipa:${row.word.phonetic_ipa}`}
            className={`${INPUT} input-xs h-7 w-full font-mono text-xs`}
            defaultValue={row.word.phonetic_ipa}
            onBlur={(event) => commitIpa(row, event.target)} />
        );
      case "pos":
        return (
          <select {...shared} className={`${SELECT} select-xs h-7 w-full text-xs`}
            value={row.sense.pos_id}
            onChange={(event) => commitSense(row, { pos_id: event.target.value })}>
            <option value="">—</option>
            {partsOfSpeech.map((pos) => (
              <option key={pos.pos_id} value={pos.pos_id}>
                {pos.name || pos.pos_id}
              </option>
            ))}
          </select>
        );
      case "gloss":
        return (
          <input {...shared} key={`gloss:${row.sense.gloss}`}
            defaultValue={row.sense.gloss}
            onBlur={(event) => commitGloss(row, event.target)} />
        );
      case "concept":
        return (
          <input {...shared} key={`concept:${row.sense.concept_id ?? ""}`}
            className={`${INPUT} input-xs h-7 w-full font-mono text-[11px]`}
            defaultValue={row.sense.concept_id ?? ""}
            onBlur={(event) => commitConcept(row, event.target)} />
        );
      case "origin":
        return (
          <select {...shared} className={`${SELECT} select-xs h-7 w-full text-xs`}
            value={row.word.etymology?.origin_type ?? "a_priori"}
            onChange={(event) =>
              commit(row, {
                etymology: { ...row.word.etymology, origin_type: event.target.value as OriginType },
              })
            }>
            {LEXICON_ORIGIN_FILTERS.map((origin) => (
              <option key={origin.value} value={origin.value}>
                {t(origin.labelKey)}
              </option>
            ))}
          </select>
        );
      case "usage":
        return (
          <input {...shared} key={`usage:${row.sense.usage_note ?? ""}`}
            defaultValue={row.sense.usage_note ?? ""}
            onBlur={(event) => commitUsage(row, event.target)} />
        );
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-4 py-2">
      <div className="flex items-center gap-2">
        <span className={`${BADGE} badge-ghost badge-sm`}>
          {rows.length} × {wordsList.length}
        </span>
        <div className="flex-1" />
        <button type="button" className={BTN_GHOST} onClick={onOpenPaste}>
          <ClipboardPaste size={14} /> {t("lexicon.table.pasteTsv")}
        </button>
        <button type="button" className={BTN_GHOST} onClick={() => setShowColumns((prev) => !prev)}>
          <Columns3 size={14} /> {t("lexicon.table.columnsToggle")}
        </button>
      </div>

      {showColumns && (
        <div className="flex flex-wrap gap-2 rounded border border-base-300 bg-base-200/50 px-2 py-1 text-xs">
          {COLUMNS.map((column) => (
            <label key={column.key} className="flex items-center gap-1">
              <input type="checkbox" className={CHECKBOX} checked={visible.has(column.key)}
                onChange={(event) => toggleColumn(column.key, event.target.checked)} />
              {t(column.labelKey)}
            </label>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto rounded-lg border border-base-300">
        <div className="sticky top-0 z-10 flex border-b border-base-300 bg-base-200 text-xs font-medium"
          style={{ minWidth: totalWidth }}>
          {onClose && <div className="shrink-0" style={{ width: GUTTER_WIDTH }} />}
          {columns.map((column) => (
            <div key={column.key} className="shrink-0 px-2 py-1.5" style={{ width: column.width }}>
              {t(column.labelKey)}
            </div>
          ))}
        </div>

        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={`${row.word.entry_id}:${row.senseIndex}`}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 flex w-full items-center border-b border-base-200 hover:bg-base-200/40"
                style={{ transform: `translateY(${virtualRow.start}px)`, minWidth: totalWidth }}
              >
                {onClose && (
                  <div className="shrink-0 px-1" style={{ width: GUTTER_WIDTH }}>
                    <button type="button" className={BTN_GHOST_SQ}
                      title={t("lexicon.table.viewDetail")}
                      aria-label={t("lexicon.table.viewDetail")}
                      onClick={() => {
                        setActiveWordId(row.word.entry_id);
                        onClose();
                      }}>
                      <LocateFixed size={12} />
                    </button>
                  </div>
                )}
                {columns.map((column, columnIndex) => (
                  <div key={column.key} className="shrink-0 px-1 py-0.5" style={{ width: column.width }}>
                    {renderCell(row, column.key, virtualRow.index, columnIndex)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
