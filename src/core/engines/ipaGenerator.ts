import {
  RomanizationMap,
  RomanizationRule,
  AllophonyRule,
  PhonologyConfig,
} from "../../types";
import { tokenizePhonemes } from "./phonemeTokenizer";

const WORD_CHAR_RE = /[\p{L}\p{M}\p{N}]/u;

export interface IpaGenerationContext {
  /** Raw input codepoint offset supplied by the morphological generator. */
  stem_start?: number;
}

interface CompiledRomanizationRule {
  rule: RomanizationRule;
  foldedInput: string;
  charCount: number;
  beforeBoundary: boolean;
  beforeFolded: string;
  beforeCharCount: number;
  afterBoundary: boolean;
  afterFolded: string;
  afterCharCount: number;
  contextSpecificity: number;
}

export interface RomanizationSegment {
  /** Start codepoint index in raw `text` (inclusive). */
  start: number;
  /** End codepoint index in raw `text` (exclusive). */
  end: number;
  /** Start codepoint index in NFC `normalized_input` (inclusive). */
  normalized_start: number;
  /** End codepoint index in NFC `normalized_input` (exclusive). */
  normalized_end: number;
  /** Exact raw codepoint spans contributing to this segment. */
  source_spans: { start: number; end: number }[];
  /** Raw substring of `text` over `[start, end)`. */
  input: string;
  /** NFC substring of `normalized_input` over `[normalized_start, normalized_end)`. */
  normalized_input: string;
  /** Phoneme output produced for this segment. */
  output: string;
  /** Matched rule ID, or `null` when unmatched / passthrough. */
  rule_id: string | null;
  /** How this segment was produced. */
  kind: "matched" | "fallback" | "passthrough";
}

export interface AllophonyStep {
  rule_id: string;
  before: string;
  after: string;
  coordinate_space: "step_input_codepoints";
  applications: { start: number; end: number; input: string; output: string }[];
}

interface ProvenanceChar {
  ch: string;
  origins: number[];
}

function swapsInNfd(a: string, b: string): boolean {
  if (a === b) return false;
  const cpA = a.codePointAt(0) ?? 0;
  const cpB = b.codePointAt(0) ?? 0;
  if (cpA < 0x0300 || cpB < 0x0300) return false;
  return (a + b).normalize("NFD") === b + a;
}

function isNonStarter(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x0300) return false;
  return (
    ("\u0300" + ch).normalize("NFD") === ch + "\u0300" ||
    (ch + "\u0334").normalize("NFD") === "\u0334" + ch
  );
}

/**
 * Normalize `rawText` to NFC while tracking exact raw codepoint provenance
 * across canonical decomposition, CCC reordering, and canonical composition.
 */
