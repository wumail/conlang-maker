import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, FileDiff, RotateCcw, ShieldCheck } from "lucide-react";
import type { SnapshotDiffSummary, SnapshotSummary } from "../../types";
import { ModalPortal } from "../common/ModalPortal";
import { BADGE, BTN_GHOST, BTN_PRIMARY } from "../../lib/ui";

interface SnapshotRollbackModalProps {
  target: SnapshotSummary | null;
  diff: SnapshotDiffSummary | null;
  loadingDiff: boolean;
  rollingBack: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const SnapshotRollbackModal: React.FC<SnapshotRollbackModalProps> = ({
  target,
  diff,
  loadingDiff,
  rollingBack,
  error,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const hasConflicts = Boolean(diff && diff.conflicts.length > 0);

  return (
    <ModalPortal open={Boolean(target)}>
      {target && (
        <div
          className="modal modal-open z-50"
          data-testid="snapshot-rollback-modal"
        >
          <div className="modal-box max-w-xl space-y-4">
            <h3 className="font-bold text-base flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-primary" />
              {t("snapshots.previewTitle")}
            </h3>

            <div className="bg-base-200/60 rounded-lg p-3 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`${BADGE} badge-primary`}>{target.scope}</span>
                <span className={`${BADGE} badge-ghost uppercase`}>
                  {target.origin}
                </span>
                <span className="font-mono text-base-content/60">
                  #{target.snapshot_id.slice(0, 8)}
                </span>
              </div>
              <div className="font-medium text-sm pt-1">
                {target.description || target.operation_type}
              </div>
            </div>

            <div className="alert alert-info alert-soft py-2 px-3 text-xs flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>{t("snapshots.nonDestructiveHint")}</span>
            </div>

            {loadingDiff && (
              <div className="py-4 text-center text-xs text-base-content/60">
                <span className="loading loading-spinner loading-sm mr-2" />
                {t("common.loading")}
              </div>
            )}

            {error && (
              <div className="alert alert-error py-2 px-3 text-xs">
                <span>{error}</span>
              </div>
            )}

            {diff && !loadingDiff && (
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-base-content/80">
                  <FileDiff className="w-4 h-4" />
                  {t("snapshots.diffSummary")}
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded border border-base-300 bg-base-200/40 p-2">
                    <div className="text-base font-bold text-warning">
                      {diff.changed_files.length}
                    </div>
                    <div className="text-[11px] text-base-content/60">
                      {t("snapshots.changedFiles")}
                    </div>
                  </div>
                  <div className="rounded border border-base-300 bg-base-200/40 p-2">
                    <div className="text-base font-bold text-success">
                      {diff.added_files.length}
                    </div>
                    <div className="text-[11px] text-base-content/60">
                      {t("snapshots.addedFiles")}
                    </div>
                  </div>
                  <div className="rounded border border-base-300 bg-base-200/40 p-2">
                    <div className="text-base font-bold text-error">
                      {diff.removed_files.length}
                    </div>
                    <div className="text-[11px] text-base-content/60">
                      {t("snapshots.removedFiles")}
                    </div>
                  </div>
                </div>

                {(diff.changed_files.length > 0 ||
                  diff.added_files.length > 0 ||
                  diff.removed_files.length > 0) && (
                  <div className="max-h-40 overflow-y-auto rounded border border-base-300 bg-base-200/30 p-2 font-mono text-[11px] space-y-0.5">
                    {diff.changed_files.map((f) => (
                      <div key={`m:${f}`} className="text-warning">
                        ~ {f}
                      </div>
                    ))}
                    {diff.added_files.map((f) => (
                      <div key={`a:${f}`} className="text-success">
                        + {f}
                      </div>
                    ))}
                    {diff.removed_files.map((f) => (
                      <div key={`d:${f}`} className="text-error">
                        - {f}
                      </div>
                    ))}
                  </div>
                )}

                {hasConflicts && (
                  <div className="alert alert-warning py-2 px-3 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      {t("snapshots.rollbackConflicts")}
                    </div>
                    <ul className="list-disc list-inside">
                      {diff.conflicts.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="modal-action">
              <button
                type="button"
                className={BTN_GHOST}
                disabled={rollingBack}
                onClick={onCancel}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={loadingDiff || rollingBack || hasConflicts}
                onClick={onConfirm}
                data-testid="confirm-snapshot-rollback"
              >
                <RotateCcw className="w-4 h-4" />
                {rollingBack
                  ? t("common.loading")
                  : t("snapshots.confirmRollback")}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalPortal>
  );
};
