import fs from "node:fs";
import path from "node:path";
import "harfbuzzjs/dist/harfbuzz.wasm" with { type: "file" };
import { McpError } from "../errors";
import { sha256FullHex } from "../storage/revision";
import type { CmapRange, LoadedFontHandle } from "./types";

export const MAX_FONT_BYTES = 20 * 1024 * 1024;

type HbModule = typeof import("harfbuzzjs");

let hbPromise: Promise<HbModule> | null = null;
const fontCache = new Map<string, LoadedFontHandle>();

export async function getHarfBuzz(): Promise<HbModule> {
  if (!hbPromise) {
    hbPromise = import("harfbuzzjs");
  }
  return await hbPromise;
}

export function isValidFontMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];
  // "OTTO"
  if (b0 === 0x4f && b1 === 0x54 && b2 === 0x54 && b3 === 0x4f) return true;
  // 0x00010000 TrueType
  if (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) return true;
  // "true"
  if (b0 === 0x74 && b1 === 0x72 && b2 === 0x75 && b3 === 0x65) return true;
  // "typ1"
  if (b0 === 0x74 && b1 === 0x79 && b2 === 0x70 && b3 === 0x31) return true;
  return false;
}

export function compressCmapRanges(sortedCodepoints: readonly number[]): CmapRange[] {
  if (sortedCodepoints.length === 0) return [];
  const ranges: CmapRange[] = [];
  let start = sortedCodepoints[0];
  let prev = start;

  for (let i = 1; i < sortedCodepoints.length; i++) {
    const cp = sortedCodepoints[i];
    if (cp === prev + 1) {
      prev = cp;
    } else {
      ranges.push(formatRange(start, prev));
      start = cp;
      prev = cp;
    }
  }
  ranges.push(formatRange(start, prev));
  return ranges;
}

function formatRange(start: number, end: number): CmapRange {
  return {
    start,
    end,
    start_hex: `U+${start.toString(16).toUpperCase().padStart(4, "0")}`,
    end_hex: `U+${end.toString(16).toUpperCase().padStart(4, "0")}`,
    count: end - start + 1,
  };
}

function readGlyphCountFromMaxp(face: import("harfbuzzjs").Face): number {
  const maxp = face.referenceTable("maxp");
  if (maxp && maxp.byteLength >= 6) {
    const view = new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength);
    return view.getUint16(4, false);
  }
  return 0;
}

function detectGlyphNamesAvailable(
  face: import("harfbuzzjs").Face,
  font: import("harfbuzzjs").Font,
  glyphCount: number,
): boolean {
  // Check CFF / CFF2 tables first
  const cff = face.referenceTable("CFF ");
  const cff2 = face.referenceTable("CFF2");
  if ((cff && cff.byteLength > 0) || (cff2 && cff2.byteLength > 0)) {
    if (cff2 && (!cff || cff.byteLength === 0)) {
      // CFF2 does not store glyph names unless post v2 is present
    } else {
      return true;
    }
  }

  const post = face.referenceTable("post");
  if (post && post.byteLength >= 4) {
    const view = new DataView(post.buffer, post.byteOffset, post.byteLength);
    const versionFixed = view.getUint32(0, false);
    // post format 3.0 (0x00030000) explicitly strips all glyph names
    if (versionFixed === 0x00030000) {
      return false;
    }
    if (versionFixed === 0x00010000 || versionFixed === 0x00020000 || versionFixed === 0x00025000) {
      return true;
    }
  }

  // Empirical fallback probe on first few non-.notdef glyphs
  const limit = Math.min(glyphCount, 16);
  for (let gid = 1; gid < limit; gid++) {
    const name = font.glyphName(gid);
    if (name && !/^gid\d+$/.test(name)) {
      return true;
    }
  }
  return false;
}

function readFaceName(
  face: import("harfbuzzjs").Face,
  targetNameId: number,
): string | null {
  const entries = face.listNames();
  const matching = entries.filter((e) => e.nameId === targetNameId);
  if (matching.length === 0) return null;
  const preferred =
    matching.find((e) => e.language === "en") ?? matching[0];
  const val = face.getName(preferred.nameId, preferred.language)?.trim();
  return val || null;
}

