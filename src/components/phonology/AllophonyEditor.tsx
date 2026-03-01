import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePhonoStore } from "../../store/phonoStore";
import { AllophonyRule } from "../../types";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { INPUT, INPUT_MONO, BTN_PRIMARY, BTN_ERROR } from "../../lib/ui";
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

const emptyRule = (): AllophonyRule => ({
  rule_id: crypto.randomUUID(),
  description: "",
  target: "",
  replacement: "",
  context_before: "",
  context_after: "",
  priority: 0,
});

export const AllophonyEditor: React.FC = () => {
  const { t } = useTranslation();
  const {
    config,
    addAllophonyRule,
    updateAllophonyRule,
    deleteAllophonyRule,
    setAllophonyRules,
  } = usePhonoStore();
  const rules = [...config.allophony_rules].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { sensors, onDragEnd } = useDragReorder(
    rules,
    setAllophonyRules,
    (r) => r.rule_id,
  );

  const handleAdd = () => {
    const maxPriority = rules.reduce(
      (max, r) => Math.max(max, r.priority ?? 0),
      0,
    );
    addAllophonyRule({ ...emptyRule(), priority: maxPriority + 1 });
  };

  const handleChange = (
    ruleId: string,
    field: keyof AllophonyRule,
    value: string | number,
  ) => {
    const rule = config.allophony_rules.find((r) => r.rule_id === ruleId);
    if (!rule) return;
    updateAllophonyRule(ruleId, { ...rule, [field]: value });
  };

  const handleDelete = (ruleId: string) => {
    setDeleteTarget(ruleId);
  };

  // Macro reference
  const macroKeys = Object.keys(config.phonotactics.macros);

  return (
    <div className="space-y-4 overflow-y-auto bg-base-100 p-6 min-w-[900px] flex-1">
      <div className="flex justify-end items-center mb-4">
        <button onClick={handleAdd} className={BTN_PRIMARY}>
          <Plus size={16} /> {t("phonology.allophony.addRule")}
        </button>
      </div>

      {macroKeys.length > 0 && (
        <div className="mb-4 text-xs text-base-content/60 bg-base-200/50 p-2 rounded">
          {t("phonology.allophony.availableMacros")}:{" "}
          {macroKeys.map((k) => (
            <span
              key={k}
              className="inline-block font-mono bg-base-100 border border-base-300 rounded px-1.5 py-0.5 mx-0.5"
            >
              {k} ={" "}
              {"{" + (config.phonotactics.macros[k]?.join(", ") ?? "") + "}"}
            </span>
          ))}
        </div>
      )}

      {rules.length === 0 && (
        <EmptyState message={t("phonology.allophony.noRules")} />
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
          <div className="space-y-3">
            {rules.map((rule) => (
              <SortableItem
                key={rule.rule_id}
                id={rule.rule_id}
                className="border border-base-300 rounded-lg p-4 bg-base-200/50"
              >
                {({ listeners, attributes }) => (
                  <div className="flex items-start gap-3">
                    {/* Drag handle */}
                    <span
                      {...listeners}
                      {...attributes}
                      className="cursor-grab"
                    >
                      <GripVertical
                        size={16}
                        className="text-base-content/30 shrink-0 mt-2"
                      />
                    </span>

                    <div className="flex-1 space-y-2">
                      {/* Description */}
                      <input
                        type="text"
                        value={rule.description}
                        onChange={(e) =>
                          handleChange(
                            rule.rule_id,
                            "description",
                            e.target.value,
                          )
                        }
                        className={`w-full ${INPUT}`}
                        placeholder={t("phonology.allophony.description")}
                      />

                      {/* Rule definition */}
                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-2">
                          <label className="block text-xs text-base-content/60 mb-1">
                            {t("phonology.allophony.contextBefore")}
                          </label>
                          <input
                            type="text"
                            value={rule.context_before}
                            onChange={(e) =>
                              handleChange(
                                rule.rule_id,
                                "context_before",
                                e.target.value,
                              )
                            }
                            className={`w-full ${INPUT_MONO}`}
                            placeholder={"V"}
                          />
                        </div>
                        <div className="col-span-3">
                          <label className="block text-xs text-base-content/60 mb-1">
                            {t("phonology.allophony.target")}
                          </label>
                          <input
                            type="text"
                            value={rule.target}
                            onChange={(e) =>
                              handleChange(
                                rule.rule_id,
                                "target",
                                e.target.value,
                              )
                            }
                            className={`w-full ${INPUT_MONO}`}
                            placeholder={"t"}
                          />
                        </div>
                        <div className="col-span-1 flex items-end justify-center pb-2 text-base-content/50">
                          →
                        </div>
                        <div className="col-span-3">
                          <label className="block text-xs text-base-content/60 mb-1">
                            {t("phonology.allophony.replacement")}
                          </label>
                          <input
                            type="text"
                            value={rule.replacement}
                            onChange={(e) =>
                              handleChange(
                                rule.rule_id,
                                "replacement",
                                e.target.value,
                              )
                            }
                            className={`w-full ${INPUT_MONO}`}
                            placeholder={"d"}
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs text-base-content/60 mb-1">
                            {t("phonology.allophony.contextAfter")}
                          </label>
                          <input
                            type="text"
                            value={rule.context_after}
                            onChange={(e) =>
                              handleChange(
                                rule.rule_id,
                                "context_after",
                                e.target.value,
                              )
                            }
                            className={`w-full ${INPUT_MONO}`}
                            placeholder={"V"}
                          />
                        </div>
                        <div className="col-span-1 flex items-end justify-end">
                          <button
                            onClick={() => handleDelete(rule.rule_id)}
                            className={BTN_ERROR}
                            title={t("phonology.allophony.deleteRule")}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Readable summary */}
                      <div className="text-xs text-base-content/50 font-mono">
                        {rule.target || "?"} → {rule.replacement || "?"} /{" "}
                        {rule.context_before || "_"}_{rule.context_after || "_"}
                      </div>
                    </div>
                  </div>
                )}
              </SortableItem>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <ConfirmModal
        open={!!deleteTarget}
        title={t("phonology.allophony.deleteRule")}
        message={t("phonology.allophony.deleteRuleConfirm")}
        onConfirm={() => {
          if (deleteTarget) deleteAllophonyRule(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
