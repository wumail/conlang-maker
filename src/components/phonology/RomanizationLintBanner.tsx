import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { RomanizationAnalysisResult } from "../../core/engines/romanizationLint";
import { BADGE } from "../../lib/ui";

interface RomanizationLintBannerProps {
  analysis: RomanizationAnalysisResult;
}

/**
 * 把分析结果压缩为「map_id::rule_id → 诊断条数」索引，供规则表行内高亮使用。
 * 键必须带上 map_id：分析覆盖全部映射表，不同表可能出现相同 rule_id。
 */
export function buildRuleLintIndex(
  analysis: RomanizationAnalysisResult,
): Map<string, number> {
  const index = new Map<string, number>();
  const bump = (mapId: string, ruleId: string): void => {
    if (!ruleId) return;
    const key = `${mapId}::${ruleId}`;
    index.set(key, (index.get(key) ?? 0) + 1);
  };

  for (const issue of analysis.shadowed_rules) {
    bump(issue.map_id, issue.shadowed_rule_id);
  }
  for (const issue of analysis.unknown_output_phonemes) {
    bump(issue.map_id, issue.rule_id);
  }
  for (const issue of analysis.case_issues) {
    bump(issue.map_id, issue.rule_id);
  }
  for (const issue of analysis.conflicting_rules) {
    for (const rule of issue.rules) bump(issue.map_id, rule.rule_id);
  }
  for (const issue of analysis.duplicate_rules) {
    for (const ruleId of issue.rule_ids) bump(issue.map_id, ruleId);
  }
  return index;
}

/** 罗马化映射表的静态诊断条：健康时收起为绿色徽章，异常时展开明细 */
export const RomanizationLintBanner: React.FC<RomanizationLintBannerProps> = ({
  analysis,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const summary = analysis.summary;

  if (summary.total_rules === 0) return null;

  if (summary.issue_count === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
        <CheckCircle2 size={16} />
        {t("phonology.romanization.lint.healthy")}
      </div>
    );
  }

  const chips: { key: string; count: number }[] = [
    { key: "phonology.romanization.lint.shadowed", count: summary.shadowed_rules },
    { key: "phonology.romanization.lint.unreachable", count: summary.unreachable_phonemes },
    { key: "phonology.romanization.lint.unknownOutput", count: summary.unknown_output_phonemes },
    { key: "phonology.romanization.lint.conflict", count: summary.conflicting_rules },
    { key: "phonology.romanization.lint.duplicate", count: summary.duplicate_rules },
    { key: "phonology.romanization.lint.case", count: summary.case_issues },
  ].filter((chip) => chip.count > 0);

  return (
    <div className="rounded-lg border border-warning/50 bg-warning/10">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-warning-content"
      >
        <AlertTriangle size={16} className="shrink-0" />
        <span className="shrink-0">
          {t("phonology.romanization.lint.issueCount", {
            count: summary.issue_count,
          })}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {chips.map((chip) => (
            <span key={chip.key} className={`${BADGE} badge-warning badge-sm`}>
              {t(chip.key)} {chip.count}
            </span>
          ))}
        </span>
        <span className="ml-auto shrink-0 opacity-70">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-warning/30 px-3 py-2 text-xs">
          {analysis.shadowed_rules.length > 0 && (
            <section>
              <h4 className="mb-1 font-semibold text-base-content/80">
                {t("phonology.romanization.lint.shadowed")}
              </h4>
              <ul className="space-y-0.5 font-mono text-base-content/70">
                {analysis.shadowed_rules.map((issue) => (
                  <li key={`${issue.map_id}:${issue.shadowed_rule_id}`}>
                    <span className="text-warning">▲</span> `{issue.shadowed_input}`{" "}
                    {t("phonology.romanization.lint.shadowedBy", {
                      rule: issue.shadowed_by_input,
                    })}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {analysis.unreachable_phonemes.length > 0 && (
            <section>
              <h4 className="mb-1 font-semibold text-base-content/80">
                {t("phonology.romanization.lint.unreachable")}
              </h4>
              <p className="font-mono text-base-content/70">
                {analysis.unreachable_phonemes
                  .map((issue) => `/${issue.phoneme}/`)
                  .join("  ")}
              </p>
            </section>
          )}

          {analysis.unknown_output_phonemes.length > 0 && (
            <section>
              <h4 className="mb-1 font-semibold text-base-content/80">
                {t("phonology.romanization.lint.unknownOutput")}
              </h4>
              <ul className="space-y-0.5 font-mono text-base-content/70">
                {analysis.unknown_output_phonemes.map((issue) => (
                  <li key={`${issue.map_id}:${issue.rule_id}`}>
                    <span className="text-warning">▲</span> `{issue.input}` →{" "}
                    {issue.unknown_tokens.join(" ")}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(analysis.conflicting_rules.length > 0 ||
            analysis.duplicate_rules.length > 0 ||
            analysis.case_issues.length > 0) && (
            <section>
              <h4 className="mb-1 font-semibold text-base-content/80">
                {t("phonology.romanization.lint.more")}
              </h4>
              <p className="text-base-content/70">
                {t("phonology.romanization.lint.moreDetail", {
                  conflict: analysis.conflicting_rules.length,
                  duplicate: analysis.duplicate_rules.length,
                  case: analysis.case_issues.length,
                })}
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
