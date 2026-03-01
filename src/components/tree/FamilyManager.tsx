import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Trash2, Settings, Save, Copy } from "lucide-react";
import { open, message } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useRegistryStore } from "../../store/registryStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { BTN_PRIMARY, BTN_GHOST, BTN_ERROR, SELECT } from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { ModalPortal } from "../common/ModalPortal";

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/\/+$/, "");
}

function dirname(input: string): string {
  const normalized = normalizePath(input);
  const idx = normalized.lastIndexOf("/");
  return idx > 0 ? normalized.slice(0, idx) : normalized;
}

function isSamePath(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

function isSubPath(path: string, base: string): boolean {
  const p = normalizePath(path).toLowerCase();
  const b = normalizePath(base).toLowerCase();
  return p.startsWith(`${b}/`);
}

/** Compact dropdown for switching between language families. */
export function FamilySelector() {
  const { t } = useTranslation();
  const { registry, setActiveFamily } = useRegistryStore();
  const { loadWorkspace, conlangFilePath } = useWorkspaceStore();

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value, 10);
    if (isNaN(idx) || idx < 0 || idx >= registry.families.length) return;
    const family = registry.families[idx];
    if (family.conlang_file_path === conlangFilePath) return;

    try {
      const missing = await invoke<string[]>("validate_conlang_file", {
        conlangFilePath: family.conlang_file_path,
      });
      if (missing && missing.length > 0) {
        await message(
          t("welcome.importFailed", { missing: missing.join(", ") }),
          { title: t("common.error"), kind: "error" },
        );
        return;
      }
      await setActiveFamily(idx);
      await loadWorkspace(family.conlang_file_path);
    } catch (err) {
      console.warn(`Failed to switch: ${err}`);
    }
  };

  if (registry.families.length <= 1) return null;

  const activeIdx = registry.families.findIndex(
    (f) => f.conlang_file_path === conlangFilePath,
  );

  return (
    <select
      className={`${SELECT} select-sm`}
      value={activeIdx >= 0 ? activeIdx : ""}
      onChange={handleChange}
      title={t("family.title")}
    >
      {registry.families.map((entry, idx) => (
        <option key={entry.conlang_file_path} value={idx}>
          {entry.name}
        </option>
      ))}
    </select>
  );
}

