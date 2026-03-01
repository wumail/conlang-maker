/**
 * ConjugationClassEditor.tsx — 屈折语变位类编辑器
 *
 * 管理变位/变格类列表。每个类有名称、适用词性、词干识别模式，
 * 以及关联的屈折规则 ID 列表（表示属于该类的规则）。
 */
import React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import { ConjugationClass } from "../../types";
import { Plus, Trash2, Info, GripVertical } from "lucide-react";
import {
  INPUT_MONO,
  SELECT,
  BTN_PRIMARY,
  BTN_ERROR,
  BADGE,
} from "../../lib/ui";
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

export const ConjugationClassEditor: React.FC = () => {
  const { t } = useTranslation();
  const { config, setConjugationClasses } = useGrammarStore();
  const classes = config.conjugation_classes;
  const partsOfSpeech = config.parts_of_speech;
  const rules = config.inflection_rules;
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { sensors, onDragEnd } = useDragReorder(
    classes,
    setConjugationClasses,
    (c) => c.class_id,
  );

  const addClass = () => {
    const newClass: ConjugationClass = {
      class_id: `conj_${crypto.randomUUID().slice(0, 8)}`,
      name: "",
      applies_to_pos: partsOfSpeech[0]?.pos_id ?? "",
      stem_pattern: "",
      rule_ids: [],
    };
    setConjugationClasses([...classes, newClass]);
  };

  const updateClass = (
    classId: string,
    field: keyof ConjugationClass,
    value: ConjugationClass[keyof ConjugationClass],
  ) => {
    setConjugationClasses(
      classes.map((c) =>
        c.class_id === classId ? { ...c, [field]: value } : c,
      ),
    );
  };

  const deleteClass = (classId: string) => {
    setConjugationClasses(classes.filter((c) => c.class_id !== classId));
  };

  const toggleRuleInClass = (classId: string, ruleId: string) => {
    const cls = classes.find((c) => c.class_id === classId);
    if (!cls) return;
    const ids = cls.rule_ids.includes(ruleId)
      ? cls.rule_ids.filter((id) => id !== ruleId)
      : [...cls.rule_ids, ruleId];
    updateClass(classId, "rule_ids", ids);
  };

  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      <div className="flex justify-end items-center">
        <button
          onClick={addClass}
          className={BTN_PRIMARY}
          disabled={partsOfSpeech.length === 0}
        >
          <Plus size={16} /> {t("typology.addClass")}
        </button>
      </div>

      {partsOfSpeech.length === 0 && (
        <div className="flex items-center gap-2 p-3 bg-info/10 border border-primary/30 rounded-lg text-sm text-primary">
          <Info size={16} /> {t("typology.noPosHint")}
        </div>
      )}

      <p className="text-sm text-base-content/60">
        {t("typology.conjugationClassesHint")}
      </p>

      {classes.length === 0 && <EmptyState message={t("typology.noClasses")} />}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={classes.map((c) => c.class_id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-4">
            {classes.map((cls) => {
              const posRules = rules.filter(
                (r) => r.pos_id === cls.applies_to_pos && !r.disabled,
              );
              return (
                <SortableItem
                  key={cls.class_id}
                  id={cls.class_id}
                  className="p-4 rounded-lg bg-base-200/50 border border-base-200 space-y-3"
                >
                  {({ listeners, attributes }) => (
                    <>
                      <div className="flex items-center gap-3">
                        <span
                          {...listeners}
                          {...attributes}
                          className="cursor-grab"
                        >
                          <GripVertical
                            size={16}
                            className="text-base-content/30 shrink-0"
                          />
                        </span>
                        <input
                          type="text"
                          value={cls.name}
                          onChange={(e) =>
                            updateClass(cls.class_id, "name", e.target.value)
                          }
                          className={`w-48 ${INPUT_MONO}`}
                          placeholder={t("typology.classNamePlaceholder")}
                        />

                        <select
                          value={cls.applies_to_pos}
                          onChange={(e) =>
                            updateClass(
                              cls.class_id,
                              "applies_to_pos",
                              e.target.value,
                            )
                          }
                          className={`w-40 ${SELECT}`}
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
                          value={cls.stem_pattern}
                          onChange={(e) =>
                            updateClass(
                              cls.class_id,
                              "stem_pattern",
                              e.target.value,
                            )
                          }
                          className={`w-48 ${INPUT_MONO}`}
                          placeholder={t("typology.stemPatternPlaceholder")}
                        />

                        <div className="flex-1" />

                        <button
                          onClick={() => setDeleteTarget(cls.class_id)}
                          className={BTN_ERROR}
                          title={t("typology.deleteClass")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      {/* 关联规则选择 */}
                      <div>
                        <h4 className="text-xs font-semibold text-base-content/60 mb-1">
                          {t("typology.associatedRules")}
                        </h4>
                        {posRules.length === 0 ? (
                          <span className="text-xs text-base-content/50 italic">
                            {t("typology.noRulesForPos")}
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {posRules.map((r) => {
                              const selected = cls.rule_ids.includes(r.rule_id);
                              return (
                                <button
                                  key={r.rule_id}
                                  onClick={() =>
                                    toggleRuleInClass(cls.class_id, r.rule_id)
                                  }
                                  className={`${BADGE} cursor-pointer transition-colors ${selected ? "badge-primary" : "badge-ghost opacity-60 hover:opacity-100"}`}
                                >
                                  {r.tag} (
                                  {r.type === "suffix"
                                    ? `-${r.affix}`
                                    : r.type === "prefix"
                                      ? `${r.affix}-`
                                      : r.type}
                                  )
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </SortableItem>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <ConfirmModal
        open={!!deleteTarget}
        title={t("typology.deleteClass")}
        message={t("typology.deleteClassConfirm")}
        onConfirm={() => {
          if (deleteTarget) deleteClass(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
