import React from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import type {
  InflectionRule,
  MorphologyType,
  PartOfSpeech,
} from "../../types";
import { SELECT, INPUT_MONO, CHECKBOX, BTN_ERROR } from "../../lib/ui";
import { useInflectionKindLabels } from "../../lib/labelMaps";
import { TypeConfigPanel } from "./TypeConfigPanel";
import { TypologyBindingPanel } from "./TypologyBindingPanel";

interface InflectionRuleFieldsProps {
  rule: InflectionRule;
  partsOfSpeech: PartOfSpeech[];
  availableTypes: MorphologyType[];
  onChange: (
    ruleId: string,
    field: keyof InflectionRule,
    value: InflectionRule[keyof InflectionRule],
  ) => void;
  onNestedChange: (
    ruleId: string,
    configKey: keyof InflectionRule,
    field: string,
    value: string,
  ) => void;
  onRequestDelete: (ruleId: string) => void;
}

/** 单条屈折规则的字段编辑行（受控，拖拽把手由父级 SortableItem 提供） */
export const InflectionRuleFields: React.FC<InflectionRuleFieldsProps> = ({
  rule,
  partsOfSpeech,
  availableTypes,
  onChange: handleChange,
  onNestedChange: handleNestedChange,
  onRequestDelete,
}) => {
  const { t } = useTranslation();
  const inflectionKindLabels = useInflectionKindLabels();

  return (
  <div className="grid grid-cols-14 gap-2 items-center flex-1">
    <select
      value={rule.pos_id}
      onChange={(e) =>
        handleChange(rule.rule_id, "pos_id", e.target.value)
      }
      className={`col-span-2 ${SELECT}`}
    >
      <option value="">--</option>
      {partsOfSpeech.map((p) => (
        <option key={p.pos_id} value={p.pos_id}>
          {p.name || p.pos_id}
        </option>
      ))}
    </select>

    <input
      type="text"
      value={rule.tag}
      onChange={(e) =>
        handleChange(
          rule.rule_id,
          "tag",
          e.target.value.toUpperCase(),
        )
      }
      className={`col-span-2 ${INPUT_MONO}`}
      placeholder={"PL, PAST, NEG..."}
    />

    <select
      value={rule.type}
      onChange={(e) =>
        handleChange(rule.rule_id, "type", e.target.value)
      }
      className={`col-span-2 ${SELECT}`}
    >
      {availableTypes.map((typeVal) => (
        <option key={typeVal} value={typeVal}>
          {inflectionKindLabels[typeVal] ?? typeVal}
        </option>
      ))}
    </select>

    <input
      type="text"
      value={rule.affix}
      onChange={(e) =>
        handleChange(rule.rule_id, "affix", e.target.value)
      }
      className={`col-span-2 ${INPUT_MONO}`}
      placeholder={t("grammar.placeholders.affix")}
      disabled={
        rule.type === "infix" ||
        rule.type === "circumfix" ||
        rule.type === "reduplication" ||
        rule.type === "ablaut"
      }
    />

    <input
      type="text"
      value={rule.match_regex}
      onChange={(e) =>
        handleChange(
          rule.rule_id,
          "match_regex",
          e.target.value,
        )
      }
      className={`col-span-2 ${INPUT_MONO}`}
      placeholder=".*"
    />

    <div className="col-span-1 flex items-center justify-center">
      <input
        type="checkbox"
        checked={!rule.disabled}
        onChange={(e) =>
          handleChange(
            rule.rule_id,
            "disabled",
            !e.target.checked,
          )
        }
        className={CHECKBOX}
      />
    </div>

    <input
      type="number"
      value={rule.priority ?? 0}
      onChange={(e) =>
        handleChange(
          rule.rule_id,
          "priority",
          Number.parseInt(e.target.value, 10) || 0,
        )
      }
      className={`col-span-1 ${INPUT_MONO}`}
      title={t("grammar.morphologyV3.priorityLabel")}
      aria-label={t("grammar.morphologyV3.priorityLabel")}
      placeholder="0"
    />

    <div className="col-span-1 flex items-center justify-center">
      <input
        type="checkbox"
        checked={!!rule.sca_mutable}
        onChange={(e) =>
          handleChange(
            rule.rule_id,
            "sca_mutable",
            e.target.checked,
          )
        }
        className={CHECKBOX}
        title={t("grammar.scaMutable")}
      />
    </div>

    <div className="col-span-1 flex justify-end">
      <button
        onClick={() => onRequestDelete(rule.rule_id)}
        className={BTN_ERROR}
        title={t("grammar.deleteRule")}
      >
        <Trash2 size={14} />
      </button>
    </div>

    {/* 类型专用配置面板 */}
    <TypeConfigPanel
      rule={rule}
      onNestedChange={handleNestedChange}
    />

    {/* 类型学绑定面板 */}
    <TypologyBindingPanel
      rule={rule}
      onChange={handleChange}
    />
  </div>
  );
};
