import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import { runQualityCheck } from "../../utils/qualityCheck";
import type { QCIssue } from "../../utils/qualityCheck";
import { ShieldCheck, Search, ExternalLink } from "lucide-react";
import { BTN_PRIMARY, BTN_GHOST, TOGGLE, BADGE } from "../../lib/ui";
import { PageHeader } from "../common/PageHeader";

interface QualityCheckProps {
  /** 点击词条链接后关闭弹窗的回调 */
  onNavigateToWord?: () => void;
}

type QCRuleKey =
  | "missingPos"
  | "unmappedSpelling"
  | "emptyIpa"
  | "patternMismatch"
  | "missingRequired"
  | "duplicateWord";
const RULE_KEYS: QCRuleKey[] = [
  "missingPos",
  "unmappedSpelling",
  "emptyIpa",
  "patternMismatch",
  "missingRequired",
  "duplicateWord",
];

export const QualityCheck: React.FC<QualityCheckProps> = ({
  onNavigateToWord,
}) => {
  const { t } = useTranslation();
  const wordsMap = useLexiconStore((s) => s.wordsMap);
  const setActiveWordId = useLexiconStore((s) => s.setActiveWordId);
  const phonoConfig = usePhonoStore((s) => s.config);
  const grammarConfig = useGrammarStore((s) => s.config);

  const [disabledRules, setDisabledRules] = useState<QCRuleKey[]>([]);
  const [issues, setIssues] = useState<QCIssue[] | null>(null);
  const [exceptions, setExceptions] = useState<Set<string>>(new Set()); // entry_id:rule

  const words = useMemo(() => Object.values(wordsMap), [wordsMap]);

  const toggleRule = (key: QCRuleKey) => {
    setDisabledRules((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleRun = () => {
    const result = runQualityCheck(
      words,
      phonoConfig,
      grammarConfig,
      disabledRules,
    );
    // 过滤掉已标记例外的
    setIssues(result.filter((i) => !exceptions.has(`${i.entry_id}:${i.rule}`)));
  };

  const markException = (issue: QCIssue) => {
    setExceptions((prev) =>
      new Set(prev).add(`${issue.entry_id}:${issue.rule}`),
    );
    setIssues(
      (prev) =>
        prev?.filter(
          (i) => !(i.entry_id === issue.entry_id && i.rule === issue.rule),
        ) ?? null,
    );
  };

  const navigateToWord = (entryId: string) => {
    setActiveWordId(entryId);
    onNavigateToWord?.();
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        icon={<ShieldCheck size={20} />}
        title={t("qc.title")}
        size="md"
      />
      {/* Rule toggles */}
      <div className="flex flex-wrap gap-3">
        {RULE_KEYS.map((key) => (
          <label
            key={key}
            className="flex items-center gap-1.5 text-sm cursor-pointer"
          >
            <input
              type="checkbox"
              checked={!disabledRules.includes(key)}
              onChange={() => toggleRule(key)}
              className={TOGGLE}
            />
            {t(`qc.rules.${key}`)}
          </label>
        ))}
      </div>

      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          {exceptions.size > 0 && (
            <span className="text-xs text-base-content/50">
              {exceptions.size} {t("qc.exceptions")}
            </span>
          )}
          <button onClick={handleRun} className={BTN_PRIMARY}>
            <Search size={16} /> {t("qc.runCheck")}
          </button>
        </div>
      </div>

      {/* No issues */}
      {issues !== null && issues.length === 0 && (
        <div className="text-center py-8 text-success">
          <ShieldCheck size={40} className="mx-auto mb-2" />
          <p>{t("qc.noIssues")}</p>
        </div>
      )}

      {/* Results table */}
      {issues !== null && issues.length > 0 && (
        <div>
          <p className="text-sm text-base-content/70 mb-2">
            {t("qc.issueCount", { count: issues.length })}
          </p>
          <div className="overflow-x-auto">
            <table className="table table-sm table-zebra">
              <thead>
                <tr>
                  <th>{t("lexicon.word")}</th>
                  <th>{t("qc.rule")}</th>
                  <th>{t("grammar.test.detail")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue, i) => (
                  <tr key={i}>
                    <td>
                      <button
                        onClick={() => navigateToWord(issue.entry_id)}
                        className="font-mono font-bold text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {issue.word} <ExternalLink size={12} />
                      </button>
                    </td>
                    <td>
                      <span
                        className={`${BADGE} badge-sm ${issue.severity === "error" ? "badge-error" : "badge-warning"}`}
                      >
                        {t(`qc.rules.${issue.rule}`)}
                      </span>
                    </td>
                    <td className="text-xs text-base-content/70 max-w-xs">
                      {issue.message}
                    </td>
                    <td>
                      <button
                        onClick={() => markException(issue)}
                        className={`${BTN_GHOST} text-xs`}
                        title={t("qc.markException")}
                      >
                        {t("qc.ignore")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
