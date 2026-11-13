/**
 * outline.ts — HarfBuzz 字形轮廓提取（T3.1）
 *
 * 把 WASM 字体句柄上的 `glyphToJson` 结果转成纯数据，喂给
 * `src/core/engines/fontGeometryAudit`；核心审计模块保持零 WASM 依赖。
 */
import type { MarkPairInput, PathCmd } from "../../src/core/engines/fontGeometryAudit";
import type { GlyphAnnotation, GlyphKind } from "../../src/types";
import { getInternalHbFont } from "./loader";
import type { LoadedFontHandle } from "./types";

const COMBINING_RANGES: readonly [number, number][] = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
];

export function isCombiningMark(codepoint: number): boolean {
  return COMBINING_RANGES.some(([start, end]) => codepoint >= start && codepoint <= end);
}

export interface ExtractedGlyph {
  gid: number;
  commands: PathCmd[];
  advanceWidth: number;
  name: string | null;
}

/** 读取单个字形的轮廓命令与水平步进 */
export function extractGlyph(
  handle: LoadedFontHandle,
  gid: number,
): ExtractedGlyph {
  const font = getInternalHbFont(handle);
  const raw = font.glyphToJson(gid) as { type?: unknown; values?: unknown }[];
  const commands: PathCmd[] = raw.map((command) => ({
    type: typeof command.type === "string" ? command.type : "L",
    values: Array.isArray(command.values)
      ? command.values.filter((value): value is number => typeof value === "number")
      : [],
  }));
  return {
    gid,
    commands,
    advanceWidth: font.glyphHAdvance(gid),
    name: handle.hasGlyphNames ? handle.glyphName(gid) : null,
  };
}

/**
 * 由 Unicode NFD 分解推导 base + mark 对：
 * 预组合字母（如 é U+00E9）分解为 `e` + U+0301，两者都在 cmap 中才构成可测对。
 * 仅对拉丁/组合区段有效，人造文字请改用 `groupAnnotationKinds`。
 */
export function buildMarkPairs(
  handle: LoadedFontHandle,
  maxPairs = 200,
): { pairs: MarkPairInput[]; compositeGids: Set<number> } {
  const pairs: MarkPairInput[] = [];
  const compositeGids = new Set<number>();

  for (const codepoint of handle.unicodeList) {
    if (pairs.length >= maxPairs) break;
    const compositeGid = handle.nominalGlyph(codepoint);
    if (compositeGid === undefined || compositeGid === 0) continue;

    const decomposed = String.fromCodePoint(codepoint).normalize("NFD");
    const parts = Array.from(decomposed).map((char) => char.codePointAt(0) ?? 0);
    if (parts.length !== 2 || !isCombiningMark(parts[1]!)) continue;

    const baseGid = handle.nominalGlyph(parts[0]!);
    const markGid = handle.nominalGlyph(parts[1]!);
    if (!baseGid || !markGid) continue;

    pairs.push({ compositeGid, baseGid, markGid });
    compositeGids.add(compositeGid);
  }

  return { pairs, compositeGids };
}

export interface AnnotationKindSets {
  /** codepoint → 标注声明的结构分类 */
  kindByCodepoint: Map<number, GlyphKind>;
  /** kind === "base" | "carrier" 的码位 */
  baseCodepoints: number[];
  /** kind === "vowel" | "mark" 的码位 */
  markCodepoints: number[];
}

/**
 * 按 `PhonologyConfig.glyph_annotations` 拆分基字 / 附标码位集合。
 * 人造文字把字母映射在 ASCII 或 PUA 区，靠 GSUB / GPOS 组合，无法用 NFD 推断。
 */
export function groupAnnotationKinds(
  annotations: readonly GlyphAnnotation[],
): AnnotationKindSets {
  const kindByCodepoint = new Map<number, GlyphKind>();
  const baseCodepoints: number[] = [];
  const markCodepoints: number[] = [];

  for (const annotation of annotations) {
    if (!annotation.kind) continue;
    kindByCodepoint.set(annotation.codepoint, annotation.kind);
    if (annotation.kind === "base" || annotation.kind === "carrier") {
      baseCodepoints.push(annotation.codepoint);
    } else if (annotation.kind === "vowel" || annotation.kind === "mark") {
      markCodepoints.push(annotation.codepoint);
    }
  }

  return {
    kindByCodepoint,
    baseCodepoints: baseCodepoints.sort((a, b) => a - b),
    markCodepoints: markCodepoints.sort((a, b) => a - b),
  };
}

