import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  auditFontCoverage,
  type CaseMode,
  type CharCoverageClassification,
  type CoverageSource,
  type NormalizationMode,
} from "../../src/core/engines/coverage";
import {
  charactersOf,
  formatCodepoint,
  unicodeBlockId,
} from "../../src/core/engines/unicodeBlocks";
import type {
  CorpusText,
  GlyphAnnotation,
  LanguageEntry,
  PhonologyLoadResult,
  WordEntry,
} from "../../src/types";
import {
  loadProjectMcpSettings,
  resolveResidualGlyphPattern,
  type ExternalFontProjectLink,
  type McpConfig,
} from "../config";
import { McpError } from "../errors";
import {
  buildCodepointToGidMap,
  enumerateAllGlyphs,
  loadFontFromBytes,
  loadFontFromFile,
} from "../font/loader";
import { shapeText } from "../font/shaper";
import {
  GUI_DEFAULT_LAYOUT,
  type AppliedLayoutMetadata,
  type LayoutOptions,
  type LoadedFontHandle,
  type ShapeResult,
} from "../font/types";
import {
  assertPathAllowed,
  assertSafeRelativeLanguagePath,
  resolveLanguage,
} from "../registry/addressing";
import {
  findOwnFontFile,
  listLanguageFontStatusesUnlocked,
  readCorpusIndexUnlocked,
  readCorpusTextUnlocked,
  readLexiconUnlocked,
  readPhonologyUnlocked,
  readWorkspaceUnlocked,
  resolveFontFileUnlocked,
} from "../storage/read";
import { withConsistentProjectRead } from "../storage/read";
import {
  computeFileRevision,
  MISSING_REVISION,
  sha256Prefix16,
} from "../storage/revision";
import { registerDefinedTool } from "../toolRegistry";
import { decodeCursor, encodeCursor } from "../util/paging";
import {
  familyInputFields,
  languageInputFields,
  pickLanguageArg,
  resolveFamilyFromArgs,
} from "./_helpers";
import { buildAncestorChain } from "./fonts_writing";

const COVERAGE_SOURCES = [
  "romanization",
  "lexicon",
  "corpus",
  "tones",
] as const;

const DEFAULT_COVERAGE_SOURCES: readonly CoverageSource[] = [
  "romanization",
  "lexicon",
  "corpus",
  "tones",
];

const auditCommonOptionFields = {
  sources: z
    .array(z.enum(COVERAGE_SOURCES))
    .optional()
    .describe(
      "Requirement sources to audit (defaults to romanization, lexicon, corpus, tones)",
    ),
  map_scope: z
    .string()
    .optional()
    .default("default")
    .describe("'default', 'all', or a specific romanization map_id"),
  shaping: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Whether to run HarfBuzz shaping checks on multi-char sequences, lexicon words, and corpus lines",
    ),
  features: z
    .array(z.string())
    .optional()
    .describe(
      "Optional OpenType feature overrides (e.g. ['ss01', '-liga']); defaults to GUI_DEFAULT_LAYOUT",
    ),
  normalization: z
    .enum(["as_used", "NFC", "NFD"])
    .optional()
    .default("as_used")
    .describe("Unicode normalization applied prior to cmap & shaping checks"),
  direction: z
    .enum(["ltr", "rtl", "ttb", "btt"])
    .optional()
    .describe("Text shaping direction (defaults to GUI 'ltr')"),
  script: z
    .string()
    .optional()
    .describe("Explicit ISO 15924 OpenType script tag override"),
  language_tag: z
    .string()
    .optional()
    .describe("Explicit OpenType/BCP47 language tag override (defaults to 'en')"),
  residual_glyph_pattern: z
    .string()
    .optional()
    .describe(
      "Regex matching untransformed/residual glyph names (falls back to .conlang-maker/mcp.json if unset)",
    ),
  case: z
    .enum(["as_used", "both"])
    .optional()
    .default("as_used")
    .describe("Case coverage mode: 'as_used' or 'both'"),
  max_examples: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(5)
    .describe("Maximum example items collected per issue bucket"),
};

interface AuditOptionsInput {
  sources?: CoverageSource[];
  map_scope?: string;
  shaping?: boolean;
  features?: string[];
  normalization?: NormalizationMode;
  direction?: "ltr" | "rtl" | "ttb" | "btt";
  script?: string;
  language_tag?: string;
  residual_glyph_pattern?: string;
  case?: CaseMode;
  max_examples?: number;
}

interface FontAuditGlyphView {
  gid: number;
  glyph_name: string | null;
  cluster: number;
  cluster_unit: "shaped_input_codepoints";
  codepoint_span: [number, number];
  source_codepoint_span: [number, number];
  source_text: string;
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  is_notdef: boolean;
}

type MultiCharSequenceStatus =
  | "notdef"
  | "substituted"
  | "positioning_only"
  | "sequence_not_unified"
  | "not_evaluated";

interface MultiCharSequenceAuditItem {
  map_id: string;
  rule_id: string;
  raw_input: string;
  text: string;
  codepoints: string[];
  output_phoneme: string;
  has_context: boolean;
  standalone_only: boolean;
  ligature_formed: boolean;
  substituted: boolean;
  positioning_adjusted: boolean;
  has_notdef: boolean;
  status: MultiCharSequenceStatus;
  glyphs: FontAuditGlyphView[];
  contextual_samples: {
    entry_id: string;
    spelling: string;
    has_notdef: boolean;
    glyphs: FontAuditGlyphView[];
  }[];
}

interface ResidualGlyphFinding {
  gid: number;
  glyph_name: string;
  matched_pattern: string;
  lexicon_count: number;
  corpus_count: number;
  lexicon_examples: {
    entry_id: string;
    spelling: string;
    source_text: string;
    source_codepoint_span: [number, number];
  }[];
  corpus_examples: {
    corpus_id: string;
    title: string;
    line_id?: string;
    snippet: string;
  }[];
}

interface ExternalFontProjectInspection {
  configured_path: string;
  variant: string | null;
  evaluated: boolean;
  reason?: string;
  unresolved_dictionary_spellings: string[];
  fea_files: string[];
}

interface LanguageConsistentAuditSnapshot {
  language: LanguageEntry;
  phonologyLoad: PhonologyLoadResult;
  words: WordEntry[];
  lexiconRevision: string;
  corpora: CorpusText[];
  corpusIndexRevision: string;
  ownFontRevision: string;
  fontSource:
    | {
        kind: "resolved";
        owner_language_id: string;
        owner_name: string;
        owner_path: string;
        inherited: boolean;
        has_own: boolean;
        file_name: string;
        revision: string;
        bytes: Buffer;
      }
    | {
        kind: "explicit_path";
        file_path: string;
        file_name: string;
        revision: string;
      }
    | null;
  residualPatternInfo: {
    pattern?: string;
    source: "argument" | "project_language" | "project_default" | "none";
  };
  externalFontProject?: ExternalFontProjectLink;
}