function normalizeNfcWithProvenance(rawCps: string[]): ProvenanceChar[] {
  if (rawCps.length === 0) return [];

  // Fast path: pure Basic Latin / IPA (< U+0300 without singletons) where NFC is identity
  const rawJoined = rawCps.join("");
  const targetNfc = rawJoined.normalize("NFC");
  if (
    rawJoined === targetNfc &&
    rawCps.every((ch) => (ch.codePointAt(0) ?? 0) < 0x0300)
  ) {
    return rawCps.map((ch, idx) => ({ ch, origins: [idx] }));
  }

  // Step 1: Per-codepoint NFD decomposition with raw codepoint provenance
  const nfdItems: ProvenanceChar[] = [];
  for (let rawIdx = 0; rawIdx < rawCps.length; rawIdx += 1) {
    const decomposed = Array.from(rawCps[rawIdx].normalize("NFD"));
    for (const ch of decomposed) {
      nfdItems.push({ ch, origins: [rawIdx] });
    }
  }

  // Step 2: Canonical Ordering (stable sort of adjacent non-starters by CCC)
  for (let i = 1; i < nfdItems.length; i += 1) {
    let j = i;
    while (j > 0 && swapsInNfd(nfdItems[j - 1].ch, nfdItems[j].ch)) {
      const tmp = nfdItems[j - 1];
      nfdItems[j - 1] = nfdItems[j];
      nfdItems[j] = tmp;
      j -= 1;
    }
  }

  // Step 3: Canonical Composition (UAX #15 D117)
  const out: ProvenanceChar[] = [];
  let lastStarterIdx = -1;

  for (const item of nfdItems) {
    const itemNonStarter = isNonStarter(item.ch);
    if (lastStarterIdx >= 0) {
      let blocked = false;
      if (out.length - 1 > lastStarterIdx) {
        if (!itemNonStarter) {
          blocked = true;
        } else {
          const prevNonStarter = out[out.length - 1].ch;
          blocked = !swapsInNfd(item.ch, prevNonStarter);
        }
      }
      if (!blocked) {
        const candidate = (out[lastStarterIdx].ch + item.ch).normalize("NFC");
        const candidateCps = Array.from(candidate);
        if (candidateCps.length === 1) {
          out[lastStarterIdx] = {
            ch: candidateCps[0],
            origins: [...out[lastStarterIdx].origins, ...item.origins],
          };
          continue;
        }
      }
    }
    out.push({ ch: item.ch, origins: [...item.origins] });
    if (!itemNonStarter) {
      lastStarterIdx = out.length - 1;
    }
  }

  // Defensive alignment fallback if engine Unicode tables ever diverged
  if (out.map((item) => item.ch).join("") !== targetNfc) {
    const fallbackCps = Array.from(targetNfc);
    const fullOrigins = rawCps.map((_, idx) => idx);
    return fallbackCps.map((ch) => ({ ch, origins: fullOrigins }));
  }

  return out;
}

function buildSourceSpans(
  normItems: ProvenanceChar[],
  normStart: number,
  normEnd: number,
): { start: number; end: number; source_spans: { start: number; end: number }[] } {
  const rawIndicesSet = new Set<number>();
  for (let i = normStart; i < normEnd; i += 1) {
    for (const rawIdx of normItems[i].origins) {
      rawIndicesSet.add(rawIdx);
    }
  }
  const sorted = Array.from(rawIndicesSet).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { start: 0, end: 0, source_spans: [] };
  }

  const spans: { start: number; end: number }[] = [];
  let spanStart = sorted[0];
  let spanEnd = sorted[0] + 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === spanEnd) {
      spanEnd = sorted[i] + 1;
    } else {
      spans.push({ start: spanStart, end: spanEnd });
      spanStart = sorted[i];
      spanEnd = sorted[i] + 1;
    }
  }
  spans.push({ start: spanStart, end: spanEnd });

  return {
    start: spans[0].start,
    end: spans[spans.length - 1].end,
    source_spans: spans,
  };
}

function compileRules(rules: RomanizationRule[]): CompiledRomanizationRule[] {
  const compiled: CompiledRomanizationRule[] = [];
  for (const rule of rules) {
    const rawInput = rule.input.normalize("NFC");
    if (!rawInput) continue;

    const rawBefore = (rule.context_before ?? "").trim().normalize("NFC");
    const normBefore = rawBefore === "_" ? "" : rawBefore;
    const beforeBoundary = normBefore.startsWith("#");
    const beforeLiteral = beforeBoundary ? normBefore.slice(1) : normBefore;

    const rawAfter = (rule.context_after ?? "").trim().normalize("NFC");
    const normAfter = rawAfter === "_" ? "" : rawAfter;
    const afterBoundary = normAfter.endsWith("#");
    const afterLiteral = afterBoundary ? normAfter.slice(0, -1) : normAfter;

    const beforeCharCount = Array.from(beforeLiteral).length;
    const afterCharCount = Array.from(afterLiteral).length;
    const contextSpecificity =
      beforeCharCount +
      afterCharCount +
      (beforeBoundary ? 1 : 0) +
      (afterBoundary ? 1 : 0);

    compiled.push({
      rule,
      foldedInput: rawInput.toLowerCase(),
      charCount: Array.from(rawInput).length,
      beforeBoundary,
      beforeFolded: beforeLiteral.toLowerCase(),
      beforeCharCount,
      afterBoundary,
      afterFolded: afterLiteral.toLowerCase(),
      afterCharCount,
      contextSpecificity,
    });
  }

  compiled.sort(
    (a, b) =>
      b.charCount - a.charCount || b.contextSpecificity - a.contextSpecificity,
  );
  return compiled;
}