/** "Manage" button that opens a modal for managing families + Save As. */
export function FamilyManager() {
  const { t } = useTranslation();
  const { registry, registerFamily, unregisterFamily, setActiveFamily } =
    useRegistryStore();
  const { loadWorkspace, conlangFilePath, copyProject } = useWorkspaceStore();
  const [showModal, setShowModal] = useState(false);
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSwitch = async (idx: number) => {
    const family = registry.families[idx];
    if (family.conlang_file_path === conlangFilePath) return;

    try {
      const missing = await invoke<string[]>("validate_conlang_file", {
        conlangFilePath: family.conlang_file_path,
      });
      if (missing && missing.length > 0) {
        await message(
          t("welcome.importFailed", { missing: missing.join(", ") }),
          { title: t("common.error"), kind: "error" },
        );
        return;
      }
      await setActiveFamily(idx);
      await loadWorkspace(family.conlang_file_path);
      setShowModal(false);
    } catch (err) {
      console.warn(`Failed to switch: ${err}`);
    }
  };

  const handleOpen = async () => {
    const selected = await open({
      title: t("welcome.openFile"),
      filters: [{ name: "Conlang File", extensions: ["conlang"] }],
    });
    if (!selected) return;
    const filePath = typeof selected === "string" ? selected : String(selected);
    try {
      const missing = await invoke<string[]>("validate_conlang_file", {
        conlangFilePath: filePath,
      });
      if (missing && missing.length > 0) {
        await message(
          t("welcome.importFailed", { missing: missing.join(", ") }),
          { title: t("common.error"), kind: "error" },
        );
        return;
      }

      await loadWorkspace(filePath);
      const reg = await registerFamily(
        filePath
          .split("/")
          .pop()
          ?.replace(/\.conlang$/, "") ?? "Untitled",
        filePath,
      );
      const idx = reg.families.findIndex(
        (f) => f.conlang_file_path === filePath,
      );
      if (idx >= 0) await setActiveFamily(idx);
      setShowModal(false);
    } catch (err) {
      console.warn(`Failed to open: ${err}`);
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleteIdx === null) return;
    const res = await unregisterFamily(deleteIdx);
    setDeleteIdx(null);
    if (res.families.length === 0) {
      useWorkspaceStore.getState().clearWorkspace();
    }
  };

  const handleSaveAs = async () => {
    if (!saveAsName.trim()) return;

    const sourceConlangPath =
      conlangFilePath ||
      registry.families.find((f) => f.conlang_file_path === conlangFilePath)
        ?.conlang_file_path ||
      (registry.active_family_index !== null
        ? registry.families[registry.active_family_index]?.conlang_file_path
        : "");

    if (!sourceConlangPath) {
      await message(t("family.saveAsSourceMissing"), {
        title: t("common.error"),
        kind: "error",
      });
      return;
    }

    setSaving(true);
    try {
      const targetDir = await open({
        directory: true,
        title: t("family.saveAsChooseDir"),
      });
      if (!targetDir) return;

      const parentDir = Array.isArray(targetDir)
        ? (targetDir[0] ?? "")
        : targetDir;
      if (!parentDir) return;

      const sourceProjectDir = dirname(sourceConlangPath);
      let resolvedParentDir = parentDir;

      // UX: if user picked current project folder, treat as "save alongside current project"
      if (isSamePath(resolvedParentDir, sourceProjectDir)) {
        resolvedParentDir = dirname(sourceProjectDir);
      }

      // True descendants are still invalid (would recurse during copy)
      if (isSubPath(resolvedParentDir, sourceProjectDir)) {
        await message(t("family.saveAsInvalidTarget"), {
          title: t("common.error"),
          kind: "error",
        });
        return;
      }

      const separator = resolvedParentDir.includes("\\") ? "\\" : "/";
      const destDir = `${resolvedParentDir}${separator}${saveAsName.trim()}`;

      const newConlangPath = await copyProject(
        sourceConlangPath,
        destDir,
        saveAsName.trim(),
      );
      const reg = await registerFamily(saveAsName.trim(), newConlangPath);
      const idx = reg.families.findIndex(
        (f) => f.conlang_file_path === newConlangPath,
      );
      if (idx >= 0) await setActiveFamily(idx);
      await loadWorkspace(newConlangPath);
      setShowSaveAs(false);
      setSaveAsName("");
      setShowModal(false);
    } catch (err) {
      console.warn(`Save As failed: ${err}`);
      await message(t("family.saveAsFailed", { reason: String(err) }), {
        title: t("common.error"),
        kind: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        className={BTN_GHOST}
        onClick={() => setShowModal(true)}
        title={t("family.manage")}
      >
        <Settings className="w-4 h-4" /> {t("family.manage")}
      </button>

      <ModalPortal open={showModal || showSaveAs}>
        <>
          {showModal && !showSaveAs && (
            <div className="modal modal-open">
              <div className="modal-box max-w-lg">
                <h3 className="font-bold text-lg">{t("family.title")}</h3>
                <p className="text-xs text-base-content/50 mt-1">
                  {t("family.description")}
                </p>

                <div className="space-y-1 mt-4">
                  {registry.families.length === 0 && (
                    <p className="text-sm text-base-content/40 italic">
                      {t("family.noFamilies")}
                    </p>
                  )}
                  {registry.families.map((entry, idx) => (
                    <div
                      key={entry.conlang_file_path}
                      className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                        entry.conlang_file_path === conlangFilePath
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-base-200 border border-transparent"
                      }`}
                      onClick={() => handleSwitch(idx)}
                    >
                      <FolderOpen className="w-4 h-4 text-base-content/50 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {entry.name}
                        </div>
                        <div className="text-xs text-base-content/40 truncate">
                          {entry.conlang_file_path}
                        </div>
                      </div>
                      {entry.conlang_file_path === conlangFilePath && (
                        <span className="badge badge-sm badge-primary">
                          {t("family.active")}
                        </span>
                      )}
                      {entry.conlang_file_path !== conlangFilePath && (
                        <button
                          className={BTN_ERROR}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteIdx(idx);
                          }}
                          title={t("family.remove")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="modal-action">
                  <button className={BTN_PRIMARY} onClick={handleOpen}>
                    <FolderOpen className="w-4 h-4" /> {t("welcome.open")}
                  </button>
                  <button
                    className={BTN_GHOST}
                    onClick={() => {
                      setSaveAsName("");
                      setShowSaveAs(true);
                    }}
                    disabled={!conlangFilePath}
                  >
                    <Copy className="w-4 h-4" /> {t("family.saveAs")}
                  </button>
                  <div className="flex-1" />
                  <button
                    className={BTN_GHOST}
                    onClick={() => setShowModal(false)}
                  >
                    {t("common.close")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Save As sub-modal */}
          {showSaveAs && (
            <div className="modal modal-open">
              <div className="modal-box">
                <h3 className="font-bold text-lg">{t("family.saveAsTitle")}</h3>
                <div className="form-control mt-3">
                  <label className="label mb-2">
                    <span className="label-text">{t("family.newName")}</span>
                  </label>
                  <input
                    className="input input-md w-full"
                    value={saveAsName}
                    onChange={(e) => setSaveAsName(e.target.value)}
                    placeholder={t("family.newNamePlaceholder")}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveAs()}
                  />
                </div>
                <div className="modal-action">
                  <button
                    className={BTN_GHOST}
                    onClick={() => setShowSaveAs(false)}
                  >
                    {t("common.back")}
                  </button>
                  <button
                    className={BTN_PRIMARY}
                    onClick={handleSaveAs}
                    disabled={!saveAsName.trim() || saving}
                  >
                    <Save className="w-4 h-4" />{" "}
                    {saving ? t("common.loading") : t("family.saveAs")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      </ModalPortal>

      <ConfirmModal
        open={deleteIdx !== null}
        title={t("family.removeTitle")}
        message={t("family.removeMessage")}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteIdx(null)}
      />
    </>
  );
}
