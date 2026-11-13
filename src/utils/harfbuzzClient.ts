/**
 * harfbuzzClient.ts — 浏览器端字体轮廓审计客户端（T3.2 / F3.2 / F3.1）
 *
 * 从 Tauri 读取解析后的字库字节，在浏览器加载 HarfBuzz WASM 提取轮廓，
 * 再交给纯函数 `auditFontGeometry`。结果按 resolved revision + 标注指纹缓存。
 *
 * 人造文字把 base / vowel / mark 映射在 ASCII 或 PUA 区，靠 GSUB / GPOS 组合，
 * 因此这里优先读取 `PhonologyConfig.glyph_annotations` 做结构分类，
 * 并用 `hb.shape` 实测 base + mark 的组合结果。
 */
import { invoke } from "@tauri-apps/api/core";
import type { GlyphAnnotation, GlyphKind, ResolvedFontBytes } from "../types";
import {
  auditFontGeometry,
  outlineBounds,
  resolveShapedMarkPair,
  type FontGeometryAuditResult,
  type GlyphOutlineInput,
  type MarkPairInput,
  type PathCmd,
  type ShapedGlyphMetrics,
} from "../core/engines/fontGeometryAudit";
import { decodeBase64 } from "./conlangFont";

type HbModule = typeof import("harfbuzzjs");

const COMBINING_RANGES: readonly [number, number][] = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
];

function isCombiningMark(codepoint: number): boolean {
  return COMBINING_RANGES.some(([start, end]) => codepoint >= start && codepoint <= end);
}

/** WASM 对象在运行时提供 destroy() 时立即释放，否则交由 GC 终结器回收 */
interface DisposableHbObject {
  destroy?: () => void;
}

function releaseHarfBuzzObject(object: unknown): void {
  if (!object || typeof object !== "object") return;
  const destroy = (object as DisposableHbObject).destroy;
  if (typeof destroy !== "function") return;
  try {
    destroy.call(object);
  } catch (error) {
    console.warn("Failed to release a HarfBuzz object:", error);
  }
}

let hbPromise: Promise<HbModule> | null = null;
const cache = new Map<string, FontGeometryAuditResult>();

async function getHarfBuzz(): Promise<HbModule> {
  if (!hbPromise) hbPromise = import("harfbuzzjs");
  return await hbPromise;
}

export interface AuditLanguageFontOptions {
  projectPath: string;
  conlangFilePath: string;
  languageId: string;
  glyphLimit?: number;
  /** 当前语言生效的 `PhonologyConfig.glyph_annotations` */
  glyphAnnotations?: GlyphAnnotation[];
}

function annotationSignature(annotations: readonly GlyphAnnotation[]): string {
  return annotations
    .map((item) => `${item.codepoint}:${item.kind ?? ""}`)
    .sort()
    .join(",");
}

/**
 * 审计当前语言解析后的字体；无字体时返回 `null`。
 * 同一个 `languageId + resolved revision + 标注指纹` 只计算一次。
 */
