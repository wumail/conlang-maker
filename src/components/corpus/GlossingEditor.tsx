import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Plus, Wand2 } from "lucide-react";
import { useCorpusStore } from "../../store/corpusStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useSCAStore } from "../../store/scaStore";
import {
  GlossedLine,
  GlossToken,
  InflectionRule,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import { GlossLineRow } from "./GlossLineRow";
import { generateIPA } from "../../utils/ipaGenerator";
import { applyInflection } from "../../utils/morphologyEngine";
import {
  applySoundChanges,
  buildMacrosFromInventory,
} from "../../utils/scaEngine";
import { BTN_PRIMARY, BTN_GHOST, CARD, CARD_BODY } from "../../lib/ui";

const AUTO_APPLY_CONFIDENCE = 0.88;
const CHUNK_SIZE = 12;

interface ParsedInflection {
  entry: WordEntry;
  morphemeBreak: string;
  glossLabels: string;
  score: number;
  confidence: number;
  trace: string;
}

interface AffixRuleInfo {
  rule: InflectionRule;
  affix: string;
  label: string;
}

interface PendingSuggestion {
  lineId: string;
  tokenId: string;
  surfaceForm: string;
  suggestion: ParsedInflection;
}

interface AutoGlossReport {
  total: number;
  autoApplied: number;
  pending: number;
  unresolved: number;
}

interface CachedTransformIndex {
  signature: string;
  index: Map<string, ParsedInflection[]>;
}

type CorpusDiffScope = "originalText" | "lineOriginal" | "tokenSurface";
type CorpusDiffTarget = "original_text" | "line_original" | "token_surface";

interface CorpusScaDiffItem {
  id: string;
  scope: CorpusDiffScope;
  target: CorpusDiffTarget;
  lineId?: string;
  tokenId?: string;
  before: string;
  after: string;
  context: string;
  selected: boolean;
  start?: number;
  end?: number;
}

const WORD_TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;

function normalizeToken(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}-]+|[^\p{L}\p{N}-]+$/gu, "");
}

function buildTransformCacheSignature(
  wordsList: WordEntry[],
  rules: InflectionRule[],
): string {
  const wordSig = wordsList
    .map(
      (w) =>
        `${w.entry_id}:${w.con_word_romanized}:${w.phonetic_ipa}:${w.phonetic_override}`,
    )
    .join("|");
  const ruleSig = rules
    .map(
      (r) =>
        `${r.rule_id}:${r.type}:${r.affix}:${r.disabled}:${r.match_regex}:${JSON.stringify(
          r.dimension_values,
        )}`,
    )
    .join("|");
  return `${wordSig}##${ruleSig}`;
}

function buildRuleLabel(
  rule: InflectionRule,
  valueGlossMap: Map<string, string>,
): string {
  if (rule.tag?.trim()) return rule.tag.trim();
  const labels = Object.values(rule.dimension_values)
    .map((valId) => valueGlossMap.get(valId) || "")
    .filter(Boolean);
  return labels.join(".") || rule.type.toUpperCase();
}

function matchesRuleRegex(rule: InflectionRule, stem: string): boolean {
  if (!rule.match_regex || rule.match_regex === ".*") return true;
  try {
    return new RegExp(rule.match_regex).test(stem);
  } catch {
    return true;
  }
}

function matchesPos(rule: InflectionRule, entry: WordEntry): boolean {
  if (!entry.senses.length) return true;
  return entry.senses.some((s) => s.pos_id === rule.pos_id);
}

