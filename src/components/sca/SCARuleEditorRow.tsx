import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import type { SCARule } from "../../types";
import { INPUT, INPUT_MONO, TOGGLE, BTN_ERROR } from "../../lib/ui";
import { FeatureExprEditor, FeatureReplEditor } from "./FeatureSelector";

interface SCARuleEditorRowProps {
  rule: SCARule;
  onFieldChange: (field: keyof SCARule, value: string) => void;
  onPatchRule: (next: SCARule) => void;
  onToggleFeatureMode: () => void;
  onRequestDelete: () => void;
}

/** 单条音变规则的编辑卡（字符模式 / 特征模式双形态） */
export const SCARuleEditorRow: React.FC<SCARuleEditorRowProps> = ({
  rule,
  onFieldChange,
  onPatchRule,
  onToggleFeatureMode,
  onRequestDelete,
}) => {
  const { t } = useTranslation();

  return (
    <div className="border border-base-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          className={`${INPUT} flex-1 text-sm`}
          placeholder={t("sca.descriptionPlaceholder")}
          value={rule.description}
          onChange={(event) => onFieldChange("description", event.target.value)}
        />
        <label className="flex items-center gap-1 text-xs text-base-content/60 whitespace-nowrap">
          <input
            type="checkbox"
            className={TOGGLE}
            checked={!!rule.feature_mode}
            onChange={onToggleFeatureMode}
          />
          {t("sca.featureMode")}
        </label>
        <button className={BTN_ERROR} onClick={onRequestDelete} title={t("sca.deleteRule")}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {rule.feature_mode ? (
        <div className="space-y-2">
          <FeatureExprEditor
            label={t("sca.targetFeatures")}
            value={rule.target_features}
            onChange={(value) => onPatchRule({ ...rule, target_features: value })}
          />
          <FeatureReplEditor
            label={t("sca.replacementFeatures")}
            value={rule.replacement_features}
            onChange={(value) => onPatchRule({ ...rule, replacement_features: value })}
          />
          <FeatureExprEditor
            label={t("sca.contextBeforeFeatures")}
            value={rule.context_before_features}
            onChange={(value) => onPatchRule({ ...rule, context_before_features: value })}
          />
          <FeatureExprEditor
            label={t("sca.contextAfterFeatures")}
            value={rule.context_after_features}
            onChange={(value) => onPatchRule({ ...rule, context_after_features: value })}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-base-content/60">{t("sca.target")}</label>
            <input
              className={`${INPUT_MONO} w-full text-sm`}
              placeholder="p t k"
              value={rule.target}
              onChange={(event) => onFieldChange("target", event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-base-content/60">{t("sca.replacement")}</label>
            <input
              className={`${INPUT_MONO} w-full text-sm`}
              placeholder="b d g"
              value={rule.replacement}
              onChange={(event) => onFieldChange("replacement", event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-base-content/60">{t("sca.contextBefore")}</label>
            <input
              className={`${INPUT_MONO} w-full text-sm`}
              placeholder="V"
              value={rule.context_before}
              onChange={(event) => onFieldChange("context_before", event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-base-content/60">{t("sca.contextAfter")}</label>
            <input
              className={`${INPUT_MONO} w-full text-sm`}
              placeholder="V"
              value={rule.context_after}
              onChange={(event) => onFieldChange("context_after", event.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
