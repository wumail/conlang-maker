import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Table2 } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGrammarStore } from "../store/grammarStore";
import {
  listLineageSnapshots,
  loadLineageLexicon,
  useLineageLexiconCacheVersion,
} from "../store/lineageLexiconStore";
import { CORE_CONCEPTS, SEMANTIC_FIELDS } from "../data/core_concepts";
import { buildCognateMatrix } from "../core/engines/cognateMatrix";
import { useSemanticFieldLabels } from "../lib/labelMaps";
import { PageHeader } from "../components/common/PageHeader";
import { CognateMatrixTable } from "../components/tree/CognateMatrixTable";
import { INPUT, SELECT, TOGGLE, CARD } from "../lib/ui";
import { createWordInLanguage, pickNounPosId } from "../utils/crossLanguageWord";
import type { WordEntry } from "../types";

/** 全语系同源词矩阵页（/cognates） */
export default function CognateMatrixPage() {
  const { t } = useTranslation();
  const fieldLabels = useSemanticFieldLabels();
  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const languages = useWorkspaceStore((s) => s.config.languages);
  const customConcepts = useWorkspaceStore((s) => s.config.custom_concepts);
  const partsOfSpeech = useGrammarStore((s) => s.config.parts_of_speech);
  const cacheVersion = useLineageLexiconCacheVersion();

  const [loading, setLoading] = useState(false);
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [field, setField] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!projectPath || languages.length === 0) return;
    let cancelled = false;
    setLoading(true);
    void Promise.all(
      languages.map((language) =>
        loadLineageLexicon(projectPath, language.path).catch(() => null),
      ),
    ).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath, languages, cacheVersion]);

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
      return { rows: [], languages: [], stats: null };
    }
    const filteredConcepts = concepts.filter((concept) => {
      if (field && concept.semantic_field !== field) return false;
      if (!search.trim()) return true;
      const needle = search.trim().toLowerCase();
      return (
        concept.concept_id.includes(needle) ||
        (concept.gloss_zh ?? "").toLowerCase().includes(needle) ||
        (concept.gloss_en ?? "").toLowerCase().includes(needle)
      );
    });
    return buildCognateMatrix({
      languages,
      wordsByLanguage,
      concepts: filteredConcepts,
      onlyFilled,
    });
  }, [languages, wordsByLanguage, concepts, field, search, onlyFilled]);

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
      posId: pickNounPosId(partsOfSpeech),
    });
  };

  const stats = matrix.stats;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-8">
      <PageHeader icon={<Table2 className="h-6 w-6" />} title={t("cognate.title")}>
        <p className="max-w-2xl text-right text-xs text-base-content/50">
          {t("cognate.description")}
        </p>
      </PageHeader>

      <div className={`${CARD} flex flex-wrap items-center gap-3 p-3 text-xs`}>
        <span className="text-base-content/60">
          {t("cognate.stats", {
            languages: languages.length,
            concepts: stats?.conceptCount ?? 0,
            filled: stats?.filledCount ?? 0,
            cells: stats?.cellCount ?? 0,
          })}
        </span>
        <span className="text-success">
          {t("cognate.legendInherited")} {stats?.cognateSetCount ?? 0}
        </span>
        <span className="text-warning">
          {t("cognate.legendBorrowed")} {stats?.borrowedCount ?? 0}
        </span>
        <span className="text-info">
          {t("cognate.legendInnovation")} {stats?.innovationCount ?? 0}
        </span>
        <div className="flex-1" />
        <input
          className={`${INPUT} h-8 w-48 text-xs`}
          placeholder={t("cognate.searchPlaceholder")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className={`${SELECT} select-xs`}
          value={field}
          onChange={(event) => setField(event.target.value)}
        >
          <option value="">{t("lexicon.concept.allFields")}</option>
          {SEMANTIC_FIELDS.map((key) => (
            <option key={key} value={key}>
              {fieldLabels[key] ?? key}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
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

      <CognateMatrixTable
        rows={matrix.rows}
        languages={matrix.languages}
        onCreate={handleCreate}
      />
    </div>
  );
}
