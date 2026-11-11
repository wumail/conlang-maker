import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileDiff,
  HardDriveDownload,
  Save,
} from "lucide-react";
import type { TFunction } from "i18next";
import { ModalPortal } from "./ModalPortal";
import { useConflictStore } from "../../store/conflictStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { ConflictResourceKind } from "../../types";
import {
  BADGE,
  BTN_GHOST,
  BTN_OUTLINE_ERROR,
  BTN_PRIMARY,
} from "../../lib/ui";

function renderKindLabel(t: TFunction, kind: ConflictResourceKind): string {
  switch (kind) {
    case "workspace":
      return t("conflict.kindWorkspace");
    case "phonology":
      return t("conflict.kindPhonology");
    case "lexicon":
      return t("conflict.kindLexicon");
    case "grammar":
      return t("conflict.kindGrammar");
    case "sca":
      return t("conflict.kindSca");
    case "corpus":
      return t("conflict.kindCorpus");
    case "font":
      return t("conflict.kindFont");
    case "registry":
      return t("conflict.kindRegistry");
  }
}

export const ExternalConflictModal: React.FC = () => {
  const { t } = useTranslation();
  const conflicts = useConflictStore((s) => s.conflicts);
  const resolvingKey = useConflictStore((s) => s.resolvingKey);
  const resolveError = useConflictStore((s) => s.resolveError);
  const resolveKeepLocal = useConflictStore((s) => s.resolveKeepLocal);
  const resolveUseDisk = useConflictStore((s) => s.resolveUseDisk);
  const languages = useWorkspaceStore((s) => s.config.languages);

  const [showDiff, setShowDiff] = useState(false);

  const active = conflicts[0] ?? null;
  const isBusy = Boolean(active && resolvingKey === active.key);
  const langLabel = active
    ? (languages.find(
        (l) =>
          l.language_id === active.languageId || l.path === active.languagePath,
      )?.name ??
      active.languageId ??
      active.languagePath)
    : null;

  const handleUseDisk = async (): Promise<void> => {
    if (!active) return;
    await resolveUseDisk(active.key);
    setShowDiff(false);
  };

  const handleKeepLocal = async (): Promise<void> => {
    if (!active) return;
    await resolveKeepLocal(active.key);
    setShowDiff(false);
  };

  return (
    <ModalPortal open={Boolean(active)}>
      {active && (
        <div
          className="modal modal-open z-50"
          data-testid="external-conflict-modal"
        >
          <div className="modal-box max-w-2xl border border-warning/40 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-warning">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="font-bold text-base text-base-content">
                  {t("conflict.title")}
                </h3>
              </div>
              {conflicts.length > 1 && (
                <span className={`${BADGE} badge-warning`}>
                  {t("conflict.queueCount", { count: conflicts.length })}
                </span>
              )}
            </div>

            <p className="text-sm text-base-content/80">
              {t("conflict.description")}
            </p>

            <div className="bg-base-200/60 rounded-lg p-3 text-xs space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {t("conflict.resourceLabel")}:
                </span>
                <span className={`${BADGE} badge-primary badge-outline`}>
                  {renderKindLabel(t, active.kind)}
                </span>
                <span className={`${BADGE} badge-secondary badge-outline uppercase`}>
                  {active.origin}
                </span>
                {langLabel && (
                  <span className={`${BADGE} badge-ghost font-mono`}>
                    {langLabel}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-4 text-base-content/60 font-mono">
                <span>
                  {t("conflict.diskRevision")}:{" "}
                  {active.diskRevision.slice(0, 12)}
                </span>
              </div>
              {active.changedFields.length > 0 && (
                <div className="pt-1">
                  <span className="font-semibold text-base-content/70">
                    {t("conflict.changedFields")}:{" "}
                  </span>
                  <span className="font-mono text-warning">
                    {active.changedFields.join(", ")}
                  </span>
                </div>
              )}
            </div>

            {resolveError && (
              <div className="alert alert-error py-2 px-3 text-xs">
                <span>{resolveError}</span>
              </div>
            )}

            <div>
              <button
                type="button"
                className={BTN_GHOST}
                onClick={() => setShowDiff((v) => !v)}
                data-testid="conflict-toggle-diff"
              >
                <FileDiff className="w-4 h-4" />
                {t("conflict.viewDiff")}
                {showDiff ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>

              {showDiff && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-primary">
                      {t("conflict.localVersion")}
                    </div>
                    <pre className="bg-base-200 rounded p-2 text-[11px] font-mono max-h-56 overflow-auto whitespace-pre-wrap break-all">
                      {active.localPreview}
                    </pre>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-secondary">
                      {t("conflict.diskVersion")}
                    </div>
                    <pre className="bg-base-200 rounded p-2 text-[11px] font-mono max-h-56 overflow-auto whitespace-pre-wrap break-all">
                      {active.diskPreview}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-action flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                className={BTN_OUTLINE_ERROR}
                disabled={isBusy}
                onClick={() => void handleUseDisk()}
                data-testid="conflict-use-disk"
              >
                <HardDriveDownload className="w-4 h-4" />
                {t("conflict.useDisk")}
              </button>
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={isBusy}
                onClick={() => void handleKeepLocal()}
                data-testid="conflict-keep-local"
              >
                <Save className="w-4 h-4" />
                {t("conflict.keepLocal")}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalPortal>
  );
};
