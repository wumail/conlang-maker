/**
 * TypologyBindingPanel — 屈折规则的类型学绑定面板
 *
 * 黏着语：词缀槽位绑定
 * 屈折语：变位类绑定 + 融合维度映射
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Trash2, Info } from "lucide-react";
import { useGrammarStore } from "../../store/grammarStore";
import { InflectionRule } from "../../types";
import { SELECT, BTN_ERROR } from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";

interface TypologyBindingPanelProps {
  rule: InflectionRule;
  onChange: (
    ruleId: string,
    field: keyof InflectionRule,
    value: InflectionRule[keyof InflectionRule],
  ) => void;
}

export const TypologyBindingPanel: React.FC<TypologyBindingPanelProps> = ({
  rule,
  onChange,
}) => {
  const { t } = useTranslation();
  const config = useGrammarStore((s) => s.config);
  const morphType = config.typology.morphological_type;
  const [confirmDeleteFusedDimIdx, setConfirmDeleteFusedDimIdx] = useState<
    number | null
  >(null);

  if (morphType === "agglutinative") {
    const hasSlots = config.affix_slots.length > 0;
    return (
      <div className="col-span-12 pl-4 border-l-2 border-teal-200 flex items-center gap-2">
        <label className="text-xs text-base-content/50">
          {t("typology.affixSlots")}:
        </label>
        {hasSlots ? (
          <>
            <select
              value={rule.slot_id ?? ""}
              onChange={(e) =>
                onChange(rule.rule_id, "slot_id", e.target.value || undefined)
              }
              className={`w-40 ${SELECT}`}
            >
              <option value="">--</option>
              {config.affix_slots.map((s) => (
                <option key={s.slot_id} value={s.slot_id}>
                  {s.label || s.slot_id}
                </option>
              ))}
            </select>
            {!rule.slot_id && (
              <span className="text-xs text-warning flex items-center gap-1">
                <AlertTriangle size={12} /> {t("typology.noSlotWarning")}
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-warning flex items-center gap-1">
            <Info size={12} /> {t("typology.noSlotsHint")}
          </span>
        )}
      </div>
    );
  }

  if (morphType === "fusional") {
    const dimsByPos = config.inflection_dimensions.filter((d) =>
      d.applies_to_pos.includes(rule.pos_id),
    );

    return (
      <div className="col-span-12 pl-4 border-l-2 border-orange-200 space-y-2">
        <div className="flex items-center gap-2">
          <select
            value={rule.conjugation_class_id ?? ""}
            onChange={(e) =>
              onChange(
                rule.rule_id,
                "conjugation_class_id",
                e.target.value || undefined,
              )
            }
            className={`w-40 ${SELECT}`}
          >
            <option value="">--</option>
            {config.conjugation_classes
              .filter((c) => c.applies_to_pos === rule.pos_id)
              .map((c) => (
                <option key={c.class_id} value={c.class_id}>
                  {c.name || c.class_id}
                </option>
              ))}
          </select>
        </div>
        {/* 融合维度映射 */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <label className="text-xs text-base-content/50">
              {t("typology.fusedDimensions")}:
            </label>
            {dimsByPos.length > 0 ? (
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => {
                  const existing = rule.fused_dimensions ?? [];
                  onChange(rule.rule_id, "fused_dimensions", [...existing, {}]);
                }}
              >
                + {t("common.add")}
              </button>
            ) : (
              <span className="text-xs text-warning flex items-center gap-1">
                <Info size={12} /> {t("typology.noDimensionsHint")}
              </span>
            )}
          </div>
          {(rule.fused_dimensions ?? []).map((fMap, fi) => (
            <div key={fi} className="flex items-center gap-1 flex-wrap">
              {dimsByPos.map((dim) => (
                <select
                  key={dim.dim_id}
                  value={fMap[dim.dim_id] ?? ""}
                  onChange={(e) => {
                    const updated = [...(rule.fused_dimensions ?? [])];
                    updated[fi] = {
                      ...updated[fi],
                      [dim.dim_id]: e.target.value,
                    };
                    onChange(rule.rule_id, "fused_dimensions", updated);
                  }}
                  className={`w-24 text-xs ${SELECT}`}
                  title={dim.name}
                >
                  <option value="">{dim.name}</option>
                  {dim.values.map((v) => (
                    <option key={v.val_id} value={v.val_id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              ))}
              <button
                className={`text-xs ${BTN_ERROR}`}
                onClick={() => setConfirmDeleteFusedDimIdx(fi)}
                title={t("typology.deleteFusedDimension")}
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>

        <ConfirmModal
          open={confirmDeleteFusedDimIdx !== null}
          title={t("common.delete")}
          message={t(
            "typology.deleteFusedDimensionConfirm",
            "Are you sure you want to delete this fused dimension mapping?",
          )}
          onConfirm={() => {
            if (confirmDeleteFusedDimIdx !== null) {
              const updated = (rule.fused_dimensions ?? []).filter(
                (_, i) => i !== confirmDeleteFusedDimIdx,
              );
              onChange(rule.rule_id, "fused_dimensions", updated);
              setConfirmDeleteFusedDimIdx(null);
            }
          }}
          onCancel={() => setConfirmDeleteFusedDimIdx(null)}
        />
      </div>
    );
  }

  return null;
};
