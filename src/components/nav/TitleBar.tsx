import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Zap,
  Sun,
  Moon,
  Info,
} from "lucide-react";
import { QuickEntry } from "../common/QuickEntry";
import { LanguageToggle } from "../common/LanguageToggle";
import { useTheme } from "../../lib/useTheme";

const appWindow = getCurrentWindow();

/* ── Pixel-perfect SVG icons for traffic light buttons ── */
const CloseIcon = () => (
  <svg width="6" height="6" viewBox="0 0 6 6" className="tl-icon">
    <line x1="0.5" y1="0.5" x2="5.5" y2="5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="5.5" y1="0.5" x2="0.5" y2="5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const MinimizeIcon = () => (
  <svg width="6" height="2" viewBox="0 0 6 2" className="tl-icon">
    <line x1="0.5" y1="1" x2="5.5" y2="1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const MaximizeIcon = () => (
  <svg width="6" height="6" viewBox="0 0 6 6" className="tl-icon">
    <polygon points="3,0.5 5.5,5.5 0.5,5.5" fill="currentColor" />
  </svg>
);

export function TitleBar() {
  const { t } = useTranslation();
  const { theme, toggle: toggleTheme } = useTheme();
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const location = useLocation();
  const isWelcome = location.pathname === "/welcome";

  return (
    <header
      className="titlebar bg-base-300 text-base-content flex items-center h-9 px-2 shrink-0 select-none"
      data-tauri-drag-region
    >
      {/* ── Left: Traffic Lights ── */}
      <div className="flex items-center gap-2 shrink-0" data-tauri-drag-region>
        <div className="traffic-lights flex items-center gap-1.5 ml-1">
          <button
            className="tl-btn tl-close"
            onClick={() => appWindow.close()}
            title={t("titlebar.close", "Close")}
          >
            <CloseIcon />
          </button>
          <button
            className="tl-btn tl-minimize"
            onClick={() => appWindow.minimize()}
            title={t("titlebar.minimize", "Minimize")}
          >
            <MinimizeIcon />
          </button>
          <button
            className="tl-btn tl-maximize"
            onClick={() => appWindow.toggleMaximize()}
            title={t("titlebar.maximize", "Maximize")}
          >
            <MaximizeIcon />
          </button>
        </div>
      </div>

      {/* ── Center: drag region spacer ── */}
      <div
        className="flex-1 min-w-0"
        data-tauri-drag-region
      />

      {/* ── Right: Utility Actions ── */}
      <div className="flex items-center gap-1 shrink-0">
        {!isWelcome && (
          <>
            <button
              onClick={() => setQuickEntryOpen(true)}
              className="btn btn-ghost btn-xs text-warning"
              title={t("quickEntry.title")}
            >
              <Zap className="w-4 h-4" />
            </button>

            <button
              onClick={toggleTheme}
              className="btn btn-ghost btn-xs"
              title={t("common.toggleTheme")}
            >
              {theme === "light" ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
            </button>
          </>
        )}

        <LanguageToggle />

        {!isWelcome && (
          <NavLink
            to="/about"
            className="btn btn-ghost btn-xs"
            title={t("nav.about")}
          >
            <Info className="w-4 h-4" />
          </NavLink>
        )}
      </div>

      <QuickEntry
        isOpen={quickEntryOpen}
        onClose={() => setQuickEntryOpen(false)}
      />
    </header>
  );
}
