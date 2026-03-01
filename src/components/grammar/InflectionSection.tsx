import React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import {
  InflectionRule,
  MorphologyType,
  MorphologicalTypology,
} from "../../types";
import { Plus, Trash2, AlertTriangle, Info, GripVertical } from "lucide-react";
import {
  INPUT_MONO,
  SELECT,
  BTN_PRIMARY,
  BTN_ERROR,
  CHECKBOX,
  BADGE,
} from "../../lib/ui";
import { TypeConfigPanel } from "./TypeConfigPanel";
import { TypologyBindingPanel } from "./TypologyBindingPanel";
import { ConfirmModal } from "../common/ConfirmModal";
import { EmptyState } from "../common/EmptyState";
import {
  useDragReorder,
  DndContext,
  closestCenter,
  SortableContext,
  verticalListSortingStrategy,
} from "../../utils/useDragReorder";
import { SortableItem } from "../common/SortableItem";

const emptyRule = (posId: string): InflectionRule => ({
  rule_id: crypto.randomUUID(),
  pos_id: posId || "",
  dimension_values: {},
  tag: "",
  type: "suffix",
  affix: "",
  match_regex: ".*",
  disabled: false,
  condition: null,
});

/** 孤立语允许的简单类型 */
const ISOLATING_ALLOWED_TYPES: MorphologyType[] = ["prefix", "suffix"];

/** 根据类型学过滤可用的形态类型 */
function getAvailableTypes(typology: MorphologicalTypology): MorphologyType[] {
  if (typology === "isolating") return ISOLATING_ALLOWED_TYPES;
  return ["prefix", "suffix", "infix", "circumfix", "reduplication", "ablaut"];
}

/** 根据类型生成摘要文本 */
function ruleSummary(r: InflectionRule): string {
  switch (r.type) {
    case "prefix":
      return `${r.affix}-`;
    case "suffix":
      return `-${r.affix}`;
    case "infix":
      return `<${r.infix_config?.morpheme || "?"}>`;
    case "circumfix":
      return `${r.circumfix_config?.prefix_part || "?"}…${r.circumfix_config?.suffix_part || "?"}`;
    case "reduplication":
      return `~${r.reduplication_config?.mode || "full"}`;
    case "ablaut":
      return `${r.ablaut_config?.target_vowel || "?"}→${r.ablaut_config?.replacement_vowel || "?"}`;
    default:
      return r.affix;
  }
}

export const InflectionSection: React.FC = () => {
  const { t } = useTranslation();
  const {
    config,
    addInflection,
    updateInflection,
    deleteInflection,
    setInflections,
  } = useGrammarStore();
  const rules = config.inflection_rules;
  const partsOfSpeech = config.parts_of_speech;
  const morphType = config.typology.morphological_type;
  const availableTypes = getAvailableTypes(morphType);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { sensors, onDragEnd } = useDragReorder(
    rules,
    setInflections,
    (r) => r.rule_id,
  );

  const handleAddRule = () => {
    const defaultPos = partsOfSpeech[0]?.pos_id || "";
    addInflection(emptyRule(defaultPos));
  };

  const handleChange = (
    ruleId: string,
    field: keyof InflectionRule,
    value: InflectionRule[keyof InflectionRule],
  ) => {
    const rule = rules.find((r) => r.rule_id === ruleId);
    if (!rule) return;
    updateInflection(ruleId, { ...rule, [field]: value });
  };

  /** 更新嵌套 config 对象的辅助 */
  const handleNestedChange = (
    ruleId: string,
    configKey: keyof InflectionRule,
    field: string,
    value: string,
  ) => {
    const rule = rules.find((r) => r.rule_id === ruleId);
    if (!rule) return;
    const existing = rule[configKey] as Record<string, string> | undefined;
    updateInflection(ruleId, {
      ...rule,
      [configKey]: { ...existing, [field]: value },
    });
  };

  // Group rules by POS
  const posGroups = rules.reduce<Record<string, InflectionRule[]>>(
    (acc, rule) => {
      if (!acc[rule.pos_id]) acc[rule.pos_id] = [];
      acc[rule.pos_id].push(rule);
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      {/* 孤立语提示：屈折规则是可选的 */}
      {morphType === "isolating" && (
        <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
          <AlertTriangle size={16} />
          {t("typology.isolatingInflectionHint")}
        </div>
      )}
      <div className="flex justify-end items-center">
        <button
          onClick={handleAddRule}
          className={BTN_PRIMARY}
          disabled={partsOfSpeech.length === 0}
        >
          <Plus size={16} /> {t("grammar.addRule")}
        </button>
      </div>
      {partsOfSpeech.length === 0 && (
        <div className="flex items-center gap-2 p-3 bg-info/10 border border-primary/30 rounded-lg text-sm text-primary">
          <Info size={16} /> {t("typology.noPosHint")}
        </div>
      )}
      {rules.length === 0 && <EmptyState message={t("grammar.noRules")} />}
      {rules.length > 0 && (
        <div className="grid grid-cols-12 gap-2 text-xs font-medium text-base-content/60 px-1">
          <div className="col-span-2">{t("grammar.pos")}</div>
          <div className="col-span-2">{t("grammar.tag")}</div>
          <div className="col-span-2">{t("grammar.type")}</div>
          <div className="col-span-2">{t("grammar.affix")}</div>
          <div className="col-span-2">{t("grammar.matchRegex")}</div>
          <div className="col-span-1">{t("grammar.enabled")}</div>
          <div className="col-span-1"></div>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={rules.map((r) => r.rule_id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {rules.map((rule) => (
              <SortableItem
                key={rule.rule_id}
                id={rule.rule_id}
                className={`flex items-start gap-2 p-2 rounded-lg border ${rule.disabled ? "bg-base-200 border-base-300 opacity-60" : "bg-base-200/50 border-base-200"}`}
              >
                {({ listeners, attributes }) => (
                  <>
                    <span
                      {...listeners}
                      {...attributes}
                      className="cursor-grab"
                    >
                      <GripVertical
                        size={16}
                        className="text-base-content/30 shrink-0 mt-1.5"
                      />
                    </span>
                    <div className="grid grid-cols-12 gap-2 items-center flex-1">
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
                            {t(`grammar.${typeVal}`)}
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

                      <div className="col-span-1 flex justify-end">
                        <button
                          onClick={() => setDeleteTarget(rule.rule_id)}
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
                  </>
                )}
              </SortableItem>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {/* Summary by POS — 使用 ruleSummary 支持所有类型 */}
      {Object.keys(posGroups).length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-base-content/70 mb-2">
            {t("common.summary")}
          </h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(posGroups).map(([posId, posRules]) => {
              const pos = partsOfSpeech.find((p) => p.pos_id === posId);
              return (
                <div
                  key={posId}
                  className="bg-base-200/50 rounded px-3 py-2 border border-base-200"
                >
                  <span className="text-xs font-semibold text-base-content/80">
                    {pos?.name || posId}
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {posRules
                      .filter((r) => !r.disabled)
                      .map((r) => (
                        <span
                          key={r.rule_id}
                          className={`text-xs font-mono ${BADGE} badge-ghost`}
                        >
                          {ruleSummary(r)} ({r.tag})
                        </span>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <ConfirmModal
        open={!!deleteTarget}
        title={t("grammar.deleteRule")}
        message={t("grammar.deleteRuleConfirm")}
        onConfirm={() => {
          if (deleteTarget) deleteInflection(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />{" "}
    </div>
  );
};
