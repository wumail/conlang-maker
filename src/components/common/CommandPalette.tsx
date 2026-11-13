import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CornerDownLeft,
  Languages,
  Plus,
  Search,
} from "lucide-react";
import { ModalPortal } from "./ModalPortal";
import { BADGE } from "../../lib/ui";
import { CommandCalcPreview } from "./CommandCalcPreview";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useLexiconStore } from "../../store/lexiconStore";
import {
  listLineageSnapshots,
  useLineageLexiconCacheVersion,
} from "../../store/lineageLexiconStore";
import {
  PALETTE_ROUTES,
  parsePaletteMode,
  searchWords,
  type CommandWordHit,
  type WordSearchGroup,
} from "../../lib/commandPalette";
import { useCommandPaletteWarmup } from "../../lib/useCommandPaletteHotkey";
import { createDraftWord } from "../../utils/lexiconDraft";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface ActionItem {
  id: string;
  label: string;
  kind: "language" | "route" | "create";
  run: () => void;
}

/** 全局命令面板：检索 / `>` 动作 / `=` 即时演算（Cmd+K） */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const retryTimers = useRef<number[]>([]);

  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const languages = useWorkspaceStore((s) => s.config.languages);
  const setActiveLanguage = useWorkspaceStore((s) => s.setActiveLanguage);
  const wordsList = useLexiconStore((s) => s.wordsList);
  const setActiveWordId = useLexiconStore((s) => s.setActiveWordId);
  const upsertWord = useLexiconStore((s) => s.upsertWord);
  const cacheVersion = useLineageLexiconCacheVersion();
  useCommandPaletteWarmup(open, projectPath, languages);

  const [raw, setRaw] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { mode, body } = parsePaletteMode(raw);

  useEffect(() => {
    if (!open) return;
    setRaw("");
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [raw]);

  useEffect(() => {
    return () => {
      retryTimers.current.forEach((timer) => window.clearTimeout(timer));
      retryTimers.current = [];
    };
  }, []);

  const cachedGroups = useMemo<WordSearchGroup[]>(() => {
    if (!projectPath) return [];
    return listLineageSnapshots(projectPath)
      .map(({ languagePath, snapshot }) => {
        const language = languages.find((item) => item.path === languagePath);
        if (!language) return null;
        return {
          languageId: language.language_id,
          languageName: language.name,
          words: Object.values(snapshot.wordsById),
        };
      })
      .filter((group): group is WordSearchGroup => group !== null);
    // cacheVersion 触发重算
  }, [projectPath, languages, cacheVersion]);

  const hits = useMemo<CommandWordHit[]>(() => {
    if (mode !== "search") return [];
    return searchWords({
      query: body,
      activeLanguageId,
      activeWords: wordsList,
      cachedGroups,
    });
  }, [mode, body, activeLanguageId, wordsList, cachedGroups]);

  const focusWordInLanguage = (languageId: string, entryId: string) => {
    if (languageId !== activeLanguageId) {
      setActiveLanguage(languageId);
      navigate("/lexicon");
      // 目标语言词库异步加载完成后聚焦该词条（最多重试 3s）
      for (let attempt = 1; attempt <= 30; attempt += 1) {
        const timer = window.setTimeout(() => {
          if (useLexiconStore.getState().wordsMap[entryId]) {
            useLexiconStore.getState().setActiveWordId(entryId);
          }
        }, attempt * 100);
        retryTimers.current.push(timer);
      }
      return;
    }
    setActiveWordId(entryId);
    navigate("/lexicon");
  };

  const actions = useMemo<ActionItem[]>(() => {
    const items: ActionItem[] = [];
    for (const language of languages) {
      if (language.language_id === activeLanguageId) continue;
      items.push({
        id: `lang_${language.language_id}`,
        label: t("commandPalette.switchLanguage", { name: language.name }),
        kind: "language",
        run: () => {
          setActiveLanguage(language.language_id);
          navigate("/lexicon");
        },
      });
    }
    for (const route of PALETTE_ROUTES) {
      items.push({
        id: `route_${route.path}`,
        label: t("commandPalette.goTo", { page: t(route.labelKey) }),
        kind: "route",
        run: () => navigate(route.path),
      });
    }
    items.push({
      id: "create_word",
      label: t("commandPalette.createWord"),
      kind: "create",
      run: () => {
        const draft = createDraftWord(t("lexicon.newMeaning"));
        upsertWord(draft);
        setActiveWordId(draft.entry_id);
        navigate("/lexicon");
      },
    });
    return items;
  }, [languages, activeLanguageId, navigate, setActiveLanguage, upsertWord, setActiveWordId, t]);

  const filteredActions = useMemo(() => {
    const needle = body.toLowerCase();
    if (!needle) return actions;
    return actions.filter((action) => action.label.toLowerCase().includes(needle));
  }, [actions, body]);

  const rowCount = mode === "search" ? hits.length : mode === "actions" ? filteredActions.length : 0;

  const activate = (index: number) => {
    if (mode === "search") {
      const hit = hits[index];
      if (!hit) return;
      focusWordInLanguage(hit.languageId, hit.entryId);
      onClose();
      return;
    }
    if (mode === "actions") {
      const action = filteredActions[index];
      if (!action) return;
      action.run();
      onClose();
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (mode === "calc" || rowCount === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % rowCount);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + rowCount) % rowCount);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activate(activeIndex);
    }
  };

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open" onClick={onClose}>
        <div
          className="modal-box max-w-2xl p-0 overflow-hidden"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3">
            <Search size={16} className="text-base-content/50" />
            <input
              ref={inputRef}
              className="w-full bg-transparent outline-none text-sm"
              value={raw}
              placeholder={t("commandPalette.placeholder")}
              onChange={(event) => setRaw(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <kbd className="kbd kbd-sm">Esc</kbd>
          </div>

          {mode === "calc" ? (
            <CommandCalcPreview word={body} />
          ) : (
            <div ref={listRef} className="max-h-[22rem] overflow-y-auto py-1">
              {mode === "search" && hits.length === 0 && (
                <p className="px-4 py-6 text-sm text-base-content/50">
                  {body.trim() ? t("commandPalette.noResults") : t("commandPalette.searchHint")}
                </p>
              )}
              {mode === "search" &&
                hits.map((hit, index) => (
                  <button
                    key={`${hit.languageId}_${hit.entryId}`}
                    className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                      index === activeIndex ? "bg-primary/10" : "hover:bg-base-200"
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => activate(index)}
                  >
                    <BookOpen size={14} className="shrink-0 text-base-content/50" />
                    <span className="font-mono font-semibold shrink-0">{hit.romanized}</span>
                    {hit.ipa && (
                      <span className="font-mono text-xs text-success truncate shrink-0">
                        /{hit.ipa}/
                      </span>
                    )}
                    <span className="truncate text-base-content/60">{hit.gloss}</span>
                    <span className={`${BADGE} badge-xs badge-ghost ml-auto shrink-0`}>
                      {hit.languageName}
                    </span>
                  </button>
                ))}

              {mode === "actions" &&
                filteredActions.map((action, index) => (
                  <button
                    key={action.id}
                    className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                      index === activeIndex ? "bg-primary/10" : "hover:bg-base-200"
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => activate(index)}
                  >
                    {action.kind === "language" && <Languages size={14} />}
                    {action.kind === "route" && <ArrowRight size={14} />}
                    {action.kind === "create" && <Plus size={14} />}
                    <span className="truncate">{action.label}</span>
                  </button>
                ))}

              {mode === "actions" && filteredActions.length === 0 && (
                <p className="px-4 py-6 text-sm text-base-content/50">
                  {t("commandPalette.noResults")}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-base-300 px-4 py-2 text-[11px] text-base-content/50">
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft size={11} /> {t("commandPalette.enterHint")}
            </span>
            <span>{t("commandPalette.modeHints")}</span>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
