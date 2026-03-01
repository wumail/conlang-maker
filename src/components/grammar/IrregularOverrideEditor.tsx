/**
 * IrregularOverrideEditor.tsx — 屈折语不规则形式覆盖编辑器
 *
 * 允许用户为特定词条的特定维度值组合指定手动词形，
 * 绕过常规屈折规则（如英语 go → went）。
 */
import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { IrregularOverride } from "../../types";
import { Plus, Trash2, Info } from "lucide-react";
import {
  INPUT,
  INPUT_MONO,
  SELECT,
  BTN_PRIMARY,
  BTN_ERROR,
  BADGE,
} from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { EmptyState } from "../common/EmptyState";

export const IrregularOverrideEditor: React.FC = () => {
  const { t } = useTranslation();
  const { config, setIrregularOverrides } = useGrammarStore();
  const { wordsList } = useLexiconStore();
  const overrides = config.irregular_overrides;
  const dimensions = config.inflection_dimensions;

  const [entrySearch, setEntrySearch] = useState("");
  const [confirmDeleteOverrideIdx, setConfirmDeleteOverrideIdx] = useState<
    number | null
  >(null);

  const filteredWords = useMemo(() => {
    if (!entrySearch) return wordsList;
    const q = entrySearch.toLowerCase();
    return wordsList.filter(
      (w) =>
        w.con_word_romanized.toLowerCase().includes(q) ||
        w.senses.some((s) => s.gloss.toLowerCase().includes(q)),
    );
  }, [wordsList, entrySearch]);

  const addOverride = () => {
    const newOverride: IrregularOverride = {
      entry_id: "",
      dimension_values: {},
      surface_form: "",
    };
    setIrregularOverrides([...overrides, newOverride]);
  };

  const updateOverride = (
    index: number,
    field: keyof IrregularOverride,
    value: IrregularOverride[keyof IrregularOverride],
  ) => {
    setIrregularOverrides(
      overrides.map((o, i) => (i === index ? { ...o, [field]: value } : o)),
    );
  };

  const updateDimVal = (index: number, dimId: string, valId: string) => {
    const ov = overrides[index];
    const newDimVals = { ...ov.dimension_values, [dimId]: valId };
    if (!valId) delete newDimVals[dimId];
    setIrregularOverrides(
      overrides.map((o, i) =>
        i === index ? { ...o, dimension_values: newDimVals } : o,
      ),
    );
  };

  const deleteOverride = (index: number) => {
    setIrregularOverrides(overrides.filter((_, i) => i !== index));
  };

  // 获取已选词条的词性，用于过滤维度
  const getEntryPosIds = (entryId: string): string[] => {
    const entry = wordsList.find((w) => w.entry_id === entryId);
    if (!entry) return [];
    return entry.senses.map((s) => s.pos_id);
  };

  const rules = config.inflection_rules;
  const hasRules = rules.length > 0;

  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      <div className="flex justify-end items-center">
        <button
          onClick={addOverride}
          className={BTN_PRIMARY}
          disabled={!hasRules}
        >
          <Plus size={16} /> {t("typology.addOverride")}
        </button>
      </div>

      <p className="text-sm text-base-content/60">
        {t("typology.irregularOverridesHint")}
      </p>

      {!hasRules && (
        <div className="flex items-center gap-2 p-3 bg-info/10 border border-primary/30 rounded-lg text-sm text-primary">
          <Info size={16} /> {t("typology.noRulesHint")}
        </div>
      )}

      {overrides.length === 0 && (
        <EmptyState message={t("typology.noOverrides")} />
      )}

      <div className="space-y-3">
        {overrides.map((ov, index) => {
          const posIds = getEntryPosIds(ov.entry_id);
          const applicableDims = dimensions.filter((d) =>
            d.applies_to_pos.some((p) => posIds.includes(p)),
          );
          const entry = wordsList.find((w) => w.entry_id === ov.entry_id);

          return (
            <div
              key={index}
              className="p-4 rounded-lg bg-base-200/50 border border-base-200 space-y-2"
            >
              <div className="flex items-center gap-3">
                {/* 词条选择 */}
                <div className="flex flex-col gap-1">
                  <input
                    type="text"
                    value={entrySearch}
                    onChange={(e) => setEntrySearch(e.target.value)}
                    className={`w-56 ${INPUT}`}
                    placeholder={t("typology.searchEntry")}
                  />
                  <select
                    value={ov.entry_id}
                    onChange={(e) =>
                      updateOverride(index, "entry_id", e.target.value)
                    }
                    className={`w-56 ${SELECT}`}
                  >
                    <option value="">{t("typology.selectEntry")}</option>
                    {filteredWords.map((w) => (
                      <option key={w.entry_id} value={w.entry_id}>
                        {w.con_word_romanized} ({w.senses[0]?.gloss ?? ""})
                      </option>
                    ))}
                  </select>
                </div>

                {entry && (
                  <span className={`${BADGE} badge-ghost`}>
                    {entry.con_word_romanized}
                  </span>
                )}

                <span className="text-base-content/50">→</span>

                {/* 表层形式 */}
                <input
                  type="text"
                  value={ov.surface_form}
                  onChange={(e) =>
                    updateOverride(index, "surface_form", e.target.value)
                  }
                  className={`w-40 ${INPUT_MONO}`}
                  placeholder={t("typology.surfaceFormPlaceholder")}
                />

                <div className="flex-1" />

                <button
                  onClick={() => setConfirmDeleteOverrideIdx(index)}
                  className={BTN_ERROR}
                  title={t("typology.deleteOverride")}
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* 维度值选择 */}
              {applicableDims.length > 0 && (
                <div className="flex flex-wrap gap-2 pl-2">
                  {applicableDims.map((dim) => (
                    <div key={dim.dim_id} className="flex items-center gap-1">
                      <span className="text-xs text-base-content/60">
                        {dim.name}:
                      </span>
                      <select
                        value={ov.dimension_values[dim.dim_id] ?? ""}
                        onChange={(e) =>
                          updateDimVal(index, dim.dim_id, e.target.value)
                        }
                        className={`w-28 ${SELECT}`}
                      >
                        <option value="">--</option>
                        {dim.values.map((v) => (
                          <option key={v.val_id} value={v.val_id}>
                            {v.name} ({v.gloss})
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmModal
        open={confirmDeleteOverrideIdx !== null}
        title={t("common.delete")}
        message={t(
          "typology.deleteOverrideConfirm",
          "Are you sure you want to delete this override?",
        )}
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
