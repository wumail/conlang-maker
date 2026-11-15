import {
  CorpusText,
  GlossCandidate,
  GlossedLine,
  GlossToken,
  GlossTokenStatus,
  GrammarConfig,
  InflectionRule,
  MorphophonologyRule,
  PhonologyConfig,
  SCARuleSet,
  WordEntry,
} from "../../types";
import { generateIPA } from "../engines/ipaGenerator";
import { applyInflection } from "../engines/morphologyEngine";
import { applySoundChanges } from "../engines/scaEngine";

export const AUTO_APPLY_CONFIDENCE = 0.88;

const WORD_TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{M}\p{N}·'’-]*/gu;

export interface ParsedInflection {
  entry: WordEntry;
  morphemeBreak: string;
  glossLabels: string;
  score: number;
  confidence: number;
  trace: string;
  stemStart?: number;
}

export interface AffixRuleInfo {
  rule: InflectionRule;
  affix: string;
  label: string;
}

export interface PendingSuggestion {
  lineId: string;
  tokenId: string;
  surfaceForm: string;
  suggestion: ParsedInflection;
}

export interface AutoGlossReport {
  total: number;
  autoApplied: number;
  pending: number;
  unresolved: number;
}

export interface AutoGlossCache {
  transformSignature?: string;
  transformIndex?: Map<string, ParsedInflection[]>;
}

export interface AutoGlossInput {
  originalText: string;
  words: WordEntry[];
  grammar: GrammarConfig;
  phono: PhonologyConfig;
  cache?: AutoGlossCache;
  createLineId?: (lineIndex: number) => string;
  createTokenId?: (lineIndex: number, tokenIndex: number) => string;
}

export interface AutoGlossResult {
  lines: GlossedLine[];
  pending: PendingSuggestion[];
  report: AutoGlossReport;
}

export type CorpusDiffScope = "originalText" | "lineOriginal" | "tokenSurface";
export type CorpusDiffTarget = "original_text" | "line_original" | "token_surface";

export interface CorpusScaDiffItem {
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

export function normalizeToken(word: string): string {
  return word.normalize("NFC").toLowerCase()
    .replace(/^[^\p{L}\p{M}\p{N}-]+|[^\p{L}\p{M}\p{N}-]+$/gu, "");
}

function normalizedStemStart(form: string, offset: number | undefined): number | undefined {
  if (offset === undefined) return undefined;
  const prefix = Array.from(form).slice(0, offset).join("")
    .normalize("NFC").toLowerCase()
    .replace(/^[^\p{L}\p{M}\p{N}-]+/u, "");
  return Array.from(prefix).length;
}

export function getEntryGloss(entry: WordEntry): string {
  return entry.senses[0]?.gloss || "";
}

export function resolveEntryIpa(
  entry: WordEntry,
  phonoConfig: PhonologyConfig,
): string {
  if (entry.phonetic_override && entry.phonetic_ipa) {
    return entry.phonetic_ipa;
  }
  return generateIPA(entry.con_word_romanized, phonoConfig).phonemic;
}

function defaultCreateLineId(idx: number): string {
  return `line_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 4)}`;
}

function defaultCreateTokenId(): string {
  return `tok_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function buildTransformCacheSignature(
  wordsList: WordEntry[],
  rules: InflectionRule[],
  morphophonologyRules: readonly MorphophonologyRule[] = [],
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
  const morphoSig = morphophonologyRules
    .map(
      (r) =>
        `${r.rule_id}:${r.disabled}:${r.priority}:${r.feature_mode}:${r.target}:${r.replacement}:${r.context_before}:${r.context_after}`,
    )
    .join("|");
  return `${wordSig}##${ruleSig}##${morphoSig}`;
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
  } catch (err) {
    console.warn(`Invalid inflection match_regex "${rule.match_regex}":`, err);
    return true;
  }
}

function matchesPos(rule: InflectionRule, entry: WordEntry): boolean {
  if (!entry.senses.length) return true;
  return entry.senses.some((s) => s.pos_id === rule.pos_id);
}

export function buildParsedCandidate(
  entry: WordEntry,
  stem: string,
  prefixes: AffixRuleInfo[],
  suffixes: AffixRuleInfo[],
): ParsedInflection {
  const stemGloss = getEntryGloss(entry);
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
    stemStart: prefixes.reduce((length, prefix) => length + Array.from(prefix.affix).length, 0),
  };
}

