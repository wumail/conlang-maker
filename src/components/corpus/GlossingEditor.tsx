import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Plus, Wand2 } from "lucide-react";
import { useCorpusStore } from "../../store/corpusStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useSCAStore } from "../../store/scaStore";
import { CorpusText, WordEntry } from "../../types";
import { GlossLineRow } from "./GlossLineRow";
import { buildMacrosFromInventory } from "../../utils/scaEngine";
import {
  autoGloss,
  applySelectedCorpusScaDiffs,
  applySuggestionToLines,
  AutoGlossCache,
  AutoGlossReport,
  collectCorpusScaDiffs,
  CorpusDiffScope,
  CorpusScaDiffItem,
  PendingSuggestion,
  resolveInflectedIpa,
} from "../../core/workflows/autoGloss";
import { BTN_PRIMARY, BTN_GHOST, CARD, CARD_BODY } from "../../lib/ui";

export function GlossingEditor() {
  const { t } = useTranslation();
  const corpus = useCorpusStore((s) => s.activeCorpus);
  const addGlossedLine = useCorpusStore((s) => s.addGlossedLine);
  const upsertCorpus = useCorpusStore((s) => s.upsertCorpus);
  const wordsList = useLexiconStore((s) => s.wordsList);
  const grammarConfig = useGrammarStore((s) => s.config);
  const phonoConfig = usePhonoStore((s) => s.config);
  const scaConfig = useSCAStore((s) => s.config);
  const [pendingSuggestions, setPendingSuggestions] = useState<PendingSuggestion[]>([]);
  const [lastReport, setLastReport] = useState<AutoGlossReport | null>(null);
  const [scaDiffItems, setScaDiffItems] = useState<CorpusScaDiffItem[]>([]);
  const [scaPreviewChecked, setScaPreviewChecked] = useState(false);
  const autoGlossCacheRef = useRef<AutoGlossCache>({});

  useEffect(() => {
    if (!corpus) return;
    setPendingSuggestions([]);
    setScaDiffItems([]);
    setScaPreviewChecked(false);
    setLastReport(corpus.metadata.auto_gloss_report || null);
  }, [corpus?.corpus_id]);

  if (!corpus) return null;

  const getEntryIpa = (_entry: WordEntry, form: string, stemStart?: number): string =>
    resolveInflectedIpa(form, stemStart, phonoConfig);

  const closeScaPreview = () => {
    setScaDiffItems([]);
    setScaPreviewChecked(false);
  };

  const handleAddLine = () => {
    addGlossedLine({
      line_id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      original: "",
      tokens: [],
      translation: "",
    });
  };

  const applyAllPending = () => {
    if (!pendingSuggestions.length) return;
    let lines = corpus.glossed_lines;
    for (const s of pendingSuggestions) {
      lines = applySuggestionToLines(lines, s, getEntryIpa);
    }
    upsertCorpus({
      ...corpus,
      glossed_lines: lines,
      metadata: { ...corpus.metadata, updated_at: new Date().toISOString() },
    });
    setPendingSuggestions([]);
  };

  const applySinglePending = (target: PendingSuggestion) => {
    const lines = applySuggestionToLines(corpus.glossed_lines, target, getEntryIpa);
    upsertCorpus({
      ...corpus,
      glossed_lines: lines,
      metadata: { ...corpus.metadata, updated_at: new Date().toISOString() },
    });
    setPendingSuggestions((prev) =>
      prev.filter((s) => !(s.lineId === target.lineId && s.tokenId === target.tokenId)),
    );
  };

  const runAutoGloss = (targetCorpus: CorpusText) => {
    if (!targetCorpus.original_text.trim()) return;
    const { lines, pending, report } = autoGloss({
      originalText: targetCorpus.original_text,
      words: wordsList,
      grammar: grammarConfig,
      phono: phonoConfig,
      cache: autoGlossCacheRef.current,
    });
    upsertCorpus({
      ...targetCorpus,
      glossed_lines: lines,
      metadata: { ...targetCorpus.metadata, updated_at: new Date().toISOString(), auto_gloss_report: report },
    });
    setPendingSuggestions(pending);
    setLastReport(report);
  };

  const handlePreviewCorpusSCA = () => {
    const macros = buildMacrosFromInventory(
      phonoConfig.phoneme_inventory.consonants,
      phonoConfig.phoneme_inventory.vowels,
      phonoConfig.phonotactics.macros,
    );
    setScaPreviewChecked(true);
    setScaDiffItems(collectCorpusScaDiffs(corpus, scaConfig.rule_sets, macros));
  };

  const toggleAllScaDiffs = (selected: boolean) =>
    setScaDiffItems((prev) => prev.map((d) => ({ ...d, selected })));

  const toggleScaDiff = (id: string) =>
    setScaDiffItems((prev) => prev.map((d) => (d.id === id ? { ...d, selected: !d.selected } : d)));

  const applySelectedCorpusSCA = () => {
    const selected = scaDiffItems.filter((d) => d.selected);
    if (selected.length === 0) return;
    const nextCorpus = applySelectedCorpusScaDiffs(corpus, selected, new Date().toISOString());
    upsertCorpus(nextCorpus);
    closeScaPreview();
    runAutoGloss(nextCorpus);
  };

  const selectedScaCount = scaDiffItems.filter((d) => d.selected).length;
  const scopeLabel = (scope: CorpusDiffScope) =>
    scope === "originalText"
      ? t("corpus.scaDiffOriginalText")
      : scope === "lineOriginal"
        ? t("corpus.scaDiffLineOriginal")
        : t("corpus.scaDiffTokenSurface");

  return (
    <div className={CARD}>
      <div className={`${CARD_BODY} p-4 space-y-4`}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{t("corpus.glossing")}</h3>
          <div className="flex gap-2">
            <button className={BTN_PRIMARY} onClick={() => runAutoGloss(corpus)}>
              <Wand2 className="w-4 h-4" /> {t("corpus.autoGloss")}
            </button>
            <button className={BTN_GHOST} onClick={handlePreviewCorpusSCA}>
              <Wand2 className="w-4 h-4" /> {t("corpus.applyScaPreview")}
            </button>
            <button className={BTN_GHOST} onClick={handleAddLine}>
              <Plus className="w-4 h-4" /> {t("corpus.addLine")}
            </button>
          </div>
        </div>

        {lastReport && (
          <div className="text-xs text-base-content/70 bg-base-200 border border-base-300 rounded-lg px-3 py-2">
            {t("corpus.autoGlossReport", {
              total: lastReport.total,
              autoApplied: lastReport.autoApplied,
              pending: lastReport.pending,
              unresolved: lastReport.unresolved,
            })}
          </div>
        )}

        {pendingSuggestions.length > 0 && (
          <div className="border border-warning/40 bg-warning/10 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">
                {t("corpus.pendingSuggestionsTitle", { count: pendingSuggestions.length })}
              </div>
              <div className="flex gap-2">
                <button className={BTN_GHOST} onClick={() => setPendingSuggestions([])}>
                  {t("common.close")}
                </button>
                <button className={BTN_PRIMARY} onClick={applyAllPending}>
                  {t("corpus.applyAllSuggestions")}
                </button>
              </div>
            </div>
            <div className="max-h-52 overflow-auto border border-base-300 rounded bg-base-100">
              <table className="table table-xs w-full">
                <thead>
                  <tr>
                    <th>{t("corpus.suggestionToken")}</th>
                    <th>{t("corpus.suggestionValue")}</th>
                    <th>{t("corpus.suggestionConfidence")}</th>
                    <th>{t("corpus.suggestionTrace")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pendingSuggestions.map((s) => (
                    <tr key={`${s.lineId}_${s.tokenId}`}>
                      <td className="font-mono">{s.surfaceForm}</td>
                      <td className="font-mono text-xs">{s.suggestion.morphemeBreak}</td>
                      <td>{Math.round(s.suggestion.confidence * 100)}%</td>
                      <td className="text-base-content/60">{s.suggestion.trace}</td>
                      <td>
                        <button className="btn btn-ghost btn-xs" onClick={() => applySinglePending(s)}>
                          {t("corpus.applySuggestion")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(scaPreviewChecked || scaDiffItems.length > 0) && (
          <div className="relative border border-primary/30 bg-primary/5 rounded-lg p-3 space-y-2">
            <button
              className="btn btn-xs btn-circle btn-outline border-error text-error hover:bg-error/10 absolute -top-3 -right-3 bg-base-100 scale-75"
              onClick={closeScaPreview}
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">
                {t("corpus.scaDiffTitle", { count: scaDiffItems.length })}
              </div>
              <div className="flex gap-2">
                <button className={BTN_GHOST} onClick={() => toggleAllScaDiffs(true)}>
                  {t("common.selectAll")}
                </button>
                <button className={BTN_GHOST} onClick={() => toggleAllScaDiffs(false)}>
                  {t("common.deselect")}
                </button>
                <button className={BTN_PRIMARY} onClick={applySelectedCorpusSCA} disabled={selectedScaCount === 0}>
                  {t("corpus.applySelectedScaChanges", { count: selectedScaCount })}
                </button>
              </div>
            </div>

            {scaDiffItems.length === 0 ? (
              <p className="text-xs text-base-content/60">{t("corpus.applyScaNoChanges")}</p>
            ) : (
              <div className="max-h-60 overflow-auto border border-base-300 rounded bg-base-100">
                <table className="table table-xs w-full">
                  <thead>
                    <tr>
                      <th />
                      <th>{t("corpus.scaDiffScope")}</th>
                      <th>{t("corpus.originalText")}</th>
                      <th>{t("corpus.result")}</th>
                      <th>{t("corpus.scaDiffContext")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scaDiffItems.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <input
                            type="checkbox"
                            className="checkbox checkbox-xs checkbox-primary"
                            checked={d.selected}
                            onChange={() => toggleScaDiff(d.id)}
                          />
                        </td>
                        <td>{scopeLabel(d.scope)}</td>
                        <td className="font-mono">{d.before}</td>
                        <td className="font-mono">{d.after}</td>
                        <td className="text-base-content/60">{d.context}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {corpus.glossed_lines.length === 0 && (
          <p className="text-base-content/50 text-sm">{t("corpus.noTexts")}</p>
        )}

        {corpus.glossed_lines.map((line) => (
          <GlossLineRow key={line.line_id} line={line} />
        ))}
      </div>
    </div>
  );
}
