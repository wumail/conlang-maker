/**
 * InflectionSystemSection — 屈折系统聚合标签页
 *
 * 将屈折规则、维度、矩阵以及类型学专用编辑器（词缀槽位、变位类、不规则覆盖）
 * 整合为一个带有内部子标签的统一面板。
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import { InflectionSection } from "./InflectionSection";
import { DimensionEditor } from "./DimensionEditor";
import { InflectionMatrix } from "./InflectionMatrix";
import { InflectionTest } from "./InflectionTest";
import { AffixSlotEditor } from "./AffixSlotEditor";
import { ConjugationClassEditor } from "./ConjugationClassEditor";
import { IrregularOverrideEditor } from "./IrregularOverrideEditor";

type SubTab =
  | "rules"
  | "dimensions"
  | "matrix"
  | "test"
  | "affix_slots"
  | "conjugation_classes"
  | "irregular_overrides";

export const InflectionSystemSection: React.FC = () => {
  const { t } = useTranslation();
  const morphType = useGrammarStore(
    (s) => s.config.typology.morphological_type,
  );
  const [sub, setSub] = useState<SubTab>("rules");

  const subTabs: { key: SubTab; label: string }[] = [
    { key: "rules", label: t("grammar.sections.inflection") },
    { key: "dimensions", label: t("grammar.sections.dimensions") },
    { key: "matrix", label: t("grammar.sections.matrix") },
    { key: "test", label: t("grammar.sections.test") },
    ...(morphType === "agglutinative"
      ? [{ key: "affix_slots" as SubTab, label: t("typology.affixSlots") }]
      : []),
    ...(morphType === "fusional"
      ? [
          {
            key: "conjugation_classes" as SubTab,
            label: t("typology.conjugationClasses"),
          },
          {
            key: "irregular_overrides" as SubTab,
            label: t("typology.irregularOverrides"),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col flex-1">
      {/* 子标签栏 */}
      <div className="flex gap-1 border-b bg-base-100 border-base-300 px-4 pt-2">
        {subTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSub(tab.key)}
            className={`px-3 py-1 text-sm rounded-t transition-colors ${
              sub === tab.key
                ? "bg-primary/10 text-primary font-semibold border-b-2 border-primary"
                : "text-base-content/60 hover:text-base-content"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 子标签内容 */}
      {sub === "rules" && <InflectionSection />}
      {sub === "dimensions" && <DimensionEditor />}
      {sub === "matrix" && <InflectionMatrix />}
      {sub === "test" && <InflectionTest />}
      {sub === "affix_slots" && <AffixSlotEditor />}
      {sub === "conjugation_classes" && <ConjugationClassEditor />}
      {sub === "irregular_overrides" && <IrregularOverrideEditor />}
    </div>
  );
};