interface SingleLanguageAuditOutput {
  language: {
    language_id: string;
    name: string;
    path: string;
    parent_id: string | null;
  };
  font: {
    source: "language" | "explicit_path";
    owner_language_id: string | null;
    owner_name: string | null;
    owner_path: string | null;
    inherited: boolean;
    has_own: boolean;
    file_name: string;
    revision: string;
    resolved_revision: string;
    sha256: string;
    family_name: string | null;
    subfamily_name: string | null;
    version: string | null;
    upem: number;
    glyph_count: number;
    codepoint_count: number;
    glyph_names_reliable: boolean;
    substitution_features: string[];
    positioning_features: string[];
    engine: string;
  };
  layout: AppliedLayoutMetadata;
  normalization: NormalizationMode;
  case_mode: CaseMode;
  checks_performed: string[];
  checks_not_evaluated: { check: string; reason: string }[];
  summary: {
    required_chars: number;
    covered: number;
    missing: number;
    decomposed_only: number;
    case_missing: number;
    punctuation_chars: number;
    multi_char_sequences: number;
    words_audited: number;
    words_with_notdef: number;
    words_with_residual: number;
    corpus_with_notdef: number;
    unmapped_spellings: number;
    residual_glyph_count: number;
    unused_glyph_count: number;
  };
  character_coverage: {
    covered: CharCoverageClassification[];
    missing: CharCoverageClassification[];
    decomposed_only: CharCoverageClassification[];
    case_missing: CharCoverageClassification[];
    punctuation: CharCoverageClassification[];
  };
  missing_chars: CharCoverageClassification[];
  multi_char_sequences: MultiCharSequenceAuditItem[];
  words_with_notdef: {
    count: number;
    examples: {
      entry_id: string;
      spelling: string;
      notdef_spans: {
        token: string;
        source_text: string;
        source_codepoint_span: [number, number];
      }[];
    }[];
  };
  corpus_with_notdef: {
    count: number;
    examples: {
      corpus_id: string;
      title: string;
      line_id?: string;
      snippet: string;
    }[];
  };
  unmapped_spellings: {
    count: number;
    items: {
      entry_id: string;
      spelling: string;
      unmapped_chars: string[];
    }[];
    truncated: boolean;
  };
  glyph_annotations_audit: {
    annotations_source: PhonologyLoadResult["annotations_source"];
    annotations_owner_id: string | null;
    annotated_count: number;
    annotated_missing_in_font: {
      codepoint: number;
      codepoint_hex: string;
      char: string;
      label: string;
      kind?: GlyphAnnotation["kind"];
    }[];
    in_font_unannotated: {
      count: number;
      codepoints: string[];
      sample: {
        codepoint: number;
        codepoint_hex: string;
        char: string;
        block: string;
      }[];
      truncated: boolean;
    };
    unannotated_required_codepoints: {
      codepoint: number;
      codepoint_hex: string;
      char: string;
    }[];
    unused_annotations: GlyphAnnotation[];
  };
  pua_audit: {
    pua_in_font_count: number;
    pua_required_count: number;
    pua_missing_in_font: {
      codepoint: number;
      codepoint_hex: string;
      char: string;
    }[];
    pua_unannotated_in_font: {
      count: number;
      codepoints: string[];
      truncated: boolean;
    };
  };
  unused_glyphs: {
    count: number;
    sample: {
      gid: number;
      glyph_name: string | null;
      mapped_codepoints: string[];
    }[];
    truncated: boolean;
  };
  residual_glyph_pattern: {
    pattern: string | null;
    source: "argument" | "project_language" | "project_default" | "none";
  };
  residual_glyphs: ResidualGlyphFinding[];
  warnings: string[];
  recommendations: string[];
  external_font_project: ExternalFontProjectInspection | null;
  revision: string;
  effective_revision: string;
  dependencies: Record<string, string>;
}

function isPrivateUseCodepoint(cp: number): boolean {
  return (
    (cp >= 0xe000 && cp <= 0xf8ff) ||
    (cp >= 0xf0000 && cp <= 0xffffd) ||
    (cp >= 0x100000 && cp <= 0x10fffd)
  );
}

function isAsciiWhitespaceCodepoint(cp: number): boolean {
  return cp === 0x09 || cp === 0x0a || cp === 0x0b || cp === 0x0c || cp === 0x0d || cp === 0x20;
}

function mapShapedGlyphsToAuditView(
  shaped: ShapeResult,
): FontAuditGlyphView[] {
  return shaped.glyphs.map((g) => ({
    gid: g.gid,
    glyph_name: g.name,
    cluster: g.cluster,
    cluster_unit: g.cluster_unit,
    codepoint_span: g.codepoint_span,
    source_codepoint_span: g.source_codepoint_span,
    source_text: g.source_text,
    ax: g.x_advance,
    ay: g.y_advance,
    dx: g.x_offset,
    dy: g.y_offset,
    is_notdef: g.is_notdef,
  }));
}

function buildLayoutOptions(opts: AuditOptionsInput): LayoutOptions {
  return {
    direction: opts.direction ?? GUI_DEFAULT_LAYOUT.direction,
    script: opts.script?.trim() || undefined,
    language: opts.language_tag?.trim() || GUI_DEFAULT_LAYOUT.language_tag,
    features: opts.features,
    normalization: opts.normalization ?? GUI_DEFAULT_LAYOUT.normalization,
  };
}

function buildLayoutCacheKey(layout: LayoutOptions): string {
  return JSON.stringify({
    d: layout.direction ?? "ltr",
    s: layout.script ?? null,
    l: layout.language ?? "en",
    f: layout.features ?? null,
    n: layout.normalization ?? "as_used",
  });
}

function loadLanguageCorporaUnlocked(
  projectDir: string,
  language: LanguageEntry,
): { corpora: CorpusText[]; indexRevision: string } {
  const indexRes = readCorpusIndexUnlocked(projectDir, language);
  const corpora: CorpusText[] = [];
  for (const entry of indexRes.entries) {
    try {
      const loaded = readCorpusTextUnlocked(
        projectDir,
        language,
        entry.corpus_id,
      );
      corpora.push(loaded.corpus);
    } catch (err) {
      console.warn(
        `[conlang-mcp] Skipping unreadable corpus "${entry.corpus_id}" in "${language.language_id}":`,
        err,
      );
    }
  }
  return { corpora, indexRevision: indexRes.revision };
}

