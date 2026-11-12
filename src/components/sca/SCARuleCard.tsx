import { useTranslation } from "react-i18next";
import { Plus, Trash2, ChevronDown, ChevronRight, Copy, Download } from "lucide-react";
import type { SCARule, SCARuleSet } from "../../types";
import { BTN_GHOST, BTN_GHOST_SQ, BTN_ERROR } from "../../lib/ui";
import { SCARuleEditorRow } from "./SCARuleEditorRow";

interface SCARuleCardProps {
  ruleSet: SCARuleSet;
  expanded: boolean;
  onToggleExpand: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onRequestDelete: () => void;
  onAddRule: () => void;
  onRuleFieldChange: (ruleId: string, field: keyof SCARule, value: string) => void;
  onPatchRule: (ruleId: string, next: SCARule) => void;
  onToggleRuleFeatureMode: (ruleId: string) => void;
  onRequestDeleteRule: (ruleId: string) => void;
}

/** 单个音变规则集卡片：折叠头 + 规则列表 */
export const SCARuleCard: React.FC<SCARuleCardProps> = ({
  ruleSet,
  expanded,
  onToggleExpand,
  onCopy,
  onDownload,
  onRequestDelete,
  onAddRule,
  onRuleFieldChange,
  onPatchRule,
  onToggleRuleFeatureMode,
  onRequestDeleteRule,
}) => {
  const { t } = useTranslation();

  return (
    <div className="border border-base-200 rounded-lg">
      <div className="p-4">
        <div className="flex items-center gap-2">
          <button
            className={BTN_GHOST}
            onClick={onToggleExpand}
            title={t("sca.toggleExpand")}
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          <span className="font-medium text-sm flex-1">
            {ruleSet.name || t("sca.unnamed")}
          </span>
          <span className="text-xs text-base-content/50">#{ruleSet.order}</span>
          <button className={BTN_GHOST_SQ} onClick={onCopy} title={t("sca.copyRuleSet")}>
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            className={BTN_GHOST_SQ}
            onClick={onDownload}
            title={t("sca.downloadRuleSet")}
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            className={BTN_ERROR}
            onClick={onRequestDelete}
            title={t("sca.deleteRuleSet")}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {expanded && (
          <div className="mt-3 space-y-3">
            {ruleSet.rules.map((rule) => (
              <SCARuleEditorRow
                key={rule.rule_id}
                rule={rule}
                onFieldChange={(field, value) =>
                  onRuleFieldChange(rule.rule_id, field, value)
                }
                onPatchRule={(next) => onPatchRule(rule.rule_id, next)}
                onToggleFeatureMode={() => onToggleRuleFeatureMode(rule.rule_id)}
                onRequestDelete={() => onRequestDeleteRule(rule.rule_id)}
              />
            ))}
            <button className={BTN_GHOST} onClick={onAddRule}>
              <Plus className="w-4 h-4" /> {t("sca.addRule")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