function uniqueSorted(items: readonly string[]): string[] {
  return Array.from(new Set(items)).sort();
}

export async function loadFontFromBytes(
  bytes: Buffer | Uint8Array,
  fileName: string = "font.ttf",
): Promise<LoadedFontHandle> {
  if (bytes.byteLength > MAX_FONT_BYTES) {
    throw new McpError(
      "VALIDATION",
      `Font "${fileName}" exceeds the 20 MB limit (${bytes.byteLength} bytes).`,
    );
  }
  if (!isValidFontMagicBytes(bytes)) {
    throw new McpError(
      "VALIDATION",
      `File "${fileName}" is not a valid single-face .otf or .ttf font.`,
    );
  }

  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const sha256 = sha256FullHex(buf);
  const cached = fontCache.get(sha256);
  if (cached) {
    return cached;
  }

  const hb = await getHarfBuzz();
  const hbBlob = new hb.Blob(new Uint8Array(buf));
  const hbFace = new hb.Face(hbBlob, 0);

  // Verify outline & cmap tables exist just like Rust validate_font_bytes
  const cmapTable = hbFace.referenceTable("cmap");
  const glyfTable = hbFace.referenceTable("glyf");
  const cffTable = hbFace.referenceTable("CFF ");
  const cff2Table = hbFace.referenceTable("CFF2");
  const glyphCount = readGlyphCountFromMaxp(hbFace);

  const hasOutline =
    Boolean(glyfTable && glyfTable.byteLength > 0) ||
    Boolean(cffTable && cffTable.byteLength > 0) ||
    Boolean(cff2Table && cff2Table.byteLength > 0);

  if (
    glyphCount === 0 ||
    !cmapTable ||
    cmapTable.byteLength === 0 ||
    !hasOutline
  ) {
    throw new McpError(
      "VALIDATION",
      `Font "${fileName}" is missing a readable cmap or glyph outline table.`,
    );
  }

  const rawUnicodes = hbFace.collectUnicodes();
  const unicodeList = Array.from(rawUnicodes).sort((a, b) => a - b);
  if (unicodeList.length === 0) {
    throw new McpError(
      "VALIDATION",
      `Font "${fileName}" has an empty Unicode character map (cmap).`,
    );
  }

  const hbFont = new hb.Font(hbFace);
  const unicodes = new Set<number>(unicodeList);
  const cmapRanges = compressCmapRanges(unicodeList);
  const hasGlyphNames = detectGlyphNamesAvailable(hbFace, hbFont, glyphCount);

  const gsubFeatures = uniqueSorted(hbFace.getTableFeatureTags("GSUB"));
  const gposFeatures = uniqueSorted(hbFace.getTableFeatureTags("GPOS"));
  const gsubScripts = uniqueSorted(hbFace.getTableScriptTags("GSUB"));
  const gposScripts = uniqueSorted(hbFace.getTableScriptTags("GPOS"));

  const handle: LoadedFontHandle & {
    _hbBlob: import("harfbuzzjs").Blob;
    _hbFace: import("harfbuzzjs").Face;
    _hbFont: import("harfbuzzjs").Font;
  } = {
    sha256,
    fileName,
    byteLength: buf.byteLength,
    familyName: readFaceName(hbFace, 16) ?? readFaceName(hbFace, 1),
    subfamilyName: readFaceName(hbFace, 17) ?? readFaceName(hbFace, 2),
    version: readFaceName(hbFace, 5),
    upem: hbFace.upem,
    glyphCount,
    hasGlyphNames,
    unicodes,
    unicodeList,
    cmapRanges,
    gsubFeatures,
    gposFeatures,
    gsubScripts,
    gposScripts,
    glyphName: (gid: number): string => hbFont.glyphName(gid),
    nominalGlyph: (cp: number): number | undefined => hbFont.nominalGlyph(cp),
    _hbBlob: hbBlob,
    _hbFace: hbFace,
    _hbFont: hbFont,
  };

  fontCache.set(sha256, handle);
  return handle;
}

