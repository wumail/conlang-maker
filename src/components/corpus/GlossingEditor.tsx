import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useCorpusStore } from "../../store/corpusStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useSCAStore } from "../../store/scaStore";
import type { CorpusText, WordEntry } from "../../types";
import { GlossLineRow } from "./GlossLineRow";
import { GlossingToolbar, type LineFilter } from "./GlossingToolbar";
import { PendingSuggestionsPanel } from "./PendingSuggestionsPanel";
import { useCorpusLineStats } from "./useCorpusLineStats";
import { BatchDiffPreviewModal } from "../common/BatchDiffPreviewModal";
import { CorpusScaDiffPanel } from "./CorpusScaDiffPanel";
import { buildMacrosFromInventory } from "../../utils/scaEngine";
import {
  autoGloss,
  applySelectedCorpusScaDiffs,
  applySuggestionToLines,
  type AutoGlossCache,
  type AutoGlossReport,
  type AutoGlossScopeMode,
  collectCorpusScaDiffs,
  type CorpusScaDiffItem,
  mergeAutoGlossIntoCorpus,
  type PendingSuggestion,
  reGlossLineUnresolvedTokens,
  resolveInflectedIpa,
} from "../../core/workflows/autoGloss";
import { CARD, CARD_BODY } from "../../lib/ui";

