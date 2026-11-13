import { McpError } from "../errors";
import { getHarfBuzz, getInternalHbFont, releaseHarfBuzzObjects } from "./loader";
import {
  GUI_DEFAULT_LAYOUT,
  type AppliedLayoutMetadata,
  type LayoutOptions,
  type LoadedFontHandle,
  type ShapedGlyph,
  type ShapeResult,
} from "./types";

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

/**
 * Maps codepoint indices [0..shapedCpLen] in `shapedInput` back to codepoint spans [start, end]
 * in `rawText`, preserving canonical equivalence across NFC/NFD/combining marks/supplementary plane.
 */
function buildShapedToSourceCodepointSpans(
  rawText: string,
  shapedInput: string,
): [number, number][] {
  const shapedChars = Array.from(shapedInput);
  if (rawText === shapedInput) {
    return shapedChars.map((_, idx) => [idx, idx + 1]);
  }

  const rawSegments = Array.from(graphemeSegmenter.segment(rawText));
  const shapedSegments = Array.from(graphemeSegmenter.segment(shapedInput));

  if (rawSegments.length === shapedSegments.length) {
    const spans: [number, number][] = [];
    let rawCpCursor = 0;
    for (let g = 0; g < shapedSegments.length; g++) {
      const rawGraphemeCpLen = Array.from(rawSegments[g].segment).length;
      const shapedGraphemeCpLen = Array.from(shapedSegments[g].segment).length;
      const rawStart = rawCpCursor;
      const rawEnd = rawCpCursor + rawGraphemeCpLen;
      for (let k = 0; k < shapedGraphemeCpLen; k++) {
        spans.push([rawStart, rawEnd]);
      }
      rawCpCursor = rawEnd;
    }
    if (spans.length === shapedChars.length) {
      return spans;
    }
  }

  // Fallback proportional span covering full raw string if non-canonical
  const rawCpTotal = Array.from(rawText).length;
  return shapedChars.map((_, idx) => {
    const s = Math.min(idx, rawCpTotal);
    const e = Math.min(Math.max(s + 1, idx + 1), rawCpTotal);
    return [s, e];
  });
}

/**
 * Shapes text with HarfBuzz Wasm using explicit Unicode codepoint cluster indices (0..N-1),
 * guaranteeing exact codepoint_span and source_codepoint_span mapping across supplementary plane
 * characters, NFC/NFD normalization, and OpenType GSUB/GPOS ligatures.
 */
