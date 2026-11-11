import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Trash2, Settings, FileUp } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { WriteResult } from "../../types";
import { useWorkspaceStore } from "../../store/workspaceStore";
import {
  generateOperationId,
  recordGuiOperationId,
} from "../../store/conflictStore";
import { BADGE, BTN_PRIMARY, BTN_GHOST, BTN_ERROR } from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { ModalPortal } from "../common/ModalPortal";
import { openPathSafely } from "../../utils/safeDialog";
import {
  DatasetSelector,
  loadDatasets,
  saveDatasets,
  type DatasetEntry,
} from "./DatasetSelector";

export { DatasetSelector };

/** "Manage" button that opens a modal for importing / removing datasets. */
export function DatasetManager() {
  const { t } = useTranslation();
  const { conlangFilePath, setConlangFilePath, loadWorkspace } =
    useWorkspaceStore();
  const [datasets, setDatasets] = useState<DatasetEntry[]>(() =>
    loadDatasets(),
  );
  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DatasetEntry | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (conlangFilePath && conlangFilePath !== ".") {
      setDatasets((prev) => {
        if (prev.some((d) => d.path === conlangFilePath)) return prev;
        const updated = [
          ...prev,
          {
            path: conlangFilePath,
            label: conlangFilePath.split("/").pop() || conlangFilePath,
            lastOpened: new Date().toISOString(),
          },
        ];
        saveDatasets(updated);
        return updated;
      });
    }
  }, [conlangFilePath]);

  const handleSwitch = async (entry: DatasetEntry): Promise<void> => {
    const updated = datasets.map((d) =>
      d.path === entry.path
        ? { ...d, lastOpened: new Date().toISOString() }
        : d,
    );
    setDatasets(updated);
    saveDatasets(updated);
    setConlangFilePath(entry.path);
    await loadWorkspace(entry.path);
    setShowModal(false);
  };

  const handleImportBundle = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      let bundleName = file.name.replace(/\.conlang\.json$|\.json$/, "");
      try {
        const parsed = JSON.parse(text) as {
          workspace?: { languages?: Array<{ name?: string }> };
        };
        const firstName = parsed.workspace?.languages?.[0]?.name;
        if (firstName) bundleName = firstName;
      } catch (parseErr) {
        console.warn(`Using filename fallback for bundle name: ${parseErr}`);
      }

      const targetDir = await openPathSafely({
        directory: true,
        title: t("dataset.chooseBundleDir"),
      });
      if (!targetDir) return;

      const safeName =
        bundleName.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_") ||
        "imported_project";
      const newProjectPath = `${targetDir}/${safeName}`;
      const newConlangFilePath = `${newProjectPath}/${safeName}.conlang`;

      const opId = generateOperationId();
      recordGuiOperationId(opId);
      await invoke<WriteResult>("import_workspace_bundle", {
        projectPath: newProjectPath,
        conlangFilePath: newConlangFilePath,
        bundleJson: text,
        expectedRevision: "missing",
        operationId: opId,
      });

      const now = new Date().toISOString();
      const entry: DatasetEntry = {
        path: newConlangFilePath,
        label: bundleName,
        lastOpened: now,
      };
      const existing = datasets.find((d) => d.path === newConlangFilePath);
      const updated = existing
        ? datasets.map((d) =>
            d.path === newConlangFilePath ? { ...d, lastOpened: now } : d,
          )
        : [...datasets, entry];
      setDatasets(updated);
      saveDatasets(updated);
      setConlangFilePath(newConlangFilePath);
      await loadWorkspace(newConlangFilePath);
      setShowModal(false);
    } catch (err) {
      console.warn(`Import failed: ${err}`);
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const handleDeleteConfirm = (): void => {
    if (!deleteTarget) return;
    const updated = datasets.filter((d) => d.path !== deleteTarget.path);
    setDatasets(updated);
    saveDatasets(updated);
    setDeleteTarget(null);
  };

  return (
    <>
      <button
        className={BTN_GHOST}
        onClick={() => setShowModal(true)}
        title={t("dataset.manage")}
      >
        <Settings className="w-4 h-4" /> {t("dataset.manage")}
      </button>

      <ModalPortal open={showModal}>
        <div className="modal modal-open">
          <div className="modal-box max-w-lg">
            <h3 className="font-bold text-lg">{t("dataset.title")}</h3>
            <p className="text-xs text-base-content/50 mt-1">
              {t("dataset.description")}
            </p>

            <div className="space-y-1 mt-4">
              {datasets.length === 0 && (
                <p className="text-sm text-base-content/40 italic">
                  {t("dataset.noDatasets")}
                </p>
              )}
              {datasets.map((entry) => (
                <div
                  key={entry.path}
                  className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                    entry.path === conlangFilePath
                      ? "bg-primary/10 border border-primary/30"
                      : "hover:bg-base-200 border border-transparent"
                  }`}
                  onClick={() => void handleSwitch(entry)}
                >
                  <FolderOpen className="w-4 h-4 text-base-content/50 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {entry.label}
                    </div>
                    <div className="text-xs text-base-content/40 truncate">
                      {entry.path}
                    </div>
                  </div>
                  {entry.path === conlangFilePath && (
                    <span className={`${BADGE} badge-primary`}>
                      {t("dataset.active")}
                    </span>
                  )}
                  {entry.path !== conlangFilePath && (
                    <button
                      className={BTN_ERROR}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(entry);
                      }}
                      title={t("dataset.remove")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="modal-action">
              <button
                className={BTN_PRIMARY}
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
                title={t("dataset.importBundleDesc")}
              >
                <FileUp className="w-4 h-4" />{" "}
                {importing ? t("common.loading") : t("dataset.importBundle")}
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,.conlang.json"
                className="hidden"
                onChange={(e) => void handleImportBundle(e)}
              />
              <div className="flex-1" />
              <button className={BTN_GHOST} onClick={() => setShowModal(false)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>

      <ConfirmModal
        open={!!deleteTarget}
        title={t("dataset.removeTitle")}
        message={t("dataset.removeMessage", {
          name: deleteTarget?.label ?? "",
        })}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