function matchesBefore(
  chars: string[],
  pos: number,
  entry: CompiledRomanizationRule,
): boolean {
  if (entry.beforeCharCount > 0) {
    if (pos < entry.beforeCharCount) return false;
    const slice = chars
      .slice(pos - entry.beforeCharCount, pos)
      .join("")
      .toLowerCase();
    if (slice !== entry.beforeFolded) return false;
  }
  if (entry.beforeBoundary) {
    const boundaryIdx = pos - entry.beforeCharCount;
    if (boundaryIdx > 0 && WORD_CHAR_RE.test(chars[boundaryIdx - 1])) {
      return false;
    }
  }
  return true;
}

function matchesAfter(
  chars: string[],
  end: number,
  entry: CompiledRomanizationRule,
): boolean {
  if (entry.afterCharCount > 0) {
    if (end + entry.afterCharCount > chars.length) return false;
    const slice = chars
      .slice(end, end + entry.afterCharCount)
      .join("")
      .toLowerCase();
    if (slice !== entry.afterFolded) return false;
  }
  if (entry.afterBoundary) {
    const boundaryIdx = end + entry.afterCharCount;
    if (boundaryIdx < chars.length && WORD_CHAR_RE.test(chars[boundaryIdx])) {
      return false;
    }
  }
  return true;
}

/**
 * Convert romanized text to phoneme string with full codepoint-level provenance trace.
 */
export function romanizationToPhonemesTraced(
  text: string,
  map: RomanizationMap,
): {
  input: string;
  normalized_input: string;
  output: string;
  segments: RomanizationSegment[];
} {
  if (!text) {
    return { input: "", normalized_input: "", output: "", segments: [] };
  }

  const rawCps = Array.from(text);
  const normItems = normalizeNfcWithProvenance(rawCps);
  const chars = normItems.map((item) => item.ch);
  const normalizedInput = chars.join("");

  const compiled = map && Array.isArray(map.rules) ? compileRules(map.rules) : [];

  if (compiled.length === 0) {
    const segments: RomanizationSegment[] = chars.map((ch, idx) => {
      const spanInfo = buildSourceSpans(normItems, idx, idx + 1);
      return {
        start: spanInfo.start,
        end: spanInfo.end,
        normalized_start: idx,
        normalized_end: idx + 1,
        source_spans: spanInfo.source_spans,
        input: rawCps.slice(spanInfo.start, spanInfo.end).join(""),
        normalized_input: ch,
        output: ch,
        rule_id: null,
        kind: "passthrough",
      };
    });
    return {
      input: text,
      normalized_input: normalizedInput,
      output: normalizedInput,
      segments,
    };
  }

  const segments: RomanizationSegment[] = [];
  let pos = 0;

  while (pos < chars.length) {
    let matched = false;
    for (const entry of compiled) {
      const end = pos + entry.charCount;
      if (end > chars.length) continue;
      const normSlice = chars.slice(pos, end).join("");
      if (normSlice.toLowerCase() !== entry.foldedInput) continue;
      if (!matchesBefore(chars, pos, entry) || !matchesAfter(chars, end, entry)) {
        continue;
      }

      const spanInfo = buildSourceSpans(normItems, pos, end);
      segments.push({
        start: spanInfo.start,
        end: spanInfo.end,
        normalized_start: pos,
        normalized_end: end,
        source_spans: spanInfo.source_spans,
        input: rawCps.slice(spanInfo.start, spanInfo.end).join(""),
        normalized_input: normSlice,
        output: entry.rule.output_type === "separator" ? "" : entry.rule.output_phoneme.normalize("NFC"),
        rule_id: entry.rule.rule_id,
        kind: "matched",
      });
      pos = end;
      matched = true;
      break;
    }

    if (!matched) {
      const spanInfo = buildSourceSpans(normItems, pos, pos + 1);
      const ch = chars[pos];
      segments.push({
        start: spanInfo.start,
        end: spanInfo.end,
        normalized_start: pos,
        normalized_end: pos + 1,
        source_spans: spanInfo.source_spans,
        input: rawCps.slice(spanInfo.start, spanInfo.end).join(""),
        normalized_input: ch,
        output: ch.toLowerCase(),
        rule_id: null,
        kind: "fallback",
      });
      pos += 1;
    }
  }

  return {
    input: text,
    normalized_input: normalizedInput,
    output: segments.map((s) => s.output).join(""),
    segments,
  };
}