function createTokenId(): string {
  return `tok_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function createLineId(idx: number): string {
  return `line_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 4)}`;
}

function buildParsedCandidate(
  entry: WordEntry,
  stem: string,
  prefixes: AffixRuleInfo[],
  suffixes: AffixRuleInfo[],
): ParsedInflection {
  const stemGloss = entry.senses[0]?.gloss || "";
  const morphemeBreak = [
    ...prefixes.map((p) => p.rule.affix),
    entry.con_word_romanized || stem,
    ...suffixes.map((s) => s.rule.affix),
  ]
    .filter(Boolean)
    .join("-");
  const glossLabels = [
    ...prefixes.map((p) => p.label),
    stemGloss,
    ...suffixes.map((s) => s.label),
  ]
    .filter(Boolean)
    .join("-");
  const affixLength = [...prefixes, ...suffixes].reduce(
    (acc, r) => acc + r.affix.length,
    0,
  );

  return {
    entry,
    morphemeBreak,
    glossLabels,
    score: prefixes.length * 100 + suffixes.length * 100 + affixLength,
    confidence: 0.96,
    trace: `concatenative(${prefixes.length}P/${suffixes.length}S)`,
  };
}

function parseHyphenatedAffixes(
  token: string,
  wordsMap: Map<string, WordEntry>,
  prefixRules: AffixRuleInfo[],
  suffixRules: AffixRuleInfo[],
): ParsedInflection | null {
  const parts = token.split("-").filter(Boolean);
  if (parts.length < 2) return null;

  const prefixByAffix = new Map(prefixRules.map((r) => [r.affix, r]));
  const suffixByAffix = new Map(suffixRules.map((r) => [r.affix, r]));
  const candidates: ParsedInflection[] = [];

  for (let left = 0; left < parts.length; left += 1) {
    for (let right = parts.length; right > left; right -= 1) {
      const prefixParts = parts.slice(0, left);
      const stemParts = parts.slice(left, right);
      const suffixParts = parts.slice(right);
      if (stemParts.length === 0) continue;

      const prefixes: AffixRuleInfo[] = [];
      let prefixOk = true;
      for (const p of prefixParts) {
        const info = prefixByAffix.get(p);
        if (!info) {
          prefixOk = false;
          break;
        }
        prefixes.push(info);
      }
      if (!prefixOk) continue;

      const suffixes: AffixRuleInfo[] = [];
      let suffixOk = true;
      for (const s of suffixParts) {
        const info = suffixByAffix.get(s);
        if (!info) {
          suffixOk = false;
          break;
        }
        suffixes.push(info);
      }
      if (!suffixOk) continue;
      if (prefixes.length === 0 && suffixes.length === 0) continue;

      const stem = stemParts.join("-");
      const entry = wordsMap.get(stem);
      if (!entry) continue;

      const allRules = [...prefixes, ...suffixes];
      if (
        !allRules.every(
          (r) => matchesRuleRegex(r.rule, stem) && matchesPos(r.rule, entry),
        )
      ) {
        continue;
      }

      const candidate = buildParsedCandidate(entry, stem, prefixes, suffixes);
      candidate.score += 1000;
      candidate.trace += ":hyphen";
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

function parseContinuousAffixes(
  token: string,
  wordsMap: Map<string, WordEntry>,
  prefixRules: AffixRuleInfo[],
  suffixRules: AffixRuleInfo[],
): ParsedInflection | null {
  const candidates: ParsedInflection[] = [];
  const seen = new Set<string>();

  const walk = (
    rest: string,
    prefixes: AffixRuleInfo[],
    suffixes: AffixRuleInfo[],
    depth: number,
  ) => {
    if (!rest || depth > 8) return;
    const key = `${rest}|${prefixes.map((p) => p.affix).join("+")}|${suffixes
      .map((s) => s.affix)
      .join("+")}`;
    if (seen.has(key)) return;
    seen.add(key);

    const entry = wordsMap.get(rest);
    if (entry && (prefixes.length > 0 || suffixes.length > 0)) {
      const allRules = [...prefixes, ...suffixes];
      if (
        allRules.every(
          (r) => matchesRuleRegex(r.rule, rest) && matchesPos(r.rule, entry),
        )
      ) {
        const c = buildParsedCandidate(entry, rest, prefixes, suffixes);
        c.trace += ":continuous";
        candidates.push(c);
      }
    }

    for (const p of prefixRules) {
      if (!rest.startsWith(p.affix) || rest.length <= p.affix.length) continue;
      walk(rest.slice(p.affix.length), [...prefixes, p], suffixes, depth + 1);
    }

    for (const s of suffixRules) {
      if (!rest.endsWith(s.affix) || rest.length <= s.affix.length) continue;
      walk(
        rest.slice(0, rest.length - s.affix.length),
        prefixes,
        [s, ...suffixes],
        depth + 1,
      );
    }
  };

  walk(token, [], [], 0);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

function parseConcatenativeByRules(
  token: string,
  wordsMap: Map<string, WordEntry>,
  rules: InflectionRule[],
  valueGlossMap: Map<string, string>,
): ParsedInflection | null {
  const prefixRules = rules
    .filter((r) => r.type === "prefix")
    .map((r) => ({
      rule: r,
      affix: (r.affix || "").toLowerCase().trim(),
      label: buildRuleLabel(r, valueGlossMap),
    }))
    .filter((r) => r.affix);

  const suffixRules = rules
    .filter((r) => r.type === "suffix")
    .map((r) => ({
      rule: r,
      affix: (r.affix || "").toLowerCase().trim(),
      label: buildRuleLabel(r, valueGlossMap),
    }))
    .filter((r) => r.affix);

  const hyphenCandidate = parseHyphenatedAffixes(
    token,
    wordsMap,
    prefixRules,
    suffixRules,
  );
  const continuousCandidate = parseContinuousAffixes(
    token,
    wordsMap,
    prefixRules,
    suffixRules,
  );

  if (!hyphenCandidate) return continuousCandidate;
  if (!continuousCandidate) return hyphenCandidate;
  return hyphenCandidate.score >= continuousCandidate.score
    ? hyphenCandidate
    : continuousCandidate;
}

function getEntryGloss(entry: WordEntry): string {
  return entry.senses[0]?.gloss || "";
}

function buildTransformativeCandidate(
  entry: WordEntry,
  rule: InflectionRule,
  label: string,
  generatedForm: string,
): ParsedInflection {
  const stem = entry.con_word_romanized;
  const stemGloss = getEntryGloss(entry);
  let confidence = 0.75;
  let morphemeBreak = stem;

  if (rule.type === "infix") {
    confidence = 0.82;
    const infix = rule.infix_config?.morpheme || rule.affix;
    morphemeBreak = infix ? `${stem}<${infix}>` : `${stem}<INFIX>`;
  } else if (rule.type === "circumfix") {
    confidence = 0.9;
    const pre = rule.circumfix_config?.prefix_part || "?";
    const suf = rule.circumfix_config?.suffix_part || "?";
    morphemeBreak = `${pre}-${stem}-${suf}`;
  } else if (rule.type === "reduplication") {
    const mode = rule.reduplication_config?.mode || "full";
    confidence = mode === "full" ? 0.78 : 0.68;
    morphemeBreak = `${stem}~RED(${mode})`;
  } else if (rule.type === "ablaut") {
    confidence = 0.62;
    morphemeBreak = `${stem}~ABLAUT`;
  }

  if (generatedForm.includes("-")) {
    confidence = Math.min(1, confidence + 0.04);
  }

  return {
    entry,
    morphemeBreak,
    glossLabels: [stemGloss, label].filter(Boolean).join("-"),
    score: generatedForm.length,
    confidence,
    trace: `transformative:${rule.type}:${rule.rule_id}`,
  };
}

function buildTransformativeIndex(
  wordsList: WordEntry[],
  rules: InflectionRule[],
  valueGlossMap: Map<string, string>,
  phonoConfig: PhonologyConfig,
): Map<string, ParsedInflection[]> {
  const index = new Map<string, ParsedInflection[]>();

  for (const entry of wordsList) {
    const stem = (entry.con_word_romanized || "").toLowerCase();
    if (!stem) continue;

    for (const rule of rules) {
      if (!matchesPos(rule, entry)) continue;
      const { result, applied } = applyInflection(stem, rule, phonoConfig);
      if (!applied) continue;

      const form = normalizeToken(result);
      if (!form || form === stem) continue;

      const label = buildRuleLabel(rule, valueGlossMap);
      const candidate = buildTransformativeCandidate(entry, rule, label, form);
      const arr = index.get(form) || [];
      arr.push(candidate);
      index.set(form, arr);
    }
  }

  for (const arr of index.values()) {
    arr.sort((a, b) => b.confidence - a.confidence || b.score - a.score);
  }

  return index;
}

function applySuggestionToLines(
  lines: GlossedLine[],
  suggestion: PendingSuggestion,
  resolveEntryIpa: (entry: WordEntry) => string,
): GlossedLine[] {
  return lines.map((line) => {
    if (line.line_id !== suggestion.lineId) return line;
    return {
      ...line,
      tokens: line.tokens.map((token) => {
        if (token.token_id !== suggestion.tokenId) return token;
        return {
          ...token,
          morpheme_break: suggestion.suggestion.morphemeBreak,
          gloss_labels: suggestion.suggestion.glossLabels,
          linked_entry_id: suggestion.suggestion.entry.entry_id,
          ipa: resolveEntryIpa(suggestion.suggestion.entry),
        };
      }),
    };
  });
}

function makeContextSnippet(text: string, start: number, end: number): string {
  const left = Math.max(0, start - 14);
  const right = Math.min(text.length, end + 14);
  return text.slice(left, right).replace(/\s+/g, " ");
}

function collectTextScaDiff(
  text: string,
  ruleSets: ReturnType<typeof useSCAStore.getState>["config"]["rule_sets"],
  macros: Record<string, string[]>,
  base: { scope: CorpusDiffScope; target: CorpusDiffTarget; lineId?: string },
): CorpusScaDiffItem[] {
  const diffs: CorpusScaDiffItem[] = [];
  const matcher = new RegExp(WORD_TOKEN_RE.source, "gu");
  let match: RegExpExecArray | null = null;
  while ((match = matcher.exec(text)) !== null) {
    const before = match[0];
    const after = applySoundChanges(before, ruleSets, macros).result;
    if (after === before) continue;
    const start = match.index;
    const end = start + before.length;
    diffs.push({
      id: `sca_${base.target}_${base.lineId || "root"}_${start}_${diffs.length}`,
      scope: base.scope,
      target: base.target,
      lineId: base.lineId,
      before,
      after,
      context: makeContextSnippet(text, start, end),
      selected: true,
      start,
      end,
    });
  }
  return diffs;
}

function applySelectedTextDiff(
  sourceText: string,
  selectedDiffs: CorpusScaDiffItem[],
): string {
  const ranged = selectedDiffs
    .filter((d) => typeof d.start === "number" && typeof d.end === "number")
    .sort((a, b) => (b.start as number) - (a.start as number));

  let result = sourceText;
  for (const d of ranged) {
    const start = d.start as number;
    const end = d.end as number;
    result = result.slice(0, start) + d.after + result.slice(end);
  }
  return result;
}

export function GlossingEditor() {
  const { t } = useTranslation();
  const corpus = useCorpusStore((s) => s.activeCorpus);
  const addGlossedLine = useCorpusStore((s) => s.addGlossedLine);
  const upsertCorpus = useCorpusStore((s) => s.upsertCorpus);
  const wordsList = useLexiconStore((s) => s.wordsList);
  const grammarConfig = useGrammarStore((s) => s.config);
  const phonoConfig = usePhonoStore((s) => s.config);
  const scaConfig = useSCAStore((s) => s.config);
  const [pendingSuggestions, setPendingSuggestions] = useState<
    PendingSuggestion[]
  >([]);
  const [lastReport, setLastReport] = useState<AutoGlossReport | null>(null);
  const [scaDiffItems, setScaDiffItems] = useState<CorpusScaDiffItem[]>([]);
  const [scaPreviewChecked, setScaPreviewChecked] = useState(false);
  const transformIndexCacheRef = useRef<CachedTransformIndex | null>(null);

  useEffect(() => {
    if (!corpus) return;
    setPendingSuggestions([]);
    setScaDiffItems([]);
    setScaPreviewChecked(false);
    setLastReport(corpus.metadata.auto_gloss_report || null);
  }, [corpus?.corpus_id]);

  if (!corpus) return null;

  const handleAddLine = () => {
    const line: GlossedLine = {
      line_id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      original: "",
      tokens: [],
      translation: "",
    };
    addGlossedLine(line);
  };

  const resolveEntryIpa = (entry: WordEntry): string => {
    if (entry.phonetic_override && entry.phonetic_ipa)
      return entry.phonetic_ipa;
    return generateIPA(entry.con_word_romanized, phonoConfig).phonemic;
  };

  const closeScaPreview = () => {
    setScaDiffItems([]);
    setScaPreviewChecked(false);
  };

  const applyAllPending = () => {
    if (!pendingSuggestions.length || !corpus) return;
    let lines = corpus.glossed_lines;
    for (const s of pendingSuggestions) {
      lines = applySuggestionToLines(lines, s, resolveEntryIpa);
    }
    upsertCorpus({
      ...corpus,
      glossed_lines: lines,
      metadata: { ...corpus.metadata, updated_at: new Date().toISOString() },
    });
    setPendingSuggestions([]);
  };

  const applySinglePending = (target: PendingSuggestion) => {
    if (!corpus) return;
    const lines = applySuggestionToLines(
      corpus.glossed_lines,
      target,
      resolveEntryIpa,
    );
    upsertCorpus({
      ...corpus,
      glossed_lines: lines,
      metadata: { ...corpus.metadata, updated_at: new Date().toISOString() },
    });
    setPendingSuggestions((prev) =>
      prev.filter(
        (s) => !(s.lineId === target.lineId && s.tokenId === target.tokenId),
      ),
    );
  };

  const dismissAllPending = () => {
    setPendingSuggestions([]);
  };

  const runAutoGloss = async (targetCorpus: typeof corpus) => {
    if (!targetCorpus || !targetCorpus.original_text.trim()) return;

    const sentences = targetCorpus.original_text
      .split(/[.!?。！？]+/)
      .filter((s) => s.trim());
    const wordsMap = new Map(
      wordsList.map((w) => [w.con_word_romanized.toLowerCase(), w]),
    );

    const activeRules = grammarConfig.inflection_rules.filter(
      (r) => !r.disabled,
    );
    const concatRules = activeRules.filter(
      (r) => r.type === "prefix" || r.type === "suffix",
    );
    const nonConcatRules = activeRules.filter((r) =>
      ["infix", "circumfix", "reduplication", "ablaut"].includes(r.type),
    );

    const valueGlossMap = new Map<string, string>();
    for (const dim of grammarConfig.inflection_dimensions) {
      for (const v of dim.values) {
        valueGlossMap.set(v.val_id, v.gloss || v.name);
      }
    }

    const transformSignature = buildTransformCacheSignature(
      wordsList,
      nonConcatRules,
    );
    let transformativeIndex = transformIndexCacheRef.current?.index;
    if (
      !transformIndexCacheRef.current ||
      transformIndexCacheRef.current.signature !== transformSignature
    ) {
      transformativeIndex = buildTransformativeIndex(
        wordsList,
        nonConcatRules,
        valueGlossMap,
        phonoConfig,
      );
      transformIndexCacheRef.current = {
        signature: transformSignature,
        index: transformativeIndex,
      };
    }

    const tokenParseCache = new Map<string, ParsedInflection | null>();

    const pending: PendingSuggestion[] = [];
    let total = 0;
    let autoApplied = 0;
    let unresolved = 0;

    const newLines: GlossedLine[] = [];
    for (let i = 0; i < sentences.length; i += 1) {
      const sentence = sentences[i];
      const lineId = createLineId(i);
      const words = sentence.trim().split(/\s+/).filter(Boolean);

      const tokens: GlossToken[] = words.map((word) => {
        total += 1;
        const tokenId = createTokenId();
        const clean = normalizeToken(word);
        const entry = wordsMap.get(clean);

        if (entry) {
          autoApplied += 1;
          return {
            token_id: tokenId,
            surface_form: word,
            morpheme_break: entry.con_word_romanized,
            gloss_labels: getEntryGloss(entry),
            linked_entry_id: entry.entry_id,
            ipa: resolveEntryIpa(entry),
          };
        }

        let picked = tokenParseCache.get(clean);
        if (picked === undefined) {
          const concatCandidate = parseConcatenativeByRules(
            clean,
            wordsMap,
            concatRules,
            valueGlossMap,
          );

          const transformCandidates = transformativeIndex?.get(clean) || [];
          const transformCandidate = transformCandidates[0] || null;

          picked = [concatCandidate, transformCandidate]
            .filter(Boolean)
            .sort((a, b) => {
              const da = a as ParsedInflection;
              const db = b as ParsedInflection;
              return db.confidence - da.confidence || db.score - da.score;
            })[0] as ParsedInflection | undefined;
          tokenParseCache.set(clean, picked || null);
        }

        if (picked && picked.confidence >= AUTO_APPLY_CONFIDENCE) {
          autoApplied += 1;
          return {
            token_id: tokenId,
            surface_form: word,
            morpheme_break: picked.morphemeBreak,
            gloss_labels: picked.glossLabels,
            linked_entry_id: picked.entry.entry_id,
            ipa: resolveEntryIpa(picked.entry),
          };
        }

        if (picked) {
          pending.push({
            lineId,
            tokenId,
            surfaceForm: word,
            suggestion: picked,
          });
        } else {
          unresolved += 1;
        }

        return {
          token_id: tokenId,
          surface_form: word,
          morpheme_break: clean || word,
          gloss_labels: "",
          linked_entry_id: "",
          ipa: "",
        };
      });

      newLines.push({
        line_id: lineId,
        original: sentence.trim(),
        tokens,
        translation: "",
      });

      if ((i + 1) % CHUNK_SIZE === 0) {
        await Promise.resolve();
      }
    }

    upsertCorpus({
      ...targetCorpus,
      glossed_lines: newLines,
      metadata: {
        ...targetCorpus.metadata,
        updated_at: new Date().toISOString(),
        auto_gloss_report: {
          total,
          autoApplied: autoApplied,
          pending: pending.length,
          unresolved,
        },
      },
    });

    setPendingSuggestions(pending);
    const report = {
      total,
      autoApplied,
      pending: pending.length,
      unresolved,
    };
    setLastReport(report);
  };

  const handleAutoGloss = async () => {
    await runAutoGloss(corpus);
  };

  const handlePreviewCorpusSCA = () => {
    if (!corpus) return;
    const macros = buildMacrosFromInventory(
      phonoConfig.phoneme_inventory.consonants,
      phonoConfig.phoneme_inventory.vowels,
      phonoConfig.phonotactics.macros,
    );

    const diffs: CorpusScaDiffItem[] = [];
    diffs.push(
      ...collectTextScaDiff(corpus.original_text, scaConfig.rule_sets, macros, {
        scope: "originalText",
        target: "original_text",
      }),
    );

    for (const line of corpus.glossed_lines) {
      diffs.push(
        ...collectTextScaDiff(line.original, scaConfig.rule_sets, macros, {
          scope: "lineOriginal",
          target: "line_original",
          lineId: line.line_id,
        }),
      );

      for (const token of line.tokens) {
        const before = token.surface_form || "";
        if (!before.trim()) continue;
        const after = applySoundChanges(
          before,
          scaConfig.rule_sets,
          macros,
        ).result;
        if (after === before) continue;
        diffs.push({
          id: `sca_token_${line.line_id}_${token.token_id}`,
          scope: "tokenSurface",
          target: "token_surface",
          lineId: line.line_id,
          tokenId: token.token_id,
          before,
          after,
          context: line.original || token.surface_form,
          selected: true,
        });
      }
    }

    setScaPreviewChecked(true);
    setScaDiffItems(diffs);
  };

  const toggleAllScaDiffs = (selected: boolean) => {
    setScaDiffItems((prev) => prev.map((d) => ({ ...d, selected })));
  };

  const toggleScaDiff = (id: string) => {
    setScaDiffItems((prev) =>
      prev.map((d) => (d.id === id ? { ...d, selected: !d.selected } : d)),
    );
  };

  const applySelectedCorpusSCA = async () => {
    if (!corpus) return;
    const selected = scaDiffItems.filter((d) => d.selected);
    if (selected.length === 0) return;

    const originalTextDiffs = selected.filter(
      (d) => d.target === "original_text",
    );
    const nextOriginalText = applySelectedTextDiff(
      corpus.original_text,
      originalTextDiffs,
    );

    const nextLines = corpus.glossed_lines.map((line) => {
      const lineDiffs = selected.filter(
        (d) => d.target === "line_original" && d.lineId === line.line_id,
      );
      const nextLineOriginal = applySelectedTextDiff(line.original, lineDiffs);

      const tokenDiffMap = new Map(
        selected
          .filter(
            (d) => d.target === "token_surface" && d.lineId === line.line_id,
          )
          .map((d) => [d.tokenId, d]),
      );

      const nextTokens = line.tokens.map((token) => {
        const tokenDiff = tokenDiffMap.get(token.token_id);
        if (!tokenDiff) return token;
        return {
          ...token,
          surface_form: tokenDiff.after,
          morpheme_break: "",
          gloss_labels: "",
          linked_entry_id: "",
          ipa: "",
        };
      });

      return {
        ...line,
        original: nextLineOriginal,
        tokens: nextTokens,
      };
    });

    const nextCorpus = {
      ...corpus,
      original_text: nextOriginalText,
      glossed_lines: nextLines,
      metadata: {
        ...corpus.metadata,
        updated_at: new Date().toISOString(),
      },
    };

    upsertCorpus(nextCorpus);
    closeScaPreview();
    await runAutoGloss(nextCorpus);
  };

  const selectedScaCount = scaDiffItems.filter((d) => d.selected).length;
  const scopeLabel = (scope: CorpusDiffScope) => {
    if (scope === "originalText") return t("corpus.scaDiffOriginalText");
    if (scope === "lineOriginal") return t("corpus.scaDiffLineOriginal");
    return t("corpus.scaDiffTokenSurface");
  };

  return (
    <div className={CARD}>
      <div className={`${CARD_BODY} p-4 space-y-4`}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{t("corpus.glossing")}</h3>
          <div className="flex gap-2">
            <button className={BTN_PRIMARY} onClick={handleAutoGloss}>
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
                {t("corpus.pendingSuggestionsTitle", {
                  count: pendingSuggestions.length,
                })}
              </div>
              <div className="flex gap-2">
                <button className={BTN_GHOST} onClick={dismissAllPending}>
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
                      <td className="font-mono text-xs">
                        {s.suggestion.morphemeBreak}
                      </td>
                      <td>{Math.round(s.suggestion.confidence * 100)}%</td>
                      <td className="text-base-content/60">
                        {s.suggestion.trace}
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => applySinglePending(s)}
                        >
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
                <button
                  className={BTN_GHOST}
                  onClick={() => toggleAllScaDiffs(true)}
                >
                  {t("common.selectAll")}
                </button>
                <button
                  className={BTN_GHOST}
                  onClick={() => toggleAllScaDiffs(false)}
                >
                  {t("common.deselect")}
                </button>
                <button
                  className={BTN_PRIMARY}
                  onClick={applySelectedCorpusSCA}
                  disabled={selectedScaCount === 0}
                >
                  {t("corpus.applySelectedScaChanges", {
                    count: selectedScaCount,
                  })}
                </button>
              </div>
            </div>

            {scaDiffItems.length === 0 ? (
              <p className="text-xs text-base-content/60">
                {t("corpus.applyScaNoChanges")}
              </p>
            ) : (
              <div className="max-h-60 overflow-auto border border-base-300 rounded bg-base-100">
                <table className="table table-xs w-full">
                  <thead>
                    <tr>
                      <th></th>
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
