/**
 * IrregularOverrideEditor.tsx — 屈折语不规则形式覆盖编辑器
 *
 * 允许用户为特定词条的特定维度值组合指定手动词形，
 * 绕过常规屈折规则（如英语 go → went）。
 * 采用虚拟滚动 + 按需单行词条选择器，避免大词库 / 大覆盖表下 O(N×W) DOM 卡死。
 */
import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Info, Plus } from "lucide-react";
import { useGrammarStore } from "../../store/grammarStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import type { IrregularOverride } from "../../types";
import { BTN_PRIMARY, INPUT } from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { EmptyState } from "../common/EmptyState";
import { IrregularOverrideRow } from "./IrregularOverrideRow";

const MAX_PICKER_CANDIDATES = 40;

export const IrregularOverrideEditor: React.FC = () => {
  const { t } = useTranslation();
  const config = useGrammarStore((s) => s.config);
  const setIrregularOverrides = useGrammarStore((s) => s.setIrregularOverrides);
  const wordsMap = useLexiconStore((s) => s.wordsMap);
  const wordsList = useLexiconStore((s) => s.wordsList);
  const hasStress = usePhonoStore((state) =>
    Boolean(state.config.phonotactics.stress),
  );

  const overrides = config.irregular_overrides ?? [];
  const dimensions = config.inflection_dimensions ?? [];
  const hasRules = (config.inflection_rules ?? []).length > 0;

  const [overrideFilter, setOverrideFilter] = useState("");
  const [activePickerIdx, setActivePickerIdx] = useState<number | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [confirmDeleteOverrideIdx, setConfirmDeleteOverrideIdx] = useState<
    number | null
  >(null);

  const candidateWords = useMemo(() => {
    if (activePickerIdx === null) return [];
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return wordsList.slice(0, MAX_PICKER_CANDIDATES);
    const matches = [];
    for (const w of wordsList) {
      if (
        w.con_word_romanized.toLowerCase().includes(q) ||
        w.senses.some((s) => s.gloss.toLowerCase().includes(q))
      ) {
        matches.push(w);
        if (matches.length >= MAX_PICKER_CANDIDATES) break;
      }
    }
    return matches;
  }, [activePickerIdx, pickerQuery, wordsList]);

  const visibleItems = useMemo(() => {
    const q = overrideFilter.trim().toLowerCase();
    return overrides
      .map((override, originalIndex) => ({ override, originalIndex }))
      .filter(({ override }) => {
        if (!q) return true;
        const entry = override.entry_id ? wordsMap[override.entry_id] : undefined;
        return (
          (override.surface_form ?? "").toLowerCase().includes(q) ||
          (entry?.con_word_romanized ?? "").toLowerCase().includes(q) ||
          (entry?.senses.some((s) => s.gloss.toLowerCase().includes(q)) ?? false)
        );
      });
  }, [overrides, overrideFilter, wordsMap]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: visibleItems.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 92,
    initialRect: { width: 860, height: 480 },
    overscan: 6,
  });

  const addOverride = () => {
    const newIndex = overrides.length;
    const newOverride: IrregularOverride = {
      entry_id: "",
      dimension_values: {},
      surface_form: "",
    };
    setOverrideFilter("");
    setIrregularOverrides([...overrides, newOverride]);
    setPickerQuery("");
    setActivePickerIdx(newIndex);
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(newIndex, { align: "end" });
    });
  };

  const updateOverride = (
    index: number,
    field: keyof IrregularOverride,
    value: IrregularOverride[keyof IrregularOverride],
  ) => {
    setIrregularOverrides(
      overrides.map((override, position) => {
        if (position !== index) return override;
        const next = { ...override, [field]: value };
        if (
          field === "surface_form" &&
          (next.stem_start ?? 0) > Array.from(next.surface_form ?? "").length
        ) {
          delete next.stem_start;
        }
        return next;
      }),
    );
  };

  const updateDimVal = (index: number, dimId: string, valId: string) => {
    const ov = overrides[index];
    if (!ov) return;
    const newDimVals = { ...(ov.dimension_values ?? {}), [dimId]: valId };
    if (!valId) delete newDimVals[dimId];
    setIrregularOverrides(
      overrides.map((o, i) =>
        i === index ? { ...o, dimension_values: newDimVals } : o,
      ),
    );
  };

  const deleteOverride = (index: number) => {
    if (activePickerIdx === index) setActivePickerIdx(null);
    setIrregularOverrides(overrides.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4 bg-base-100 p-6 flex-1 min-w-0">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <p className="text-sm text-base-content/60">
          {t("typology.irregularOverridesHint")}
        </p>
        <div className="flex items-center gap-2">
          {overrides.length > 0 && (
            <input
              type="text"
              value={overrideFilter}
              onChange={(e) => setOverrideFilter(e.target.value)}
              className={`${INPUT} input-sm w-48 text-xs`}
              placeholder={t("common.search")}
            />
          )}
          <button
            onClick={addOverride}
            className={BTN_PRIMARY}
            disabled={!hasRules}
          >
            <Plus size={16} /> {t("typology.addOverride")}
          </button>
        </div>
      </div>

      {!hasRules && (
        <div className="flex items-center gap-2 p-3 bg-info/10 border border-primary/30 rounded-lg text-sm text-primary">
          <Info size={16} /> {t("typology.noRulesHint")}
        </div>
      )}

      {overrides.length === 0 ? (
        <EmptyState message={t("typology.noOverrides")} />
      ) : (
        <div ref={listRef} className="max-h-[62vh] overflow-y-auto pr-1">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = visibleItems[virtualRow.index];
              if (!item) return null;
              const { override, originalIndex } = item;
              const entry = override.entry_id
                ? wordsMap[override.entry_id]
                : undefined;
              const posIds = entry ? entry.senses.map((s) => s.pos_id) : [];
              const applicableDims = dimensions.filter((d) =>
                (d.applies_to_pos ?? []).some((p) => posIds.includes(p)),
              );

              return (
                <div
                  key={`${override.entry_id || "empty"}-${originalIndex}`}
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
                  <div className="pb-2.5">
                    <IrregularOverrideRow
                      override={override}
                      entry={entry}
                      applicableDims={applicableDims}
                      hasStress={hasStress}
                      isPickerOpen={activePickerIdx === originalIndex}
                      pickerQuery={pickerQuery}
                      candidateWords={candidateWords}
                      onTogglePicker={() => {
                        if (activePickerIdx === originalIndex) {
                          setActivePickerIdx(null);
                        } else {
                          setPickerQuery("");
                          setActivePickerIdx(originalIndex);
                        }
                      }}
                      onPickerQueryChange={setPickerQuery}
                      onSelectEntry={(entryId) => {
                        updateOverride(originalIndex, "entry_id", entryId);
                        setActivePickerIdx(null);
                      }}
                      onSurfaceFormChange={(val) =>
                        updateOverride(originalIndex, "surface_form", val)
                      }
                      onStemStartChange={(offset) =>
                        updateOverride(originalIndex, "stem_start", offset)
                      }
                      onDimValChange={(dimId, valId) =>
                        updateDimVal(originalIndex, dimId, valId)
                      }
                      onRequestDelete={() =>
                        setConfirmDeleteOverrideIdx(originalIndex)
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmDeleteOverrideIdx !== null}
        title={t("common.delete")}
        message={t("typology.deleteOverrideConfirm")}
        onConfirm={() => {
          if (confirmDeleteOverrideIdx !== null) {
            deleteOverride(confirmDeleteOverrideIdx);
            setConfirmDeleteOverrideIdx(null);
          }
        }}
        onCancel={() => setConfirmDeleteOverrideIdx(null)}
      />
    </div>
  );
};
