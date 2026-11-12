import React, { type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import type { RewriteRule, DropoffMap } from "../../core/engines/wordGenerator";
import { INPUT_MONO, BTN_GHOST, BTN_ERROR } from "../../lib/ui";

interface RewriteSettingsPanelProps {
  rewriteRules: RewriteRule[];
  onRewriteRulesChange: Dispatch<SetStateAction<RewriteRule[]>>;
  dropoffs: DropoffMap;
  onDropoffsChange: Dispatch<SetStateAction<DropoffMap>>;
  macroKeys: string[];
  onRequestDeleteRewriteRule: (index: number) => void;
}

/** 造词器的「字符改写规则」与「宏衰减」高级设置面板（纯受控组件） */
export const RewriteSettingsPanel: React.FC<RewriteSettingsPanelProps> = ({
  rewriteRules,
  onRewriteRulesChange,
  dropoffs,
  onDropoffsChange,
  macroKeys,
  onRequestDeleteRewriteRule,
}) => {
  const { t } = useTranslation();

  return (
    <>
  {/* Rewrite Rules */}
  <div className="mb-4 p-3 bg-base-200/50 rounded-lg border border-base-200">
    <div className="flex justify-between items-center mb-2">
      <span className="text-xs font-medium text-base-content/70">
        {t("wordgen.rewriteRules")}
      </span>
      <button
        onClick={() =>
          onRewriteRulesChange((prev) => [
            ...prev,
            { pattern: "", replacement: "" },
          ])
        }
        className={BTN_GHOST}
      >
        <Plus size={12} /> {t("wordgen.addRewriteRule")}
      </button>
    </div>
    {rewriteRules.map((rule, i) => (
      <div key={i} className="flex items-center gap-2 mb-1">
        <input
          type="text"
          value={rule.pattern}
          onChange={(e) =>
            onRewriteRulesChange((prev) =>
              prev.map((r, j) =>
                j === i ? { ...r, pattern: e.target.value } : r,
              ),
            )
          }
          className={`flex-1 ${INPUT_MONO}`}
          placeholder={t("wordgen.rewritePattern")}
        />
        <span className="text-base-content/50">→</span>
        <input
          type="text"
          value={rule.replacement}
          onChange={(e) =>
            onRewriteRulesChange((prev) =>
              prev.map((r, j) =>
                j === i ? { ...r, replacement: e.target.value } : r,
              ),
            )
          }
          className={`flex-1 ${INPUT_MONO}`}
          placeholder={t("wordgen.rewriteReplacement")}
        />
        <button
          onClick={() => onRequestDeleteRewriteRule(i)}
          className={BTN_ERROR}
          title={t("wordgen.deleteRewriteRule")}
        >
          <Trash2 size={12} />
        </button>
      </div>
    ))}
  </div>

  {/* Per-macro Dropoff */}
  {macroKeys.length > 0 && (
    <div className="mb-4 p-3 bg-base-200/50 rounded-lg border border-base-200">
      <span className="text-xs font-medium text-base-content/70 block mb-2">
        {t("wordgen.dropoff")}
      </span>
      <div className="flex flex-wrap gap-4">
        {macroKeys.map((key) => (
          <div key={key} className="flex items-center gap-2">
            <span className="text-xs font-mono text-base-content/80 w-6">
              {key}
            </span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={dropoffs[key] ?? 1.0}
              onChange={(e) =>
                onDropoffsChange((prev) => ({
                  ...prev,
                  [key]: Number(e.target.value),
                }))
              }
              className="range range-xs range-primary w-24"
            />
            <span className="text-xs font-mono w-8">
              {(dropoffs[key] ?? 1.0).toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )}
    </>
  );
};
