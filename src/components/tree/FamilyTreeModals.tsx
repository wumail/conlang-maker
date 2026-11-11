import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, GitFork, Plus } from "lucide-react";
import type { LanguageEntry } from "../../types";
import { ModalPortal } from "../common/ModalPortal";
import { PullSync } from "./PullSync";
import { BorrowingPanel } from "./BorrowingPanel";
import { SnapshotManager } from "./SnapshotManager";
import {
  BTN_GHOST,
  BTN_OUTLINE_ERROR,
  BTN_PRIMARY,
  INPUT,
} from "../../lib/ui";

interface FamilyTreeModalsProps {
  languages: LanguageEntry[];
  showPullSync: boolean;
  onClosePullSync: () => void;
  showBorrowing: boolean;
  onCloseBorrowing: () => void;
  showSnapshots: boolean;
  onCloseSnapshots: () => void;
  showForkModal: boolean;
  forkParentId: string | null;
  newLangName: string;
  onNewLangNameChange: (next: string) => void;
  onCloseFork: () => void;
  onConfirmFork: () => void;
  deleteTarget: LanguageEntry | null;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
  showCreateRoot: boolean;
  newRootName: string;
  onNewRootNameChange: (next: string) => void;
  onCloseCreateRoot: () => void;
  onConfirmCreateRoot: () => void;
}

export const FamilyTreeModals: React.FC<FamilyTreeModalsProps> = ({
  languages,
  showPullSync,
  onClosePullSync,
  showBorrowing,
  onCloseBorrowing,
  showSnapshots,
  onCloseSnapshots,
  showForkModal,
  forkParentId,
  newLangName,
  onNewLangNameChange,
  onCloseFork,
  onConfirmFork,
  deleteTarget,
  onCloseDelete,
  onConfirmDelete,
  showCreateRoot,
  newRootName,
  onNewRootNameChange,
  onCloseCreateRoot,
  onConfirmCreateRoot,
}) => {
  const { t } = useTranslation();
  const anyOpen =
    showPullSync ||
    showBorrowing ||
    showSnapshots ||
    showForkModal ||
    Boolean(deleteTarget) ||
    showCreateRoot;

  return (
    <ModalPortal open={anyOpen}>
      <>
        {showPullSync && (
          <div className="modal modal-open">
            <div className="modal-box max-w-lg">
              <PullSync />
              <div className="modal-action">
                <button className={BTN_GHOST} onClick={onClosePullSync}>
                  {t("common.close")}
                </button>
              </div>
            </div>
          </div>
        )}

        {showBorrowing && (
          <div className="modal modal-open">
            <div className="modal-box max-w-2xl">
              <BorrowingPanel />
              <div className="modal-action">
                <button className={BTN_GHOST} onClick={onCloseBorrowing}>
                  {t("common.close")}
                </button>
              </div>
            </div>
          </div>
        )}

        {showSnapshots && (
          <div className="modal modal-open">
            <div className="modal-box max-w-3xl">
              <SnapshotManager />
              <div className="modal-action mt-2">
                <button className={BTN_GHOST} onClick={onCloseSnapshots}>
                  {t("common.close")}
                </button>
              </div>
            </div>
          </div>
        )}

        {showForkModal && (
          <div className="modal modal-open">
            <div className="modal-box">
              <h3 className="font-bold text-lg">{t("tree.forkTitle")}</h3>
              <p className="py-2 text-sm text-base-content/60">
                {t("tree.forkFrom")}:{" "}
                {languages.find((l) => l.language_id === forkParentId)?.name}
              </p>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">{t("tree.newLangName")}</span>
                </label>
                <input
                  className={`${INPUT} w-full`}
                  value={newLangName}
                  onChange={(e) => onNewLangNameChange(e.target.value)}
                  placeholder={t("tree.newLangNamePlaceholder")}
                />
              </div>
              <div className="modal-action">
                <button className={BTN_GHOST} onClick={onCloseFork}>
                  {t("common.close")}
                </button>
                <button
                  className={BTN_PRIMARY}
                  onClick={onConfirmFork}
                  disabled={!newLangName.trim()}
                >
                  <GitFork className="w-4 h-4" /> {t("tree.fork")}
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteTarget && (
          <div className="modal modal-open">
            <div className="modal-box">
              <h3 className="font-bold text-lg flex items-center gap-2 text-error">
                <AlertTriangle size={20} /> {t("tree.deleteConfirmTitle")}
              </h3>
              <p className="py-3 text-sm text-base-content/70">
                {t("tree.deleteConfirmMsg", { name: deleteTarget.name })}
              </p>
              <div className="modal-action">
                <button className={BTN_GHOST} onClick={onCloseDelete}>
                  {t("common.close")}
                </button>
                <button className={BTN_OUTLINE_ERROR} onClick={onConfirmDelete}>
                  {t("tree.confirmDelete")}
                </button>
              </div>
            </div>
          </div>
        )}

        {showCreateRoot && (
          <div className="modal modal-open">
            <div className="modal-box">
              <h3 className="font-bold text-lg">{t("tree.createRoot")}</h3>
              <div className="form-control mt-3">
                <label className="label mb-3">
                  <span className="label-text">{t("tree.newLangName")}</span>
                </label>
                <input
                  className={`${INPUT} w-full`}
                  value={newRootName}
                  onChange={(e) => onNewRootNameChange(e.target.value)}
                  placeholder={t("tree.newLangNamePlaceholder")}
                />
              </div>
              <div className="modal-action">
                <button className={BTN_GHOST} onClick={onCloseCreateRoot}>
                  {t("common.close")}
                </button>
                <button
                  className={BTN_PRIMARY}
                  onClick={onConfirmCreateRoot}
                  disabled={!newRootName.trim()}
                >
                  <Plus className="w-4 h-4" /> {t("tree.createRoot")}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    </ModalPortal>
  );
};
