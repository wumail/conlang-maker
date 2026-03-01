/**
 * AffixSlotEditor.tsx — 黏着语词缀槽位编辑器
 *
 * 管理有序的词缀槽位列表，每个槽位关联一个屈折维度，
 * position < 0 表示前缀，position > 0 表示后缀。
 * 黏着语通过槽位顺序决定词缀的拼接顺序。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import { AffixSlot } from "../../types";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import {
  INPUT_MONO,
  SELECT,
  BTN_PRIMARY,
  BTN_ERROR,
  BTN_GHOST_SQ,
  CHECKBOX,
  BADGE,
} from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { EmptyState } from "../common/EmptyState";

export const AffixSlotEditor: React.FC = () => {
  const { t } = useTranslation();
  const { config, setAffixSlots } = useGrammarStore();
  const slots = config.affix_slots;
  const dimensions = config.inflection_dimensions;
  const [confirmDeleteSlotId, setConfirmDeleteSlotId] = React.useState<
    string | null
  >(null);

  const addSlot = () => {
    const newSlot: AffixSlot = {
      slot_id: `slot_${crypto.randomUUID().slice(0, 8)}`,
      position: slots.length + 1,
      dimension_id: dimensions[0]?.dim_id ?? "",
      is_obligatory: false,
      label: "",
    };
    setAffixSlots([...slots, newSlot]);
  };

  const updateSlot = (
    slotId: string,
    field: keyof AffixSlot,
    value: AffixSlot[keyof AffixSlot],
  ) => {
    setAffixSlots(
      slots.map((s) => (s.slot_id === slotId ? { ...s, [field]: value } : s)),
    );
  };

  const deleteSlot = (slotId: string) => {
    setAffixSlots(slots.filter((s) => s.slot_id !== slotId));
  };

  const moveSlot = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= slots.length) return;
    const reordered = [...slots];
    [reordered[index], reordered[target]] = [
      reordered[target],
      reordered[index],
    ];
    // 重新计算 position
    const updated = reordered.map((s, i) => ({
      ...s,
      position: s.position < 0 ? -(reordered.length - i) : i + 1,
    }));
    setAffixSlots(updated);
  };

  const sortedSlots = [...slots].sort((a, b) => a.position - b.position);
  const prefixSlots = sortedSlots.filter((s) => s.position < 0);
  const suffixSlots = sortedSlots.filter((s) => s.position >= 0);

  const renderSlotRow = (slot: AffixSlot, globalIndex: number) => {
    const dim = dimensions.find((d) => d.dim_id === slot.dimension_id);
    return (
      <div
        key={slot.slot_id}
        className="flex items-center gap-2 p-2 rounded-lg bg-base-200/50 border border-base-200"
      >
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => moveSlot(globalIndex, -1)}
            className={BTN_GHOST_SQ}
            aria-label="Move up"
            title={t("common.moveUp")}
          >
            <ArrowUp size={12} />
          </button>
          <button
            onClick={() => moveSlot(globalIndex, 1)}
            className={BTN_GHOST_SQ}
            aria-label="Move down"
            title={t("common.moveDown")}
          >
            <ArrowDown size={12} />
          </button>
        </div>

        <span
          className={`${BADGE} ${slot.position < 0 ? "badge-primary" : "badge-secondary"} font-mono`}
        >
          {slot.position < 0
            ? t("typology.slotPrefix")
            : t("typology.slotSuffix")}
        </span>

        <input
          type="text"
          value={slot.label}
          onChange={(e) => updateSlot(slot.slot_id, "label", e.target.value)}
          className={`w-32 ${INPUT_MONO}`}
          placeholder={t("typology.slotLabelPlaceholder")}
        />

        <select
          value={slot.dimension_id}
          onChange={(e) =>
            updateSlot(slot.slot_id, "dimension_id", e.target.value)
          }
          className={`w-40 ${SELECT}`}
        >
          <option value="">--</option>
          {dimensions.map((d) => (
            <option key={d.dim_id} value={d.dim_id}>
              {d.name}
            </option>
          ))}
        </select>

        <select
          value={slot.position < 0 ? "prefix" : "suffix"}
          onChange={(e) => {
            const isPrefix = e.target.value === "prefix";
            updateSlot(slot.slot_id, "position", isPrefix ? -1 : 1);
          }}
          className={`w-24 ${SELECT}`}
        >
          <option value="prefix">{t("grammar.prefix")}</option>
          <option value="suffix">{t("grammar.suffix")}</option>
        </select>

        <label className="flex items-center gap-1 text-xs text-base-content/60">
          <input
            type="checkbox"
            checked={slot.is_obligatory}
            onChange={(e) =>
              updateSlot(slot.slot_id, "is_obligatory", e.target.checked)
            }
            className={CHECKBOX}
          />
          {t("typology.obligatory")}
        </label>

        <div className="flex-1" />

        {dim && (
          <span className={`${BADGE} badge-ghost text-xs`}>
            {dim.values.map((v) => v.gloss).join(" / ")}
          </span>
        )}

        <button
          onClick={() => setConfirmDeleteSlotId(slot.slot_id)}
          className={BTN_ERROR}
          title={t("typology.deleteSlot")}
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      <div className="flex justify-end items-center">
        <button onClick={addSlot} className={BTN_PRIMARY}>
          <Plus size={16} /> {t("typology.addSlot")}
        </button>
      </div>

      <p className="text-sm text-base-content/60">
        {t("typology.affixSlotsHint")}
      </p>

      {slots.length === 0 && <EmptyState message={t("typology.noSlots")} />}

      {prefixSlots.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold text-primary uppercase">
            {t("typology.slotPrefix")}
          </h3>
          {prefixSlots.map((s) => renderSlotRow(s, sortedSlots.indexOf(s)))}
        </div>
      )}

      {suffixSlots.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold text-secondary uppercase">
            {t("typology.slotSuffix")}
          </h3>
          {suffixSlots.map((s) => renderSlotRow(s, sortedSlots.indexOf(s)))}
        </div>
      )}

      {/* 槽位顺序可视化 */}
      {slots.length > 0 && (
        <div className="mt-4 p-3 bg-base-200 rounded-lg">
          <h3 className="text-xs font-semibold text-base-content/60 mb-2">
            {t("typology.slotOrderPreview")}
          </h3>
          <div className="flex items-center gap-1 font-mono text-sm">
            {prefixSlots.map((s) => (
              <span key={s.slot_id} className={`${BADGE} badge-primary`}>
                {s.label || s.dimension_id}
              </span>
            ))}
            <span className="font-bold text-lg">STEM</span>
            {suffixSlots.map((s) => (
              <span key={s.slot_id} className={`${BADGE} badge-secondary`}>
                {s.label || s.dimension_id}
              </span>
            ))}
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmDeleteSlotId !== null}
        title={t("common.delete")}
        message={t(
          "typology.deleteSlotConfirm",
          "Are you sure you want to delete this affix slot?",
        )}
        onConfirm={() => {
          if (confirmDeleteSlotId) {
            deleteSlot(confirmDeleteSlotId);
            setConfirmDeleteSlotId(null);
          }
        }}
        onCancel={() => setConfirmDeleteSlotId(null)}
      />
    </div>
  );
};