/**
 * Convert romanized text to phoneme string using the given romanization map.
 * Greedy longest-input matching (with context specificity tie-breaking and `#` word boundaries).
 */
export const romanizationToPhonemes = (
  romanized: string,
  map: RomanizationMap,
): string => {
  return romanizationToPhonemesTraced(romanized, map).output;
};

/**
 * Expand a context pattern string into a regex fragment.
 * Supports:
 *   - `#` → word boundary (^ for before, $ for after)
 *   - Single-letter macro symbols (e.g. `V` → `(?:a|e|i|o|u)`)
 *   - Multi-character sequences (e.g. `lV` → `l(?:a|e|i|o|u)`)
 *   - `_` or empty → empty string
 */
const expandContext = (
  pattern: string,
  macros: Record<string, string[]>,
  position: "before" | "after",
): string => {
  if (!pattern || pattern === "_") return "";
  if (pattern === "#") return position === "before" ? "^" : "$";

  let result = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "#") {
      result += position === "before" ? "^" : "$";
      i += 1;
    } else if (macros[ch] && macros[ch].length > 0) {
      const sorted = [...macros[ch]].sort((a, b) => b.length - a.length);
      const alt = sorted
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
      result += `(?:${alt})`;
      i += 1;
    } else {
      // Literal character — escape regex special chars
      result += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return result;
};

function buildUtf16ToCodepointMap(str: string): number[] {
  const map = new Array<number>(str.length + 1);
  let cpIndex = 0;
  let u16 = 0;
  for (const ch of str) {
    map[u16] = cpIndex;
    if (ch.length === 2) {
      map[u16 + 1] = cpIndex;
    }
    u16 += ch.length;
    cpIndex += 1;
  }
  map[str.length] = cpIndex;
  return map;
}

/**
 * ECMA-262 GetSubstitution expansion for replacement templates against a regex match.
 */
function expandJsReplacement(
  template: string,
  matched: string,
  fullStr: string,
  position: number,
  captures: [string, string],
): string {
  if (!template.includes("$")) return template;

  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== "$" || i + 1 >= template.length) {
      out += ch;
      i += 1;
      continue;
    }

    const next = template[i + 1];
    if (next === "$") {
      out += "$";
      i += 2;
    } else if (next === "&") {
      out += matched;
      i += 2;
    } else if (next === "`") {
      out += fullStr.slice(0, position);
      i += 2;
    } else if (next === "'") {
      out += fullStr.slice(position + matched.length);
      i += 2;
    } else if (next === "1") {
      out += captures[0];
      i += 2;
    } else if (next === "2") {
      out += captures[1];
      i += 2;
    } else {
      out += "$" + next;
      i += 2;
    }
  }
  return out;
}

/**
 * Apply a single allophony rule with codepoint-level application tracing.
 * Uses a capturing group for the 'before' context and a lookahead for the 'after' context.
 */
