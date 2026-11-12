import { useTranslation } from "react-i18next";
import { Undo2, Redo2 } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { performRedo, performUndo, useUndoState } from "../../store/undoManager";
import { useUndoLabelTexts } from "../../lib/labelMaps";

/** 顶栏撤销/重做按钮（悬停显示该步动作名） */
export const UndoRedoButtons: React.FC = () => {
  const { t } = useTranslation();
  const undoState = useUndoState();
  const labelTexts = useUndoLabelTexts();
  const activeLanguagePath = useWorkspaceStore((s) => s.activeLanguagePath);

  const undoTitle = undoState.undoLabelKey
    ? t("undo.undoHint", {
        label: labelTexts[undoState.undoLabelKey] ?? undoState.undoLabelKey,
      })
    : t("undo.nothingToUndo");
  const redoTitle = undoState.redoLabelKey
    ? t("undo.redoHint", {
        label: labelTexts[undoState.redoLabelKey] ?? undoState.redoLabelKey,
      })
    : t("undo.nothingToRedo");

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-square"
        disabled={!undoState.canUndo}
        title={undoTitle}
        onClick={() => void performUndo(activeLanguagePath || undefined)}
      >
        <Undo2 size={15} />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-square"
        disabled={!undoState.canRedo}
        title={redoTitle}
        onClick={() => void performRedo(activeLanguagePath || undefined)}
      >
        <Redo2 size={15} />
      </button>
    </div>
  );
};
