import React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Camera, RotateCcw } from "lucide-react";
import type { LanguageEntry, SnapshotSummary } from "../../types";
import { BADGE, BTN_GHOST, BTN_PRIMARY, INPUT, SELECT } from "../../lib/ui";
import {
  formatSnapshotTimestamp,
  LANGUAGE_SNAPSHOT_SCOPES,
  type LanguageSnapshotScope,
  type ManualSnapshotTarget,
  type SnapshotScopeFilter,
} from "./snapshotHelpers";

function renderLanguageScopeLabel(
  t: TFunction,
  scope: LanguageSnapshotScope,
): string {
  switch (scope) {
    case "lexicon":
      return t("snapshots.scope_lexicon");
    case "phonology":
      return t("snapshots.scope_phonology");
    case "grammar":
      return t("snapshots.scope_grammar");
    case "sca":
      return t("snapshots.scope_sca");
    case "corpus":
      return t("snapshots.scope_corpus");
    case "font":
      return t("snapshots.scope_font");
  }
}

interface SnapshotListSectionProps {
  languages: LanguageEntry[];
  langNameMap: Map<string, string>;
  manualScope: ManualSnapshotTarget;
  onManualScopeChange: (next: ManualSnapshotTarget) => void;
  manualDesc: string;
  onManualDescChange: (next: string) => void;
  creating: boolean;
  onCreateSnapshot: () => void;
  scopeFilter: SnapshotScopeFilter;
  onScopeFilterChange: (next: SnapshotScopeFilter) => void;
  langFilter: string;
  onLangFilterChange: (next: string) => void;
  filteredSnapshots: SnapshotSummary[];
  onPreviewRollback: (snap: SnapshotSummary) => void;
}

export const SnapshotListSection: React.FC<SnapshotListSectionProps> = ({
  languages,
  langNameMap,
  manualScope,
  onManualScopeChange,
  manualDesc,
  onManualDescChange,
  creating,
  onCreateSnapshot,
  scopeFilter,
  onScopeFilterChange,
  langFilter,
  onLangFilterChange,
  filteredSnapshots,
  onPreviewRollback,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="bg-base-200/40 rounded-lg border border-base-300 p-3 flex flex-wrap items-center gap-2">
        <select
          className={`${SELECT} select-sm`}
          value={manualScope}
          onChange={(e) =>
            onManualScopeChange(e.target.value as ManualSnapshotTarget)
          }
          data-testid="snapshot-create-scope"
        >
          <option value="project">{t("snapshots.scopeProject")}</option>
          {LANGUAGE_SNAPSHOT_SCOPES.map((sc) => (
            <option key={sc} value={sc}>
              {renderLanguageScopeLabel(t, sc)}
            </option>
          ))}
        </select>
        <input
          className={`${INPUT} input-sm flex-1 min-w-44`}
          placeholder={t("snapshots.descriptionPlaceholder")}
          value={manualDesc}
          onChange={(e) => onManualDescChange(e.target.value)}
          data-testid="snapshot-create-desc"
        />
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={creating}
          onClick={onCreateSnapshot}
          data-testid="snapshot-create-btn"
        >
          <Camera className="w-4 h-4" />
          {creating ? t("common.loading") : t("snapshots.createBtn")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${SELECT} select-sm`}
          value={scopeFilter}
          onChange={(e) =>
            onScopeFilterChange(e.target.value as SnapshotScopeFilter)
          }
          data-testid="snapshot-filter-scope"
        >
          <option value="all">{t("snapshots.filterAllScopes")}</option>
          <option value="project">{t("snapshots.scopeProject")}</option>
          {LANGUAGE_SNAPSHOT_SCOPES.map((sc) => (
            <option key={sc} value={sc}>
              {renderLanguageScopeLabel(t, sc)}
            </option>
          ))}
        </select>
        <select
          className={`${SELECT} select-sm`}
          value={langFilter}
          onChange={(e) => onLangFilterChange(e.target.value)}
        >
          <option value="all">{t("snapshots.filterAllLanguages")}</option>
          <option value="__project__">{t("snapshots.scopeProject")}</option>
          {languages.map((l) => (
            <option key={l.language_id} value={l.language_id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-base-200/50 rounded-lg border border-base-300 max-h-72 overflow-y-auto">
        {filteredSnapshots.length === 0 ? (
          <div className="p-6 text-center text-base-content/50 text-sm">
            {t("tree.noSnapshots")}
          </div>
        ) : (
          <div className="divide-y divide-base-300" data-testid="snapshot-list">
            {filteredSnapshots.map((entry) => (
              <div
                key={`${entry.level}:${entry.language_id ?? "proj"}:${entry.snapshot_id}`}
                className="p-3 flex items-center justify-between gap-3 hover:bg-base-200 transition-colors"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`${BADGE} ${
                        entry.level === "project"
                          ? "badge-secondary"
                          : "badge-primary"
                      }`}
                    >
                      {entry.scope}
                    </span>
                    <span className={`${BADGE} badge-outline uppercase`}>
                      {entry.origin}
                    </span>
                    {entry.language_id && (
                      <span className={`${BADGE} badge-ghost`}>
                        {langNameMap.get(entry.language_id) ?? entry.language_id}
                      </span>
                    )}
                    {entry.restored_from && (
                      <span className={`${BADGE} badge-info badge-outline`}>
                        {t("snapshots.restoredFromBadge", {
                          id: entry.restored_from.slice(0, 6),
                        })}
                      </span>
                    )}
                    {entry.archived_language && (
                      <span className={`${BADGE} badge-warning badge-outline`}>
                        {t("snapshots.archivedBadge")}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-medium truncate">
                    {entry.description || entry.operation_type}
                  </div>
                  <div className="text-xs text-base-content/50">
                    {formatSnapshotTimestamp(entry.timestamp)} •{" "}
                    {entry.operation_type}
                  </div>
                </div>
                <button
                  type="button"
                  className={BTN_GHOST}
                  onClick={() => onPreviewRollback(entry)}
                  title={t("tree.rollbackHere")}
                  data-testid={`preview-rollback-${entry.snapshot_id}`}
                >
                  <RotateCcw className="w-4 h-4" />
                  {t("snapshots.previewBtn")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
