import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Trash2, Settings, FileUp } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { BTN_PRIMARY, BTN_GHOST, BTN_ERROR, SELECT } from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { ModalPortal } from "../common/ModalPortal";

const DATASETS_KEY = "conlang-maker-datasets";

interface DatasetEntry {
  path: string;
  label: string;
  lastOpened: string;
}

function loadDatasets(): DatasetEntry[] {
  try {
    const raw = localStorage.getItem(DATASETS_KEY);
    if (raw) return JSON.parse(raw) as DatasetEntry[];
  } catch {
    /* ignore */
  }
  return [];
}

function saveDatasets(datasets: DatasetEntry[]) {
  localStorage.setItem(DATASETS_KEY, JSON.stringify(datasets));
}

/** Compact dropdown for switching datasets — placed in the page header. */
export function DatasetSelector() {
  const { t } = useTranslation();
  const { projectPath, setConlangFilePath, loadWorkspace } =
    useWorkspaceStore();
  const [datasets, setDatasets] = useState<DatasetEntry[]>(() =>
    loadDatasets(),
  );

  useEffect(() => {
    if (projectPath && projectPath !== ".") {
      const existing = datasets.find((d) => d.path === projectPath);
      if (!existing) {
        const updated = [
          ...datasets,
          {
            path: projectPath,
            label: projectPath.split("/").pop() || projectPath,
            lastOpened: new Date().toISOString(),
          },
        ];
        setDatasets(updated);
        saveDatasets(updated);
      }
    }
  }, [projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedPath = e.target.value;
    if (!selectedPath || selectedPath === projectPath) return;
    const updated = datasets.map((d) =>
      d.path === selectedPath
        ? { ...d, lastOpened: new Date().toISOString() }
        : d,
    );
    setDatasets(updated);
    saveDatasets(updated);
    setConlangFilePath(selectedPath);
    await loadWorkspace(selectedPath);
  };

  if (datasets.length <= 1) return null;

  return (
    <select
      className={`${SELECT} select-sm`}
      value={projectPath}
      onChange={handleChange}
      title={t("dataset.title")}
    >
      {datasets.map((entry) => (
        <option key={entry.path} value={entry.path}>
          {entry.label}
        </option>
      ))}
    </select>
  );
}

/** "Manage" button that opens a modal for importing / removing datasets. */
export function DatasetManager() {
  const { t } = useTranslation();
  const { projectPath, setConlangFilePath, loadWorkspace } =
    useWorkspaceStore();
  const [datasets, setDatasets] = useState<DatasetEntry[]>(() =>
    loadDatasets(),
  );
  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DatasetEntry | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (projectPath && projectPath !== ".") {
      const existing = datasets.find((d) => d.path === projectPath);
      if (!existing) {
        const updated = [
          ...datasets,
          {
            path: projectPath,
            label: projectPath.split("/").pop() || projectPath,
            lastOpened: new Date().toISOString(),
          },
        ];
        setDatasets(updated);
        saveDatasets(updated);
      }
    }
  }, [projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSwitch = async (entry: DatasetEntry) => {
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

  const handleImportBundle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      // Parse the bundle to extract a label for the new project
      let bundleName = file.name.replace(/\.conlang\.json$|\.json$/, "");
      try {
        const parsed = JSON.parse(text) as {
          workspace?: { languages?: Array<{ name?: string }> };
        };
        const firstName = parsed.workspace?.languages?.[0]?.name;
        if (firstName) bundleName = firstName;
      } catch {
        /* use filename */
      }

      // Let user pick a directory to place the imported project
      const targetDir = await open({
        directory: true,
        title: t("dataset.chooseBundleDir"),
      });
      if (!targetDir) return;
      const targetPath =
        typeof targetDir === "string" ? targetDir : String(targetDir);

      // Create new project directory inside the chosen folder
      const safeName =
        bundleName.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_") ||
        "imported_project";
      const newProjectPath = `${targetPath}/${safeName}`;

      await invoke("import_workspace_bundle", {
        projectPath: newProjectPath,
        bundleJson: text,
      });

      // Register the new dataset and switch to it
      const now = new Date().toISOString();
      const entry: DatasetEntry = {
        path: newProjectPath,
        label: bundleName,
        lastOpened: now,
      };
      const existing = datasets.find((d) => d.path === newProjectPath);
      const updated = existing
        ? datasets.map((d) =>
            d.path === newProjectPath ? { ...d, lastOpened: now } : d,
          )
        : [...datasets, entry];
      setDatasets(updated);
      saveDatasets(updated);
      setConlangFilePath(newProjectPath);
      await loadWorkspace(newProjectPath);
      setShowModal(false);
    } catch (err) {
      console.warn(`Import failed: ${err}`);
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const handleDeleteConfirm = () => {
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
                    entry.path === projectPath
                      ? "bg-primary/10 border border-primary/30"
                      : "hover:bg-base-200 border border-transparent"
                  }`}
                  onClick={() => handleSwitch(entry)}
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
                  {entry.path === projectPath && (
                    <span className="badge badge-sm badge-primary">
                      {t("dataset.active")}
                    </span>
                  )}
                  {entry.path !== projectPath && (
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
                onChange={handleImportBundle}
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
