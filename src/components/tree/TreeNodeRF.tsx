import { useState, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  GitFork,
  ArrowRightLeft,
  Trash2,
  Pencil,
  Check,
  X,
  FolderOpen,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { BTN_GHOST, BTN_ERROR, CARD, CARD_BODY, INPUT } from "../../lib/ui";
import type { TreeFlowNode } from "../../utils/useTreeLayout";

function TreeNodeInner({ data }: NodeProps<TreeFlowNode>) {
  const { language, stats, onFork, onSwitch, onDelete, canDelete } = data;
  const { t } = useTranslation();
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const renameLanguage = useWorkspaceStore((s) => s.renameLanguage);
  const isActive = activeLanguageId === language.language_id;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(language.name);

  const handleRenameConfirm = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== language.name) {
      renameLanguage(language.language_id, trimmed);
    }
    setEditing(false);
  };

  const handleRenameCancel = () => {
    setEditName(language.name);
    setEditing(false);
  };

  const handleShowInFolder = async () => {
    const projectPath = useWorkspaceStore.getState().projectPath;
    try {
      await invoke("show_in_folder", {
        projectPath,
        languagePath: language.path,
      });
    } catch (err) {
      console.warn("Failed to show in folder:", err);
    }
  };

  return (
    <>
      {/* Top handle — parent connects here */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-base-300 !w-2 !h-2 opacity-0"
        draggable={false}
      />

      <div
        className={`${CARD} min-w-48 ${isActive ? "ring-2 ring-primary" : ""}`}
      >
        <div className={`${CARD_BODY} p-3 text-center`}>
          {editing ? (
            <div className="flex items-center flex-col gap-1">
              <div className="flex-1 ">
                <input
                  className={`${INPUT} input-sm text-center`}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameConfirm();
                    if (e.key === "Escape") handleRenameCancel();
                  }}
                  autoFocus
                />
              </div>
              <div className="mt-2">
                <button
                  className={BTN_GHOST}
                  onClick={handleRenameConfirm}
                  title={t("common.save")}
                >
                  <Check className="w-3.5 h-3.5 text-success" />
                </button>
                <button
                  className={BTN_GHOST}
                  onClick={handleRenameCancel}
                  title={t("common.close")}
                >
                  <X className="w-3.5 h-3.5 text-error" />
                </button>
              </div>
            </div>
          ) : (
            <h3 className="font-bold text-sm">{language.name}</h3>
          )}
          <div className="flex items-center justify-center gap-1 group relative">
            <p className="text-xs text-base-content/60">
              {stats?.word_count ?? 0} {t("tree.words")}
            </p>
          </div>
          <div className="flex justify-center gap-1 mt-2">
            <button
              className={BTN_GHOST}
              onClick={() => onSwitch(language.language_id)}
              title={t("tree.switchTo")}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>
            <button
              className={BTN_GHOST}
              onClick={() => {
                setEditName(language.name);
                setEditing(true);
              }}
              title={t("tree.renameLang")}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              className={BTN_GHOST}
              onClick={() => onFork(language.language_id)}
              title={t("tree.fork")}
            >
              <GitFork className="w-3.5 h-3.5" />
            </button>
            <button
              className={BTN_GHOST}
              onClick={handleShowInFolder}
              title={t("tree.showInFolder", "Show in folder")}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
            {canDelete && (
              <button
                className={BTN_ERROR}
                onClick={() => onDelete(language)}
                title={t("tree.deleteLang")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom handle — children connect from here */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-base-300 !w-2 !h-2 opacity-0"
        draggable={false}
      />
    </>
  );
}

export const TreeNode = memo(TreeNodeInner);