const applyRuleTraced = (
  phonemes: string,
  rule: AllophonyRule,
  macros: Record<string, string[]>,
): AllophonyStep => {
  if (!rule.target) {
    return {
      rule_id: rule.rule_id,
      before: phonemes,
      after: phonemes,
      coordinate_space: "step_input_codepoints",
      applications: [],
    };
  }

  try {
    const beforeRaw = expandContext(rule.context_before, macros, "before");
    const afterRaw = expandContext(rule.context_after, macros, "after");
    const escapedTarget = rule.target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const beforeGroup = beforeRaw ? `(${beforeRaw})` : "()";
    const afterLookahead = afterRaw ? `(?=${afterRaw})` : "";
    const pattern = `${beforeGroup}(${escapedTarget})${afterLookahead}`;

    const regex = new RegExp(pattern, "g");
    const utf16ToCp = buildUtf16ToCodepointMap(phonemes);
    const applications: {
      start: number;
      end: number;
      input: string;
      output: string;
    }[] = [];

    let after = "";
    let lastUtf16Index = 0;
    let match: RegExpExecArray | null = null;

    while ((match = regex.exec(phonemes)) !== null) {
      const fullMatch = match[0];
      const p1 = match[1] ?? "";
      const p2 = match[2] ?? "";
      const matchOffset = match.index;
      const targetUtf16Start = matchOffset + p1.length;
      const targetUtf16End = targetUtf16Start + p2.length;

      const targetOutput = expandJsReplacement(
        rule.replacement ?? "",
        fullMatch,
        phonemes,
        matchOffset,
        [p1, p2],
      );

      applications.push({
        start: utf16ToCp[targetUtf16Start],
        end: utf16ToCp[targetUtf16End],
        input: p2,
        output: targetOutput,
      });

      after +=
        phonemes.slice(lastUtf16Index, targetUtf16Start) + targetOutput;
      lastUtf16Index = targetUtf16End;

      if (fullMatch.length === 0) {
        regex.lastIndex += 1;
      }
    }

    after += phonemes.slice(lastUtf16Index);

    return {
      rule_id: rule.rule_id,
      before: phonemes,
      after,
      coordinate_space: "step_input_codepoints",
      applications,
    };
  } catch {
    console.warn(
      `[Allophony] Invalid regex for rule "${rule.rule_id}": target="${rule.target}"`,
    );
    return {
      rule_id: rule.rule_id,
      before: phonemes,
      after: phonemes,
      coordinate_space: "step_input_codepoints",
      applications: [],
    };
  }
};

/**
 * Apply all allophony rules sorted by priority (higher priority first) with step trace.
 */
export const applyAllophonyTraced = (
  phonemes: string,
  rules: AllophonyRule[],
  macros: Record<string, string[]>,
): { result: string; steps: AllophonyStep[] } => {
  const sorted = [...rules].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );
  const steps: AllophonyStep[] = [];
  let current = phonemes;

  for (const rule of sorted) {
    const step = applyRuleTraced(current, rule, macros);
    steps.push(step);
    current = step.after;
  }

  return { result: current, steps };
};

/**
 * Apply all allophony rules sorted by priority (higher priority first).
 */
export const applyAllophony = (
  phonemes: string,
  rules: AllophonyRule[],
  macros: Record<string, string[]>,
): string => {
  return applyAllophonyTraced(phonemes, rules, macros).result;
};

/**
 * Full traced IPA generation pipeline:
 * romanized text → phonemes (via romanization map) → allophony → IPA string + trace.
 */
function phonemeOffsetForStem(
  segments: RomanizationSegment[],
  stemStart: number,
): number {
  let offset = 0;
  for (const segment of segments) {
    if (segment.end > stemStart) return offset;
    offset += Array.from(segment.output).length;
  }
  return offset;
}