function inspectExternalFontProjectReadOnly(
  projectDir: string,
  link: ExternalFontProjectLink | undefined,
  config: McpConfig,
): ExternalFontProjectInspection | null {
  if (!link || !link.path.trim()) {
    return null;
  }
  const rawCandidate = path.isAbsolute(link.path)
    ? link.path
    : path.resolve(projectDir, link.path);
  let allowedDir: string;
  try {
    allowedDir = assertPathAllowed(rawCandidate, config);
  } catch (err) {
    return {
      configured_path: link.path,
      variant: link.variant ?? null,
      evaluated: false,
      reason: err instanceof Error ? err.message : String(err),
      unresolved_dictionary_spellings: [],
      fea_files: [],
    };
  }

  if (!fs.existsSync(allowedDir) || !fs.statSync(allowedDir).isDirectory()) {
    return {
      configured_path: link.path,
      variant: link.variant ?? null,
      evaluated: false,
      reason: `External font project directory not found: ${allowedDir}`,
      unresolved_dictionary_spellings: [],
      fea_files: [],
    };
  }

  const unresolvedSet = new Set<string>();
  const feaFiles: string[] = [];

  for (const jsonName of ["encoding.json", "manifest.json"]) {
    const candidateJson = path.join(allowedDir, jsonName);
    if (fs.existsSync(candidateJson) && fs.statSync(candidateJson).isFile()) {
      try {
        const parsed = JSON.parse(
          fs.readFileSync(candidateJson, "utf-8"),
        ) as Record<string, unknown>;
        const topUnresolved = parsed.unresolved_dictionary_spellings;
        if (Array.isArray(topUnresolved)) {
          for (const item of topUnresolved) {
            if (typeof item === "string" && item.trim()) {
              unresolvedSet.add(item.trim());
            }
          }
        }
        if (
          link.variant &&
          typeof parsed.variants === "object" &&
          parsed.variants !== null
        ) {
          const variantObj = (parsed.variants as Record<string, unknown>)[
            link.variant
          ];
          if (typeof variantObj === "object" && variantObj !== null) {
            const varUnresolved = (variantObj as Record<string, unknown>)
              .unresolved_dictionary_spellings;
            if (Array.isArray(varUnresolved)) {
              for (const item of varUnresolved) {
                if (typeof item === "string" && item.trim()) {
                  unresolvedSet.add(item.trim());
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn(
          `[conlang-mcp] Failed to parse external font project ${jsonName}:`,
          err,
        );
      }
    }
  }

  try {
    for (const entry of fs.readdirSync(allowedDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".fea")) {
        feaFiles.push(path.join(allowedDir, entry.name));
      } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const subDir = path.join(allowedDir, entry.name);
        for (const subEntry of fs.readdirSync(subDir, { withFileTypes: true })) {
          if (subEntry.isFile() && subEntry.name.toLowerCase().endsWith(".fea")) {
            feaFiles.push(path.join(subDir, subEntry.name));
          }
        }
      }
    }
  } catch (err) {
    console.warn("[conlang-mcp] Error scanning .fea files:", err);
  }

  return {
    configured_path: link.path,
    variant: link.variant ?? null,
    evaluated: true,
    unresolved_dictionary_spellings: Array.from(unresolvedSet).sort(),
    fea_files: feaFiles.sort(),
  };
}

async function runSingleLanguageFontAudit(params: {
  projectDir: string;
  snapshot: LanguageConsistentAuditSnapshot;
  loadedFont: LoadedFontHandle;
  options: AuditOptionsInput;
  mcpConfig: McpConfig;
  sharedShapeCache?: Map<string, ShapeResult>;
}): Promise<SingleLanguageAuditOutput> {
  const { projectDir, snapshot, loadedFont, options, mcpConfig } = params;
  const sources: CoverageSource[] =
    options.sources && options.sources.length > 0
      ? options.sources
      : [...DEFAULT_COVERAGE_SOURCES];
  const sourceSet = new Set<CoverageSource>(sources);
  const mapScope = options.map_scope ?? "default";
  const normalization: NormalizationMode = options.normalization ?? "as_used";
  const caseMode: CaseMode = options.case ?? "as_used";
  const maxExamples = options.max_examples ?? 5;
  const doShaping = options.shaping !== false;

  // Validate residual_glyph_pattern if configured (NEVER hardcode a fallback pattern!)
  const residualPattern = snapshot.residualPatternInfo.pattern;
  let residualRegex: RegExp | null = null;
  if (residualPattern !== undefined) {
    try {
      residualRegex = new RegExp(residualPattern);
    } catch (err) {
      throw new McpError(
        "VALIDATION",
        `Invalid residual_glyph_pattern regex "${residualPattern}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const effectivePhono =
    snapshot.phonologyLoad.effective_config ?? snapshot.phonologyLoad.config;

  const auditRes = auditFontCoverage({
    phonology: effectivePhono,
    words: snapshot.words,
    corpora: snapshot.corpora,
    sources,
    mapScope,
    normalization,
    maxExamples,
    cmap: loadedFont.unicodes,
    caseMode,
  });

  const layoutOpts = buildLayoutOptions(options);
  const layoutKey = buildLayoutCacheKey(layoutOpts);
  const shapeCache = params.sharedShapeCache ?? new Map<string, ShapeResult>();

  const shapeCached = async (rawText: string): Promise<ShapeResult> => {
    const cacheKey = `${loadedFont.sha256}\0${layoutKey}\0${rawText}`;
    const existing = shapeCache.get(cacheKey);
    if (existing) {
      return existing;
    }
    const computed = await shapeText(loadedFont, rawText, layoutOpts);
    shapeCache.set(cacheKey, computed);
    return computed;
  };

  // Probe layout metadata even on empty text so layout field is always populated accurately
  const baselineShape = await shapeCached("");
  const appliedLayout: AppliedLayoutMetadata = baselineShape.layout;

  const checksPerformed: string[] = [
    "cmap",
    "glyph_annotations",
    "pua",
    "unmapped_spellings",
  ];
  const checksNotEvaluated: { check: string; reason: string }[] = [];

  if (doShaping) {
    checksPerformed.push("notdef", "substitution", "positioning");
  } else {
    checksNotEvaluated.push({
      check: "shaping",
      reason: "shaping parameter was set to false",
    });
  }

  const evaluateResidual =
    doShaping && residualRegex !== null && loadedFont.hasGlyphNames;
  if (evaluateResidual) {
    checksPerformed.push("residual_glyphs");
  } else if (!doShaping) {
    checksNotEvaluated.push({
      check: "residual_glyphs",
      reason: "shaping parameter was set to false",
    });
  } else if (residualRegex === null) {
    checksNotEvaluated.push({
      check: "residual_glyphs",
      reason:
        "residual_glyph_pattern is not configured in arguments or .conlang-maker/mcp.json",
    });
  } else {
    checksNotEvaluated.push({
      check: "residual_glyphs",
      reason:
        "Font lacks reliable glyph names (e.g. post format 3.0 or stripped CFF names)",
    });
  }

  // Track all used GIDs for unused_glyphs calculation
  const cpToNominalGid = buildCodepointToGidMap(loadedFont);
  const usedGids = new Set<number>();
  for (const chItem of auditRes.characters) {
    const nominal = cpToNominalGid.get(chItem.codepoint);
    if (nominal !== undefined && nominal !== 0) {
      usedGids.add(nominal);
    }
  }
  for (const punctItem of auditRes.punctuation_chars) {
    const nominal = cpToNominalGid.get(punctItem.codepoint);
    if (nominal !== undefined && nominal !== 0) {
      usedGids.add(nominal);
    }
  }

  // 1. Multi-character sequences shaping
  const multiCharSequences: MultiCharSequenceAuditItem[] = [];
  for (const seq of auditRes.sequences) {
    const formattedCps = seq.codepoints.map(formatCodepoint);
    const standaloneOnly = seq.has_context && seq.lexicon_samples.length === 0;

    if (!doShaping) {
      multiCharSequences.push({
        map_id: seq.map_id,
        rule_id: seq.rule_id,
        raw_input: seq.raw_input,
        text: seq.text,
        codepoints: formattedCps,
        output_phoneme: seq.output_phoneme,
        has_context: seq.has_context,
        standalone_only: standaloneOnly,
        ligature_formed: false,
        substituted: false,
        positioning_adjusted: false,
        has_notdef: false,
        status: "not_evaluated",
        glyphs: [],
        contextual_samples: [],
      });
      continue;
    }

    const wholeShaped = await shapeCached(seq.text);
    for (const g of wholeShaped.glyphs) {
      if (g.gid !== 0) usedGids.add(g.gid);
    }

    const seqChars = charactersOf(seq.text);
    const perCharResults: ShapeResult[] = [];
    for (const ch of seqChars) {
      const charShaped = await shapeCached(ch);
      perCharResults.push(charShaped);
    }

    const wholeGids = wholeShaped.glyphs.map((g) => g.gid);
    const perCharGlyphs = perCharResults.flatMap((r) => r.glyphs);
    const perCharGids = perCharGlyphs.map((g) => g.gid);

    const substituted =
      wholeGids.length !== perCharGids.length ||
      wholeGids.some((gid, idx) => gid !== perCharGids[idx]);

    const ligatureFormed =
      (!wholeShaped.has_notdef &&
        wholeShaped.glyphs.some(
          (g) => g.codepoint_span[1] - g.codepoint_span[0] > 1,
        )) ||
      (!wholeShaped.has_notdef &&
        seqChars.length > 1 &&
        wholeGids.length < seqChars.length);

    const positioningAdjusted =
      !substituted &&
      wholeShaped.glyphs.length === perCharGlyphs.length &&
      wholeShaped.glyphs.some((g, idx) => {
        const base = perCharGlyphs[idx];
        return (
          g.x_advance !== base.x_advance ||
          g.y_advance !== base.y_advance ||
          g.x_offset !== base.x_offset ||
          g.y_offset !== base.y_offset
        );
      });

    let status: MultiCharSequenceStatus;
    if (wholeShaped.has_notdef) {
      status = "notdef";
    } else if (substituted) {
      status = "substituted";
    } else if (positioningAdjusted) {
      status = "positioning_only";
    } else {
      status = "sequence_not_unified";
    }

    const contextualSamples: MultiCharSequenceAuditItem["contextual_samples"] =
      [];
    for (const sample of seq.lexicon_samples.slice(0, maxExamples)) {
      const sampleShaped = await shapeCached(sample.spelling);
      for (const g of sampleShaped.glyphs) {
        if (g.gid !== 0) usedGids.add(g.gid);
      }
      contextualSamples.push({
        entry_id: sample.entry_id,
        spelling: sample.spelling,
        has_notdef: sampleShaped.has_notdef,
        glyphs: mapShapedGlyphsToAuditView(sampleShaped),
      });
    }

    multiCharSequences.push({
      map_id: seq.map_id,
      rule_id: seq.rule_id,
      raw_input: seq.raw_input,
      text: seq.text,
      codepoints: formattedCps,
      output_phoneme: seq.output_phoneme,
      has_context: seq.has_context,
      standalone_only: standaloneOnly,
      ligature_formed: ligatureFormed,
      substituted,
      positioning_adjusted: positioningAdjusted,
      has_notdef: wholeShaped.has_notdef,
      status,
      glyphs: mapShapedGlyphsToAuditView(wholeShaped),
      contextual_samples: contextualSamples,
    });
  }

  // 2. Lexicon & Corpus shaping (.notdef + residual_glyphs + usedGids)
  const activeWords = snapshot.words.filter((w) => !w.evolution?.is_deprecated);
  let wordsWithNotdefCount = 0;
  const wordsWithNotdefExamples: SingleLanguageAuditOutput["words_with_notdef"]["examples"] =
    [];
  let wordsWithResidualCount = 0;

  let corpusWithNotdefCount = 0;
  const corpusWithNotdefExamples: SingleLanguageAuditOutput["corpus_with_notdef"]["examples"] =
    [];

  const residualByGid = new Map<
    number,
    ResidualGlyphFinding & { seenWordIds: Set<string> }
  >();

  const getOrCreateResidualBucket = (gid: number, glyphName: string) => {
    let bucket = residualByGid.get(gid);
    if (!bucket) {
      bucket = {
        gid,
        glyph_name: glyphName,
        matched_pattern: residualPattern ?? "",
        lexicon_count: 0,
        corpus_count: 0,
        lexicon_examples: [],
        corpus_examples: [],
        seenWordIds: new Set<string>(),
      };
      residualByGid.set(gid, bucket);
    }
    return bucket;
  };

  if (doShaping && sourceSet.has("lexicon")) {
    for (const word of activeWords) {
      const tokens = word.con_word_romanized.split(/\s+/u).filter(Boolean);
      let wordHasNotdef = false;
      let wordHasResidual = false;
      const notdefSpans: {
        token: string;
        source_text: string;
        source_codepoint_span: [number, number];
      }[] = [];

      for (const token of tokens) {
        const shaped = await shapeCached(token);
        for (const g of shaped.glyphs) {
          if (g.is_notdef) {
            wordHasNotdef = true;
            if (wordsWithNotdefExamples.length < maxExamples) {
              notdefSpans.push({
                token,
                source_text: g.source_text,
                source_codepoint_span: g.source_codepoint_span,
              });
            }
          } else {
            usedGids.add(g.gid);
            if (
              evaluateResidual &&
              residualRegex !== null &&
              g.name !== null &&
              residualRegex.test(g.name)
            ) {
              wordHasResidual = true;
              const bucket = getOrCreateResidualBucket(g.gid, g.name);
              if (!bucket.seenWordIds.has(word.entry_id)) {
                bucket.seenWordIds.add(word.entry_id);
                bucket.lexicon_count += 1;
                if (bucket.lexicon_examples.length < maxExamples) {
                  bucket.lexicon_examples.push({
                    entry_id: word.entry_id,
                    spelling: word.con_word_romanized,
                    source_text: g.source_text,
                    source_codepoint_span: g.source_codepoint_span,
                  });
                }
              }
            }
          }
        }
      }

      if (wordHasNotdef) {
        wordsWithNotdefCount += 1;
        if (wordsWithNotdefExamples.length < maxExamples) {
          wordsWithNotdefExamples.push({
            entry_id: word.entry_id,
            spelling: word.con_word_romanized,
            notdef_spans: notdefSpans,
          });
        }
      }
      if (wordHasResidual) {
        wordsWithResidualCount += 1;
      }
    }
  }

  if (doShaping && sourceSet.has("corpus")) {
    const auditCorpusFragment = async (
      rawFragment: string,
      corpusId: string,
      title: string,
      lineId?: string,
    ): Promise<void> => {
      if (!rawFragment || !rawFragment.trim()) return;
      const tokens = rawFragment.split(/\s+/u).filter(Boolean);
      let fragmentHasNotdef = false;
      const snippet =
        rawFragment.length > 60
          ? `${rawFragment.slice(0, 57)}...`
          : rawFragment;

      for (const token of tokens) {
        const shaped = await shapeCached(token);
        for (const g of shaped.glyphs) {
          if (g.is_notdef) {
            fragmentHasNotdef = true;
          } else {
            usedGids.add(g.gid);
            if (
              evaluateResidual &&
              residualRegex !== null &&
              g.name !== null &&
              residualRegex.test(g.name)
            ) {
              const bucket = getOrCreateResidualBucket(g.gid, g.name);
              bucket.corpus_count += 1;
              if (bucket.corpus_examples.length < maxExamples) {
                const dup = bucket.corpus_examples.some(
                  (ex) =>
                    ex.corpus_id === corpusId &&
                    ex.line_id === lineId &&
                    ex.snippet === snippet,
                );
                if (!dup) {
                  bucket.corpus_examples.push({
                    corpus_id: corpusId,
                    title,
                    line_id: lineId,
                    snippet,
                  });
                }
              }
            }
          }
        }
      }

      if (fragmentHasNotdef) {
        corpusWithNotdefCount += 1;
        if (corpusWithNotdefExamples.length < maxExamples) {
          corpusWithNotdefExamples.push({
            corpus_id: corpusId,
            title,
            line_id: lineId,
            snippet,
          });
        }
      }
    };

    for (const ct of snapshot.corpora) {
      if (ct.glossed_lines.length > 0) {
        for (const line of ct.glossed_lines) {
          await auditCorpusFragment(
            line.original,
            ct.corpus_id,
            ct.title,
            line.line_id,
          );
        }
      } else if (ct.original_text) {
        const lines = ct.original_text.split(/\r?\n/);
        for (let idx = 0; idx < lines.length; idx++) {
          await auditCorpusFragment(
            lines[idx],
            ct.corpus_id,
            ct.title,
            `line_${idx + 1}`,
          );
        }
      }
    }
  }

  const residualGlyphs: ResidualGlyphFinding[] = evaluateResidual
    ? Array.from(residualByGid.values())
        .map(({ seenWordIds: _ignored, ...rest }) => rest)
        .sort((a, b) => a.gid - b.gid)
    : [];

  // 3. Glyph annotations cross-check
  const effectiveAnnotations = effectivePhono.glyph_annotations ?? [];
  const annotationByCp = new Map<number, GlyphAnnotation>();
  for (const ann of effectiveAnnotations) {
    annotationByCp.set(ann.codepoint, ann);
  }

  const annotatedMissingInFont =
    auditRes.glyph_annotations_check.annotated_missing_in_cmap.map((cp) => {
      const ann = annotationByCp.get(cp);
      return {
        codepoint: cp,
        codepoint_hex: formatCodepoint(cp),
        char: String.fromCodePoint(cp),
        label: ann?.label ?? "",
        kind: ann?.kind,
      };
    });

  const inFontUnannotatedCps = loadedFont.unicodeList.filter(
    (cp) => !isAsciiWhitespaceCodepoint(cp) && !annotationByCp.has(cp),
  );
  const inFontUnannotatedSampleLimit = 50;

  const unannotatedRequired =
    auditRes.glyph_annotations_check.unannotated_required_codepoints.map(
      (cp) => ({
        codepoint: cp,
        codepoint_hex: formatCodepoint(cp),
        char: String.fromCodePoint(cp),
      }),
    );

  // 4. PUA audit
  const puaInFont = loadedFont.unicodeList.filter(isPrivateUseCodepoint);
  const puaRequired = auditRes.characters.filter((c) =>
    isPrivateUseCodepoint(c.codepoint),
  );
  const puaMissingInFont = puaRequired
    .filter((c) => !loadedFont.unicodes.has(c.codepoint))
    .map((c) => ({
      codepoint: c.codepoint,
      codepoint_hex: c.codepoint_hex,
      char: c.char,
    }));
  const puaUnannotated = puaInFont.filter((cp) => !annotationByCp.has(cp));

  // 5. Unused glyphs
  const allFontGlyphs = enumerateAllGlyphs(loadedFont);
  const unusedRaw = allFontGlyphs.filter(
    (g) => g.gid !== 0 && !usedGids.has(g.gid),
  );
  const unusedSampleLimit = 100;

  // 6. External font project read-only inspection (P2 optional)
  const externalInspection = inspectExternalFontProjectReadOnly(
    projectDir,
    snapshot.externalFontProject,
    mcpConfig,
  );
  if (externalInspection && !externalInspection.evaluated) {
    checksNotEvaluated.push({
      check: "external_font_project",
      reason:
        externalInspection.reason ?? "External font project could not be read",
    });
  } else if (externalInspection?.evaluated) {
    checksPerformed.push("external_font_project");
  }

  // 7. Actionable recommendations
  const recommendations: string[] = [];
  if (
    snapshot.fontSource?.kind === "resolved" &&
    snapshot.fontSource.inherited
  ) {
    recommendations.push(
      `Language "${snapshot.language.name}" currently inherits "${snapshot.fontSource.file_name}" from ancestor "${snapshot.fontSource.owner_name}" (${snapshot.fontSource.owner_language_id}). Use font_import or font_import_batch if a dialect-specific font is intended.`,
    );
  }
  if (auditRes.missing_chars.length > 0) {
    const preview = auditRes.missing_chars
      .slice(0, 8)
      .map((c) => `"${c.char}" (${c.codepoint_hex})`)
      .join(", ");
    recommendations.push(
      `Add ${auditRes.missing_chars.length} missing character(s) to the font cmap: ${preview}${
        auditRes.missing_chars.length > 8 ? ", ..." : ""
      }.`,
    );
  }
  if (auditRes.decomposed_only_chars.length > 0) {
    const preview = auditRes.decomposed_only_chars
      .slice(0, 6)
      .map((c) => `"${c.char}" (${c.codepoint_hex})`)
      .join(", ");
    recommendations.push(
      `${auditRes.decomposed_only_chars.length} precomposed character(s) (${preview}) are only covered via NFD base+mark decomposition; add precomposed cmap entries or verify mark/mkmk/ccmp shaping.`,
    );
  }
  if (auditRes.case_missing_chars.length > 0) {
    recommendations.push(
      `${auditRes.case_missing_chars.length} character(s) are missing an uppercase or lowercase counterpart in cmap.`,
    );
  }
  if (wordsWithNotdefCount > 0) {
    recommendations.push(
      `${wordsWithNotdefCount} active lexicon word(s) produce .notdef (gid 0) during HarfBuzz shaping.`,
    );
  }
  if (residualGlyphs.length > 0) {
    const glyphNamesPreview = residualGlyphs
      .slice(0, 6)
      .map((r) => r.glyph_name)
      .join(", ");
    recommendations.push(
      `${residualGlyphs.length} residual/untransformed glyph(s) matched pattern "${residualPattern}" (${glyphNamesPreview}); review OpenType GSUB (ccmp/liga/calt) rules for missing digraph or contextual substitutions.`,
    );
  }
  if (auditRes.unmapped_spellings.length > 0) {
    recommendations.push(
      `${auditRes.unmapped_spellings.length} lexicon entry spelling(s) contain characters not matched by any default romanization rule; run romanization_analyze or add romanization rules.`,
    );
  }
  if (puaUnannotated.length > 0) {
    recommendations.push(
      `${puaUnannotated.length} Private Use Area (PUA) codepoint(s) in the font have no glyph_annotations; document them with glyph_annotations_upsert.`,
    );
  }
  if (
    externalInspection?.evaluated &&
    externalInspection.unresolved_dictionary_spellings.length > 0
  ) {
    const preview = externalInspection.unresolved_dictionary_spellings
      .slice(0, 8)
      .join(", ");
    recommendations.push(
      `External font project lists ${externalInspection.unresolved_dictionary_spellings.length} unresolved_dictionary_spellings (${preview})${
        externalInspection.fea_files.length > 0
          ? `; inspect ${externalInspection.fea_files[0]}`
          : ""
      }.`,
    );
  }

  // 8. Dependencies & effective_revision
  const fontResolvedRevision =
    snapshot.fontSource?.revision ?? MISSING_REVISION;
  const rawDeps: Record<string, string> = {
    ...snapshot.phonologyLoad.dependencies,
    lexicon: snapshot.lexiconRevision,
    corpus_index: snapshot.corpusIndexRevision,
    resolved_font: fontResolvedRevision,
    resolved_font_sha256: loadedFont.sha256.slice(0, 16),
    layout: sha256Prefix16(
      Buffer.from(
        JSON.stringify({
          layout: appliedLayout,
          case_mode: caseMode,
          map_scope: mapScope,
          sources: [...sources].sort(),
          shaping: doShaping,
          residual_pattern: residualPattern ?? null,
        }),
        "utf-8",
      ),
    ),
  };

  const sortedDeps: Record<string, string> = {};
  let depSig = "";
  for (const key of Object.keys(rawDeps).sort()) {
    sortedDeps[key] = rawDeps[key];
    depSig += `${key}=${rawDeps[key]}\n`;
  }
  const effectiveRevision = sha256Prefix16(Buffer.from(depSig, "utf-8"));

  const unmappedLimit = Math.max(maxExamples * 4, 20);

  return {
    language: {
      language_id: snapshot.language.language_id,
      name: snapshot.language.name,
      path: snapshot.language.path,
      parent_id: snapshot.language.parent_id ?? null,
    },
    font:
      snapshot.fontSource?.kind === "resolved"
        ? {
            source: "language",
            owner_language_id: snapshot.fontSource.owner_language_id,
            owner_name: snapshot.fontSource.owner_name,
            owner_path: snapshot.fontSource.owner_path,
            inherited: snapshot.fontSource.inherited,
            has_own: snapshot.fontSource.has_own,
            file_name: snapshot.fontSource.file_name,
            revision: snapshot.ownFontRevision,
            resolved_revision: snapshot.fontSource.revision,
            sha256: loadedFont.sha256,
            family_name: loadedFont.familyName,
            subfamily_name: loadedFont.subfamilyName,
            version: loadedFont.version,
            upem: loadedFont.upem,
            glyph_count: loadedFont.glyphCount,
            codepoint_count: loadedFont.unicodeList.length,
            glyph_names_reliable: loadedFont.hasGlyphNames,
            substitution_features: loadedFont.gsubFeatures,
            positioning_features: loadedFont.gposFeatures,
            engine: "harfbuzz-wasm (GUI uses WebKit/CoreText/DirectWrite)",
          }
        : {
            source: "explicit_path",
            owner_language_id: null,
            owner_name: null,
            owner_path: null,
            inherited: false,
            has_own: snapshot.ownFontRevision !== MISSING_REVISION,
            file_name: loadedFont.fileName,
            revision: snapshot.ownFontRevision,
            resolved_revision: fontResolvedRevision,
            sha256: loadedFont.sha256,
            family_name: loadedFont.familyName,
            subfamily_name: loadedFont.subfamilyName,
            version: loadedFont.version,
            upem: loadedFont.upem,
            glyph_count: loadedFont.glyphCount,
            codepoint_count: loadedFont.unicodeList.length,
            glyph_names_reliable: loadedFont.hasGlyphNames,
            substitution_features: loadedFont.gsubFeatures,
            positioning_features: loadedFont.gposFeatures,
            engine: "harfbuzz-wasm (GUI uses WebKit/CoreText/DirectWrite)",
          },
    layout: appliedLayout,
    normalization: auditRes.normalization,
    case_mode: auditRes.case_mode,
    checks_performed: checksPerformed,
    checks_not_evaluated: checksNotEvaluated,
    summary: {
      required_chars: auditRes.summary.required_chars,
      covered: auditRes.summary.covered,
      missing: auditRes.summary.missing,
      decomposed_only: auditRes.summary.decomposed_only,
      case_missing: auditRes.summary.case_missing,
      punctuation_chars: auditRes.summary.punctuation_chars,
      multi_char_sequences: multiCharSequences.length,
      words_audited: activeWords.length,
      words_with_notdef: wordsWithNotdefCount,
      words_with_residual: wordsWithResidualCount,
      corpus_with_notdef: corpusWithNotdefCount,
      unmapped_spellings: auditRes.summary.unmapped_spellings,
      residual_glyph_count: residualGlyphs.length,
      unused_glyph_count: unusedRaw.length,
    },
    character_coverage: {
      covered: auditRes.covered_chars,
      missing: auditRes.missing_chars,
      decomposed_only: auditRes.decomposed_only_chars,
      case_missing: auditRes.case_missing_chars,
      punctuation: auditRes.punctuation_chars,
    },
    missing_chars: auditRes.missing_chars,
    multi_char_sequences: multiCharSequences,
    words_with_notdef: {
      count: wordsWithNotdefCount,
      examples: wordsWithNotdefExamples,
    },
    corpus_with_notdef: {
      count: corpusWithNotdefCount,
      examples: corpusWithNotdefExamples,
    },
    unmapped_spellings: {
      count: auditRes.unmapped_spellings.length,
      items: auditRes.unmapped_spellings.slice(0, unmappedLimit),
      truncated: auditRes.unmapped_spellings.length > unmappedLimit,
    },
    glyph_annotations_audit: {
      annotations_source: snapshot.phonologyLoad.annotations_source,
      annotations_owner_id: snapshot.phonologyLoad.annotations_owner_id ?? null,
      annotated_count:
        auditRes.glyph_annotations_check.annotated_codepoints.length,
      annotated_missing_in_font: annotatedMissingInFont,
      in_font_unannotated: {
        count: inFontUnannotatedCps.length,
        codepoints: inFontUnannotatedCps
          .slice(0, inFontUnannotatedSampleLimit)
          .map(formatCodepoint),
        sample: inFontUnannotatedCps
          .slice(0, inFontUnannotatedSampleLimit)
          .map((cp) => ({
            codepoint: cp,
            codepoint_hex: formatCodepoint(cp),
            char: String.fromCodePoint(cp),
            block: unicodeBlockId(cp),
          })),
        truncated: inFontUnannotatedCps.length > inFontUnannotatedSampleLimit,
      },
      unannotated_required_codepoints: unannotatedRequired,
      unused_annotations: auditRes.glyph_annotations_check.unused_annotations,
    },
    pua_audit: {
      pua_in_font_count: puaInFont.length,
      pua_required_count: puaRequired.length,
      pua_missing_in_font: puaMissingInFont,
      pua_unannotated_in_font: {
        count: puaUnannotated.length,
        codepoints: puaUnannotated.slice(0, 100).map(formatCodepoint),
        truncated: puaUnannotated.length > 100,
      },
    },
    unused_glyphs: {
      count: unusedRaw.length,
      sample: unusedRaw.slice(0, unusedSampleLimit).map((g) => ({
        gid: g.gid,
        glyph_name: g.name,
        mapped_codepoints: g.mapped_codepoints.map(formatCodepoint),
      })),
      truncated: unusedRaw.length > unusedSampleLimit,
    },
    residual_glyph_pattern: {
      pattern: residualPattern ?? null,
      source: snapshot.residualPatternInfo.source,
    },
    residual_glyphs: residualGlyphs,
    warnings: auditRes.warnings,
    recommendations,
    external_font_project: externalInspection,
    revision: snapshot.phonologyLoad.revision,
    effective_revision: effectiveRevision,
    dependencies: sortedDeps,
  };
}

function collectSubtreeLanguages(
  allLanguages: readonly LanguageEntry[],
  rootId: string,
): LanguageEntry[] {
  const byId = new Map(allLanguages.map((l) => [l.language_id, l]));
  const root = byId.get(rootId);
  if (!root) return [];

  const childrenByParent = new Map<string, LanguageEntry[]>();
  for (const lang of allLanguages) {
    if (lang.parent_id) {
      const list = childrenByParent.get(lang.parent_id) ?? [];
      list.push(lang);
      childrenByParent.set(lang.parent_id, list);
    }
  }

  const visited = new Set<string>();
  const ordered: LanguageEntry[] = [];
  const queue: LanguageEntry[] = [root];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur.language_id)) continue;
    visited.add(cur.language_id);
    ordered.push(cur);
    const kids = childrenByParent.get(cur.language_id) ?? [];
    for (const k of kids) {
      if (!visited.has(k.language_id)) {
        queue.push(k);
      }
    }
  }

  return ordered;
}

export function registerAuditTools(
  server: McpServer,
  config: McpConfig,
): void {
  // 1. font_audit_coverage
  registerDefinedTool(server, config, {
    name: "font_audit_coverage",
    title: "Audit Language Font Coverage & OpenType Shaping",
    description:
      "Audits character-level cmap coverage, multi-character OpenType GSUB/GPOS shaping, .notdef occurrences across lexicon and corpus, residual glyphs, unmapped spellings, glyph annotations, and PUA codepoints for a language against its resolved font (or explicit font_path). Throws NO_FONT if no font is available.",
    toolsets: ["audit", "core"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      font_path: z
        .string()
        .optional()
        .describe(
          "Optional explicit .ttf/.otf file path to audit against instead of the language's resolved font",
        ),
      ...auditCommonOptionFields,
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);

      let explicitFontPath: string | null = null;
      if (args.font_path?.trim()) {
        explicitFontPath = assertPathAllowed(args.font_path.trim(), config);
      }

      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "font_audit_coverage",
        (): LanguageConsistentAuditSnapshot => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const langQuery = pickLanguageArg(args);
          const resolvedLang = resolveLanguage(family, langQuery, {
            workspace: ws.config,
            revision: ws.revision,
          });
          const lang = resolvedLang.language;

          const ownFont = findOwnFontFile(resolvedLang.language_dir);
          const ownFontRevision = ownFont
            ? computeFileRevision(ownFont)
            : MISSING_REVISION;

          let fontSource: LanguageConsistentAuditSnapshot["fontSource"] = null;
          if (explicitFontPath) {
            if (
              !fs.existsSync(explicitFontPath) ||
              !fs.statSync(explicitFontPath).isFile()
            ) {
              throw new McpError(
                "NOT_FOUND",
                `Font file not found: ${explicitFontPath}`,
              );
            }
            fontSource = {
              kind: "explicit_path",
              file_path: explicitFontPath,
              file_name: path.basename(explicitFontPath),
              revision: computeFileRevision(explicitFontPath),
            };
          } else {
            const resolvedFont = resolveFontFileUnlocked(
              family.project_dir,
              ws.config.languages,
              lang.language_id,
            );
            if (!resolvedFont) {
              throw new McpError(
                "NO_FONT",
                `Language "${lang.name}" (${lang.language_id}) and its ancestors have no font installed.`,
                "Import a font with font_import or pass an explicit font_path.",
                {
                  language_id: lang.language_id,
                  ancestor_chain: buildAncestorChain(
                    ws.config.languages,
                    lang.language_id,
                  ),
                },
              );
            }
            fontSource = {
              kind: "resolved",
              owner_language_id: resolvedFont.owner_language_id,
              owner_name: resolvedFont.owner_name,
              owner_path: resolvedFont.owner_path,
              inherited: resolvedFont.inherited,
              has_own: resolvedFont.has_own,
              file_name: resolvedFont.file_name,
              revision: resolvedFont.revision,
              bytes: resolvedFont.bytes,
            };
          }

          const phonologyLoad = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            lang,
          );
          const lexiconLoad = readLexiconUnlocked(family.project_dir, lang);
          const { corpora, indexRevision } = loadLanguageCorporaUnlocked(
            family.project_dir,
            lang,
          );

          const mcpSettings = loadProjectMcpSettings(family.project_dir);
          const extLink =
            mcpSettings.languages[lang.language_id]?.external_font_project ??
            mcpSettings.languages[lang.name]?.external_font_project;

          const residualPatternInfo = resolveResidualGlyphPattern(
            family.project_dir,
            lang.language_id,
            lang.name,
            args.residual_glyph_pattern,
          );

          return {
            language: lang,
            phonologyLoad,
            words: lexiconLoad.words,
            lexiconRevision: lexiconLoad.revision,
            corpora,
            corpusIndexRevision: indexRevision,
            ownFontRevision,
            fontSource,
            residualPatternInfo,
            externalFontProject: extLink,
          };
        },
      );

      if (!snapshot.fontSource) {
        throw new McpError("NO_FONT", "No font resolved for language.");
      }

      const loadedFont =
        snapshot.fontSource.kind === "explicit_path"
          ? await loadFontFromFile(snapshot.fontSource.file_path)
          : await loadFontFromBytes(
              snapshot.fontSource.bytes,
              snapshot.fontSource.file_name,
            );

      return await runSingleLanguageFontAudit({
        projectDir: family.project_dir,
        snapshot,
        loadedFont,
        options: args,
        mcpConfig: config,
      });
    },
  });

  // 2. font_audit_family
  registerDefinedTool(server, config, {
    name: "font_audit_family",
    title: "Audit Font Coverage Matrix Across Language Family",
    description:
      "Audits font coverage and OpenType shaping across all languages in a family (or a subtree rooted at root_language) from a consistent workspace snapshot, deduplicating HarfBuzz font parsing by font sha256 / resolved_revision, reporting NO_FONT languages cleanly without failing, and supporting pagination and budget_ms partial returns.",
    toolsets: ["audit"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      root_language: z
        .string()
        .optional()
        .describe(
          "Optional root language (ID, name, or path) to restrict audit to that subtree",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(50)
        .describe("Maximum number of languages to audit in this page"),
      cursor: z
        .string()
        .optional()
        .describe("Pagination cursor returned by a previous partial/paged call"),
      budget_ms: z
        .number()
        .int()
        .min(100)
        .max(120000)
        .optional()
        .default(20000)
        .describe(
          "Wall-clock time budget in milliseconds before returning partial results with next_cursor (default: 20000)",
        ),
      ...auditCommonOptionFields,
    },
    handler: async (args) => {
      const startedAt = performance.now();
      const budgetMs = args.budget_ms ?? 20000;
      const limit = args.limit ?? 50;
      const family = resolveFamilyFromArgs(config, args);

      const consistentBatch = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "font_audit_family",
        () => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          let targetLanguages: LanguageEntry[] = ws.config.languages;
          let resolvedRootId: string | null = null;

          if (args.root_language?.trim()) {
            const rootResolved = resolveLanguage(
              family,
              args.root_language.trim(),
              {
                workspace: ws.config,
                revision: ws.revision,
              },
            );
            resolvedRootId = rootResolved.language.language_id;
            targetLanguages = collectSubtreeLanguages(
              ws.config.languages,
              resolvedRootId,
            );
          }

          const startOffset = args.cursor
            ? decodeCursor(args.cursor, ws.revision)
            : 0;
          const candidateLanguages = targetLanguages.slice(
            startOffset,
            startOffset + limit,
          );

          const allStatuses = listLanguageFontStatusesUnlocked(
            family.project_dir,
            ws.config.languages,
          );

          const mcpSettings = loadProjectMcpSettings(family.project_dir);
          // Deduplicate reading identical font files from disk during snapshot capture
          const rawFontCacheByPath = new Map<
            string,
            { revision: string; bytes: Buffer; fileName: string }
          >();

          const snapshots: LanguageConsistentAuditSnapshot[] = [];
          for (const lang of candidateLanguages) {
            const langDir = assertSafeRelativeLanguagePath(
              family.project_dir,
              lang.path,
            );
            const ownFont = findOwnFontFile(langDir);
            const ownFontRevision = ownFont
              ? computeFileRevision(ownFont)
              : MISSING_REVISION;

            // Walk ancestor chain for resolved font without re-reading identical bytes
            let resolvedFontMeta: {
              owner_language_id: string;
              owner_name: string;
              owner_path: string;
              inherited: boolean;
              has_own: boolean;
              file_name: string;
              revision: string;
              bytes: Buffer;
            } | null = null;

            const seenAncestors = new Set<string>();
            let curId: string | null = lang.language_id;
            while (curId && !seenAncestors.has(curId)) {
              seenAncestors.add(curId);
              const anc = ws.config.languages.find(
                (l) => l.language_id === curId,
              );
              if (!anc) break;
              const ancDir = assertSafeRelativeLanguagePath(
                family.project_dir,
                anc.path,
              );
              const foundPath = findOwnFontFile(ancDir);
              if (foundPath) {
                let cachedRaw = rawFontCacheByPath.get(foundPath);
                if (!cachedRaw) {
                  cachedRaw = {
                    revision: computeFileRevision(foundPath),
                    bytes: fs.readFileSync(foundPath),
                    fileName: path.basename(foundPath),
                  };
                  rawFontCacheByPath.set(foundPath, cachedRaw);
                }
                resolvedFontMeta = {
                  owner_language_id: anc.language_id,
                  owner_name: anc.name,
                  owner_path: anc.path,
                  inherited: anc.language_id !== lang.language_id,
                  has_own: ownFont !== null,
                  file_name: cachedRaw.fileName,
                  revision: cachedRaw.revision,
                  bytes: cachedRaw.bytes,
                };
                break;
              }
              curId = anc.parent_id ?? null;
            }

            const phonologyLoad = readPhonologyUnlocked(
              family.project_dir,
              family.conlang_file_path,
              lang,
            );
            const lexiconLoad = readLexiconUnlocked(family.project_dir, lang);
            const { corpora, indexRevision } = loadLanguageCorporaUnlocked(
              family.project_dir,
              lang,
            );

            const extLink =
              mcpSettings.languages[lang.language_id]?.external_font_project ??
              mcpSettings.languages[lang.name]?.external_font_project;

            const residualPatternInfo = resolveResidualGlyphPattern(
              family.project_dir,
              lang.language_id,
              lang.name,
              args.residual_glyph_pattern,
            );

            snapshots.push({
              language: lang,
              phonologyLoad,
              words: lexiconLoad.words,
              lexiconRevision: lexiconLoad.revision,
              corpora,
              corpusIndexRevision: indexRevision,
              ownFontRevision,
              fontSource: resolvedFontMeta
                ? { kind: "resolved", ...resolvedFontMeta }
                : null,
              residualPatternInfo,
              externalFontProject: extLink,
            });
          }

          return {
            workspaceRevision: ws.revision,
            resolvedRootId,
            totalTargetCount: targetLanguages.length,
            startOffset,
            allStatuses,
            snapshots,
          };
        },
      );

      // Deduplicate font parsing by resolved_revision (and loadFontFromBytes also deduplicates by sha256)
      const fontHandleByRev = new Map<string, Promise<LoadedFontHandle>>();
      const sharedShapeCache = new Map<string, ShapeResult>();

      const getLoadedFontDeduped = async (
        revision: string,
        bytes: Buffer,
        fileName: string,
      ): Promise<LoadedFontHandle> => {
        let pending = fontHandleByRev.get(revision);
        if (!pending) {
          pending = loadFontFromBytes(bytes, fileName);
          fontHandleByRev.set(revision, pending);
        }
        return await pending;
      };

      // Precompute inheriting language IDs per owner_language_id from full family statuses
      const inheritingByOwner = new Map<string, string[]>();
      for (const st of consistentBatch.allStatuses) {
        if (!st.has_own && st.resolved_owner_id) {
          const list = inheritingByOwner.get(st.resolved_owner_id) ?? [];
          list.push(st.language_id);
          inheritingByOwner.set(st.resolved_owner_id, list);
        }
      }

      const perLanguage: {
        language_id: string;
        name: string;
        path: string;
        parent_id: string | null;
        status: "OK" | "ISSUES_FOUND" | "NO_FONT";
        font: {
          owner_language_id: string;
          owner_name: string;
          inherited: boolean;
          has_own: boolean;
          file_name: string;
          revision: string;
          resolved_revision: string;
          sha256: string;
          family_name: string | null;
          version: string | null;
        } | null;
        summary: SingleLanguageAuditOutput["summary"] | null;
        missing_chars: { char: string; codepoint: string }[];
        decomposed_only_chars: { char: string; codepoint: string }[];
        missing_sequences: string[];
        residual_glyphs: string[];
        effective_revision: string;
      }[] = [];

      interface ByFontAggregate {
        font_revision: string;
        sha256: string;
        owner_language_id: string;
        owner_name: string;
        owner_path: string;
        file_name: string;
        family_name: string | null;
        version: string | null;
        inheriting_language_ids: string[];
        audited_language_ids: string[];
        missingCharMap: Map<
          number,
          { char: string; codepoint: string; language_ids: Set<string> }
        >;
        missingSeqSet: Set<string>;
        residualGlyphMap: Map<
          number,
          { gid: number; glyph_name: string; language_ids: Set<string> }
        >;
      }

      const byFontMap = new Map<string, ByFontAggregate>();
      const unionMissingMap = new Map<
        number,
        {
          char: string;
          codepoint: string;
          language_ids: Set<string>;
          language_names: Set<string>;
        }
      >();
      const unionMissingSeqMap = new Map<string, Set<string>>();

      let processedCount = 0;
      let timedOut = false;

      for (let i = 0; i < consistentBatch.snapshots.length; i++) {
        // Always audit at least 1 language so cursor pagination makes guaranteed progress
        if (i > 0 && performance.now() - startedAt >= budgetMs) {
          timedOut = true;
          break;
        }

        const snap = consistentBatch.snapshots[i];
        processedCount += 1;

        if (!snap.fontSource || snap.fontSource.kind !== "resolved") {
          perLanguage.push({
            language_id: snap.language.language_id,
            name: snap.language.name,
            path: snap.language.path,
            parent_id: snap.language.parent_id ?? null,
            status: "NO_FONT",
            font: null,
            summary: null,
            missing_chars: [],
            decomposed_only_chars: [],
            missing_sequences: [],
            residual_glyphs: [],
            effective_revision:
              snap.phonologyLoad.effective_revision ??
              snap.phonologyLoad.revision,
          });
          continue;
        }

        const loadedFont = await getLoadedFontDeduped(
          snap.fontSource.revision,
          snap.fontSource.bytes,
          snap.fontSource.file_name,
        );

        const report = await runSingleLanguageFontAudit({
          projectDir: family.project_dir,
          snapshot: snap,
          loadedFont,
          options: args,
          mcpConfig: config,
          sharedShapeCache,
        });

        const missingSeqs = report.multi_char_sequences
          .filter(
            (s) => s.status === "notdef" || s.status === "sequence_not_unified",
          )
          .map((s) => s.text);
        const uniqueMissingSeqs = Array.from(new Set(missingSeqs)).sort();

        const hasIssues =
          report.summary.missing > 0 ||
          report.summary.words_with_notdef > 0 ||
          report.summary.corpus_with_notdef > 0 ||
          report.summary.residual_glyph_count > 0 ||
          report.summary.case_missing > 0;

        perLanguage.push({
          language_id: snap.language.language_id,
          name: snap.language.name,
          path: snap.language.path,
          parent_id: snap.language.parent_id ?? null,
          status: hasIssues ? "ISSUES_FOUND" : "OK",
          font: {
            owner_language_id: snap.fontSource.owner_language_id,
            owner_name: snap.fontSource.owner_name,
            inherited: snap.fontSource.inherited,
            has_own: snap.fontSource.has_own,
            file_name: snap.fontSource.file_name,
            revision: snap.ownFontRevision,
            resolved_revision: snap.fontSource.revision,
            sha256: loadedFont.sha256,
            family_name: loadedFont.familyName,
            version: loadedFont.version,
          },
          summary: report.summary,
          missing_chars: report.missing_chars.map((c) => ({
            char: c.char,
            codepoint: c.codepoint_hex,
          })),
          decomposed_only_chars:
            report.character_coverage.decomposed_only.map((c) => ({
              char: c.char,
              codepoint: c.codepoint_hex,
            })),
          missing_sequences: uniqueMissingSeqs,
          residual_glyphs: report.residual_glyphs.map((r) => r.glyph_name),
          effective_revision: report.effective_revision,
        });

        // Aggregate into by_font
        const byFontKey = `${snap.fontSource.owner_language_id}:${snap.fontSource.revision}`;
        let agg = byFontMap.get(byFontKey);
        if (!agg) {
          agg = {
            font_revision: snap.fontSource.revision,
            sha256: loadedFont.sha256,
            owner_language_id: snap.fontSource.owner_language_id,
            owner_name: snap.fontSource.owner_name,
            owner_path: snap.fontSource.owner_path,
            file_name: snap.fontSource.file_name,
            family_name: loadedFont.familyName,
            version: loadedFont.version,
            inheriting_language_ids:
              inheritingByOwner.get(snap.fontSource.owner_language_id) ?? [],
            audited_language_ids: [],
            missingCharMap: new Map(),
            missingSeqSet: new Set(),
            residualGlyphMap: new Map(),
          };
          byFontMap.set(byFontKey, agg);
        }
        agg.audited_language_ids.push(snap.language.language_id);

        for (const mc of report.missing_chars) {
          let fontEntry = agg.missingCharMap.get(mc.codepoint);
          if (!fontEntry) {
            fontEntry = {
              char: mc.char,
              codepoint: mc.codepoint_hex,
              language_ids: new Set<string>(),
            };
            agg.missingCharMap.set(mc.codepoint, fontEntry);
          }
          fontEntry.language_ids.add(snap.language.language_id);

          let famEntry = unionMissingMap.get(mc.codepoint);
          if (!famEntry) {
            famEntry = {
              char: mc.char,
              codepoint: mc.codepoint_hex,
              language_ids: new Set<string>(),
              language_names: new Set<string>(),
            };
            unionMissingMap.set(mc.codepoint, famEntry);
          }
          famEntry.language_ids.add(snap.language.language_id);
          famEntry.language_names.add(snap.language.name);
        }

        for (const seqText of uniqueMissingSeqs) {
          agg.missingSeqSet.add(seqText);
          let seqLangs = unionMissingSeqMap.get(seqText);
          if (!seqLangs) {
            seqLangs = new Set<string>();
            unionMissingSeqMap.set(seqText, seqLangs);
          }
          seqLangs.add(snap.language.language_id);
        }

        for (const rg of report.residual_glyphs) {
          let rgEntry = agg.residualGlyphMap.get(rg.gid);
          if (!rgEntry) {
            rgEntry = {
              gid: rg.gid,
              glyph_name: rg.glyph_name,
              language_ids: new Set<string>(),
            };
            agg.residualGlyphMap.set(rg.gid, rgEntry);
          }
          rgEntry.language_ids.add(snap.language.language_id);
        }
      }

      // Group owners sharing identical sha256 so callers can see duplicated font binaries
      const ownersBySha = new Map<string, string[]>();
      for (const agg of byFontMap.values()) {
        const list = ownersBySha.get(agg.sha256) ?? [];
        if (!list.includes(agg.owner_language_id)) {
          list.push(agg.owner_language_id);
        }
        ownersBySha.set(agg.sha256, list);
      }

      const byFont = Array.from(byFontMap.values()).map((agg) => ({
        font_revision: agg.font_revision,
        sha256: agg.sha256,
        owner_language_id: agg.owner_language_id,
        owner_name: agg.owner_name,
        owner_path: agg.owner_path,
        file_name: agg.file_name,
        family_name: agg.family_name,
        version: agg.version,
        inheriting_language_ids: agg.inheriting_language_ids,
        audited_language_ids: agg.audited_language_ids,
        shared_sha256_owner_ids: (ownersBySha.get(agg.sha256) ?? []).filter(
          (id) => id !== agg.owner_language_id,
        ),
        union_missing_chars: Array.from(agg.missingCharMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, v]) => ({
            char: v.char,
            codepoint: v.codepoint,
            language_ids: Array.from(v.language_ids),
          })),
        union_missing_sequences: Array.from(agg.missingSeqSet).sort(),
        residual_glyphs: Array.from(agg.residualGlyphMap.values())
          .sort((a, b) => a.gid - b.gid)
          .map((r) => ({
            gid: r.gid,
            glyph_name: r.glyph_name,
            language_ids: Array.from(r.language_ids),
          })),
      }));

      const nextOffset = consistentBatch.startOffset + processedCount;
      const hasMore = nextOffset < consistentBatch.totalTargetCount;
      const partial = timedOut || hasMore;
      const nextCursor = hasMore
        ? encodeCursor(nextOffset, consistentBatch.workspaceRevision)
        : null;

      return {
        family_id: family.family_id,
        name: family.name,
        root_language_id: consistentBatch.resolvedRootId,
        total_languages: consistentBatch.totalTargetCount,
        audited_count: processedCount,
        distinct_fonts_parsed: fontHandleByRev.size,
        partial,
        timed_out: timedOut,
        elapsed_ms: Math.round(performance.now() - startedAt),
        next_cursor: nextCursor,
        revision: consistentBatch.workspaceRevision,
        per_language: perLanguage,
        matrix: perLanguage,
        by_font: byFont,
        union_missing: {
          chars: Array.from(unionMissingMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, v]) => ({
              char: v.char,
              codepoint: v.codepoint,
              language_ids: Array.from(v.language_ids),
              language_names: Array.from(v.language_names),
            })),
          sequences: Array.from(unionMissingSeqMap.entries())
            .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([text, langSet]) => ({
              text,
              language_ids: Array.from(langSet),
            })),
        },
      };
    },
  });
}