export function getInternalHbFont(
  handle: LoadedFontHandle,
): import("harfbuzzjs").Font {
  const internal = handle as LoadedFontHandle & {
    _hbFont?: import("harfbuzzjs").Font;
  };
  if (!internal._hbFont) {
    throw new McpError("IO", "Internal HarfBuzz font handle not initialized.");
  }
  return internal._hbFont;
}

export async function loadFontFromFile(filePath: string): Promise<LoadedFontHandle> {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new McpError("NOT_FOUND", `Font file not found: ${filePath}`);
  }
  const bytes = fs.readFileSync(filePath);
  return await loadFontFromBytes(bytes, path.basename(filePath));
}

export function buildCodepointToGidMap(
  handle: LoadedFontHandle,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const cp of handle.unicodeList) {
    const gid = handle.nominalGlyph(cp);
    if (gid !== undefined && gid !== 0) {
      map.set(cp, gid);
    }
  }
  return map;
}

export interface EnumeratedGlyphInfo {
  gid: number;
  name: string | null;
  mapped_codepoints: number[];
}

export function enumerateAllGlyphs(
  handle: LoadedFontHandle,
): EnumeratedGlyphInfo[] {
  const cpByGid = new Map<number, number[]>();
  for (const cp of handle.unicodeList) {
    const gid = handle.nominalGlyph(cp);
    if (gid !== undefined && gid !== 0) {
      const list = cpByGid.get(gid) ?? [];
      list.push(cp);
      cpByGid.set(gid, list);
    }
  }
  const result: EnumeratedGlyphInfo[] = [];
  for (let gid = 0; gid < handle.glyphCount; gid++) {
    const name = handle.hasGlyphNames
      ? handle.glyphName(gid)
      : gid === 0
        ? ".notdef"
        : null;
    result.push({
      gid,
      name,
      mapped_codepoints: cpByGid.get(gid) ?? [],
    });
  }
  return result;
}

export interface FontFaceInfoCompat {
  family_name: string | null;
  version: string | null;
  codepoints: number[];
  glyphs: number[][];
}

interface TaggedTable {
  tag: string;
  offset: number;
  length: number;
}

/**
 * Synchronous binary cmap + name inspector matching Rust `src-tauri/src/commands/font_info.rs`
 * 100% bit-for-bit (`tests/golden/font_inspect_*.json`).
 */
export function inspectFontBytesCompat(data: Uint8Array): FontFaceInfoCompat {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const readU16 = (off: number): number => {
    if (off + 2 > data.byteLength) throw new Error("Unexpected end of font");
    return view.getUint16(off, false);
  };
  const readI16 = (off: number): number => {
    if (off + 2 > data.byteLength) throw new Error("Unexpected end of font");
    return view.getInt16(off, false);
  };
  const readU32 = (off: number): number => {
    if (off + 4 > data.byteLength) throw new Error("Unexpected end of font");
    return view.getUint32(off, false);
  };

  if (data.byteLength < 12) {
    throw new Error("Font file is truncated");
  }
  const numTables = readU16(4);
  const tables: TaggedTable[] = [];
  for (let i = 0; i < numTables; i++) {
    const pos = 12 + i * 16;
    if (pos + 16 > data.byteLength) {
      throw new Error("Font table directory is truncated");
    }
    const tag = String.fromCharCode(
      data[pos],
      data[pos + 1],
      data[pos + 2],
      data[pos + 3],
    );
    const offset = readU32(pos + 8);
    const length = readU32(pos + 12);
    if (offset + length > data.byteLength) {
      throw new Error(`Font table ${tag} is outside the file`);
    }
    tables.push({ tag, offset, length });
  }

  const cmapTable = tables.find((t) => t.tag === "cmap");
  if (!cmapTable) {
    throw new Error("Font has no character map");
  }
  const nameTable = tables.find((t) => t.tag === "name");
  const { family_name, version } = nameTable
    ? readNamesCompat(data, nameTable, readU16)
    : { family_name: null, version: null };
  const mapped = readCmapCompat(data, cmapTable, readU16, readI16, readU32);
  return {
    family_name,
    version,
    codepoints: mapped.codepoints,
    glyphs: mapped.glyphs,
  };
}

