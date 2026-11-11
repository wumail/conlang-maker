export type LayoutNormalization = "as_used" | "NFC" | "NFD" | "none";

export interface LayoutOptions {
  direction?: "ltr" | "rtl" | "ttb" | "btt";
  script?: string;
  language?: string;
  features?: string[];
  normalization?: LayoutNormalization;
}

/**
 * Shared layout baseline matching GUI `.conlang-script` CSS (`src/App.css`):
 * - `font-feature-settings: "ccmp" 1, "rlig" 1, "liga" 1, "clig" 1, "calt" 1, "locl" 1, "mark" 1, "mkmk" 1, "kern" 1`
 * - LTR direction, HTML `lang="en"`, script inferred per Unicode run (`guessSegmentProperties`)
 */
export const GUI_DEFAULT_LAYOUT = {
  direction: "ltr" as const,
  language_tag: "en" as const,
  script_source: "unicode_runs" as const,
  normalization: "as_used" as const,
  features: [
    "ccmp",
    "rlig",
    "liga",
    "clig",
    "calt",
    "locl",
    "mark",
    "mkmk",
    "kern",
  ] as readonly string[],
};

export const DEFAULT_SHAPING_LAYOUT: Required<
  Pick<LayoutOptions, "direction" | "features" | "normalization">
> & { script?: string; language?: string } = {
  direction: GUI_DEFAULT_LAYOUT.direction,
  script: undefined,
  language: GUI_DEFAULT_LAYOUT.language_tag,
  features: [...GUI_DEFAULT_LAYOUT.features],
  normalization: GUI_DEFAULT_LAYOUT.normalization,
};

export interface AppliedLayoutMetadata {
  normalization: "as_used" | "NFC" | "NFD";
  direction: "ltr" | "rtl" | "ttb" | "btt";
  script: string | null;
  script_source: "override" | "unicode_runs";
  language_tag: string;
  features: string[];
  features_source: "override" | "GUI_DEFAULT_LAYOUT";
}

export interface CmapRange {
  start: number;
  end: number;
  start_hex: string;
  end_hex: string;
  count: number;
}

export interface LoadedFontHandle {
  sha256: string;
  fileName: string;
  byteLength: number;
  familyName: string | null;
  subfamilyName: string | null;
  version: string | null;
  upem: number;
  glyphCount: number;
  hasGlyphNames: boolean;
  unicodes: ReadonlySet<number>;
  unicodeList: number[];
  cmapRanges: CmapRange[];
  gsubFeatures: string[];
  gposFeatures: string[];
  gsubScripts: string[];
  gposScripts: string[];
  glyphName(gid: number): string;
  nominalGlyph(codepoint: number): number | undefined;
}

export interface ShapedGlyph {
  gid: number;
  name: string | null;
  cluster: number;
  cluster_unit: "shaped_input_codepoints";
  codepoint_span: [number, number];
  source_codepoint_span: [number, number];
  source_text: string;
  x_advance: number;
  y_advance: number;
  x_offset: number;
  y_offset: number;
  is_notdef: boolean;
}

export interface ShapeResult {
  input: string;
  shaped_input: string;
  codepoint_count: number;
  source_codepoint_count: number;
  cluster_unit: "shaped_input_codepoints";
  layout: AppliedLayoutMetadata;
  glyphs: ShapedGlyph[];
  has_notdef: boolean;
  total_x_advance: number;
}