export function GlossingEditor() {
  const { t } = useTranslation();
  const corpus = useCorpusStore((s) => s.activeCorpus);
  const addGlossedLine = useCorpusStore((s) => s.addGlossedLine);
  const upsertCorpus = useCorpusStore((s) => s.upsertCorpus);
  const grammarConfig = useGrammarStore((s) => s.config);
  const phonoConfig = usePhonoStore((s) => s.config);
  const scaConfig = useSCAStore((s) => s.config);
  const wordsList = useLexiconStore((s) => s.wordsList);
  const [params] = useSearchParams();
  const highlightLineId = params.get("line");
  const [pendingSuggestions, setPendingSuggestions] = useState<PendingSuggestion[]>([]);
  const [lastReport, setLastReport] = useState<AutoGlossReport | null>(null);
  const [mode, setMode] = useState<AutoGlossScopeMode>("fill_empty");
  const [filter, setFilter] = useState<LineFilter>("all");
  const [scaDiffItems, setScaDiffItems] = useState<CorpusScaDiffItem[]>([]);
  const [scaPreviewChecked, setScaPreviewChecked] = useState(false);
  const [pendingMerge, setPendingMerge] = useState<{
    lines: CorpusText["glossed_lines"];
    replaced: Array<{ lineId: string; tokenId: string; beforeGloss: string; afterGloss: string; surface: string }>;
    report: AutoGlossReport;
  } | null>(null);
  const autoGlossCacheRef = useRef<AutoGlossCache>({});

  useEffect(() => {
    if (!corpus) return;
    setPendingSuggestions([]);
    setScaDiffItems([]);
    setScaPreviewChecked(false);
    setLastReport(corpus.metadata.auto_gloss_report || null);
  }, [corpus?.corpus_id]);

  const { lineStats, visibleLines, counts } = useCorpusLineStats(corpus, wordsList, filter);
  if (!corpus) return null;

  const getEntryIpa = (_entry: WordEntry, form: string, stemStart?: number): string =>
    resolveInflectedIpa(form, stemStart, phonoConfig);

  const commit = (target: CorpusText, lines: CorpusText["glossed_lines"], report?: AutoGlossReport, skipHistory?: boolean) =>
    upsertCorpus(
      {
        ...target,
        glossed_lines: lines,
        metadata: { ...target.metadata, updated_at: new Date().toISOString(), ...(report ? { auto_gloss_report: report } : {}) },
      },
      skipHistory ? { skipHistory: true } : undefined,
    );

  const closeScaPreview = () => {
    setScaDiffItems([]);
    setScaPreviewChecked(false);
  };

  const handleAddLine = () =>
    addGlossedLine({ line_id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, original: "", tokens: [], translation: "" });

  const applyAllPending = () => {
    if (!pendingSuggestions.length) return;
    let lines = corpus.glossed_lines;
    for (const suggestion of pendingSuggestions) {
      lines = applySuggestionToLines(lines, suggestion, getEntryIpa);
    }
    commit(corpus, lines);
    setPendingSuggestions([]);
  };

  const applySinglePending = (target: PendingSuggestion) => {
    commit(corpus, applySuggestionToLines(corpus.glossed_lines, target, getEntryIpa));
    setPendingSuggestions((prev) =>
      prev.filter((item) => !(item.lineId === target.lineId && item.tokenId === target.tokenId)),
    );
  };

  /** 三模式非破坏合并：任何模式下都保留 line.translation */
  const runAutoGloss = (target: CorpusText, scopeMode: AutoGlossScopeMode = mode) => {
    if (!target.original_text.trim()) return;
    const { lines, pending, report } = autoGloss({
      originalText: target.original_text,
      words: useLexiconStore.getState().wordsList,
      grammar: grammarConfig,
      phono: phonoConfig,
      cache: autoGlossCacheRef.current,
      // 按位置复用旧 line_id：否则新分析结果无法与既有行匹配，会被整体丢弃
      createLineId: (idx) =>
        target.glossed_lines[idx]?.line_id ?? `line_${Date.now()}_${idx}`,
    });
    const selectedLineIds = new Set(
      scopeMode === "reanalyze_selected"
        ? target.glossed_lines
            .filter((line) => {
              const stat = lineStats.get(line.line_id);
              if (filter === "all") return true;
              if (!stat) return false;
              if (filter === "unresolved") return stat.unresolved;
              if (filter === "multi_candidate") return stat.multi;
              return stat.broken;
            })
            .map((line) => line.line_id)
        : [
            ...target.glossed_lines.map((line) => line.line_id),
            ...lines.map((line) => line.line_id),
          ],
    );
    const merged = mergeAutoGlossIntoCorpus({
      corpus: target,
      freshLines: lines,
      mode: scopeMode,
      selectedLineIds,
    });
    if (scopeMode === "reanalyze_selected" && merged.replacedProtectedTokens.length > 0) {
      setPendingMerge({ lines: merged.nextLines, replaced: merged.replacedProtectedTokens, report });
      return;
    }
    commit(target, merged.nextLines, report);
    setPendingSuggestions(pending);
    setLastReport(report);
  };

  const reGlossSingleLine = (targetCorpus: CorpusText, lineId: string, skipHistory?: boolean) => {
    const words = useLexiconStore.getState().wordsList;
    commit(
      targetCorpus,
      targetCorpus.glossed_lines.map((line) =>
        line.line_id === lineId
          ? reGlossLineUnresolvedTokens(line, words, grammarConfig, phonoConfig, autoGlossCacheRef.current)
          : line,
      ),
      undefined,
      skipHistory,
    );
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
    setScaDiffItems((prev) => prev.map((item) => ({ ...item, selected })));

  const toggleScaDiff = (id: string) =>
    setScaDiffItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item)),
    );

  /** 音变改写原文后只重算机器标注，100% 保留所有句译 */
  const applySelectedCorpusSCA = () => {
    const selected = scaDiffItems.filter((item) => item.selected);
    if (selected.length === 0) return;
    const nextCorpus = applySelectedCorpusScaDiffs(corpus, selected, new Date().toISOString());
    const glossed = autoGloss({
      originalText: nextCorpus.original_text,
      words: useLexiconStore.getState().wordsList,
      grammar: grammarConfig,
      phono: phonoConfig,
      cache: autoGlossCacheRef.current,
      createLineId: (idx) =>
        nextCorpus.glossed_lines[idx]?.line_id ?? `line_${Date.now()}_${idx}`,
    });
    const merged = mergeAutoGlossIntoCorpus({
      corpus: nextCorpus,
      freshLines: glossed.lines,
      mode: "recompute_auto",
      selectedLineIds: new Set(nextCorpus.glossed_lines.map((line) => line.line_id)),
    });
    commit(nextCorpus, merged.nextLines, glossed.report);
    setLastReport(glossed.report);
    closeScaPreview();
  };

  const selectedScaCount = scaDiffItems.filter((item) => item.selected).length;

  return (
    <div className={CARD}>
      <div className={`${CARD_BODY} space-y-4 p-4`}>
        <GlossingToolbar
          mode={mode}
          onModeChange={setMode}
          filter={filter}
          onFilterChange={setFilter}
          counts={counts}
          report={lastReport}
          onRunAutoGloss={() => runAutoGloss(corpus)}
          onPreviewSca={handlePreviewCorpusSCA}
          onAddLine={handleAddLine}
        />

        {pendingSuggestions.length > 0 && (
          <PendingSuggestionsPanel
            suggestions={pendingSuggestions}
            onApplyAll={applyAllPending}
            onApplyOne={applySinglePending}
            onDismiss={() => setPendingSuggestions([])}
          />
        )}

        {(scaPreviewChecked || scaDiffItems.length > 0) && (
          <CorpusScaDiffPanel
            items={scaDiffItems}
            selectedCount={selectedScaCount}
            onToggleAll={toggleAllScaDiffs}
            onToggle={toggleScaDiff}
            onApply={applySelectedCorpusSCA}
            onClose={closeScaPreview}
          />
        )}

        {visibleLines.length === 0 && (
          <p className="text-sm text-base-content/50">{t("corpus.noTexts")}</p>
        )}

        {visibleLines.map((line) => (
          <GlossLineRow
            key={line.line_id}
            line={line}
            onLexEntryCreated={() => {
              // 收词/绑定后必须读最新语料且跳过独立历史，由 QuickLex 组合撤销统一回滚整行
              const latest = useCorpusStore.getState().activeCorpus;
              if (latest) reGlossSingleLine(latest, line.line_id, true);
            }}
            highlight={Boolean(highlightLineId) && line.line_id === highlightLineId}
          />
        ))}
      </div>

      <BatchDiffPreviewModal
        open={Boolean(pendingMerge)}
        title={t("corpus.v3.confirmReanalyzeTitle")}
        summaryText={t("corpus.v3.confirmReanalyzeSummary", {
          lines: new Set(pendingMerge?.replaced.map((item) => item.lineId) ?? []).size,
          tokens: pendingMerge?.replaced.length ?? 0,
        })}
        rows={(pendingMerge?.replaced ?? []).map((item) => ({
          id: `${item.lineId}:${item.tokenId}`,
          label: item.surface,
          before: item.beforeGloss,
          after: item.afterGloss,
          warning: t("corpus.v3.confirmReanalyzeTitle"),
        }))}
        onConfirm={() => {
          if (!pendingMerge) return;
          const latest = useCorpusStore.getState().activeCorpus ?? corpus;
          commit(latest, pendingMerge.lines, pendingMerge.report);
          setLastReport(pendingMerge.report);
          setPendingMerge(null);
        }}
        onCancel={() => setPendingMerge(null)}
      />
    </div>
  );
}