function finishMapCompat(
  pairs: [number, number][],
): { codepoints: number[]; glyphs: number[][] } {
  const filtered = pairs.filter(
    ([code, glyph]) => glyph !== 0 && code !== 0xffff,
  );
  filtered.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));

  const byGlyph = new Map<number, Set<number>>();
  for (const [code, glyph] of filtered) {
    let set = byGlyph.get(glyph);
    if (!set) {
      set = new Set<number>();
      byGlyph.set(glyph, set);
    }
    set.add(code);
  }

  const sortedGids = Array.from(byGlyph.keys()).sort((a, b) => a - b);
  const glyphs: number[][] = sortedGids.map((gid) =>
    Array.from(byGlyph.get(gid) ?? []).sort((a, b) => a - b),
  );
  glyphs.sort((a, b) => a[0] - b[0]);

  const codepointSet = new Set<number>();
  for (const grp of glyphs) {
    for (const cp of grp) codepointSet.add(cp);
  }
  const codepoints = Array.from(codepointSet).sort((a, b) => a - b);
  return { codepoints, glyphs };
}

function readCmapCompat(
  data: Uint8Array,
  table: TaggedTable,
  readU16: (o: number) => number,
  readI16: (o: number) => number,
  readU32: (o: number) => number,
): { codepoints: number[]; glyphs: number[][] } {
  const base = table.offset;
  if (table.length < 4) {
    throw new Error("Character map is truncated");
  }
  const numTables = readU16(base + 2);
  let bestScore = -1;
  let bestMapped: { codepoints: number[]; glyphs: number[][] } | null = null;

  for (let i = 0; i < numTables; i++) {
    const rec = base + 4 + i * 8;
    if (rec + 8 > base + table.length) {
      throw new Error("Character map records are truncated");
    }
    const platform = readU16(rec);
    const encoding = readU16(rec + 2);
    const subOff = readU32(rec + 4);
    const sub = base + subOff;
    if (sub + 2 > data.byteLength) continue;
    const format = readU16(sub);

    const unicode =
      platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const score =
      format === 12 || format === 13
        ? 3
        : format === 4
          ? 2
          : format === 6 || format === 0
            ? 1
            : 0;
    if (score === 0) continue;

    let mapped: { codepoints: number[]; glyphs: number[][] };
    if (format === 0) {
      if (sub + 6 + 256 > data.byteLength) {
        throw new Error("Byte character map is truncated");
      }
      const pairs: [number, number][] = [];
      for (let code = 0; code < 256; code++) {
        const g = data[sub + 6 + code];
        if (g !== 0) pairs.push([code, g]);
      }
      mapped = finishMapCompat(pairs);
    } else if (format === 4) {
      const len = readU16(sub + 2);
      if (len < 16 || sub + len > data.byteLength) {
        throw new Error("Format 4 character map is truncated");
      }
      const segCount = Math.floor(readU16(sub + 6) / 2);
      const endPos = sub + 14;
      const startPos = endPos + segCount * 2 + 2;
      const deltaPos = startPos + segCount * 2;
      const offsetPos = deltaPos + segCount * 2;
      if (offsetPos + segCount * 2 > sub + len) {
        throw new Error("Format 4 character map is truncated");
      }
      const pairs: [number, number][] = [];
      for (let s = 0; s < segCount; s++) {
        const end = readU16(endPos + s * 2);
        const start = readU16(startPos + s * 2);
        if (start === 0xffff && end === 0xffff) continue;
        if (start > end) continue;
        if (end - start > 100_000) {
          throw new Error("Character map segment is too large");
        }
        const delta = readI16(deltaPos + s * 2);
        const rangeOffset = readU16(offsetPos + s * 2);
        for (let code = start; code <= end; code++) {
          let glyph = 0;
          if (rangeOffset === 0) {
            glyph = (code + delta) & 0xffff;
          } else {
            const glyphPos =
              offsetPos + s * 2 + rangeOffset + (code - start) * 2;
            const gid = readU16(glyphPos);
            glyph = gid === 0 ? 0 : (gid + delta) & 0xffff;
          }
          if (glyph !== 0 && code !== 0xffff) {
            pairs.push([code, glyph]);
          }
        }
      }
      mapped = finishMapCompat(pairs);
    } else if (format === 6) {
      const len = readU16(sub + 2);
      if (sub + len > data.byteLength) {
        throw new Error("Format 6 character map is truncated");
      }
      const first = readU16(sub + 6);
      const count = readU16(sub + 8);
      const pairs: [number, number][] = [];
      for (let k = 0; k < count; k++) {
        const g = readU16(sub + 10 + k * 2);
        if (g !== 0) pairs.push([first + k, g]);
      }
      mapped = finishMapCompat(pairs);
    } else if (format === 12 || format === 13) {
      const len = readU32(sub + 4);
      if (len < 16 || sub + len > data.byteLength) {
        throw new Error("Format 12 character map is truncated");
      }
      const groups = readU32(sub + 12);
      let pos = sub + 16;
      const pairs: [number, number][] = [];
      for (let gIdx = 0; gIdx < groups; gIdx++) {
        const start = readU32(pos);
        const end = readU32(pos + 4);
        let glyph = readU32(pos + 8);
        pos += 12;
        if (start > end) continue;
        if (end - start > 100_000) {
          throw new Error("Character map group is too large");
        }
        for (let code = start; code <= end; code++) {
          if (glyph !== 0) pairs.push([code, glyph]);
          if (format === 12) {
            glyph = (glyph + 1) >>> 0;
          }
        }
      }
      mapped = finishMapCompat(pairs);
    } else {
      continue;
    }

    if (
      bestMapped === null ||
      score > bestScore ||
      (score === bestScore &&
        mapped.codepoints.length > bestMapped.codepoints.length)
    ) {
      bestScore = score;
      bestMapped = mapped;
    }
  }

  if (!bestMapped) {
    throw new Error("Font has no Unicode character map");
  }
  return bestMapped;
}

