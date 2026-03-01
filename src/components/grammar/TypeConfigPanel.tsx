/**
 * TypeConfigPanel — 屈折规则类型专用配置面板
 *
 * 从 InflectionSection 中提取，负责渲染 infix / circumfix / reduplication / ablaut 的专用编辑 UI
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { InflectionRule, MorphologyType } from "../../types";
import { INPUT_MONO, SELECT } from "../../lib/ui";

interface TypeConfigPanelProps {
  rule: InflectionRule;
  onNestedChange: (
    ruleId: string,
    configKey: keyof InflectionRule,
    field: string,
    value: string,
  ) => void;
}

export const TypeConfigPanel: React.FC<TypeConfigPanelProps> = ({
  rule,
  onNestedChange,
}) => {
  const { t } = useTranslation();
  const type: MorphologyType = rule.type;

  switch (type) {
    case "prefix":
    case "suffix":
      return null;

    case "infix":
      return (
        <div className="col-span-12 grid grid-cols-2 gap-2 pl-4 border-l-2 border-primary/30">
          <div>
            <label className="text-xs text-base-content/50">
              {t("grammar.infixPosition")}
            </label>
            <input
              type="text"
              value={rule.infix_config?.position_regex ?? ""}
              onChange={(e) =>
                onNestedChange(
                  rule.rule_id,
                  "infix_config",
                  "position_regex",
                  e.target.value,
                )
              }
              className={`w-full ${INPUT_MONO}`}
              placeholder="(?<=^[^aeiou]*)"
            />
          </div>
          <div>
            <label className="text-xs text-base-content/50">
              {t("grammar.infixMorpheme")}
            </label>
            <input
              type="text"
              value={rule.infix_config?.morpheme ?? ""}
              onChange={(e) =>
                onNestedChange(
                  rule.rule_id,
                  "infix_config",
                  "morpheme",
                  e.target.value,
                )
              }
              className={`w-full ${INPUT_MONO}`}
              placeholder="um"
            />
          </div>
        </div>
      );

    case "circumfix":
      return (
        <div className="col-span-12 grid grid-cols-2 gap-2 pl-4 border-l-2 border-purple-200">
          <div>
            <label className="text-xs text-base-content/50">
              {t("grammar.circumfixPrefix")}
            </label>
            <input
              type="text"
              value={rule.circumfix_config?.prefix_part ?? ""}
              onChange={(e) =>
                onNestedChange(
                  rule.rule_id,
                  "circumfix_config",
                  "prefix_part",
                  e.target.value,
                )
              }
              className={`w-full ${INPUT_MONO}`}
              placeholder="ge-"
            />
          </div>
          <div>
            <label className="text-xs text-base-content/50">
              {t("grammar.circumfixSuffix")}
            </label>
            <input
              type="text"
              value={rule.circumfix_config?.suffix_part ?? ""}
              onChange={(e) =>
                onNestedChange(
                  rule.rule_id,
                  "circumfix_config",
                  "suffix_part",
                  e.target.value,
                )
              }
              className={`w-full ${INPUT_MONO}`}
              placeholder="-t"
            />
          </div>
        </div>
      );

    case "reduplication":
      return (
        <div className="col-span-12 pl-4 border-l-2 border-green-200 flex items-center gap-2">
          <label className="text-xs text-base-content/50">
            {t("grammar.redupMode")}:
          </label>
          <select
            value={rule.reduplication_config?.mode ?? "full"}
            onChange={(e) =>
              onNestedChange(
                rule.rule_id,
                "reduplication_config",
                "mode",
                e.target.value,
              )
            }
            className={`w-48 ${SELECT}`}
          >
            <option value="full">{t("grammar.redupFull")}</option>
            <option value="partial_onset">{t("grammar.redupOnset")}</option>
            <option value="partial_coda">{t("grammar.redupCoda")}</option>
          </select>
        </div>
      );

    case "ablaut":
      return (
        <div className="col-span-12 grid grid-cols-2 gap-2 pl-4 border-l-2 border-amber-200">
          <div>
            <label className="text-xs text-base-content/50">
              {t("grammar.ablautTarget")}
            </label>
            <input
              type="text"
              value={rule.ablaut_config?.target_vowel ?? ""}
              onChange={(e) =>
                onNestedChange(
                  rule.rule_id,
                  "ablaut_config",
                  "target_vowel",
                  e.target.value,
                )
              }
              className={`w-full ${INPUT_MONO}`}
              placeholder="i"
            />
          </div>
          <div>
            <label className="text-xs text-base-content/50">
              {t("grammar.ablautReplacement")}
            </label>
            <input
              type="text"
              value={rule.ablaut_config?.replacement_vowel ?? ""}
              onChange={(e) =>
                onNestedChange(
                  rule.rule_id,
                  "ablaut_config",
                  "replacement_vowel",
                  e.target.value,
                )
              }
              className={`w-full ${INPUT_MONO}`}
              placeholder="a"
            />
          </div>
        </div>
      );
  }
};
