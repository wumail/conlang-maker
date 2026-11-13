import React from "react";
import { useTranslation } from "react-i18next";
import { GripVertical, Sparkles, Trash2 } from "lucide-react";
import type { DerivationRule, PartOfSpeech } from "../../types";
import type { DerivedWordPreview } from "../../utils/derivationEngine";
import {
  BTN_ERROR,
  BTN_PRIMARY,
  BTN_SUCCESS,
  CHECKBOX,
  INPUT,
  INPUT_MONO,
  SELECT,
  TEXTAREA,
} from "../../lib/ui";
import { SortableItem } from "../common/SortableItem";

interface DerivationRuleCardProps {
  rule: DerivationRule;
  partsOfSpeech: PartOfSpeech[];
  isPreviewActive: boolean;
  previews: DerivedWordPreview[];
  selectedPreviewIds: Set<string>;
  onChange: (
    ruleId: string,
    field: keyof DerivationRule,
    value: DerivationRule[keyof DerivationRule],
  ) => void;
  onRequestDelete: (ruleId: string) => void;
  onGeneratePreview: (rule: DerivationRule) => void;
  onImportDerived: (rule: DerivationRule) => void;
  onSetSelectedPreviewIds: (next: Set<string>) => void;
}

export const DerivationRuleCard: React.FC<DerivationRuleCardProps> = ({
  rule,
  partsOfSpeech,
  isPreviewActive,
  previews,
  selectedPreviewIds,
  onChange,
  onRequestDelete,
  onGeneratePreview,
  onImportDerived,
  onSetSelectedPreviewIds,
}) => {
  const { t } = useTranslation();

  return (
    <SortableItem
      id={rule.rule_id}
      className="p-4 border border-base-300 rounded-lg bg-base-200/50 space-y-3"
    >
      {({ listeners, attributes }) => (
        <>
          <div className="flex items-center gap-3">
            <span {...listeners} {...attributes} className="cursor-grab">
              <GripVertical size={16} className="text-base-content/30 shrink-0" />
            </span>
            <input
              type="text"
              value={rule.name}
              onChange={(e) => onChange(rule.rule_id, "name", e.target.value)}
              className={`flex-1 ${INPUT}`}
              placeholder={t("grammar.derivation.namePlaceholder")}
            />
            <button
              onClick={() => onRequestDelete(rule.rule_id)}
              className={BTN_ERROR}
              title={t("grammar.derivation.deleteRule")}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-base-content/60">
                {t("grammar.derivation.sourcePos")}
              </label>
              <select
                value={rule.source_pos_id}
                onChange={(e) =>
                  onChange(rule.rule_id, "source_pos_id", e.target.value)
                }
                className={`w-full ${SELECT}`}
              >
                {partsOfSpeech.map((p) => (
                  <option key={p.pos_id} value={p.pos_id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-base-content/60">
                {t("grammar.derivation.targetPos")}
              </label>
              <select
                value={rule.target_pos_id}
                onChange={(e) =>
                  onChange(rule.rule_id, "target_pos_id", e.target.value)
                }
                className={`w-full ${SELECT}`}
              >
                {partsOfSpeech.map((p) => (
                  <option key={p.pos_id} value={p.pos_id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-base-content/60">
                {t("grammar.type")}
              </label>
              <select
                value={rule.type}
                onChange={(e) => onChange(rule.rule_id, "type", e.target.value)}
                className={`w-full ${SELECT}`}
              >
                <option value="suffix">{t("grammar.suffix")}</option>
                <option value="prefix">{t("grammar.prefix")}</option>
                <option value="infix">{t("grammar.infix")}</option>
                <option value="circumfix">{t("grammar.circumfix")}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-base-content/60">
                {t("grammar.affix")}
              </label>
              <input
                type="text"
                value={rule.affix}
                onChange={(e) => onChange(rule.rule_id, "affix", e.target.value)}
                className={`w-full ${INPUT_MONO}`}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-base-content/60">
              {t("grammar.derivation.semanticNote")}
            </label>
            <textarea
              value={rule.semantic_note}
              onChange={(e) =>
                onChange(rule.rule_id, "semantic_note", e.target.value)
              }
              className={`w-full ${TEXTAREA} min-h-[40px]`}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onGeneratePreview(rule)}
              className={BTN_PRIMARY}
            >
              <Sparkles size={14} /> {t("grammar.derivation.preview")}
            </button>
            <label className="flex items-center gap-2 text-xs text-base-content/70">
              <input
                type="checkbox"
                className={`${CHECKBOX} checkbox-primary`}
                checked={!!rule.sca_mutable}
                onChange={(e) =>
                  onChange(rule.rule_id, "sca_mutable", e.target.checked)
                }
              />
              {t("grammar.scaMutable")}
            </label>
            {isPreviewActive && previews.length > 0 && (
              <button
                onClick={() => onImportDerived(rule)}
                className={BTN_SUCCESS}
                disabled={selectedPreviewIds.size === 0}
              >
                {t("grammar.derivation.import")} ({selectedPreviewIds.size}/
                {previews.length})
              </button>
            )}
          </div>
          {isPreviewActive && previews.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table table-sm table-zebra">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        className={`${CHECKBOX} checkbox-primary`}
                        checked={selectedPreviewIds.size === previews.length}
                        onChange={() => {
                          if (selectedPreviewIds.size === previews.length) {
                            onSetSelectedPreviewIds(new Set());
                          } else {
                            onSetSelectedPreviewIds(
                              new Set(previews.map((p) => p.source.entry_id)),
                            );
                          }
                        }}
                      />
                    </th>
                    <th>{t("lexicon.word")}</th>
                    <th>→</th>
                    <th>{"IPA"}</th>
                  </tr>
                </thead>
                <tbody>
                  {previews.slice(0, 20).map((p) => (
                    <tr
                      key={p.source.entry_id}
                      className="cursor-pointer hover:bg-base-200"
                      onClick={() => {
                        const next = new Set(selectedPreviewIds);
                        if (next.has(p.source.entry_id)) {
                          next.delete(p.source.entry_id);
                        } else {
                          next.add(p.source.entry_id);
                        }
                        onSetSelectedPreviewIds(next);
                      }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          className={`${CHECKBOX} checkbox-primary`}
                          checked={selectedPreviewIds.has(p.source.entry_id)}
                          readOnly
                        />
                      </td>
                      <td className="font-mono">{p.source.con_word_romanized}</td>
                      <td className="font-mono font-bold">{p.derived}</td>
                      <td className="font-mono text-primary">{p.ipa}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </SortableItem>
  );
};