export async function auditLanguageFont(
  options: AuditLanguageFontOptions,
): Promise<FontGeometryAuditResult | null> {
  const font = await invoke<ResolvedFontBytes | null>("read_resolved_font", {
    projectPath: options.projectPath,
    conlangFilePath: options.conlangFilePath,
    languageId: options.languageId,
  });
  if (!font?.bytes_base64) return null;

  const annotations = options.glyphAnnotations ?? [];
  const cacheKey = `${options.languageId}::${font.revision}::${annotationSignature(annotations)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

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

  const hb = await getHarfBuzz();
  const blob = new hb.Blob(decodeBase64(font.bytes_base64));
  const face = new hb.Face(blob, 0);
  const hbFont = new hb.Font(face);
  // 全量配对共用同一个 shaping buffer，避免每次 hb.shape 都向 WASM 堆申请新缓冲区
  const shapeBuffer = new hb.Buffer();
  let result: FontGeometryAuditResult;

  try {
    const unicodes = Array.from(face.collectUnicodes()).sort((a, b) => a - b);
    const limit = options.glyphLimit ?? 320;

    const gidByCodepoint = new Map<number, number>();
    for (const codepoint of unicodes) {
      const gid = hbFont.nominalGlyph(codepoint);
      if (gid) gidByCodepoint.set(codepoint, gid);
    }

    const codepointsByGid = new Map<number, number[]>();
    for (const [codepoint, gid] of gidByCodepoint) {
      const list = codepointsByGid.get(gid) ?? [];
      list.push(codepoint);
      codepointsByGid.set(gid, list);
    }

    const kindOf = (codepoints: readonly number[]): GlyphKind | undefined => {
      for (const codepoint of codepoints) {
        const kind = kindByCodepoint.get(codepoint);
        if (kind) return kind;
      }
      return undefined;
    };

    const gids = Array.from(codepointsByGid.keys()).slice(0, limit);
    const glyphs: GlyphOutlineInput[] = gids.map((gid) => {
      const codepoints = codepointsByGid.get(gid) ?? [];
      const glyphKind = kindOf(codepoints);
      return {
        gid,
        name: hbFont.glyphName(gid) || null,
        codepoints,
        advanceWidth: hbFont.glyphHAdvance(gid),
        commands: hbFont.glyphToJson(gid) as PathCmd[],
        isMark:
          glyphKind === undefined && codepoints.length > 0 && codepoints.every(isCombiningMark),
        ...(glyphKind ? { glyphKind } : {}),
      };
    });

    const markPairs: MarkPairInput[] = [];
    for (const [codepoint, gid] of gidByCodepoint) {
      const parts = Array.from(String.fromCodePoint(codepoint).normalize("NFD")).map(
        (char) => char.codePointAt(0) ?? 0,
      );
      if (parts.length !== 2 || !isCombiningMark(parts[1]!)) continue;
      const baseGid = gidByCodepoint.get(parts[0]!);
      const markGid = gidByCodepoint.get(parts[1]!);
      if (!baseGid || !markGid) continue;
      markPairs.push({ compositeGid: gid, baseGid, markGid });
    }

    if (baseCodepoints.length > 0 && markCodepoints.length > 0) {
      const budget = Math.min(baseCodepoints.length * markCodepoints.length, 120);
      let shapedPairs = 0;
      outer: for (const baseCp of baseCodepoints) {
        const baseGid = gidByCodepoint.get(baseCp);
        if (!baseGid) continue;
        for (const markCp of markCodepoints) {
          if (shapedPairs >= budget) break outer;
          const markGid = gidByCodepoint.get(markCp);
          if (!markGid || markGid === baseGid) continue;
          shapedPairs += 1;
          const shaped = shapePair(hb, hbFont, shapeBuffer, baseCp, markCp);
          const pair = resolveShapedMarkPair(baseGid, markGid, shaped);
          if (pair) markPairs.push(pair);
        }
      }
    }

    const overrides: { capHeight?: number; xHeight?: number } = {};
    const capGid = gidByCodepoint.get(0x48);
    if (capGid) {
      const bounds = outlineBounds(hbFont.glyphToJson(capGid) as PathCmd[]);
      if (bounds.maxY > 0) overrides.capHeight = bounds.maxY;
    }
    const xGid = gidByCodepoint.get(0x78);
    if (xGid) {
      const bounds = outlineBounds(hbFont.glyphToJson(xGid) as PathCmd[]);
      if (bounds.maxY > 0) overrides.xHeight = bounds.maxY;
    }

    result = auditFontGeometry({
      glyphs,
      upm: face.upem,
      metrics: overrides,
      markPairs,
    });
  } finally {
    // 无论审计成功与否，都清空缓冲并释放本次创建的 WASM 句柄
    shapeBuffer.reset();
    releaseHarfBuzzObject(shapeBuffer);
    releaseHarfBuzzObject(hbFont);
    releaseHarfBuzzObject(face);
    releaseHarfBuzzObject(blob);
  }

  cache.set(cacheKey, result);
  return result;
}

/** 用 HarfBuzz 实测 base + mark 的组合结果（GSUB 连字 / GPOS 定位） */
function shapePair(
  hb: HbModule,
  hbFont: import("harfbuzzjs").Font,
  buffer: import("harfbuzzjs").Buffer,
  baseCodepoint: number,
  markCodepoint: number,
): ShapedGlyphMetrics[] {
  buffer.reset();
  try {
    buffer.add(baseCodepoint, 0);
    buffer.add(markCodepoint, 1);
    buffer.guessSegmentProperties();
    buffer.setDirection(hb.Direction.LTR);
    hb.shape(hbFont, buffer);
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    return infos.map((info, index) => {
      const position = positions[index];
      return {
        gid: info.codepoint,
        xAdvance: position?.xAdvance ?? 0,
        xOffset: position?.xOffset ?? 0,
        yOffset: position?.yOffset ?? 0,
      };
    });
  } finally {
    buffer.reset();
  }
}

/** 清空缓存（字体重新导入后调用） */
export function invalidateGeometryCache(): void {
  cache.clear();
}
