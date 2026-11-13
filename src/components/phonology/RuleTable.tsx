import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RomanizationMap, RomanizationRule } from "../../types";
import { Plus, Trash2, ArrowUpDown, AlertTriangle } from "lucide-react";
import {
  INPUT_MONO,
  BTN_ERROR,
  BTN_LINK,
} from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { PhonemeStrip } from "../common/PhonemeStrip";

interface RuleTableProps {
  map: RomanizationMap;
  consonants: string[];
  vowels: string[];
  onUpdateRule: (
    map: RomanizationMap,
    ruleIdx: number,
    patch: Partial<RomanizationRule>,
  ) => void;
  onAddRule: (map: RomanizationMap) => void;
  onDeleteRule: (map: RomanizationMap, ruleIdx: number) => void;
  onSortRules: (map: RomanizationMap) => void;
  /** `map_id::rule_id` → 诊断条数（来自 analyzeRomanization，按映射表隔离） */
  lintIndex?: Map<string, number>;
}

/** Renders the rule grid for a single romanization map */
export const RuleTable: React.FC<RuleTableProps> = ({
  map,
  consonants,
  vowels,
  onUpdateRule,
  onAddRule,
  onDeleteRule,
  onSortRules,
  lintIndex,
}) => {
  const { t } = useTranslation();
  const [activeRuleIdx, setActiveRuleIdx] = useState<number | null>(null);
  const [confirmDeleteRuleIdx, setConfirmDeleteRuleIdx] = useState<number | null>(null);
  const outputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const ruleGrid =
    "grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto] gap-2";

  const handleQuickInsert = (phoneme: string) => {
    if (activeRuleIdx === null) return;
    const rule = map.rules[activeRuleIdx];
    if (!rule) return;
    onUpdateRule(map, activeRuleIdx, {
      output_phoneme: rule.output_phoneme + phoneme,
    });
    setTimeout(() => outputRefs.current[activeRuleIdx]?.focus(), 0);
  };

  return (
    <div className="p-4 space-y-3">
      {/* Quick phoneme insert strip */}
      <PhonemeStrip
        consonants={consonants}
        vowels={vowels}
        isActive={activeRuleIdx !== null}
        onInsert={handleQuickInsert}
      />

      {/* Rule table header */}
      {map.rules.length > 0 && (
        <div className={`${ruleGrid} text-xs font-medium text-base-content/60 px-1`}>
          <div>{t("phonology.romanization.input")}</div>
          <div>{t("phonology.romanization.output")}</div>
          <div>{t("phonology.romanization.contextBefore")}</div>
          <div>{t("phonology.romanization.contextAfter")}</div>
          <div></div>
        </div>
      )}

      {map.rules.map((rule, idx) => {
        const lintCount = lintIndex?.get(`${map.map_id}::${rule.rule_id}`) ?? 0;
        return (
        <div key={rule.rule_id || idx} className={`${ruleGrid} items-center`}>
          <input
            type="text"
            value={rule.input}
            onChange={(e) => onUpdateRule(map, idx, { input: e.target.value })}
            className={INPUT_MONO}
            placeholder="sh"
          />
          <input
            type="text"
            ref={(el) => {
              outputRefs.current[idx] = el;
            }}
            value={rule.output_phoneme}
            onChange={(e) =>
              onUpdateRule(map, idx, {
                output_phoneme: e.target.value,
              })
            }
            onFocus={() => setActiveRuleIdx(idx)}
            className={`${INPUT_MONO} w-full ${activeRuleIdx === idx ? "ring-2 ring-primary/50" : ""}`}
            placeholder="ʃ"
          />
          <input
            type="text"
            value={rule.context_before}
            onChange={(e) => onUpdateRule(map, idx, { context_before: e.target.value })}
            className={INPUT_MONO}
          />
          <input
            type="text"
            value={rule.context_after}
            onChange={(e) => onUpdateRule(map, idx, { context_after: e.target.value })}
            className={INPUT_MONO}
            placeholder="_"
          />
          <div className="flex items-center gap-1">
            {lintCount > 0 && (
              <span
                className="text-warning"
                title={t("phonology.romanization.lint.ruleRowHint", {
                  count: lintCount,
                })}
              >
                <AlertTriangle size={14} />
              </span>
            )}
            <button
              onClick={() => setConfirmDeleteRuleIdx(idx)}
              className={BTN_ERROR}
              title={t("common.delete")}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        );
      })}

      <div className="flex items-center gap-3 mt-2">
        <button onClick={() => onAddRule(map)} className={BTN_LINK}>
          <Plus size={14} /> {t("phonology.romanization.addRule")}
        </button>
        {map.rules.length > 1 && (
          <button
            onClick={() => onSortRules(map)}
            className="flex items-center gap-1 text-xs text-base-content/60 hover:text-base-content/80"
            title={t("phonology.romanization.sortHint")}
          >
            <ArrowUpDown size={12} /> {t("phonology.romanization.sort")}
          </button>
        )}
      </div>

      <ConfirmModal
        open={confirmDeleteRuleIdx !== null}
        title={t("common.delete")}
        message={t("phonology.romanization.deleteRuleConfirm", "Are you sure you want to delete this rule?")}
        onConfirm={() => {
          if (confirmDeleteRuleIdx !== null) {
            onDeleteRule(map, confirmDeleteRuleIdx);
          }
          setConfirmDeleteRuleIdx(null);
        }}
        onCancel={() => setConfirmDeleteRuleIdx(null)}
      />
    </div>
  );
};