function readNamesCompat(
  data: Uint8Array,
  table: TaggedTable,
  readU16: (o: number) => number,
): { family_name: string | null; version: string | null } {
  const base = table.offset;
  if (table.length < 6) return { family_name: null, version: null };
  let count = 0;
  let stringOffset = 0;
  try {
    count = readU16(base + 2);
    stringOffset = readU16(base + 4);
  } catch {
    return { family_name: null, version: null };
  }

  let fam16: { score: number; text: string } | null = null;
  let fam1: { score: number; text: string } | null = null;
  let ver5: { score: number; text: string } | null = null;

  for (let i = 0; i < count; i++) {
    const rec = base + 6 + i * 12;
    if (rec + 12 > base + table.length) break;
    let platform = 0;
    let language = 0;
    let nameId = 0;
    let length = 0;
    let offset = 0;
    try {
      platform = readU16(rec);
      language = readU16(rec + 4);
      nameId = readU16(rec + 6);
      length = readU16(rec + 8);
      offset = readU16(rec + 10);
    } catch {
      break;
    }
    const start = base + stringOffset + offset;
    if (start + length > data.byteLength) continue;
    if (nameId !== 16 && nameId !== 1 && nameId !== 5) continue;

    const slice = data.subarray(start, start + length);
    let decoded: string | null = null;
    if (platform === 0 || platform === 3) {
      if (slice.byteLength % 2 !== 0) continue;
      try {
        decoded = new TextDecoder("utf-16be", { fatal: true }).decode(slice);
      } catch {
        decoded = null;
      }
    } else {
      let s = "";
      for (let b = 0; b < slice.byteLength; b++) {
        s += String.fromCharCode(slice[b]);
      }
      decoded = s;
    }
    const trimmed = decoded?.trim() ?? "";
    if (!trimmed) continue;

    const score =
      platform === 3 && language === 0x0409
        ? 3
        : platform === 3
          ? 2
          : platform === 0
            ? 1
            : 0;

    if (nameId === 16 && (!fam16 || fam16.score < score)) {
      fam16 = { score, text: trimmed };
    } else if (nameId === 1 && (!fam1 || fam1.score < score)) {
      fam1 = { score, text: trimmed };
    } else if (nameId === 5 && (!ver5 || ver5.score < score)) {
      ver5 = { score, text: trimmed };
    }
  }

  return {
    family_name: (fam16 ?? fam1)?.text ?? null,
    version: ver5?.text ?? null,
  };
}