function initialStressPositions(
  phonemes: string,
  config: PhonologyConfig,
  explicitStem: number | undefined,
): number[] {
  const stress = config.phonotactics.stress;
  if (!stress || stress.position !== "initial") return [];
  const vowels = new Set(config.phoneme_inventory.vowels);
  const positions: number[] = [];
  const words = phonemes.matchAll(/[\p{L}\p{M}]+(?:[.·'-][\p{L}\p{M}]+)*/gu);
  for (const match of words) {
    if (/[ˈˌ]/u.test(match[0])) continue;
    if (!tokenizePhonemes(match[0], [...vowels]).some((token) => vowels.has(token))) continue;
    const start = Array.from(phonemes.slice(0, match.index)).length;
    const end = start + Array.from(match[0]).length;
    const position = explicitStem !== undefined && explicitStem >= start && explicitStem < end
      ? explicitStem
      : start;
    positions.push(position);
    if (stress.domain === "entry") break;
  }
  return positions;
}

function transformStressPositions(positions: number[], steps: AllophonyStep[]): number[] {
  return steps.reduce((current, step) => current.map((position) => {
    let shift = 0;
    for (const change of step.applications) {
      if (change.end <= position) {
        shift += Array.from(change.output).length - (change.end - change.start);
      } else if (change.start < position) {
        return change.start + shift;
      }
    }
    return position + shift;
  }), positions);
}

function insertStress(text: string, positions: number[]): string {
  const chars = Array.from(text);
  for (const position of [...new Set(positions)].sort((a, b) => b - a)) {
    if (position < chars.length && WORD_CHAR_RE.test(chars[position])) chars.splice(position, 0, "ˈ");
  }
  return chars.join("");
}

export function generateIPATraced(
  text: string,
  config: PhonologyConfig,
  context: IpaGenerationContext = {},
): {
  phonemic: string;
  surface: string;
  romanization: ReturnType<typeof romanizationToPhonemesTraced> | null;
  allophony_steps: AllophonyStep[];
  prosody?: { phonemic_positions: number[]; surface_positions: number[]; stem_start?: number };
} {
  const defaultMap =
    config.romanization_maps.find((m) => m.is_default) ??
    config.romanization_maps[0];

  if (!defaultMap || !text.trim()) {
    return {
      phonemic: "",
      surface: "",
      romanization: null,
      allophony_steps: [],
    };
  }

  const romanization = romanizationToPhonemesTraced(text, defaultMap);
  const phonemes = romanization.output;
  const { result: surfaceRaw, steps } = applyAllophonyTraced(
    phonemes,
    config.allophony_rules,
    config.phonotactics.macros,
  );

  if (context.stem_start !== undefined && (
    !Number.isInteger(context.stem_start) || context.stem_start < 0 || context.stem_start > Array.from(text).length
  )) throw new RangeError("stem_start must be an input codepoint offset");
  const stemOffset = context.stem_start === undefined
    ? undefined
    : phonemeOffsetForStem(romanization.segments, context.stem_start);
  const stressPositions = initialStressPositions(phonemes, config, stemOffset);
  const surfacePositions = transformStressPositions(stressPositions, steps);

  return {
    phonemic: `/${insertStress(phonemes, stressPositions)}/`,
    surface: phonemes !== surfaceRaw ? `[${insertStress(surfaceRaw, surfacePositions)}]` : "",
    romanization,
    allophony_steps: steps,
    ...(config.phonotactics.stress ? { prosody: { phonemic_positions: stressPositions, surface_positions: surfacePositions, ...context } } : {}),
  };
}

/**
 * Full IPA generation pipeline:
 * romanized text → phonemes (via romanization map) → allophony → IPA string
 *
 * Returns the IPA string wrapped in slashes: /.../ for phonemic, [...] for surface.
 */
export const generateIPA = (
  romanized: string,
  config: PhonologyConfig,
  context: IpaGenerationContext = {},
): { phonemic: string; surface: string } => {
  const traced = generateIPATraced(romanized, config, context);
  return {
    phonemic: traced.phonemic,
    surface: traced.surface,
  };
};