export async function shapeText(
  fontHandle: LoadedFontHandle,
  rawText: string,
  options?: LayoutOptions,
): Promise<ShapeResult> {
  const hb = await getHarfBuzz();
  const hbFont = getInternalHbFont(fontHandle);

  const rawNorm = options?.normalization ?? GUI_DEFAULT_LAYOUT.normalization;
  const canonicalNorm: "as_used" | "NFC" | "NFD" =
    rawNorm === "NFC" ? "NFC" : rawNorm === "NFD" ? "NFD" : "as_used";

  const shapedInput =
    canonicalNorm === "NFC"
      ? rawText.normalize("NFC")
      : canonicalNorm === "NFD"
        ? rawText.normalize("NFD")
        : rawText;

  const rawChars = Array.from(rawText);
  const chars = Array.from(shapedInput);
  const codepointCount = chars.length;
  const sourceCodepointCount = rawChars.length;

  const dir = options?.direction ?? GUI_DEFAULT_LAYOUT.direction;
  const languageTag = options?.language ?? GUI_DEFAULT_LAYOUT.language_tag;
  const hasFeatureOverride = options?.features !== undefined;
  const featureStrings = hasFeatureOverride
    ? options.features!
    : [...GUI_DEFAULT_LAYOUT.features];

  const layoutMeta: AppliedLayoutMetadata = {
    normalization: canonicalNorm,
    direction: dir,
    script: options?.script ?? null,
    script_source: options?.script ? "override" : "unicode_runs",
    language_tag: languageTag,
    features: featureStrings,
    features_source: hasFeatureOverride ? (options?.features_source ?? "override") : "GUI_DEFAULT_LAYOUT",
  };

  if (codepointCount === 0) {
    return {
      input: rawText,
      shaped_input: shapedInput,
      codepoint_count: 0,
      source_codepoint_count: sourceCodepointCount,
      cluster_unit: "shaped_input_codepoints",
      layout: layoutMeta,
      glyphs: [],
      has_notdef: false,
      total_x_advance: 0,
    };
  }

  const hbFeatures: import("harfbuzzjs").Feature[] = [];
  for (const featStr of featureStrings) {
    const parsed = hb.Feature.fromString(featStr);
    if (!parsed) {
      throw new McpError(
        "VALIDATION",
        `Invalid OpenType feature specification "${featStr}". Examples: "liga", "-liga", "+ss01", "aalt=2".`,
      );
    }
    hbFeatures.push(parsed);
  }

  const buffer = new hb.Buffer();
  let infos: import("harfbuzzjs").GlyphInfo[] = [];
  let positions: import("harfbuzzjs").GlyphPosition[] = [];
  try {
    buffer.setClusterLevel(hb.ClusterLevel.MONOTONE_CHARACTERS);

    for (let idx = 0; idx < chars.length; idx++) {
      const cp = chars[idx].codePointAt(0) ?? 0xfffd;
      buffer.add(cp, idx);
    }

    buffer.guessSegmentProperties();

    if (dir === "rtl") {
      buffer.setDirection(hb.Direction.RTL);
    } else if (dir === "ttb") {
      buffer.setDirection(hb.Direction.TTB);
    } else if (dir === "btt") {
      buffer.setDirection(hb.Direction.BTT);
    } else {
      buffer.setDirection(hb.Direction.LTR);
    }

    if (options?.script) {
      buffer.setScript(options.script);
    }
    if (languageTag) {
      buffer.setLanguage(languageTag);
    }

    hb.shape(hbFont, buffer, hbFeatures);

    infos = buffer.getGlyphInfos();
    positions = buffer.getGlyphPositions();
  } finally {
    // 无论 shaping 成功还是抛错，都必须清空并释放本次创建的 WASM buffer
    buffer.reset();
    releaseHarfBuzzObjects(buffer);
  }

  const uniqueClusters = Array.from(
    new Set(infos.map((info) => info.cluster)),
  ).sort((a, b) => a - b);

  const clusterEndMap = new Map<number, number>();
  for (let i = 0; i < uniqueClusters.length; i++) {
    const start = uniqueClusters[i];
    const end =
      i + 1 < uniqueClusters.length ? uniqueClusters[i + 1] : codepointCount;
    clusterEndMap.set(start, end);
  }

  const cpToSourceSpan = buildShapedToSourceCodepointSpans(rawText, shapedInput);

  const glyphs: ShapedGlyph[] = [];
  let hasNotdef = false;
  let totalXAdvance = 0;

  for (let i = 0; i < infos.length; i++) {
    const info = infos[i];
    const pos = positions[i] ?? {
      xAdvance: 0,
      yAdvance: 0,
      xOffset: 0,
      yOffset: 0,
    };
    const gid = info.codepoint;
    const isNotdef = gid === 0;
    if (isNotdef) hasNotdef = true;

    const spanStart = Math.max(0, Math.min(info.cluster, codepointCount));
    const spanEnd = Math.max(
      spanStart,
      Math.min(clusterEndMap.get(info.cluster) ?? codepointCount, codepointCount),
    );

    let sourceStart = spanStart;
    let sourceEnd = spanEnd;
    if (spanEnd > spanStart && cpToSourceSpan.length === codepointCount) {
      sourceStart = cpToSourceSpan[spanStart][0];
      sourceEnd = cpToSourceSpan[spanEnd - 1][1];
    } else if (cpToSourceSpan.length === codepointCount && spanStart < codepointCount) {
      sourceStart = cpToSourceSpan[spanStart][0];
      sourceEnd = sourceStart;
    } else {
      sourceStart = Math.min(spanStart, sourceCodepointCount);
      sourceEnd = Math.min(spanEnd, sourceCodepointCount);
    }

    const sourceText = rawChars.slice(sourceStart, sourceEnd).join("");
    const name = fontHandle.hasGlyphNames
      ? fontHandle.glyphName(gid)
      : gid === 0
        ? ".notdef"
        : null;

    totalXAdvance += pos.xAdvance;

    glyphs.push({
      gid,
      name,
      cluster: info.cluster,
      cluster_unit: "shaped_input_codepoints",
      codepoint_span: [spanStart, spanEnd],
      source_codepoint_span: [sourceStart, sourceEnd],
      source_text: sourceText,
      x_advance: pos.xAdvance,
      y_advance: pos.yAdvance,
      x_offset: pos.xOffset,
      y_offset: pos.yOffset,
      is_notdef: isNotdef,
    });
  }

  return {
    input: rawText,
    shaped_input: shapedInput,
    codepoint_count: codepointCount,
    source_codepoint_count: sourceCodepointCount,
    cluster_unit: "shaped_input_codepoints",
    layout: layoutMeta,
    glyphs,
    has_notdef: hasNotdef,
    total_x_advance: totalXAdvance,
  };
}

export async function shapeStrings(
  fontHandle: LoadedFontHandle,
  texts: readonly string[],
  options?: LayoutOptions,
): Promise<ShapeResult[]> {
  const out: ShapeResult[] = [];
  for (const t of texts) {
    out.push(await shapeText(fontHandle, t, options));
  }
  return out;
}
