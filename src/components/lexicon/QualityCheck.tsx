import React, { useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import {
  QC_RULE_KEYS,
  runQualityCheck,
  type QCIssue,
  type QCRuleKey,
} from "../../utils/qualityCheck";
import { ShieldCheck, Search, ExternalLink } from "lucide-react";
import { BTN_PRIMARY, BTN_GHOST, TOGGLE, BADGE } from "../../lib/ui";
import { PageHeader } from "../common/PageHeader";
import { useQcRuleLabels } from "../../lib/labelMaps";

interface QualityCheckProps {
  /** 点击词条链接后关闭弹窗的回调 */
  onNavigateToWord?: () => void;
}

const ISSUE_GRID =
  "grid grid-cols-[minmax(0,1fr)_130px_minmax(0,2fr)_70px] gap-2 items-center";

export const QualityCheck: React.FC<QualityCheckProps> = ({ onNavigateToWord }) => {
  const { t } = useTranslation();
  const ruleLabels = useQcRuleLabels();
  const wordsMap = useLexiconStore((s) => s.wordsMap);
  const setActiveWordId = useLexiconStore((s) => s.setActiveWordId);
  const phonoConfig = usePhonoStore((s) => s.config);
  const grammarConfig = useGrammarStore((s) => s.config);

  const [disabledRules, setDisabledRules] = useState<QCRuleKey[]>([]);
  const [issues, setIssues] = useState<QCIssue[] | null>(null);
  const [exceptions, setExceptions] = useState<Set<string>>(new Set());

  const words = useMemo(() => Object.values(wordsMap), [wordsMap]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: issues?.length ?? 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  const toggleRule = (key: QCRuleKey) => {
    setDisabledRules((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  };

  const handleRun = () => {
    const result = runQualityCheck(words, phonoConfig, grammarConfig, disabledRules);
    setIssues(result.filter((issue) => !exceptions.has(`${issue.entry_id}:${issue.rule}`)));
  };

  const markException = (issue: QCIssue) => {
    setExceptions((prev) => new Set(prev).add(`${issue.entry_id}:${issue.rule}`));
    setIssues(
      (prev) =>
        prev?.filter(
          (item) => !(item.entry_id === issue.entry_id && item.rule === issue.rule),
        ) ?? null,
    );
  };

  const navigateToWord = (entryId: string) => {
    setActiveWordId(entryId);
    onNavigateToWord?.();
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader icon={<ShieldCheck size={20} />} title={t("qc.title")} size="md" />

      <div className="flex flex-wrap gap-3">
        {QC_RULE_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={!disabledRules.includes(key)}
              onChange={() => toggleRule(key)}
              className={TOGGLE}
            />
            {ruleLabels[key] ?? key}
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

      {issues !== null && issues.length === 0 && (
        <div className="text-center py-8 text-success">
          <ShieldCheck size={40} className="mx-auto mb-2" />
          <p>{t("qc.noIssues")}</p>
        </div>
      )}

      {issues !== null && issues.length > 0 && (
        <div>
          <p className="text-sm text-base-content/70 mb-2">
            {t("qc.issueCount", { count: issues.length })}
          </p>
          <div className={`${ISSUE_GRID} px-2 pb-1 text-xs font-semibold text-base-content/60`}>
            <div>{t("lexicon.word")}</div>
            <div>{t("qc.rule")}</div>
            <div>{t("grammar.test.detail")}</div>
            <div />
          </div>
          <div ref={listRef} className="max-h-[60vh] overflow-y-auto contain-strict">
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const issue = issues[virtualRow.index];
                if (!issue) return null;
                return (
                  <div
                    key={`${issue.entry_id}-${issue.rule}-${virtualRow.index}`}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div className={`${ISSUE_GRID} pb-1 px-2 py-1 border-b border-base-200`}>
                      <button
                        onClick={() => navigateToWord(issue.entry_id)}
                        className="font-mono font-bold text-primary hover:underline inline-flex items-center gap-1 truncate"
                      >
                        {issue.word} <ExternalLink size={12} />
                      </button>
                      <span
                        className={`${BADGE} badge-sm ${issue.severity === "error" ? "badge-error" : "badge-warning"}`}
                      >
                        {ruleLabels[issue.rule] ?? issue.rule}
                      </span>
                      <span className="text-xs text-base-content/70 truncate">
                        {issue.message}
                      </span>
                      <button
                        onClick={() => markException(issue)}
                        className={`${BTN_GHOST} text-xs`}
                        title={t("qc.markException")}
                      >
                        {t("qc.ignore")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
