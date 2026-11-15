/**
 * InflectionTracePanel.tsx — 统一形态推导诊断与逐步链（Roadmap v3 / Pillar 3）
 *
 * 展示 inflectWord 的完整输出：解析出的变位类及来源、缺失必要维度、
 * 并列规则冲突警告，以及「词干 → 词缀 → 形态音位 → IPA」逐步推导记录。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, GitBranch, Layers } from "lucide-react";
import type { InflectionResult, InflectionStepTrace } from "../../types";
import { BADGE } from "../../lib/ui";

const STAGE_KEYS: Record<InflectionStepTrace["stage"], string> = {
  irregular: "grammar.morphologyV3.stageIrregular",
  class_select: "grammar.morphologyV3.stageClass",
  affix: "grammar.morphologyV3.stageAffix",
  morphophonology: "grammar.morphologyV3.stageMorphophonology",
  ipa: "grammar.morphologyV3.stageIpa",
};

const CLASS_SOURCE_KEYS: Record<InflectionResult["diagnosis"]["resolved_class_source"], string> = {
  sense: "grammar.morphologyV3.classSourceSense",
  word: "grammar.morphologyV3.classSourceWord",
  stem_pattern: "grammar.morphologyV3.classSourceStemPattern",
  none: "grammar.morphologyV3.classSourceNone",
};

interface InflectionTracePanelProps {
  result: InflectionResult;
  /** 便于在标题里显示当前试算的特征组合 */
  dimensionLabels?: Record<string, string>;
}

export const InflectionTracePanel: React.FC<InflectionTracePanelProps> = ({
  result,
  dimensionLabels,
}) => {
  const { t } = useTranslation();
  const { diagnosis, conflicts, steps } = result;
  const provided = Object.entries(diagnosis.provided_dimensions);

  return (
    <div className="space-y-2 rounded-lg border border-base-300 bg-base-200/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1 font-medium">
          <GitBranch size={13} /> {t("grammar.morphologyV3.traceTitle")}
        </span>
        {provided.length > 0 && (
          <span className="font-mono text-base-content/60">
            {provided
              .map(([dimId, valId]) => dimensionLabels?.[`${dimId}:${valId}`] ?? `${dimId}=${valId}`)
              .join(" · ")}
          </span>
        )}
        <span className="font-mono font-bold text-primary">{result.surface_form}</span>
        <span className="font-mono text-base-content/60">{result.phonetic_ipa}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-base-content/60">{t("grammar.morphologyV3.resolvedClass")}:</span>
        {diagnosis.resolved_class_id ? (
          <span className={`${BADGE} badge-info badge-xs`}>
            {diagnosis.resolved_class_id}
            <span className="opacity-70">
              · {t(CLASS_SOURCE_KEYS[diagnosis.resolved_class_source])}
            </span>
          </span>
        ) : (
          <span className={`${BADGE} badge-ghost badge-xs`}>
            {t(CLASS_SOURCE_KEYS[diagnosis.resolved_class_source])}
          </span>
        )}
        {result.used_irregular && (
          <span className={`${BADGE} badge-warning badge-xs`}>
            {t("grammar.morphologyV3.stageIrregular")}
          </span>
        )}
      </div>

      {diagnosis.missing_obligatory_dimensions.length > 0 && (
        <div className="flex items-start gap-1.5 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning-content">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            {t("grammar.morphologyV3.missingDimensions")}:{" "}
            <span className="font-mono">
              {diagnosis.missing_obligatory_dimensions.join(", ")}
            </span>
          </span>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="space-y-1 rounded border border-error/40 bg-error/10 px-2 py-1 text-[11px]">
          <div className="flex items-center gap-1 font-medium text-error">
            <AlertTriangle size={12} /> {t("grammar.morphologyV3.conflictDetected")}
          </div>
          {conflicts.map((conflict, index) => (
            <div key={`${conflict.dimension_key}_${index}`} className="text-base-content/70">
              <span className="font-mono">{conflict.dimension_key}</span>
              {" → "}
              <span className="font-mono text-success">{conflict.winner_rule_id}</span>
              {" / "}
              {t("grammar.morphologyV3.conflictCandidates")}:{" "}
              <span className="font-mono">{conflict.candidate_rule_ids.join(", ")}</span>
              {conflict.reason ? ` · ${conflict.reason}` : ""}
            </div>
          ))}
        </div>
      )}

      <ol className="space-y-1">
        {steps.map((step, index) => (
          <li key={`${step.stage}_${index}`} className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={`${BADGE} badge-outline badge-xs`}>
              <Layers size={9} /> {t(STAGE_KEYS[step.stage])}
            </span>
            <span className="font-mono text-base-content/70">{step.label}</span>
            <span className="font-mono">
              {step.before} <span className="opacity-40">→</span>{" "}
              <span className="text-primary">{step.after}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};
