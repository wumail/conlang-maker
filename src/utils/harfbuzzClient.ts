/**
 * harfbuzzClient.ts — 浏览器端字体轮廓审计客户端（T3.2）
 *
 * 从 Tauri 读取解析后的字库字节，在浏览器加载 HarfBuzz WASM 提取轮廓，
 * 再交给纯函数 `auditFontGeometry`。结果按 resolved revision 缓存。
 */
import { invoke } from "@tauri-apps/api/core";
import type { ResolvedFontBytes } from "../types";
import {
  auditFontGeometry,
  outlineBounds,
  type FontGeometryAuditResult,
  type GlyphOutlineInput,
  type MarkPairInput,
  type PathCmd,
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
}

/**
 * 审计当前语言解析后的字体；无字体时返回 `null`。
 * 同一个 `languageId + resolved revision` 只计算一次。
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

  const cacheKey = `${options.languageId}::${font.revision}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const hb = await getHarfBuzz();
  const blob = new hb.Blob(decodeBase64(font.bytes_base64));
  const face = new hb.Face(blob, 0);
  const hbFont = new hb.Font(face);

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

  const gids = Array.from(codepointsByGid.keys()).slice(0, limit);
  const glyphs: GlyphOutlineInput[] = gids.map((gid) => {
    const codepoints = codepointsByGid.get(gid) ?? [];
    return {
      gid,
      name: hbFont.glyphName(gid) || null,
      codepoints,
      advanceWidth: hbFont.glyphHAdvance(gid),
      commands: hbFont.glyphToJson(gid) as PathCmd[],
      isMark: codepoints.length > 0 && codepoints.every(isCombiningMark),
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

  const result = auditFontGeometry({
    glyphs,
    upm: face.upem,
    metrics: overrides,
    markPairs,
  });

  cache.set(cacheKey, result);
  return result;
}

/** 清空缓存（字体重新导入后调用） */
export function invalidateGeometryCache(): void {
  cache.clear();
}
