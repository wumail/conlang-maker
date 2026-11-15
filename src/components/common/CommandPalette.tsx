import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import { CornerDownLeft, Search } from "lucide-react";
import { ModalPortal } from "./ModalPortal";
import { CommandCalcPreview } from "./CommandCalcPreview";
import {
  CommandPaletteResults,
  type PaletteActionItem,
} from "./CommandPaletteResults";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { useCorpusStore } from "../../store/corpusStore";
import {
  listLineageSnapshots,
  useLineageLexiconCacheVersion,
} from "../../store/lineageLexiconStore";
import { PALETTE_ROUTES, parsePaletteMode, type CommandWordHit, type WordSearchGroup } from "../../lib/commandPalette";
import { useCommandPaletteWarmup } from "../../lib/useCommandPaletteHotkey";
import { filterAndSearchWords } from "../../core/lexicon/searchLexicon";
import { saveLanguageViewMemory } from "../../lib/languageViewMemory";
import { CORE_CONCEPTS } from "../../data/core_concepts";
import { createDraftWord } from "../../utils/lexiconDraft";
import type { ConceptDefinition } from "../../types";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/** 全局命令面板：检索 / `>` 动作 / `=` 即时演算（Cmd+K） */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const languages = useWorkspaceStore((s) => s.config.languages);
  const customConcepts = useWorkspaceStore((s) => s.config.custom_concepts);
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

  useEffect(() => setActiveIndex(0), [raw]);

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

  const conceptsMap = useMemo(() => {
    const map = new Map<string, ConceptDefinition>();
    for (const concept of [...CORE_CONCEPTS, ...(customConcepts ?? [])]) {
      map.set(concept.concept_id, concept);
    }
    return map;
  }, [customConcepts]);

  /** 统一搜索引擎：词形 / IPA / 释义 / 定义 / 用法 / 标签 / 概念名与别名 */
  const hits = useMemo<CommandWordHit[]>(() => {
    if (mode !== "search" || !body.trim()) return [];
    const groups: WordSearchGroup[] = [
      {
        languageId: activeLanguageId,
        languageName: languages.find((item) => item.language_id === activeLanguageId)?.name ?? "",
        words: wordsList,
      },
      ...cachedGroups.filter((group) => group.languageId !== activeLanguageId),
    ];
    const out: CommandWordHit[] = [];
    for (const group of groups) {
      for (const word of filterAndSearchWords(group.words, { searchTerm: body }, conceptsMap)) {
        out.push({
          entryId: word.entry_id,
          languageId: group.languageId,
          languageName: group.languageName,
          romanized: word.con_word_romanized,
          ipa: word.phonetic_ipa,
          gloss: word.senses[0]?.gloss ?? "",
          tags: word.metadata?.tags ?? [],
          isActiveLanguage: group.languageId === activeLanguageId,
        });
        if (out.length >= 20) return out;
      }
    }
    return out;
  }, [mode, body, activeLanguageId, wordsList, cachedGroups, conceptsMap, languages]);

  /** 切换语言时保持当前路由；仅 /welcome 才回词典（目标词条由 App 视图记忆恢复选中） */
  const switchLanguage = (languageId: string, entryId?: string) => {
    saveLanguageViewMemory(activeLanguageId, {
      activeWordId: useLexiconStore.getState().activeWordId,
      activeCorpusId: useCorpusStore.getState().activeCorpus?.corpus_id ?? null,
    });
    if (entryId) saveLanguageViewMemory(languageId, { activeWordId: entryId });
    setActiveLanguage(languageId);
    // HashRouter 下 window.location.pathname 恒为 "/"，只能用 router 的 location
    if (location.pathname.startsWith("/welcome")) navigate("/lexicon");
  };

  const actions = useMemo<PaletteActionItem[]>(() => {
    const items: PaletteActionItem[] = [];
    for (const language of languages) {
      if (language.language_id === activeLanguageId) continue;
      items.push({
        id: `lang_${language.language_id}`,
        label: t("commandPalette.switchLanguage", { name: language.name }),
        kind: "language",
      });
    }
    for (const route of PALETTE_ROUTES) {
      items.push({
        id: `route_${route.path}`,
        label: t("commandPalette.goTo", { page: t(route.labelKey) }),
        kind: "route",
      });
    }
    items.push({ id: "create_word", label: t("commandPalette.createWord"), kind: "create" });
    return items;
  }, [languages, activeLanguageId, t]);

  const filteredActions = useMemo(() => {
    const needle = body.toLowerCase();
    if (!needle) return actions;
    return actions.filter((action) => action.label.toLowerCase().includes(needle));
  }, [actions, body]);

  const rowCount = mode === "search" ? hits.length : mode === "actions" ? filteredActions.length : 0;

  const runAction = (index: number) => {
    const action = filteredActions[index];
    if (!action) return;
    if (action.kind === "language") {
      switchLanguage(action.id.replace("lang_", ""));
    } else if (action.kind === "route") {
      const route = PALETTE_ROUTES.find((item) => `route_${item.path}` === action.id);
      if (route) navigate(route.path);
    } else {
      const draft = createDraftWord(t("lexicon.newMeaning"));
      upsertWord(draft);
      setActiveWordId(draft.entry_id);
      navigate("/lexicon");
    }
    onClose();
  };

  const activate = (index: number) => {
    if (mode === "search") {
      const hit = hits[index];
      if (!hit) return;
      if (hit.languageId !== activeLanguageId) {
        switchLanguage(hit.languageId, hit.entryId);
        navigate("/lexicon");
      } else {
        setActiveWordId(hit.entryId);
        navigate("/lexicon");
      }
      onClose();
      return;
    }
    if (mode === "actions") runAction(index);
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
          className="modal-box max-w-2xl overflow-hidden p-0"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3">
            <Search size={16} className="text-base-content/50" />
            <input
              ref={inputRef}
              className="w-full bg-transparent text-sm outline-none"
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
            <CommandPaletteResults
              mode={mode}
              body={body}
              hits={hits}
              actions={filteredActions}
              activeIndex={activeIndex}
              scopeLabel={t("commandPalette.scopeHint")}
              onActivate={activate}
              onHover={setActiveIndex}
            />
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
