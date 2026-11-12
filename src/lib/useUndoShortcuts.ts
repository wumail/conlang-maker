import { useEffect } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { performRedo, performUndo } from "../store/undoManager";

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

/**
 * 全局撤销/重做快捷键。
 *
 * - `Cmd/Ctrl+Z` 撤销，`Cmd/Ctrl+Shift+Z` 或 `Cmd/Ctrl+Y` 重做；
 * - 输入法组合态（`isComposing`）不拦截；
 * - 焦点在原生输入框/文本域/可编辑区时保留浏览器自身的字符级撤销体验。
 */
export function useUndoShortcuts(): void {
  const activeLanguagePath = useWorkspaceStore((s) => s.activeLanguagePath);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey) return;

      const key = event.key.toLowerCase();
      const undo = key === "z" && !event.shiftKey;
      const redo = (key === "z" && event.shiftKey) || key === "y";
      if (!undo && !redo) return;
      if (isTextEntryTarget(event.target)) return;

      event.preventDefault();
      const languageId = activeLanguagePath || undefined;
      void (undo ? performUndo(languageId) : performRedo(languageId));
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeLanguagePath]);
}
