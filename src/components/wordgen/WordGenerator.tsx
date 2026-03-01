import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { usePhonoStore } from "../../store/phonoStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import {
  generateWords,
  GenerateOptions,
  SWADESH_100,
  RewriteRule,
  DropoffMap,
  deriveGeneratorConfigByTypology,
} from "../../utils/wordGenerator";
import { generateIPA } from "../../utils/ipaGenerator";
import { Wand2, RefreshCw, Plus, Trash2 } from "lucide-react";
import { DEFAULT_LANGUAGE_ID } from "../../constants";
import {
  INPUT,
  INPUT_MONO,
  CARD,
  BTN_PRIMARY,
  BTN_ERROR,
  BTN_GHOST,
  CHECKBOX,
  BADGE,
} from "../../lib/ui";
import { CandidateTable, CandidateWord } from "./CandidateTable";
import { ConfirmModal } from "../common/ConfirmModal";
import { PageHeader } from "../common/PageHeader";

export const WordGenerator: React.FC = () => {
  const { t } = useTranslation();
  const phonoConfig = usePhonoStore((s) => s.config);
  const { importWords } = useLexiconStore();
  const partsOfSpeech = useGrammarStore((s) => s.config.parts_of_speech);
  const morphType = useGrammarStore(
    (s) => s.config.typology.morphological_type,
  );

  const typologyDefaults = deriveGeneratorConfigByTypology(morphType);
  const [count, setCount] = useState(20);
  const [minSyl, setMinSyl] = useState(typologyDefaults.minSyllables);
  const [maxSyl, setMaxSyl] = useState(typologyDefaults.maxSyllables);
  const [candidates, setCandidates] = useState<CandidateWord[]>([]);
  const [useSwadesh, setUseSwadesh] = useState(false);
  const [rewriteRules, setRewriteRules] = useState<RewriteRule[]>([]);
  const [dropoffs, setDropoffs] = useState<DropoffMap>({});
  const [confirmDeleteRewriteRuleIdx, setConfirmDeleteRewriteRuleIdx] =
    useState<number | null>(null);

  const macroKeys = Object.keys(phonoConfig.phonotactics.macros);

  const handleGenerate = useCallback(() => {
    const options: GenerateOptions = {
      count,
      minSyllables: minSyl,
      maxSyllables: maxSyl,
      rewriteRules,
      dropoffs,
    };
    const words = generateWords(phonoConfig, options);
    const newCandidates: CandidateWord[] = words.map((w, i) => {
      const { phonemic } = generateIPA(w, phonoConfig);
      return {
        id: crypto.randomUUID(),
        word: w,
        ipa: phonemic,
        selected: false,
        swadeshConcept:
          useSwadesh && i < SWADESH_100.length ? SWADESH_100[i] : undefined,
        posId: partsOfSpeech[0]?.pos_id || "",
      };
    });
    setCandidates(newCandidates);
  }, [count, minSyl, maxSyl, phonoConfig, useSwadesh, partsOfSpeech]);

  const toggleSelect = (id: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)),
    );
  };

  const toggleAll = () => {
    const allSelected = candidates.every((c) => c.selected);
    setCandidates((prev) =>
      prev.map((c) => ({ ...c, selected: !allSelected })),
    );
  };

  const updateCandidate = (
    id: string,
    field: keyof CandidateWord,
    value: CandidateWord[keyof CandidateWord],
  ) => {
    setCandidates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
    );
  };

  const removeCandidate = (id: string) => {
    setCandidates((prev) => prev.filter((c) => c.id !== id));
  };

  const handleImport = () => {
    const selected = candidates.filter((c) => c.selected);
    const newWords = selected.map((c) => ({
      entry_id: crypto.randomUUID(),
      language_id: DEFAULT_LANGUAGE_ID,
      con_word_romanized: c.word,
      phonetic_ipa: c.ipa,
      phonetic_override: false,
      senses: c.swadeshConcept
        ? [
            {
              sense_id: crypto.randomUUID(),
              pos_id: c.posId || "",
              gloss: c.swadeshConcept,
              definitions: [],
              examples: [],
            },
          ]
        : [],
      etymology: {
        origin_type: "a_priori" as const,
        parent_entry_id: null,
        source_language_id: null,
        applied_sound_changes: [],
        semantic_shift_note: "",
      },
      metadata: {
        tags: ["generated"],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }));
    importWords(newWords);
    // Remove imported from candidates
    const importedIds = new Set(selected.map((c) => c.id));
    setCandidates((prev) => prev.filter((c) => !importedIds.has(c.id)));
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={<Wand2 size={24} />} title={t("wordgen.title")} />

      <div className={`${CARD} p-6`}>
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-base-200/50 rounded-lg border border-base-200 ">
          <div>
            <label className="block text-xs text-base-content/60 mb-1">
              {t("wordgen.count")}
            </label>
            <input
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className={`w-20 ${INPUT}`}
            />
          </div>
          <div>
            <label className="block text-xs text-base-content/60 mb-1">
              {t("wordgen.minSyl")}
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={minSyl}
              onChange={(e) => setMinSyl(Number(e.target.value))}
              className={`w-16 ${INPUT}`}
            />
          </div>
          <div>
            <label className="block text-xs text-base-content/60 mb-1">
              {t("wordgen.maxSyl")}
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={maxSyl}
              onChange={(e) => setMaxSyl(Number(e.target.value))}
              className={`w-16 ${INPUT}`}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="use-swadesh"
              checked={useSwadesh}
              onChange={(e) => setUseSwadesh(e.target.checked)}
              className={CHECKBOX}
            />
            <label
              htmlFor="use-swadesh"
              className="text-sm text-base-content/70"
            >
              {t("wordgen.swadesh")}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className={`${BADGE} badge-info`}>
              {t(`typology.types.${morphType}`)}
            </span>
            <button
              onClick={() => {
                setMinSyl(typologyDefaults.minSyllables);
                setMaxSyl(typologyDefaults.maxSyllables);
              }}
              className={BTN_GHOST}
            >
              {t("wordgen.applyTypologyDefaults")}
            </button>
          </div>
          <button onClick={handleGenerate} className={`${BTN_PRIMARY} `}>
            <RefreshCw size={14} /> {t("wordgen.generate")}
          </button>
        </div>

        {/* Rewrite Rules */}
        <div className="mb-4 p-3 bg-base-200/50 rounded-lg border border-base-200">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-medium text-base-content/70">
              {t("wordgen.rewriteRules")}
            </span>
            <button
              onClick={() =>
                setRewriteRules((prev) => [
                  ...prev,
                  { pattern: "", replacement: "" },
                ])
              }
              className={BTN_GHOST}
            >
              <Plus size={12} /> {t("wordgen.addRewriteRule")}
            </button>
          </div>
          {rewriteRules.map((rule, i) => (
            <div key={i} className="flex items-center gap-2 mb-1">
              <input
                type="text"
                value={rule.pattern}
                onChange={(e) =>
                  setRewriteRules((prev) =>
                    prev.map((r, j) =>
                      j === i ? { ...r, pattern: e.target.value } : r,
                    ),
                  )
                }
                className={`flex-1 ${INPUT_MONO}`}
                placeholder={t("wordgen.rewritePattern")}
              />
              <span className="text-base-content/50">→</span>
              <input
                type="text"
                value={rule.replacement}
                onChange={(e) =>
                  setRewriteRules((prev) =>
                    prev.map((r, j) =>
                      j === i ? { ...r, replacement: e.target.value } : r,
                    ),
                  )
                }
                className={`flex-1 ${INPUT_MONO}`}
                placeholder={t("wordgen.rewriteReplacement")}
              />
              <button
                onClick={() => setConfirmDeleteRewriteRuleIdx(i)}
                className={BTN_ERROR}
                title={t("wordgen.deleteRewriteRule")}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {/* Per-macro Dropoff */}
        {macroKeys.length > 0 && (
          <div className="mb-4 p-3 bg-base-200/50 rounded-lg border border-base-200">
            <span className="text-xs font-medium text-base-content/70 block mb-2">
              {t("wordgen.dropoff")}
            </span>
            <div className="flex flex-wrap gap-4">
              {macroKeys.map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-base-content/80 w-6">
                    {key}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={3}
                    step={0.1}
                    value={dropoffs[key] ?? 1.0}
                    onChange={(e) =>
                      setDropoffs((prev) => ({
                        ...prev,
                        [key]: Number(e.target.value),
                      }))
                    }
                    className="range range-xs range-primary w-24"
                  />
                  <span className="text-xs font-mono w-8">
                    {(dropoffs[key] ?? 1.0).toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {candidates.length > 0 && (
          <CandidateTable
            candidates={candidates}
            useSwadesh={useSwadesh}
            partsOfSpeech={partsOfSpeech}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
            onUpdate={updateCandidate}
            onRemove={removeCandidate}
            onImport={handleImport}
          />
        )}

        {candidates.length === 0 && (
          <p className="text-sm text-base-content/50 italic text-center py-8">
            {t("wordgen.hint")}
          </p>
        )}
      </div>

      <ConfirmModal
        open={confirmDeleteRewriteRuleIdx !== null}
        title={t("common.delete")}
        message={t(
          "wordgen.deleteRewriteRuleConfirm",
          "Are you sure you want to delete this rewrite rule?",
        )}
        onConfirm={() => {
          if (confirmDeleteRewriteRuleIdx !== null) {
            setRewriteRules((prev) =>
              prev.filter((_, j) => j !== confirmDeleteRewriteRuleIdx),
            );
            setConfirmDeleteRewriteRuleIdx(null);
          }
        }}
        onCancel={() => setConfirmDeleteRewriteRuleIdx(null)}
      />
    </div>
  );
};
