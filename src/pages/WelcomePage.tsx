import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Plus, FolderOpen, Trash2 } from "lucide-react";
import { open, message } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useRegistryStore } from "../store/registryStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { BTN_PRIMARY, BTN_GHOST, BTN_ERROR, BTN_PRIMARY_MD } from "../lib/ui";
import { ConfirmModal } from "../components/common/ConfirmModal";
import { ModalPortal } from "../components/common/ModalPortal";
import { LanguageToggle } from "../components/common/LanguageToggle";
import type { FamilyEntry } from "../types";

export function WelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { registry, registerFamily, unregisterFamily, setActiveFamily } =
    useRegistryStore();
  const { loadWorkspace, createRootLanguage } = useWorkspaceStore();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null);

  /** Open an existing .conlang file */
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
          { title: t("common.error", "Error"), kind: "error" },
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
      navigate("/tree");
    } catch (err) {
      console.warn(`Failed to open file: ${err}`);
    }
  };

  /** Create a new language family */
  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const result = await createRootLanguage(newName.trim());
      if (result) {
        const reg = await registerFamily(
          newName.trim(),
          result.conlang_file_path,
        );
        const idx = reg.families.findIndex(
          (f) => f.conlang_file_path === result.conlang_file_path,
        );
        if (idx >= 0) await setActiveFamily(idx);
        setShowCreate(false);
        setNewName("");
        navigate("/tree");
      }
    } catch (err) {
      console.warn(`Failed to create: ${err}`);
    } finally {
      setCreating(false);
    }
  };

  /** Switch to a recently opened family */
  const handleSwitch = async (entry: FamilyEntry, index: number) => {
    try {
      const missing = await invoke<string[]>("validate_conlang_file", {
        conlangFilePath: entry.conlang_file_path,
      });
      if (missing && missing.length > 0) {
        await message(
          t("welcome.importFailed", { missing: missing.join(", ") }),
          { title: t("common.error", "Error"), kind: "error" },
        );
        return;
      }
      await loadWorkspace(entry.conlang_file_path);
      await setActiveFamily(index);
      navigate("/tree");
    } catch (err) {
      console.warn(`Failed to switch: ${err}`);
    }
  };

  /** Remove a family from registry (no file deletion) */
  const handleDelete = async () => {
    if (deleteIdx === null) return;
    await unregisterFamily(deleteIdx);
    setDeleteIdx(null);
  };

  return (
    <div className="relative flex items-center justify-center h-full bg-base-200">
      <LanguageToggle
        className={`${BTN_GHOST} text-xs font-bold absolute top-4 right-4`}
      />

      <div className="max-w-md w-full p-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Conlang Maker</h1>
          <p className="text-base-content/60 text-sm">
            {t("welcome.subtitle")}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 justify-center">
          <button
            className={BTN_PRIMARY_MD}
            onClick={() => setShowCreate(true)}
          >
            <Plus className="w-4 h-4" /> {t("welcome.create")}
          </button>
          <button className={BTN_PRIMARY_MD} onClick={handleOpen}>
            <FolderOpen className="w-4 h-4" /> {t("welcome.open")}
          </button>
        </div>

        {/* Recent families */}
        {registry.families.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-base-content/70">
              {t("welcome.recent")}
            </h2>
            <div className="space-y-1">
              {registry.families.map((entry, idx) => (
                <div
                  key={entry.conlang_file_path}
                  className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-base-300 transition-colors"
                  onClick={() => handleSwitch(entry, idx)}
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
                  <button
                    className={BTN_ERROR}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteIdx(idx);
                    }}
                    title={t("welcome.remove")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create modal */}
      <ModalPortal open={showCreate}>
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">{t("welcome.createTitle")}</h3>
            <div className="form-control mt-3">
              <label className="label mb-2">
                <span className="label-text">{t("welcome.familyName")}</span>
              </label>
              <input
                className="input input-md w-full"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("welcome.familyNamePlaceholder")}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="modal-action">
              <button
                className={BTN_GHOST}
                onClick={() => setShowCreate(false)}
              >
                {t("common.close")}
              </button>
              <button
                className={BTN_PRIMARY}
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
              >
                <Plus className="w-4 h-4" /> {t("welcome.create")}
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>

      {/* Delete confirm */}
      <ConfirmModal
        open={deleteIdx !== null}
        title={t("welcome.removeTitle")}
        message={t("welcome.removeMessage")}
        onConfirm={handleDelete}
        onCancel={() => setDeleteIdx(null)}
      />
    </div>
  );
}