/**
 * 同一词形可能对应多个词条（同形词）：逐桶筛选「词性与 match_regex 都满足」的词条，
 * 不再静默取 `bucket[0]`，从而让「同形名词 / 动词只有动词匹配该词缀」的场景正确落到动词。
 */
function matchAffixableEntries(
  bucket: readonly WordEntry[] | undefined,
  stem: string,
  rules: AffixRuleInfo[],
): WordEntry[] {
  if (!bucket || bucket.length === 0) return [];
  return bucket.filter((entry) =>
    rules.every((r) => matchesRuleRegex(r.rule, stem) && matchesPos(r.rule, entry)),
  );
}

function collectHyphenatedAffixes(
  token: string,
  wordsByForm: ReadonlyMap<string, WordEntry[]>,
  prefixRules: AffixRuleInfo[],
  suffixRules: AffixRuleInfo[],
): ParsedInflection[] {
  const parts = token.split("-").filter(Boolean);
  if (parts.length < 2) return [];

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
      const entries = matchAffixableEntries(
        wordsByForm.get(stem),
        stem,
        [...prefixes, ...suffixes],
      );
      for (const entry of entries) {
        const candidate = buildParsedCandidate(entry, stem, prefixes, suffixes);
        candidate.stemStart = (candidate.stemStart ?? 0) + prefixes.length;
        candidate.score += 1000;
        candidate.trace += ":hyphen";
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

function collectContinuousAffixes(
  token: string,
  wordsByForm: ReadonlyMap<string, WordEntry[]>,
  prefixRules: AffixRuleInfo[],
  suffixRules: AffixRuleInfo[],
): ParsedInflection[] {
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

    if (prefixes.length > 0 || suffixes.length > 0) {
      const entries = matchAffixableEntries(
        wordsByForm.get(rest),
        rest,
        [...prefixes, ...suffixes],
      );
      for (const entry of entries) {
        const candidate = buildParsedCandidate(entry, rest, prefixes, suffixes);
        candidate.trace += ":continuous";
        candidates.push(candidate);
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

  return candidates;
}

function buildAffixRules(
  rules: InflectionRule[],
  type: "prefix" | "suffix",
  valueGlossMap: Map<string, string>,
): AffixRuleInfo[] {
  return rules
    .filter((r) => r.type === type)
    .map((r) => ({
      rule: r,
      affix: (r.affix || "").normalize("NFC").toLowerCase().trim(),
      label: buildRuleLabel(r, valueGlossMap),
    }))
    .filter((r) => r.affix);
}

/**
 * 汇总黏着拆解的全部候选（含前缀/后缀、连字符与连写两种切分方式），
 * 按得分降序返回，供主流程检测「同分并列的多词条」歧义。
 */
function rankConcatenativeCandidates(
  token: string,
  wordsByForm: ReadonlyMap<string, WordEntry[]>,
  rules: InflectionRule[],
  valueGlossMap: Map<string, string>,
): ParsedInflection[] {
  const prefixRules = buildAffixRules(rules, "prefix", valueGlossMap);
  const suffixRules = buildAffixRules(rules, "suffix", valueGlossMap);

  const merged = [
    ...collectHyphenatedAffixes(token, wordsByForm, prefixRules, suffixRules),
    ...collectContinuousAffixes(token, wordsByForm, prefixRules, suffixRules),
  ];

  const seen = new Set<string>();
  const unique: ParsedInflection[] = [];
  for (const candidate of merged) {
    const key = `${candidate.entry.entry_id}:${candidate.morphemeBreak}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  unique.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  return unique;
}

export function parseConcatenativeByRules(
  token: string,
  wordsByForm: ReadonlyMap<string, WordEntry[]>,
  rules: InflectionRule[],
  valueGlossMap: Map<string, string>,
): ParsedInflection | null {
  return rankConcatenativeCandidates(token, wordsByForm, rules, valueGlossMap)[0] ?? null;
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

export function buildTransformativeIndex(
  wordsList: WordEntry[],
  rules: InflectionRule[],
  valueGlossMap: Map<string, string>,
  phonoConfig: PhonologyConfig,
  morphophonologyRules: readonly MorphophonologyRule[] = [],
): Map<string, ParsedInflection[]> {
  const index = new Map<string, ParsedInflection[]>();

  for (const entry of wordsList) {
    const stem = (entry.con_word_romanized || "").normalize("NFC").toLowerCase();
    if (!stem) continue;

    for (const rule of rules) {
      if (!matchesPos(rule, entry)) continue;
      const { result, applied, stem_start } = applyInflection(
        stem,
        rule,
        phonoConfig,
        morphophonologyRules,
      );
      if (!applied) continue;

      const form = normalizeToken(result);
      if (!form || form === stem) continue;

      const label = buildRuleLabel(rule, valueGlossMap);
      const candidate = buildTransformativeCandidate(entry, rule, label, form);
      candidate.stemStart = normalizedStemStart(result, stem_start);
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

/**
 * Pure interlinear auto-glosser matching GUI `GlossingEditor` semantics (`T1.6`).
 */
export function autoGloss(input: AutoGlossInput): AutoGlossResult {
  const {
    originalText,
    words: wordsList,
    grammar: grammarConfig,
    phono: phonoConfig,
    cache,
    createLineId = defaultCreateLineId,
    createTokenId = defaultCreateTokenId,
  } = input;

  if (!originalText.trim()) {
    return {
      lines: [],
      pending: [],
      report: { total: 0, autoApplied: 0, pending: 0, unresolved: 0 },
    };
  }

  const sentences = originalText.split(/[.!?。！？]+/).filter((s) => s.trim());
  // 按归一化词形聚合为数组：同形词条不再互相静默覆盖（Roadmap v3 / Pillar 6）
  const wordsByForm = new Map<string, WordEntry[]>();
  for (const entry of wordsList) {
    const key = entry.con_word_romanized.normalize("NFC").toLowerCase();
    const bucket = wordsByForm.get(key);
    if (bucket) bucket.push(entry);
    else wordsByForm.set(key, [entry]);
  }
  const homographForms = new Set(
    [...wordsByForm].filter(([, bucket]) => bucket.length > 1).map(([key]) => key),
  );

  const activeRules = grammarConfig.inflection_rules.filter((r) => !r.disabled);
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
    grammarConfig.morphophonology_rules ?? [],
  );
  let transformativeIndex = cache?.transformIndex;
  if (!transformativeIndex || cache?.transformSignature !== transformSignature) {
    transformativeIndex = buildTransformativeIndex(
      wordsList,
      nonConcatRules,
      valueGlossMap,
      phonoConfig,
      grammarConfig.morphophonology_rules ?? [],
    );
    if (cache) {
      cache.transformSignature = transformSignature;
      cache.transformIndex = transformativeIndex;
    }
  }

  const tokenParseCache = new Map<string, ParsedInflection | null>();
  /** 同形词条以相同最高分并列的屈折形式：主流程降入 pending 供人工确认 */
  const ambiguousParses = new Map<string, ParsedInflection>();
  const entriesById = new Map(wordsList.map((entry) => [entry.entry_id, entry]));
  const ambiguousForms = new Set<string>();
  for (const form of grammarConfig.irregular_overrides) {
    const entry = entriesById.get(form.entry_id);
    if (!entry) continue;
    const key = normalizeToken(form.surface_form);
    const stemStart = normalizedStemStart(form.surface_form, form.stem_start);
    if (ambiguousForms.has(key)) continue;
    const previous = tokenParseCache.get(key);
    if (previous && (previous.entry.entry_id !== entry.entry_id || previous.stemStart !== stemStart)) {
      // Ambiguous compiled forms require an explicit choice.
      tokenParseCache.set(key, null);
      ambiguousForms.add(key);
      continue;
    }
    tokenParseCache.set(key, {
      entry,
      morphemeBreak: form.surface_form,
      glossLabels: [getEntryGloss(entry), ...Object.values(form.dimension_values).map((value) => valueGlossMap.get(value))].filter(Boolean).join("-"),
      score: form.surface_form.length,
      confidence: 1,
      trace: "irregular_override",
      stemStart,
    });
  }
  const pending: PendingSuggestion[] = [];
  let total = 0;
  let autoApplied = 0;
  let unresolved = 0;

  const lines: GlossedLine[] = [];
  for (let i = 0; i < sentences.length; i += 1) {
    const sentence = sentences[i];
    const lineId = createLineId(i);
    const sentenceWords = sentence.trim().split(/\s+/).filter(Boolean);

    const tokens: GlossToken[] = sentenceWords.map((word, tokenIdx) => {
      total += 1;
      const tokenId = createTokenId(i, tokenIdx);
      const clean = normalizeToken(word);
      const entry = wordsByForm.get(clean)?.[0];

      if (entry && !homographForms.has(clean)) {
        autoApplied += 1;
        return {
          token_id: tokenId,
          surface_form: word,
          morpheme_break: entry.con_word_romanized,
          gloss_labels: getEntryGloss(entry),
          linked_entry_id: entry.entry_id,
          ipa: resolveEntryIpa(entry, phonoConfig),
        };
      }

      if (entry && homographForms.has(clean)) {
        // 同形多词条：不静默择一，作为待消歧候选交给 UI / MCP
        const representative = buildParsedCandidate(entry, clean, [], []);
        representative.confidence = 1;
        representative.score = clean.length;
        representative.trace = "homograph";
        pending.push({ lineId, tokenId, surfaceForm: word, suggestion: representative });
        return {
          token_id: tokenId,
          surface_form: word,
          morpheme_break: entry.con_word_romanized,
          gloss_labels: "",
          linked_entry_id: "",
          ipa: "",
        };
      }

      let picked = tokenParseCache.get(clean);
      if (picked === undefined) {
        const both: ParsedInflection[] = [
          ...rankConcatenativeCandidates(clean, wordsByForm, concatRules, valueGlossMap),
          ...(transformativeIndex.get(clean) ?? []),
        ];
        both.sort(
          (a, b) => b.confidence - a.confidence || b.score - a.score,
        );
        const top = both[0] ?? null;
        if (top) {
          // 不同词条以相同的最高分并列时不做静默择一，交由人工在候选器中确认
          const tiedEntryIds = new Set(
            both
              .filter(
                (candidate) =>
                  candidate.confidence === top.confidence &&
                  candidate.score === top.score,
              )
              .map((candidate) => candidate.entry.entry_id),
          );
          if (tiedEntryIds.size > 1) ambiguousParses.set(clean, top);
        }
        picked = top;
        tokenParseCache.set(clean, picked);
      }

      const ambiguous = ambiguousParses.get(clean);
      if (ambiguous) {
        pending.push({
          lineId,
          tokenId,
          surfaceForm: word,
          suggestion: ambiguous,
        });
        return {
          token_id: tokenId,
          surface_form: word,
          morpheme_break: ambiguous.morphemeBreak,
          gloss_labels: "",
          linked_entry_id: "",
          ipa: "",
        };
      }

      if (picked && picked.confidence >= AUTO_APPLY_CONFIDENCE) {
        autoApplied += 1;
        return {
          token_id: tokenId,
          surface_form: word,
          morpheme_break: picked.morphemeBreak,
          gloss_labels: picked.glossLabels,
          linked_entry_id: picked.entry.entry_id,
          ipa: resolveInflectedIpa(clean, picked.stemStart, phonoConfig),
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

    lines.push({
      line_id: lineId,
      original: sentence.trim(),
      tokens,
      translation: "",
    });
  }

  return {
    lines,
    pending,
    report: {
      total,
      autoApplied,
      pending: pending.length,
      unresolved,
    },
  };
}

export function applySuggestionToLines(
  lines: GlossedLine[],
  suggestion: PendingSuggestion,
  getIpa: (entry: WordEntry, surfaceForm: string, stemStart?: number) => string,
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
          ipa: getIpa(suggestion.suggestion.entry, suggestion.surfaceForm, suggestion.suggestion.stemStart),
        };
      }),
    };
  });
}

export function resolveInflectedIpa(
  surfaceForm: string,
  stemStart: number | undefined,
  config: PhonologyConfig,
): string {
  const generated = generateIPA(normalizeToken(surfaceForm), config, { stem_start: stemStart });
  return generated.phonemic;
}

/**
 * 只重标一行里「尚未解析」的 token（F1.5）。
 *
 * 已经绑定词条（`linked_entry_id` 非空）或已被人工锁定（`verified`）的 token 原样保留，
 * 避免新建词条时把整篇手工标注推倒重算。
 */
export function reGlossLineUnresolvedTokens(
  line: GlossedLine,
  words: WordEntry[],
  grammarConfig: GrammarConfig,
  phonoConfig: PhonologyConfig,
  cache?: AutoGlossCache,
): GlossedLine {
  const tokens = line.tokens.map((token) => {
    const bound = Boolean(token.linked_entry_id?.trim()) || token.status === "verified";
    if (bound) return token;
    const surface = (token.surface_form ?? "").trim();
    if (!surface) return token;

    const reglossed = autoGloss({
      originalText: surface,
      words,
      grammar: grammarConfig,
      phono: phonoConfig,
      cache,
      createLineId: () => line.line_id,
      createTokenId: () => token.token_id,
    });
    const candidate = reglossed.lines[0]?.tokens[0];
    if (!candidate?.linked_entry_id || !candidate.gloss_labels) return token;
    return {
      ...token,
      morpheme_break: candidate.morpheme_break,
      gloss_labels: candidate.gloss_labels,
      linked_entry_id: candidate.linked_entry_id,
      ipa: candidate.ipa,
    };
  });
  return { ...line, tokens };
}

function makeContextSnippet(text: string, start: number, end: number): string {
  const left = Math.max(0, start - 14);
  const right = Math.min(text.length, end + 14);
  return text.slice(left, right).replace(/\s+/g, " ");
}

function collectTextScaDiff(
  text: string,
  ruleSets: SCARuleSet[],
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

export function collectCorpusScaDiffs(
  corpus: Pick<CorpusText, "original_text" | "glossed_lines">,
  ruleSets: SCARuleSet[],
  macros: Record<string, string[]>,
): CorpusScaDiffItem[] {
  const diffs: CorpusScaDiffItem[] = [];
  diffs.push(
    ...collectTextScaDiff(corpus.original_text, ruleSets, macros, {
      scope: "originalText",
      target: "original_text",
    }),
  );

  for (const line of corpus.glossed_lines) {
    diffs.push(
      ...collectTextScaDiff(line.original, ruleSets, macros, {
        scope: "lineOriginal",
        target: "line_original",
        lineId: line.line_id,
      }),
    );

    for (const token of line.tokens) {
      const before = token.surface_form || "";
      if (!before.trim()) continue;
      const after = applySoundChanges(before, ruleSets, macros).result;
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

  return diffs;
}

export function applySelectedCorpusScaDiffs(
  corpus: CorpusText,
  selected: CorpusScaDiffItem[],
  updatedAt: string,
): CorpusText {
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
      // 表层形式被音变改写后，旧的标注与锁定状态已不再对应新词形，重置为待标注
      return {
        ...token,
        surface_form: tokenDiff.after,
        morpheme_break: "",
        gloss_labels: "",
        linked_entry_id: "",
        linked_sense_id: undefined,
        ipa: "",
        status: undefined,
      };
    });

    return {
      ...line,
      original: nextLineOriginal,
      tokens: nextTokens,
    };
  });

  return {
    ...corpus,
    original_text: nextOriginalText,
    glossed_lines: nextLines,
    metadata: {
      ...corpus.metadata,
      updated_at: updatedAt,
    },
  };
}

// ── Roadmap v3 / Pillar 6：同形词安全的多候选词法分析 ──────────────

/** 自动标注处理范围（Roadmap v3 / Pillar 2） */
export type AutoGlossScopeMode = "fill_empty" | "recompute_auto" | "reanalyze_selected";

/**
 * 对给定表层形式生成按置信度排序的多候选列表：覆盖同形不同词条、
 * 同一词条的不同义项（sense_id）以及不同屈折规则拆解方案。
 * 词形索引按归一化形式聚合为数组，彻底消除后加载同形词静默覆盖前词的问题。
 */
export function rankTokenCandidates(
  surfaceForm: string,
  words: WordEntry[],
  grammar: GrammarConfig,
  phono: PhonologyConfig,
): GlossCandidate[] {
  const clean = normalizeToken(surfaceForm);
  if (!clean) return [];

  const candidates: ParsedInflection[] = [];
  const activeRules = grammar.inflection_rules.filter((r) => !r.disabled);
  const concatRules = activeRules.filter(
    (r) => r.type === "prefix" || r.type === "suffix",
  );
  const valueGlossMap = new Map<string, string>();
  for (const dim of grammar.inflection_dimensions) {
    for (const v of dim.values) {
      valueGlossMap.set(v.val_id, v.gloss || v.name);
    }
  }

  for (const entry of words) {
    const stem = (entry.con_word_romanized || "").normalize("NFC").toLowerCase();
    if (!stem) continue;

    // 精确词形匹配（该词条本身即此形式）
    if (normalizeToken(stem) === clean) {
      candidates.push({
        entry,
        morphemeBreak: entry.con_word_romanized,
        glossLabels: getEntryGloss(entry),
        score: stem.length,
        confidence: 1,
        trace: "exact_form",
      });
    }

    // 黏着前后缀拆解候选（单值视图逐词条调用，同形词互不覆盖）
    const singleMap = new Map<string, WordEntry[]>([[stem, [entry]]]);
    const concat = parseConcatenativeByRules(
      clean,
      singleMap,
      concatRules,
      valueGlossMap,
    );
    if (concat) candidates.push(concat);

    // 非黏着型屈折（中缀/环缀/重叠/元音交替）逐个规则试算
    for (const rule of activeRules) {
      if (["prefix", "suffix"].includes(rule.type)) continue;
      if (!matchesPos(rule, entry)) continue;
      const { result, applied, stem_start } = applyInflection(
        stem,
        rule,
        phono,
        grammar.morphophonology_rules ?? [],
      );
      if (!applied) continue;
      if (normalizeToken(result) !== clean) continue;
      const label = buildRuleLabel(rule, valueGlossMap);
      const candidate = buildTransformativeCandidate(entry, rule, label, clean);
      candidate.stemStart = normalizedStemStart(result, stem_start);
      candidates.push(candidate);
    }
  }

  candidates.sort(
    (a, b) => b.confidence - a.confidence || b.score - a.score ||
      a.entry.entry_id.localeCompare(b.entry.entry_id),
  );

  const seen = new Set<string>();
  const out: GlossCandidate[] = [];
  for (const candidate of candidates) {
    // 一词多义：每个义项各产出一项候选，第 2..N 个义项不再被候选器吞掉
    const senses = candidate.entry.senses.length > 0 ? candidate.entry.senses : [undefined];
    const baseGloss = getEntryGloss(candidate.entry);
    for (const sense of senses) {
      const key = `${candidate.entry.entry_id}:${sense?.sense_id ?? ""}:${candidate.morphemeBreak}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const senseGloss = sense?.gloss ?? "";
      out.push({
        candidate_id: `cand_${out.length}_${candidate.entry.entry_id}`,
        entry_id: candidate.entry.entry_id,
        sense_id: sense?.sense_id ?? "",
        romanized: candidate.entry.con_word_romanized,
        pos_id: sense?.pos_id ?? "",
        morpheme_break: candidate.morphemeBreak,
        gloss_labels:
          baseGloss && senseGloss && senseGloss !== baseGloss
            ? candidate.glossLabels.replace(baseGloss, senseGloss)
            : candidate.glossLabels,
        ipa: candidate.entry.phonetic_override
          ? candidate.entry.phonetic_ipa
          : resolveInflectedIpa(clean, candidate.stemStart, phono),
        confidence: candidate.confidence,
        trace: candidate.trace,
      });
    }
  }
  return out;
}

/** 旧数据兼容：无 status 但已有非空人工标注视为 edited */
function effectiveTokenStatus(token: GlossToken): GlossTokenStatus | "blank" {
  if (token.status) return token.status;
  if (token.gloss_labels.trim() && token.linked_entry_id.trim()) return "edited";
  return "blank";
}

/** 自动分析产出的 token：只有真正标注出内容才标记 auto，未解析保持 blank 以便后续重试 */
function withAutoStatus(token: GlossToken): GlossToken {
  const hasContent = Boolean(token.gloss_labels.trim() || token.linked_entry_id.trim());
  return {
    ...token,
    // 显式写入自有属性：重算后旧的 linked_sense_id 会在 mergeById 浅合并中被清空
    linked_sense_id: token.linked_sense_id ?? undefined,
    status: hasContent ? "auto" : undefined,
  };
}

/**
 * 将新一轮自动分析结果非破坏性合并回语料（Roadmap v3 / Pillar 2）。
 *
 * 以 `freshLines` 为主序列遍历：语料还没有任何行、或 `original_text` 追加了新句子时，
 * 新分析出的行会完整生成（旧实现以 `corpus.glossed_lines` 为主序列，会整体丢弃这些行）。
 * 不变量：任何模式下 100% 保留旧 `line.translation`。
 */
export function mergeAutoGlossIntoCorpus(params: {
  corpus: CorpusText;
  freshLines: GlossedLine[];
  mode: AutoGlossScopeMode;
  selectedLineIds?: Set<string>;
}): {
  nextLines: GlossedLine[];
  replacedProtectedTokens: Array<{
    lineId: string;
    tokenId: string;
    surface: string;
    beforeGloss: string;
    afterGloss: string;
  }>;
} {
  const { corpus, freshLines, mode, selectedLineIds } = params;
  const oldLines = corpus.glossed_lines;
  const oldById = new Map(oldLines.map((line) => [line.line_id, line]));
  // 已被某个 fresh 行按 ID 匹配的旧行：位置兜底时不得重复占用
  const claimedOldIds = new Set(
    freshLines.map((line) => line.line_id).filter((id) => oldById.has(id)),
  );
  const usedOldIds = new Set<string>();
  const replacedProtectedTokens: Array<{
    lineId: string;
    tokenId: string;
    surface: string;
    beforeGloss: string;
    afterGloss: string;
  }> = [];

  const nextLines = freshLines.map((fresh, lineIdx) => {
    const positional = oldLines[lineIdx];
    const oldLine =
      oldById.get(fresh.line_id) ??
      (positional && !claimedOldIds.has(positional.line_id) ? positional : undefined);

    if (!oldLine) {
      // 全新语料或新增句子行：该行没有可保护的人工标注，直接采用新结果并落 auto 状态
      return { ...fresh, tokens: fresh.tokens.map(withAutoStatus) };
    }

    usedOldIds.add(oldLine.line_id);

    const targetSelected =
      mode !== "reanalyze_selected" ||
      Boolean(selectedLineIds?.has(fresh.line_id)) ||
      Boolean(selectedLineIds?.has(oldLine.line_id));
    if (!targetSelected) return oldLine;

    const oldTokensById = new Map(oldLine.tokens.map((t) => [t.token_id, t]));
    // 新分析可能重新生成 token_id：token 数量一致时按位置对齐，保证人工标注仍能被识别
    const alignedFreshTokens =
      fresh.tokens.length === oldLine.tokens.length &&
      !fresh.tokens.some((token) => oldTokensById.has(token.token_id))
        ? fresh.tokens.map((token, index) => ({
            ...token,
            token_id: oldLine.tokens[index]?.token_id ?? token.token_id,
          }))
        : fresh.tokens;
    // 以新分析结果驱动 token 序列：新出现的 token 追加，消失的 token 不再保留
    const nextTokens = alignedFreshTokens.map((freshToken) => {
      const token = oldTokensById.get(freshToken.token_id);
      if (!token) return withAutoStatus(freshToken);

      const status = effectiveTokenStatus(token);
      const protectedToken = status === "edited" || status === "verified";

      if (mode === "fill_empty") {
        const hasContent = status !== "blank";
        if (hasContent || protectedToken) return token;
        return withAutoStatus(freshToken);
      }

      if (mode === "recompute_auto") {
        if (protectedToken) return token;
        return withAutoStatus(freshToken);
      }

      // reanalyze_selected：强制重算，但记录被替换的人工 token 供预览
      if (protectedToken) {
        replacedProtectedTokens.push({
          lineId: oldLine.line_id,
          tokenId: token.token_id,
          surface: token.surface_form,
          beforeGloss: token.gloss_labels,
          afterGloss: freshToken.gloss_labels,
        });
      }
      return withAutoStatus(freshToken);
    });

    return {
      ...oldLine,
      // 行原文以最新分析为准（SCA 改写 / 原文追加后不再保留旧行文本）
      original: fresh.original,
      tokens: nextTokens,
      // 100% 保留旧句译
      translation: oldLine.translation,
    };
  });

  // 本次分析未覆盖到的旧行（例如手工新增的空行）原样保留，避免静默丢失
  for (const line of oldLines) {
    if (!usedOldIds.has(line.line_id)) nextLines.push(line);
  }

  return { nextLines, replacedProtectedTokens };
}
