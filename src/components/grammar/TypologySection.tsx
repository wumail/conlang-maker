import React from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import type { MorphologicalTypology, HeadMarking } from "../../types";
import { SELECT, CARD } from "../../lib/ui";

const TYPOLOGY_OPTIONS: MorphologicalTypology[] = [
  "isolating",
  "agglutinative",
  "fusional",
  "polysynthetic",
];
const HEAD_MARKING_OPTIONS: HeadMarking[] = [
  "head",
  "dependent",
  "double",
  "none",
];

/** 类型对应的图标色 */
const TYPE_COLORS: Record<MorphologicalTypology, string> = {
  isolating: "bg-amber-100 border-amber-300 text-amber-800",
  agglutinative: "bg-primary/15 border-primary/40 text-primary",
  fusional: "bg-purple-100 border-purple-300 text-purple-800",
  polysynthetic: "bg-emerald-100 border-emerald-300 text-emerald-800",
};

export const TypologySection: React.FC = () => {
  const { t } = useTranslation();
  const { config, updateTypology } = useGrammarStore();
  const typo = config.typology;

  const handleTypeChange = (morphological_type: MorphologicalTypology) => {
    updateTypology({ ...typo, morphological_type });
  };

  const handleHeadMarkingChange = (head_marking: HeadMarking) => {
    updateTypology({ ...typo, head_marking });
  };

  const handleSynthesisChange = (v: number) => {
    updateTypology({ ...typo, synthesis_index: v, auto_estimated: false });
  };

  const handleFusionChange = (v: number) => {
    updateTypology({ ...typo, fusion_index: v, auto_estimated: false });
  };

  return (
    <div className="space-y-6 bg-base-100 p-6 min-w-[900px] flex-1">
      {/* 类型选择卡片 */}
      <div>
        <label className="text-lg font-semibold text-base-content mb-4 block">
          {t("typology.morphologicalType")}
        </label>
        <div className="grid grid-cols-2 gap-3">
          {TYPOLOGY_OPTIONS.map((tp) => (
            <button
              key={tp}
              onClick={() => handleTypeChange(tp)}
              className={`rounded-lg border-2 p-3 text-left transition-all ${
                typo.morphological_type === tp
                  ? TYPE_COLORS[tp] + " border-2 shadow-sm"
                  : "bg-base-100 border-base-200 hover:border-base-300"
              }`}
            >
              <div className="font-semibold text-sm">
                {t(`typology.types.${tp}`)}
              </div>
              <div className="text-xs mt-1 opacity-75">
                {t(`typology.typeDescriptions.${tp}`)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 指数滑块 */}
      <div className={`${CARD} p-4 space-y-4`}>
        {/* 综合度 */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-sm font-medium text-base-content/80">
              {t("typology.synthesisIndex")}
            </label>
            <span className="text-xs font-mono text-base-content/60">
              {typo.synthesis_index.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min="1.0"
            max="5.0"
            step="0.1"
            value={typo.synthesis_index}
            onChange={(e) => handleSynthesisChange(parseFloat(e.target.value))}
            className="range range-sm range-primary w-full"
          />
          <div className="text-xs text-base-content/50 mt-0.5">
            {t("typology.synthesisIndexHint")}
          </div>
        </div>

        {/* 融合度 */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-sm font-medium text-base-content/80">
              {t("typology.fusionIndex")}
            </label>
            <span className="text-xs font-mono text-base-content/60">
              {typo.fusion_index.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min="1.0"
            max="3.0"
            step="0.1"
            value={typo.fusion_index}
            onChange={(e) => handleFusionChange(parseFloat(e.target.value))}
            className="range range-sm range-secondary w-full"
          />
          <div className="text-xs text-base-content/50 mt-0.5">
            {t("typology.fusionIndexHint")}
          </div>
        </div>

        {/* 标记模式 */}
        <div>
          <label className="text-sm font-medium text-base-content/80 block mb-1">
            {t("typology.headMarking")}
          </label>
          <select
            value={typo.head_marking}
            onChange={(e) =>
              handleHeadMarkingChange(e.target.value as HeadMarking)
            }
            className={`w-60 ${SELECT}`}
          >
            {HEAD_MARKING_OPTIONS.map((hm) => (
              <option key={hm} value={hm}>
                {t(`typology.headMarkingOptions.${hm}`)}
              </option>
            ))}
          </select>
        </div>

        {/* 自动/手动 */}
        <div className="text-xs text-base-content/50">
          {typo.auto_estimated
            ? t("typology.autoEstimated")
            : t("typology.manualMode")}
        </div>
      </div>
    </div>
  );
};
