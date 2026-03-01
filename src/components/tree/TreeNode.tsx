import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GitFork,
  ArrowRightLeft,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { LanguageEntry } from "../../types";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { BTN_GHOST, BTN_ERROR, CARD, CARD_BODY, INPUT } from "../../lib/ui";

interface TreeNodeProps {
  language: LanguageEntry;
  wordCount: number;
  onFork: () => void;
  onSwitch: () => void;
  onDelete: () => void;
  canDelete: boolean;
  depth: number;
}

export function TreeNode({
  language,
  wordCount,
  onFork,
  onSwitch,
  onDelete,
  canDelete,
}: TreeNodeProps) {
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

  return (
    <div
      className={`${CARD} min-w-48 ${isActive ? "ring-2 ring-primary" : ""}`}
    >
      <div className={`${CARD_BODY} p-3 text-center`}>
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              className={`${INPUT} input-sm flex-1 text-center`}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameConfirm();
                if (e.key === "Escape") handleRenameCancel();
              }}
              autoFocus
            />
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
        ) : (
          <h3 className="font-bold text-sm">{language.name}</h3>
        )}
        <p className="text-xs text-base-content/60">
          {wordCount} {t("tree.words")}
        </p>
        <div className="flex justify-center gap-1 mt-2">
          <button
            className={BTN_GHOST}
            onClick={onSwitch}
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
          <button className={BTN_GHOST} onClick={onFork} title={t("tree.fork")}>
            <GitFork className="w-3.5 h-3.5" />
          </button>
          {canDelete && (
            <button
              className={BTN_ERROR}
              onClick={onDelete}
              title={t("tree.deleteLang")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
