import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useLexiconStore } from "../../store/lexiconStore";
import {
  getLineageLexicon,
  invalidateLineageLexicon,
  listLineageSnapshots,
  loadLineageLexicon,
  useLineageLexiconCacheVersion,
} from "../../store/lineageLexiconStore";
import { saveLanguageViewMemory } from "../../lib/languageViewMemory";
import { CORE_CONCEPTS, SEMANTIC_FIELDS } from "../../data/core_concepts";
import {
  buildCognateMatrix,
  type CognateComparisonFilter,
  type CognateMatrixCell,
  type CognateMatrixRow,
} from "../../core/engines/cognateMatrix";
import { useSemanticFieldLabels } from "../../lib/labelMaps";
import { CognateMatrixTable } from "./CognateMatrixTable";
import { CognateMatrixToolbar } from "./CognateMatrixToolbar";
import { CognateCellDrawer } from "./CognateCellDrawer";
import { CognateTracePopover } from "./CognateTracePopover";
import { INPUT, SELECT, TOGGLE, CARD } from "../../lib/ui";
import { createWordInLanguage } from "../../utils/crossLanguageWord";
import type { WordEntry } from "../../types";

interface CognateMatrixViewProps {
  /** 在弹窗内跳转到词条前先关闭宿主弹窗 */
  onNavigateAway?: () => void;
}

