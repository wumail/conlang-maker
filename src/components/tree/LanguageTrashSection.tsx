import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArchiveRestore, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type {
  RestoreLanguageResult,
  TrashedLanguageEntry,
} from "../../types";
import {
  flushAllDomainStores,
  useWorkspaceStore,
} from "../../store/workspaceStore";
import {
  generateOperationId,
  isConflictError,
  recordGuiOperationId,
} from "../../store/conflictStore";
import { reloadAllActiveStoresAndFonts } from "../../utils/externalChanges";
import { ModalPortal } from "../common/ModalPortal";
import { BADGE, BTN_GHOST, BTN_PRIMARY } from "../../lib/ui";
import { formatSnapshotTimestamp } from "./snapshotHelpers";

interface LanguageTrashSectionProps {
  trashItems: TrashedLanguageEntry[];
  onRestored: () => Promise<void>;
}

export const LanguageTrashSection: React.FC<LanguageTrashSectionProps> = ({
  trashItems,
  onRestored,
}) => {
  const { t } = useTranslation();
  const { projectPath, conlangFilePath } = useWorkspaceStore();

  const [previewTarget, setPreviewTarget] =
    useState<TrashedLanguageEntry | null>(null);
  const [previewResult, setPreviewResult] =
    useState<RestoreLanguageResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openRestorePreview = async (
    entry: TrashedLanguageEntry,
  ): Promise<void> => {
    setPreviewTarget(entry);
    setPreviewResult(null);
    setError(null);
    setBusy(true);
    try {
      const res = await invoke<RestoreLanguageResult>("restore_language", {
        projectPath,
        conlangFilePath,
        trashId: entry.trash_id,
        dryRun: true,
      });
      setPreviewResult(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmRestore = async (): Promise<void> => {
    if (!previewTarget) return;
    setBusy(true);
    setError(null);
    try {
      await flushAllDomainStores();
      const opId = generateOperationId();
      recordGuiOperationId(opId);
      await invoke<RestoreLanguageResult>("restore_language", {
        projectPath,
        conlangFilePath,
        trashId: previewTarget.trash_id,
        dryRun: false,
        expectedRevision: useWorkspaceStore.getState().revision,
        operationId: opId,
      });
      setPreviewTarget(null);
      setPreviewResult(null);
      await reloadAllActiveStoresAndFonts();
      await onRestored();
    } catch (err) {
      if (isConflictError(err)) {
        await useWorkspaceStore
          .getState()
          .triggerExternalConflict(conlangFilePath);
      }
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const hasConflicts = Boolean(
    previewResult && previewResult.conflicts.length > 0,
  );

  return (
    <div className="space-y-2 pt-2 border-t border-base-300">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm flex items-center gap-1.5">
          <Trash2 className="w-4 h-4 text-base-content/70" />
          {t("snapshots.trashTitle")}
          {trashItems.length > 0 && (
            <span className={`${BADGE} badge-ghost`}>{trashItems.length}</span>
          )}
        </h4>
      </div>

      {trashItems.length === 0 ? (
        <p className="text-xs text-base-content/50 py-2">
          {t("snapshots.trashEmpty")}
        </p>
      ) : (
        <div
          className="bg-base-200/40 rounded-lg border border-base-300 divide-y divide-base-300 max-h-48 overflow-y-auto"
          data-testid="language-trash-list"
        >
          {trashItems.map((item) => (
            <div
              key={item.trash_id}
              className="p-2.5 flex items-center justify-between gap-2 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm flex items-center gap-2">
                  <span>{item.name}</span>
                  <span className="font-mono text-xs text-base-content/50">
                    ({item.language_id})
                  </span>
                </div>
                <div className="text-base-content/50 truncate">
                  {formatSnapshotTimestamp(item.deleted_at)} •{" "}
                  {item.original_path}
                </div>
              </div>
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={() => void openRestorePreview(item)}
                data-testid={`restore-trash-${item.trash_id}`}
              >
                <ArchiveRestore className="w-3.5 h-3.5" />
                {t("snapshots.restoreLanguage")}
              </button>
            </div>
          ))}
        </div>
      )}

      <ModalPortal open={Boolean(previewTarget)}>
        {previewTarget && (
          <div className="modal modal-open z-50">
            <div className="modal-box max-w-md space-y-3">
              <h3 className="font-bold text-base flex items-center gap-2">
                <ArchiveRestore className="w-4 h-4 text-primary" />
                {t("snapshots.restoreConfirmTitle")}
              </h3>
              <p className="text-xs text-base-content/80">
                {t("snapshots.restoreConfirmDesc", {
                  name: previewTarget.name,
                  path: previewTarget.original_path,
                })}
              </p>

              {error && (
                <div className="alert alert-error py-2 px-3 text-xs">
                  <span>{error}</span>
                </div>
              )}

              {hasConflicts && previewResult && (
                <div className="alert alert-warning py-2 px-3 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {t("snapshots.restoreConflicts")}
                  </div>
                  <ul className="list-disc list-inside">
                    {previewResult.conflicts.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="modal-action">
                <button
                  type="button"
                  className={BTN_GHOST}
                  disabled={busy}
                  onClick={() => setPreviewTarget(null)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={busy || hasConflicts || !previewResult}
                  onClick={() => void confirmRestore()}
                  data-testid="confirm-restore-language"
                >
                  <ArchiveRestore className="w-4 h-4" />
                  {busy ? t("common.loading") : t("snapshots.restoreLanguage")}
                </button>
              </div>
            </div>
          </div>
        )}
      </ModalPortal>
    </div>
  );
};
