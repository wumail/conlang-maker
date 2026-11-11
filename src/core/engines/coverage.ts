import {
  CorpusText,
  GlyphAnnotation,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import { isValidWordEntry } from "../lexicon/utils";
import { romanizationToPhonemesTraced } from "./ipaGenerator";
import { selectRomanizationMaps } from "./romanizationLint";
import { charactersOf, formatCodepoint } from "./unicodeBlocks";

export interface FontShapingLayout {
  direction: "ltr" | "rtl";
  script: string | undefined;
  language: string | undefined;
  features: string[];
}

/**
 * Shared baseline layout matching GUI `.conlang-script` (`src/App.css`, `index.html`).
 * Empty `features` delegates to HarfBuzz's standard enabled OpenType features
 * (`ccmp`, `rlig`, `liga`, `clig`, `calt`, `locl`, `mark`, `mkmk`, `kern`).
 */
export const GUI_DEFAULT_LAYOUT: Readonly<FontShapingLayout> = {
  direction: "ltr",
  script: undefined,
  language: undefined,
  features: [],
};

export type CoverageSource = "romanization" | "lexicon" | "corpus" | "tones";
export type NormalizationMode = "as_used" | "NFC" | "NFD";
export type CaseMode = "as_used" | "both";
export type CharCoverageStatus =
  | "covered"
  | "missing"
  | "decomposed_only"
  | "case_missing";

export interface RomanizationRuleRef {
  map_id: string;
  rule_id: string;
  input: string;
  normalized_input: string;
  output_phoneme: string;
  from_context?: boolean;
}

export interface LexiconExampleRef {
  entry_id: string;
  spelling: string;
}

export interface CorpusExampleRef {
  corpus_id: string;
  title: string;
  line_id?: string;
  snippet: string;
}

export interface ToneMarkerRef {
  tone_id: string;
  name: string;
  marker: string;
}

export interface CharRequirement {
  char: string;
  codepoint: number;
  codepoint_hex: string;
  is_punctuation: boolean;
  romanization: RomanizationRuleRef[];
  lexicon: {
    count: number;
    examples: LexiconExampleRef[];
  };
  corpus: {
    count: number;
    examples: CorpusExampleRef[];
  };
  tones: ToneMarkerRef[];
}

export interface MultiCharSequenceRequirement {
  map_id: string;
  rule_id: string;
  raw_input: string;
  text: string;
  codepoints: number[];
  output_phoneme: string;
  has_context: boolean;
  contextual_combinations: string[];
  lexicon_samples: LexiconExampleRef[];
}

export interface GlyphAnnotationCrossCheck {
  annotated_codepoints: number[];
  annotated_missing_in_cmap: number[];
  unannotated_required_codepoints: number[];
  unused_annotations: GlyphAnnotation[];
}

export interface UnmappedSpellingItem {
  entry_id: string;
  spelling: string;
  unmapped_chars: string[];
}

export interface ExtractCoverageInput {
  phonology: PhonologyConfig;
  words?: WordEntry[];
  corpora?: CorpusText[];
  sources?: CoverageSource[];
  mapScope?: "default" | "all" | string;
  normalization?: NormalizationMode;
  maxExamples?: number;
}

export interface ExtractedCoverageRequirements {
  normalization: NormalizationMode;
  sources: CoverageSource[];
  required_chars: CharRequirement[];
  punctuation_chars: CharRequirement[];
  sequences: MultiCharSequenceRequirement[];
  unmapped_spellings: UnmappedSpellingItem[];
  warnings: string[];
}

export interface CharCoverageClassification extends CharRequirement {
  status: CharCoverageStatus;
  missing_case_variants: string[];
  nfd_codepoints: number[];
}

export interface FontCoverageAuditInput extends ExtractCoverageInput {
  cmap: ReadonlySet<number>;
  caseMode?: CaseMode;
}

export interface FontCoverageAuditResult {
  layout: FontShapingLayout;
  normalization: NormalizationMode;
  case_mode: CaseMode;
  summary: {
    required_chars: number;
    covered: number;
    missing: number;
    decomposed_only: number;
    case_missing: number;
    punctuation_chars: number;
    unmapped_spellings: number;
  };
  characters: CharCoverageClassification[];
  covered_chars: CharCoverageClassification[];
  missing_chars: CharCoverageClassification[];
  decomposed_only_chars: CharCoverageClassification[];
  case_missing_chars: CharCoverageClassification[];
  punctuation_chars: CharCoverageClassification[];
  sequences: MultiCharSequenceRequirement[];
  glyph_annotations_check: GlyphAnnotationCrossCheck;
  unmapped_spellings: UnmappedSpellingItem[];
  warnings: string[];
}

/** Backward-compatible report interface used by early MCP scaffolding. */
export interface CoverageReport {
  missing_chars: number[];
}

const DEFAULT_SOURCES: CoverageSource[] = [
  "romanization",
  "lexicon",
  "corpus",
  "tones",
];
const WHITESPACE_RE = /^\s+$/u;
const PUNCTUATION_RE = /^\p{P}+$/u;

function applyNormalization(text: string, mode: NormalizationMode): string {
  if (mode === "NFC") return text.normalize("NFC");
  if (mode === "NFD") return text.normalize("NFD");
  return text;
}

function stripContextBoundaryAndMacros(
  rawCtx: string | undefined,
  macroKeys: ReadonlySet<string>,
): string {
  const trimmed = (rawCtx ?? "").trim();
  if (!trimmed || trimmed === "_" || trimmed === "#") return "";
  const withoutHashes = trimmed.replace(/^#+|#+$/g, "");
  if (!withoutHashes || macroKeys.has(withoutHashes)) return "";
  // Filter out standalone macro tokens if space-separated or single-char uppercase macro
  if (
    charactersOf(withoutHashes).every((ch) => macroKeys.has(ch))
  ) {
    return "";
  }
  return withoutHashes;
}

interface MutableCharBucket {
  char: string;
  codepoint: number;
  explicitOrthographic: boolean;
  romanization: RomanizationRuleRef[];
  romanizationKeys: Set<string>;
  lexiconCount: number;
  lexiconSeenEntries: Set<string>;
  lexiconExamples: LexiconExampleRef[];
  corpusCount: number;
  corpusExamples: CorpusExampleRef[];
  tones: ToneMarkerRef[];
  toneIds: Set<string>;
}

/**
 * Extracts character, sequence, and unmapped-spelling requirements from language data (`PRD §6.3` / `T2.9`).
 */
export function extractCoverageRequirements(
  input: ExtractCoverageInput,
): ExtractedCoverageRequirements {
  const {
    phonology,
    words = [],
    corpora = [],
    sources = DEFAULT_SOURCES,
    mapScope = "default",
    normalization = "as_used",
    maxExamples = 5,
  } = input;

  const sourceSet = new Set<CoverageSource>(sources);
  const buckets = new Map<number, MutableCharBucket>();
  const warnings: string[] = [];

  // Track NFC vs raw forms to detect normalization inconsistencies in `"as_used"` mode
  const rawFormsByNfc = new Map<string, Set<string>>();
  let sawNonNfcString = false;
  let sawPrecomposedNfcString = false;

  const recordNormalizationObservation = (raw: string) => {
    if (normalization !== "as_used" || !raw) return;
    const nfc = raw.normalize("NFC");
    const nfd = raw.normalize("NFD");
    if (raw !== nfc) {
      sawNonNfcString = true;
    } else if (nfc !== nfd) {
      sawPrecomposedNfcString = true;
    }

    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      for (const part of seg.segment(raw)) {
        const g = part.segment;
        if (WHITESPACE_RE.test(g)) continue;
        const gNfc = g.normalize("NFC");
        const gNfd = g.normalize("NFD");
        if (gNfc !== gNfd) {
          const set = rawFormsByNfc.get(gNfc) ?? new Set<string>();
          set.add(g);
          rawFormsByNfc.set(gNfc, set);
        }
      }
    }
  };

  const getOrCreateBucket = (
    ch: string,
    explicitOrthographic: boolean,
  ): MutableCharBucket | null => {
    if (!ch || WHITESPACE_RE.test(ch)) return null;
    const cp = ch.codePointAt(0);
    if (cp === undefined) return null;
    let bucket = buckets.get(cp);
    if (!bucket) {
      bucket = {
        char: ch,
        codepoint: cp,
        explicitOrthographic,
        romanization: [],
        romanizationKeys: new Set<string>(),
        lexiconCount: 0,
        lexiconSeenEntries: new Set<string>(),
        lexiconExamples: [],
        corpusCount: 0,
        corpusExamples: [],
        tones: [],
        toneIds: new Set<string>(),
      };
      buckets.set(cp, bucket);
    } else if (explicitOrthographic) {
      bucket.explicitOrthographic = true;
    }
    return bucket;
  };

  const validWords = words.filter(
    (w) => isValidWordEntry(w) && !w.evolution?.is_deprecated,
  );
  const selectedMaps = selectRomanizationMaps(phonology, mapScope);
  const macroKeys = new Set<string>([
    "V",
    "C",
    ...Object.keys(phonology.phonotactics?.macros ?? {}),
  ]);

  const sequences: MultiCharSequenceRequirement[] = [];

  // 1. Romanization rules & contextual combinations
  if (sourceSet.has("romanization")) {
    for (const map of selectedMaps) {
      for (const rule of map.rules) {
        if (!rule.input) continue;
        recordNormalizationObservation(rule.input);
        const normInput = applyNormalization(rule.input, normalization);
        const inputCodepoints = charactersOf(normInput);

        for (const ch of inputCodepoints) {
          const bucket = getOrCreateBucket(ch, true);
          if (!bucket) continue;
          const refKey = `${map.map_id}:${rule.rule_id}:input`;
          if (!bucket.romanizationKeys.has(refKey)) {
            bucket.romanizationKeys.add(refKey);
            bucket.romanization.push({
              map_id: map.map_id,
              rule_id: rule.rule_id,
              input: rule.input,
              normalized_input: normInput,
              output_phoneme: rule.output_phoneme,
            });
          }
        }

        const litBeforeRaw = stripContextBoundaryAndMacros(
          rule.context_before,
          macroKeys,
        );
        const litAfterRaw = stripContextBoundaryAndMacros(
          rule.context_after,
          macroKeys,
        );
        if (litBeforeRaw) recordNormalizationObservation(litBeforeRaw);
        if (litAfterRaw) recordNormalizationObservation(litAfterRaw);

        const litBefore = applyNormalization(litBeforeRaw, normalization);
        const litAfter = applyNormalization(litAfterRaw, normalization);

        for (const ch of [...charactersOf(litBefore), ...charactersOf(litAfter)]) {
          const bucket = getOrCreateBucket(ch, true);
          if (!bucket) continue;
          const refKey = `${map.map_id}:${rule.rule_id}:ctx`;
          if (!bucket.romanizationKeys.has(refKey)) {
            bucket.romanizationKeys.add(refKey);
            bucket.romanization.push({
              map_id: map.map_id,
              rule_id: rule.rule_id,
              input: rule.input,
              normalized_input: normInput,
              output_phoneme: rule.output_phoneme,
              from_context: true,
            });
          }
        }

        const hasContext = Boolean(
          (rule.context_before && rule.context_before.trim() && rule.context_before.trim() !== "_") ||
            (rule.context_after && rule.context_after.trim() && rule.context_after.trim() !== "_"),
        );
        const comboText = `${litBefore}${normInput}${litAfter}`;
        const isMultiChar =
          inputCodepoints.length > 1 || charactersOf(comboText).length > 1;

        if (isMultiChar || hasContext) {
          const contextualCombinations: string[] = [];
          if (comboText !== normInput && charactersOf(comboText).length > 1) {
            contextualCombinations.push(comboText);
          }

          const lexiconSamples: LexiconExampleRef[] = [];
          const needleFolded = comboText.toLowerCase();
          if (needleFolded) {
            for (const w of validWords) {
              if (lexiconSamples.length >= maxExamples) break;
              const wNorm = applyNormalization(
                w.con_word_romanized,
                normalization,
              );
              if (wNorm.toLowerCase().includes(needleFolded)) {
                lexiconSamples.push({
                  entry_id: w.entry_id,
                  spelling: w.con_word_romanized,
                });
              }
            }
          }

          sequences.push({
            map_id: map.map_id,
            rule_id: rule.rule_id,
            raw_input: rule.input,
            text: normInput,
            codepoints: inputCodepoints
              .map((c) => c.codePointAt(0))
              .filter((cp): cp is number => cp !== undefined),
            output_phoneme: rule.output_phoneme,
            has_context: hasContext,
            contextual_combinations: contextualCombinations,
            lexicon_samples: lexiconSamples,
          });
        }
      }
    }
  }

  // 2. Lexicon words
  if (sourceSet.has("lexicon")) {
    for (const w of validWords) {
      recordNormalizationObservation(w.con_word_romanized);
      const normWord = applyNormalization(w.con_word_romanized, normalization);
      const uniqueCpsInWord = new Set<number>();

      for (const ch of charactersOf(normWord)) {
        const bucket = getOrCreateBucket(ch, false);
        if (!bucket) continue;
        if (!uniqueCpsInWord.has(bucket.codepoint)) {
          uniqueCpsInWord.add(bucket.codepoint);
          bucket.lexiconCount += 1;
          if (
            bucket.lexiconExamples.length < maxExamples &&
            !bucket.lexiconSeenEntries.has(w.entry_id)
          ) {
            bucket.lexiconSeenEntries.add(w.entry_id);
            bucket.lexiconExamples.push({
              entry_id: w.entry_id,
              spelling: w.con_word_romanized,
            });
          }
        }
      }
    }
  }

  // 3. Corpus texts (`original_text` + `glossed_lines[].original` + `tokens[].surface_form`)
  if (sourceSet.has("corpus")) {
    const recordCorpusFragment = (
      rawText: string,
      corpusId: string,
      title: string,
      lineId?: string,
    ) => {
      if (!rawText) return;
      recordNormalizationObservation(rawText);
      const normText = applyNormalization(rawText, normalization);
      const seenInFragment = new Set<number>();
      const snippet =
        rawText.length > 60 ? `${rawText.slice(0, 57)}...` : rawText;

      for (const ch of charactersOf(normText)) {
        const bucket = getOrCreateBucket(ch, false);
        if (!bucket) continue;
        bucket.corpusCount += 1;
        if (
          !seenInFragment.has(bucket.codepoint) &&
          bucket.corpusExamples.length < maxExamples
        ) {
          seenInFragment.add(bucket.codepoint);
          const alreadyHasRef = bucket.corpusExamples.some(
            (ex) => ex.corpus_id === corpusId && ex.line_id === lineId && ex.snippet === snippet,
          );
          if (!alreadyHasRef) {
            bucket.corpusExamples.push({
              corpus_id: corpusId,
              title,
              line_id: lineId,
              snippet,
            });
          }
        }
      }
    };

    for (const ct of corpora) {
      recordCorpusFragment(ct.original_text, ct.corpus_id, ct.title);
      for (const line of ct.glossed_lines) {
        recordCorpusFragment(
          line.original,
          ct.corpus_id,
          ct.title,
          line.line_id,
        );
        for (const tok of line.tokens) {
          recordCorpusFragment(
            tok.surface_form,
            ct.corpus_id,
            ct.title,
            line.line_id,
          );
        }
      }
    }
  }

  // 4. Tones (`tone_system.tones[].marker`)
  if (sourceSet.has("tones")) {
    const toneSystem = phonology.phonotactics?.tone_system;
    if (toneSystem?.enabled) {
      for (const tone of toneSystem.tones) {
        if (!tone.marker) continue;
        recordNormalizationObservation(tone.marker);
        const normMarker = applyNormalization(tone.marker, normalization);
        for (const ch of charactersOf(normMarker)) {
          const bucket = getOrCreateBucket(ch, true);
          if (!bucket) continue;
          if (!bucket.toneIds.has(tone.tone_id)) {
            bucket.toneIds.add(tone.tone_id);
            bucket.tones.push({
              tone_id: tone.tone_id,
              name: tone.name,
              marker: tone.marker,
            });
          }
        }
      }
    }
  }

  // Emit normalization inconsistency warnings in `"as_used"` mode
  if (normalization === "as_used") {
    for (const [nfc, rawSet] of rawFormsByNfc.entries()) {
      if (rawSet.size > 1) {
        const formsDesc = Array.from(rawSet)
          .map(
            (f) =>
              `${f} (${charactersOf(f)
                .map((c) => formatCodepoint(c.codePointAt(0) ?? 0))
                .join("+")})`,
          )
          .join(" vs ");
        warnings.push(
          `Inconsistent NFC/NFD forms detected for "${nfc}": ${formsDesc}`,
        );
      }
    }
    if (warnings.length === 0 && sawNonNfcString && sawPrecomposedNfcString) {
      warnings.push(
        "Mixed Unicode normalization detected across inputs (both precomposed NFC and decomposed NFD sequences are present).",
      );
    } else if (warnings.length === 0 && sawNonNfcString) {
      warnings.push(
        "Non-NFC decomposed character sequences detected in 'as_used' mode; consider normalizing to NFC or NFD.",
      );
    }
  }

  // Partition into core required_chars vs punctuation_chars (PRD §6.3 step 4)
  const required_chars: CharRequirement[] = [];
  const punctuation_chars: CharRequirement[] = [];

  const sortedBuckets = Array.from(buckets.values()).sort(
    (a, b) => a.codepoint - b.codepoint,
  );
  for (const b of sortedBuckets) {
    const isPunct = PUNCTUATION_RE.test(b.char) && !b.explicitOrthographic;
    const item: CharRequirement = {
      char: b.char,
      codepoint: b.codepoint,
      codepoint_hex: formatCodepoint(b.codepoint),
      is_punctuation: PUNCTUATION_RE.test(b.char),
      romanization: b.romanization,
      lexicon: {
        count: b.lexiconCount,
        examples: b.lexiconExamples,
      },
      corpus: {
        count: b.corpusCount,
        examples: b.corpusExamples,
      },
      tones: b.tones,
    };
    if (isPunct) {
      punctuation_chars.push(item);
    } else {
      required_chars.push(item);
    }
  }

  // Unmapped spellings via `romanizationToPhonemesTraced` (PRD §6.3 step 6)
  const unmapped_spellings: UnmappedSpellingItem[] = [];
  const defaultMap =
    phonology.romanization_maps.find((m) => m.is_default) ??
    phonology.romanization_maps[0];
  if (defaultMap && defaultMap.rules.some((r) => r.input.trim().length > 0)) {
    for (const w of validWords) {
      const traced = romanizationToPhonemesTraced(
        w.con_word_romanized,
        defaultMap,
      );
      const fallbackChars = traced.segments
        .filter(
          (seg) =>
            seg.kind === "fallback" &&
            !WHITESPACE_RE.test(seg.input) &&
            !PUNCTUATION_RE.test(seg.input),
        )
        .map((seg) => seg.input);
      if (fallbackChars.length > 0) {
        unmapped_spellings.push({
          entry_id: w.entry_id,
          spelling: w.con_word_romanized,
          unmapped_chars: Array.from(new Set(fallbackChars)),
        });
      }
    }
  }

  return {
    normalization,
    sources: Array.from(sourceSet),
    required_chars,
    punctuation_chars,
    sequences,
    unmapped_spellings,
    warnings,
  };
}

function allCodepointsInCmap(text: string, cmap: ReadonlySet<number>): boolean {
  const chars = charactersOf(text);
  if (chars.length === 0) return false;
  return chars.every((c) => {
    const cp = c.codePointAt(0);
    return cp !== undefined && cmap.has(cp);
  });
}

/**
 * Classifies a single codepoint against `cmap` under `caseMode` (`"as_used"` vs `"both"`).
 */
export function classifyCharacterCoverage(
  codepoint: number,
  cmap: ReadonlySet<number>,
  caseMode: CaseMode = "as_used",
): {
  status: CharCoverageStatus;
  missing_case_variants: string[];
  nfd_codepoints: number[];
} {
  const ch = String.fromCodePoint(codepoint);
  const inCmap = cmap.has(codepoint);
  const nfdChars = charactersOf(ch.normalize("NFD"));
  const nfd_codepoints = nfdChars
    .map((c) => c.codePointAt(0))
    .filter((cp): cp is number => cp !== undefined);

  const upper = ch.toUpperCase();
  const lower = ch.toLowerCase();
  const hasDistinctUpper = upper !== ch;
  const hasDistinctLower = lower !== ch;
  const upperCovered = hasDistinctUpper && allCodepointsInCmap(upper, cmap);
  const lowerCovered = hasDistinctLower && allCodepointsInCmap(lower, cmap);

  if (inCmap) {
    if (caseMode === "both") {
      const missingVariants: string[] = [];
      if (hasDistinctUpper && !upperCovered) {
        missingVariants.push(upper);
      }
      if (hasDistinctLower && !lowerCovered) {
        missingVariants.push(lower);
      }
      if (missingVariants.length > 0) {
        return {
          status: "case_missing",
          missing_case_variants: missingVariants,
          nfd_codepoints,
        };
      }
    }
    return {
      status: "covered",
      missing_case_variants: [],
      nfd_codepoints,
    };
  }

  // `codepoint` itself is NOT in `cmap`
  if (
    nfd_codepoints.length > 1 &&
    nfd_codepoints.every((cp) => cmap.has(cp))
  ) {
    return {
      status: "decomposed_only",
      missing_case_variants: [],
      nfd_codepoints,
    };
  }

  if (upperCovered || lowerCovered) {
    return {
      status: "case_missing",
      missing_case_variants: [ch],
      nfd_codepoints,
    };
  }

  const missingVariants: string[] = [];
  if (caseMode === "both") {
    if (hasDistinctUpper && !upperCovered) missingVariants.push(upper);
    if (hasDistinctLower && !lowerCovered) missingVariants.push(lower);
  }

  return {
    status: "missing",
    missing_case_variants: missingVariants,
    nfd_codepoints,
  };
}

/**
 * Cross-checks `phonology.glyph_annotations` against required codepoints and `cmap`.
 */
export function crossCheckGlyphAnnotations(
  annotations: GlyphAnnotation[] | undefined,
  requiredCodepoints: ReadonlySet<number>,
  cmap: ReadonlySet<number>,
): GlyphAnnotationCrossCheck {
  const list = annotations ?? [];
  const annotatedSet = new Set<number>();
  const annotated_missing_in_cmap: number[] = [];
  const unused_annotations: GlyphAnnotation[] = [];

  for (const ann of list) {
    annotatedSet.add(ann.codepoint);
    if (!cmap.has(ann.codepoint)) {
      annotated_missing_in_cmap.push(ann.codepoint);
    }
    if (!requiredCodepoints.has(ann.codepoint)) {
      unused_annotations.push(ann);
    }
  }

  const unannotated_required_codepoints = Array.from(requiredCodepoints)
    .filter((cp) => !annotatedSet.has(cp))
    .sort((a, b) => a - b);

  return {
    annotated_codepoints: Array.from(annotatedSet).sort((a, b) => a - b),
    annotated_missing_in_cmap: Array.from(
      new Set(annotated_missing_in_cmap),
    ).sort((a, b) => a - b),
    unannotated_required_codepoints,
    unused_annotations,
  };
}

/**
 * Full pure character-level font coverage audit (`PRD §6` / `T2.9`).
 */
export function auditFontCoverage(
  input: FontCoverageAuditInput,
): FontCoverageAuditResult {
  const { cmap, caseMode = "as_used" } = input;
  const extracted = extractCoverageRequirements(input);

  const classifyItem = (req: CharRequirement): CharCoverageClassification => {
    const cls = classifyCharacterCoverage(req.codepoint, cmap, caseMode);
    return {
      ...req,
      status: cls.status,
      missing_case_variants: cls.missing_case_variants,
      nfd_codepoints: cls.nfd_codepoints,
    };
  };

  const characters = extracted.required_chars.map(classifyItem);
  const punctuation_chars = extracted.punctuation_chars.map(classifyItem);

  const covered_chars = characters.filter((c) => c.status === "covered");
  const missing_chars = characters.filter((c) => c.status === "missing");
  const decomposed_only_chars = characters.filter(
    (c) => c.status === "decomposed_only",
  );
  const case_missing_chars = characters.filter(
    (c) => c.status === "case_missing",
  );

  const requiredCpSet = new Set<number>(characters.map((c) => c.codepoint));
  const glyph_annotations_check = crossCheckGlyphAnnotations(
    input.phonology.glyph_annotations,
    requiredCpSet,
    cmap,
  );

  return {
    layout: {
      direction: GUI_DEFAULT_LAYOUT.direction,
      script: GUI_DEFAULT_LAYOUT.script,
      language: GUI_DEFAULT_LAYOUT.language,
      features: [...GUI_DEFAULT_LAYOUT.features],
    },
    normalization: extracted.normalization,
    case_mode: caseMode,
    summary: {
      required_chars: characters.length,
      covered: covered_chars.length,
      missing: missing_chars.length,
      decomposed_only: decomposed_only_chars.length,
      case_missing: case_missing_chars.length,
      punctuation_chars: punctuation_chars.length,
      unmapped_spellings: extracted.unmapped_spellings.length,
    },
    characters,
    covered_chars,
    missing_chars,
    decomposed_only_chars,
    case_missing_chars,
    punctuation_chars,
    sequences: extracted.sequences,
    glyph_annotations_check,
    unmapped_spellings: extracted.unmapped_spellings,
    warnings: extracted.warnings,
  };
}

/**
 * Simple codepoint extractor kept for backward compatibility with early callers.
 */
export function extractRequirements(config: PhonologyConfig): number[] {
  const reqs = new Set<number>();
  config.glyph_annotations?.forEach((a) => {
    if (typeof a.codepoint === "number") reqs.add(a.codepoint);
  });
  const extracted = extractCoverageRequirements({
    phonology: config,
    sources: ["romanization", "tones"],
    mapScope: "all",
  });
  for (const ch of extracted.required_chars) {
    reqs.add(ch.codepoint);
  }
  return Array.from(reqs).sort((a, b) => a - b);
}

/**
 * Simple cmap diff kept for backward compatibility with early callers.
 */
export function checkCoverage(
  required: number[],
  supported: ReadonlySet<number>,
): CoverageReport {
  return {
    missing_chars: required.filter((c) => !supported.has(c)),
  };
}
