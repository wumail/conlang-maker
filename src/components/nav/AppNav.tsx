import { useState, useRef, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Book,
  AudioLines,
  ScrollText,
  Package,
  Wand2,
  Zap,
  Dna,
  GitFork,
  FileDown,
  BookOpen,
  Sun,
  Moon,
  MoreHorizontal,
  Info,
} from "lucide-react";
import { QuickEntry } from "../common/QuickEntry";
import { LanguageToggle } from "../common/LanguageToggle";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useTheme } from "../../lib/useTheme";

const NAV_LINK_BASE =
  "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap";
const NAV_ACTIVE = `${NAV_LINK_BASE} bg-primary text-primary-content`;
const NAV_INACTIVE = `${NAV_LINK_BASE} text-base-content/70 hover:bg-primary-content hover:text-neutral`;

export function AppNav() {
  const { t, i18n } = useTranslation();
  const { theme, toggle: toggleTheme } = useTheme();
  const location = useLocation();
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const languages = useWorkspaceStore((s) => s.config.languages);
  const activeLang = languages.find((l) => l.language_id === activeLanguageId);

  const navRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [overflowIdx, setOverflowIdx] = useState(9);

  const navItems = [
    {
      to: "/phonology",
      icon: <AudioLines className="w-4 h-4" />,
      label: t("nav.phonology"),
    },
    {
      to: "/lexicon",
      icon: <Book className="w-4 h-4" />,
      label: t("nav.lexicon"),
    },
    {
      to: "/wordgen",
      icon: <Wand2 className="w-4 h-4" />,
      label: t("nav.wordgen"),
    },
    {
      to: "/grammar",
      icon: <ScrollText className="w-4 h-4" />,
      label: t("nav.grammar"),
    },
    {
      to: "/corpus",
      icon: <BookOpen className="w-4 h-4" />,
      label: t("nav.corpus"),
    },
    {
      to: "/sandbox",
      icon: <Package className="w-4 h-4" />,
      label: t("nav.sandbox"),
    },
    {
      to: "/tree",
      icon: <GitFork className="w-4 h-4" />,
      label: t("nav.tree"),
    },
    { to: "/sca", icon: <Dna className="w-4 h-4" />, label: t("nav.sca") },
    {
      to: "/export",
      icon: <FileDown className="w-4 h-4" />,
      label: t("nav.export"),
    },
  ];

  /* ── Overflow calculation via hidden measurement row ── */
  useEffect(() => {
    const navEl = navRef.current;
    const measureEl = measureRef.current;
    if (!navEl || !measureEl) return;

    const calcOverflow = () => {
      const available = navEl.clientWidth;
      const moreW = 34; // width reserved for "..." button
      const gap = 2; // gap-0.5 = 2px
      const children = Array.from(measureEl.children) as HTMLElement[];
      if (children.length === 0) return;

      const widths = children.map((el) => el.offsetWidth);
      let total = 0;
      for (let i = 0; i < widths.length; i++)
        total += widths[i] + (i > 0 ? gap : 0);

      if (total <= available) {
        setOverflowIdx(widths.length);
        return;
      }

      let used = 0;
      for (let i = 0; i < widths.length; i++) {
        used += widths[i] + (i > 0 ? gap : 0);
        if (used > available - moreW - gap) {
          setOverflowIdx(i);
          return;
        }
      }
      setOverflowIdx(widths.length);
    };

    const observer = new ResizeObserver(calcOverflow);
    observer.observe(navEl);
    calcOverflow();
    return () => observer.disconnect();
  }, [i18n.language]);

  const visibleItems = navItems.slice(0, overflowIdx);
  const overflowItems = navItems.slice(overflowIdx);
  const isActiveInOverflow = overflowItems.some(({ to }) =>
    location.pathname.startsWith(to),
  );

  return (
    <header className="bg-base-300 text-base-content flex items-center h-11 px-2 shrink-0 select-none relative">
      {/* ── Brand / Language Name ── */}
      <NavLink
        to="/tree"
        className="flex items-center gap-1.5 px-2 shrink-0"
        title={activeLang?.name ?? "Conlang"}
      >
        <span className="font-semibold text-sm tracking-wide truncate max-w-[7rem]">
          {activeLang?.name ?? "Conlang"}
        </span>
      </NavLink>

      <div className="w-px h-5 bg-base-content/20 mx-1" />

      {/* Hidden measurement row — measures natural width of all items */}
      <div
        ref={measureRef}
        className="flex items-center gap-0.5 absolute invisible pointer-events-none whitespace-nowrap"
        aria-hidden="true"
      >
        {navItems.map(({ to, icon, label }) => (
          <span
            key={to}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium"
          >
            {icon}
            <span className="hidden sm:inline">{label}</span>
          </span>
        ))}
      </div>

      {/* ── Visible Nav Items ── */}
      <nav ref={navRef} className="flex items-center gap-1 flex-1 min-w-0">
        {visibleItems.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) => (isActive ? NAV_ACTIVE : NAV_INACTIVE)}
          >
            {icon}
            <span className="hidden sm:inline">{label}</span>
          </NavLink>
        ))}
        {overflowItems.length > 0 && (
          <div className="dropdown dropdown-end">
            <button
              tabIndex={0}
              className={`flex items-center px-2 py-1 rounded text-xs ${
                isActiveInOverflow
                  ? "bg-primary text-base-content"
                  : "text-neutral-content/70 hover:bg-neutral-content/10 hover:text-neutral-content"
              }`}
              title={t("common.more")}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            <ul
              tabIndex={0}
              className="dropdown-content menu bg-base-200 rounded-box shadow-lg z-50 w-48 p-1 mt-1"
            >
              {overflowItems.map(({ to, icon, label }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      `flex items-center gap-2 text-sm ${isActive ? "bg-primary text-base-content" : ""}`
                    }
                  >
                    {icon} {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      {/* ── Right Actions ── */}
      <div className="flex items-center gap-1 shrink-0 ml-2">
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

        <LanguageToggle />

        <NavLink
          to="/about"
          className="btn btn-ghost btn-xs"
          title={t("nav.about")}
        >
          <Info className="w-4 h-4" />
        </NavLink>
      </div>

      <QuickEntry
        isOpen={quickEntryOpen}
        onClose={() => setQuickEntryOpen(false)}
      />
    </header>
  );
}