/** 全语系同源词矩阵视图：语系页弹窗与独立页面共用同一份逻辑 */
export const CognateMatrixView: React.FC<CognateMatrixViewProps> = ({ onNavigateAway }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fieldLabels = useSemanticFieldLabels();
  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const languages = useWorkspaceStore((s) => s.config.languages);
  const customConcepts = useWorkspaceStore((s) => s.config.custom_concepts);
  const lexicalGaps = useWorkspaceStore((s) => s.config.lexical_gaps);
  const primaryOverrides = useWorkspaceStore((s) => s.config.primary_cognate_overrides);
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const setActiveLanguage = useWorkspaceStore((s) => s.setActiveLanguage);
  const cacheVersion = useLineageLexiconCacheVersion();

  const [loading, setLoading] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [failedLanguages, setFailedLanguages] = useState<string[]>([]);
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [field, setField] = useState("");
  const [search, setSearch] = useState("");
  const [pinnedLanguageId, setPinnedLanguageId] = useState("");
  const [comparisonFilter, setComparisonFilter] = useState<CognateComparisonFilter>("all");
  const [drawer, setDrawer] = useState<{
    row: CognateMatrixRow;
    cell: CognateMatrixCell;
  } | null>(null);
  const [trace, setTrace] = useState<{ row: CognateMatrixRow; setId: string } | null>(null);

  const reload = useCallback(() => {
    if (!projectPath) return;
    for (const language of languages) {
      invalidateLineageLexicon(projectPath, language.path);
    }
    setRetryTick((tick) => tick + 1);
  }, [projectPath, languages]);

  useEffect(() => {
    if (!projectPath || languages.length === 0) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const failed: string[] = [];
      await Promise.all(
        languages.map(async (language) => {
          try {
            await loadLineageLexicon(projectPath, language.path);
          } catch (err) {
            console.warn(`Cognate matrix: failed to load ${language.language_id}: ${err}`);
          }
          // 加载失败必须显式记录，禁止静默当作空词典
          if (!getLineageLexicon(projectPath, language.path)) {
            failed.push(language.language_id);
          }
        }),
      );
      if (!cancelled) {
        setFailedLanguages(failed);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, languages, cacheVersion, retryTick]);

  const wordsByLanguage = useMemo<Record<string, WordEntry[]>>(() => {
    if (!projectPath) return {};
    const snapshots = new Map(
      listLineageSnapshots(projectPath).map((item) => [item.languagePath, item.snapshot]),
    );
    const result: Record<string, WordEntry[]> = {};
    for (const language of languages) {
      const snapshot = snapshots.get(language.path);
      result[language.language_id] = snapshot ? Object.values(snapshot.wordsById) : [];
    }
    return result;
  }, [projectPath, languages, cacheVersion]);

  const concepts = useMemo(
    () => [...CORE_CONCEPTS, ...(customConcepts ?? [])],
    [customConcepts],
  );

  const matrix = useMemo(() => {
    if (languages.length === 0) {
      return { rows: [], languages: [], stats: null, totalMatchedConcepts: 0 };
    }
    const filteredConcepts = concepts.filter((concept) => {
      if (field && concept.semantic_field !== field) return false;
      if (!search.trim()) return true;
      const needle = search.trim().toLowerCase();
      return (
        concept.concept_id.toLowerCase().includes(needle) ||
        (concept.gloss_zh ?? "").toLowerCase().includes(needle) ||
        (concept.gloss_en ?? "").toLowerCase().includes(needle)
      );
    });
    return buildCognateMatrix({
      languages,
      wordsByLanguage,
      concepts: filteredConcepts,
      onlyFilled,
      // Roadmap v3：取消 400 行截断，全部概念一次加载
      maxRows: Number.MAX_SAFE_INTEGER,
      lexicalGaps: lexicalGaps ?? [],
      primaryOverrides: primaryOverrides ?? [],
      failedLanguageIds: failedLanguages,
      comparisonFilter,
    });
  }, [
    languages,
    wordsByLanguage,
    concepts,
    onlyFilled,
    field,
    search,
    lexicalGaps,
    primaryOverrides,
    failedLanguages,
    comparisonFilter,
  ]);

  const handleCreate = async (languageId: string, conceptId: string, romanized: string) => {
    const language = languages.find((item) => item.language_id === languageId);
    if (!language || !projectPath) return;
    const concept = concepts.find((item) => item.concept_id === conceptId);
    await createWordInLanguage({
      projectPath,
      languagePath: language.path,
      languageId,
      romanized,
      conceptId,
      gloss: concept?.gloss_zh || concept?.gloss_en || romanized,
    });
    reload();
  };

  const handleJump = (languageId: string, entryId: string) => {
    saveLanguageViewMemory(languageId, { activeWordId: entryId });
    if (languageId === activeLanguageId) {
      useLexiconStore.getState().setActiveWordId(entryId);
    } else {
      setActiveLanguage(languageId);
    }
    onNavigateAway?.();
    navigate("/lexicon");
  };

  const stats = matrix.stats;
  const drawerLanguage = languages.find(
    (language) => language.language_id === drawer?.cell.languageId,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {/* 两行固定布局：统计行不随筛选状态改宽度而换行，切换「只看已有词形」不再抖动 */}
      <div className={`${CARD} shrink-0 flex-col gap-2 px-4 py-2 text-xs`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-base-content/60 whitespace-nowrap">
            {t("cognate.stats", {
              languages: languages.length,
              concepts: stats?.conceptCount ?? 0,
              filled: stats?.filledCount ?? 0,
              cells: stats?.cellCount ?? 0,
            })}
          </span>
          <span className="text-success whitespace-nowrap">
            {t("cognate.legendInherited")} {stats?.cognateSetCount ?? 0}
          </span>
          <span className="text-warning whitespace-nowrap">
            {t("cognate.legendBorrowed")} {stats?.borrowedCount ?? 0}
          </span>
          <span className="text-info whitespace-nowrap">
            {t("cognate.legendInnovation")} {stats?.innovationCount ?? 0}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            className={`${INPUT} input-sm w-44 text-xs`}
            placeholder={t("cognate.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select className={`${SELECT} select-sm w-40 text-xs`} value={field} onChange={(event) => setField(event.target.value)}>
            <option value="">{t("lexicon.concept.allFields")}</option>
            {SEMANTIC_FIELDS.map((key) => (
              <option key={key} value={key}>{fieldLabels[key] ?? key}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              className={TOGGLE}
              checked={onlyFilled}
              onChange={(event) => setOnlyFilled(event.target.checked)}
            />
            {t("cognate.onlyFilled")}
          </label>
          {loading && <Loader2 size={14} className="animate-spin text-base-content/40" />}
        </div>
      </div>

      <CognateMatrixToolbar
        languages={matrix.languages}
        shown={matrix.rows.length}
        total={matrix.totalMatchedConcepts}
        pinnedLanguageId={pinnedLanguageId}
        comparisonFilter={comparisonFilter}
        failedLanguages={failedLanguages}
        loading={loading}
        onPinChange={setPinnedLanguageId}
        onFilterChange={setComparisonFilter}
        onRetry={reload}
      />

      <CognateMatrixTable
        rows={matrix.rows}
        languages={matrix.languages}
        activeLanguageId={activeLanguageId}
        pinnedLanguageId={pinnedLanguageId}
        onCreate={handleCreate}
        onOpenCell={(row, cell) => {
          // 抽屉与同源组气泡互斥：先收起 z-[1200] 的气泡，避免浮在抽屉之上
          setTrace(null);
          setDrawer({ row, cell });
        }}
        onOpenTrace={(row, setId) => setTrace({ row, setId })}
        onRetryLanguage={() => reload()}
      />

      <CognateCellDrawer
        open={Boolean(drawer)}
        row={drawer?.row ?? null}
        cell={drawer?.cell ?? null}
        languageName={drawerLanguage?.name ?? ""}
        languagePath={drawerLanguage?.path ?? ""}
        projectPath={projectPath}
        activeLanguageId={activeLanguageId}
        words={drawer ? (wordsByLanguage[drawer.cell.languageId] ?? []) : []}
        onClose={() => setDrawer(null)}
        onRefresh={reload}
        onJump={(entryId) => drawer && handleJump(drawer.cell.languageId, entryId)}
      />

      <CognateTracePopover
        open={Boolean(trace)}
        row={trace?.row ?? null}
        setId={trace?.setId ?? null}
        languages={matrix.languages}
        onClose={() => setTrace(null)}
      />
    </div>
  );
}
