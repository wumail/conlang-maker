import { useEffect, useState } from "react";
import { warmLineageLexiconCache } from "./commandPalette";

/** 预热所需的最小语言信息（工作区 languages 的子集） */
export interface PaletteWarmupLanguage {
  path: string;
}

/**
 * 面板打开时预热全工作区词库缓存：遍历 workspaceConfig.languages，
 * 对尚未进入缓存的语言后台加载，使从未手动打开过的子语言词条也能被秒搜。
 */
export function useCommandPaletteWarmup(
  open: boolean,
  projectPath: string,
  languages: readonly PaletteWarmupLanguage[],
): void {
  useEffect(() => {
    if (!open) return;
    warmLineageLexiconCache(
      projectPath,
      languages.map((language) => language.path),
    );
  }, [open, projectPath, languages]);
}

/**
 * 全局命令面板开关：`Cmd+K` / `Ctrl+K` 打开，Esc 由面板自身处理。
 */
export function useCommandPaletteHotkey(): {
  open: boolean;
  setOpen: (next: boolean) => void;
  close: () => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return { open, setOpen, close: () => setOpen(false) };
}
