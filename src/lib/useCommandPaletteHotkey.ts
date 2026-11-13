import { useEffect, useState } from "react";

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
