/**
 * PendingSuggestionsPanel.tsx — 自动标注待确认建议面板（Roadmap v3 拆分）
 */
import React from "react";
import { useTranslation } from "react-i18next";
import type { PendingSuggestion } from "../../core/workflows/autoGloss";

interface PendingSuggestionsPanelProps {
  suggestions: PendingSuggestion[];
  onApplyAll: () => void;
  onApplyOne: (suggestion: PendingSuggestion) => void;
  onDismiss: () => void;
}

export const PendingSuggestionsPanel: React.FC<PendingSuggestionsPanelProps> = ({
  suggestions,
  onApplyAll,
  onApplyOne,
  onDismiss,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">
          {t("corpus.pendingSuggestionsTitle", { count: suggestions.length })}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm btn-ghost" onClick={onDismiss}>
            {t("common.close")}
          </button>
          <button className="btn btn-sm btn-primary btn-soft" onClick={onApplyAll}>
            {t("corpus.applyAllSuggestions")}
          </button>
        </div>
      </div>
      <div className="max-h-52 overflow-auto rounded border border-base-300 bg-base-100">
        <table className="table table-xs w-full">
          <thead>
            <tr>
              <th>{t("corpus.suggestionToken")}</th>
              <th>{t("corpus.suggestionValue")}</th>
              <th>{t("corpus.suggestionConfidence")}</th>
              <th>{t("corpus.suggestionTrace")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {suggestions.map((suggestion) => (
              <tr key={`${suggestion.lineId}_${suggestion.tokenId}`}>
                <td className="font-mono">{suggestion.surfaceForm}</td>
                <td className="font-mono text-xs">{suggestion.suggestion.morphemeBreak}</td>
                <td>{Math.round(suggestion.suggestion.confidence * 100)}%</td>
                <td className="text-base-content/60">{suggestion.suggestion.trace}</td>
                <td>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => onApplyOne(suggestion)}
                  >
                    {t("corpus.applySuggestion")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
