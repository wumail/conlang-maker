import { useEffect, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import type {
  FontInspection,
  GlyphAnnotation,
  GlyphKind,
  LanguageEntry,
  PhonologyLoadResult,
} from "../../types";
import {
  charactersOf,
  formatCodepoint,
  isCombiningMark,
  unicodeBlockId,
  type UnicodeBlockId,
} from "../../utils/unicodeBlocks";

export type BlockFilter = "all" | "annotated" | UnicodeBlockId;

export interface ResolvedCellInfo {
  codepoint: number;
  annotation: GlyphAnnotation | null;
  label: string;
  kind: GlyphKind;
  phonemes: string[];
  compositionText: string;
  annotated: boolean;
  inFont: boolean;
}

export const PAGE_SIZE = 160;
export const POPOVER_WIDTH = 280;
export const EMPTY_SET_SYMBOL = "∅";
export const KINDS: GlyphKind[] = [
  "base",
  "vowel",
  "carrier",
  "mark",
  "punctuation",
];
export const ALL_BLOCKS: UnicodeBlockId[] = [
  "basicLatin",
  "latin1",
  "latinExtA",
  "latinExtB",
  "ipa",
  "combining",
  "generalPunct",
  "pua",
  "other",
];

export function normalizeToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed === "∅" || trimmed === "Ø") return EMPTY_SET_SYMBOL;
  return trimmed;
}

export function placePopover(rect: DOMRect): { top: number; left: number } {
  const margin = 8;
  let left = rect.right + margin;
  if (left + POPOVER_WIDTH > window.innerWidth - margin) {
    left = Math.max(margin, rect.left - POPOVER_WIDTH - margin);
  }
  const height = Math.min(360, window.innerHeight - margin * 2);
  let top = rect.top;
  if (top + height > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - margin - height);
  }
  return { top, left };
}

export function kindLabel(t: TFunction, kind: GlyphKind): string {
  switch (kind) {
    case "base":
      return t("writing.kindBase");
    case "vowel":
      return t("writing.kindVowel");
    case "carrier":
      return t("writing.kindCarrier");
    case "mark":
      return t("writing.kindMark");
    case "punctuation":
      return t("writing.kindPunctuation");
  }
}

export function blockLabel(t: TFunction, block: UnicodeBlockId): string {
  switch (block) {
    case "basicLatin":
      return t("writing.blocks.basicLatin");
    case "latin1":
      return t("writing.blocks.latin1");
    case "latinExtA":
      return t("writing.blocks.latinExtA");
    case "latinExtB":
      return t("writing.blocks.latinExtB");
    case "ipa":
      return t("writing.blocks.ipa");
    case "combining":
      return t("writing.blocks.combining");
    case "generalPunct":
      return t("writing.blocks.generalPunct");
    case "pua":
      return t("writing.blocks.pua");
    case "other":
      return t("writing.blocks.other");
  }
}

export function safeFromCodePoint(codepoint: number): string {
  if (!Number.isInteger(codepoint) || codepoint < 0 || codepoint > 0x10ffff) {
    return "";
  }
  try {
    return String.fromCodePoint(codepoint);
  } catch (err) {
    console.warn(`Invalid codepoint ${codepoint}: ${err}`);
    return "";
  }
}

export function glyphText(codepoint: number): string {
  const character = safeFromCodePoint(codepoint);
  return isCombiningMark(codepoint) ? `\u25CC${character}` : character;
}

export function representative(codepoints: number[]): number {
  const lower = codepoints.find((code) => {
    const text = safeFromCodePoint(code);
    return (
      text.length > 0 &&
      text.toLowerCase() === text &&
      text.toUpperCase() !== text
    );
  });
  return lower ?? codepoints[0] ?? 0;
}

export function asKind(value: string): GlyphKind {
  if (
    value === "vowel" ||
    value === "carrier" ||
    value === "mark" ||
    value === "punctuation"
  ) {
    return value;
  }
  return "base";
}

export async function copyCharacter(character: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(character);
    return true;
  } catch (clipErr) {
    console.warn(`Clipboard API failed, falling back: ${clipErr}`);
    try {
      const area = document.createElement("textarea");
      area.value = character;
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return copied;
    } catch (fallbackErr) {
      console.warn(`Fallback copy failed: ${fallbackErr}`);
      return false;
    }
  }
}

export function resolveCellInfoFromMap(
  cell: number[],
  annotationByCodepoint: Map<number, GlyphAnnotation>,
  fontCodeSet: Set<number>,
): ResolvedCellInfo {
  const codepoint = representative(cell);
  const inFont = cell.some((code) => fontCodeSet.has(code));
  const found =
    cell.map((code) => annotationByCodepoint.get(code)).find(Boolean) ?? null;
  if (!found) {
    return {
      codepoint,
      annotation: null,
      label: "",
      kind: "base",
      phonemes: [],
      compositionText: "",
      annotated: false,
      inFont,
    };
  }
  const phonemes = (found.phonemes ?? []).map(normalizeToken).filter(Boolean);
  return {
    codepoint,
    annotation: found,
    label: found.label,
    kind: found.kind ?? "base",
    phonemes,
    compositionText: phonemes.length > 0 ? `[${phonemes.join("")}]` : "",
    annotated: true,
    inFont,
  };
}

export function buildGlyphCells(
  inspection: FontInspection | null,
  annotations: GlyphAnnotation[],
): number[][] {
  const fromFont =
    inspection?.glyphs && inspection.glyphs.length > 0
      ? inspection.glyphs.filter((group) => group.length > 0)
      : inspection?.present
        ? inspection.codepoints.map((code) => [code])
        : [];
  const known = new Set(fromFont.flat());
  const extra = new Set<number>();
  for (const item of annotations) {
    if (item.codepoint >= 0 && !known.has(item.codepoint)) {
      extra.add(item.codepoint);
    }
  }
  const cells = [
    ...fromFont,
    ...[...extra].sort((a, b) => a - b).map((code) => [code]),
  ];
  cells.sort((left, right) => left[0] - right[0]);
  return cells;
}

export function filterGlyphCells(
  glyphCells: number[][],
  query: string,
  blockFilter: BlockFilter,
  annotationByCodepoint: Map<number, GlyphAnnotation>,
  fontCodeSet: Set<number>,
): number[][] {
  const needle = query.trim().toLowerCase();
  const compact = needle.replace(/^u\+/, "");
  const asCode =
    Boolean(needle) && /^[0-9a-f]{2,6}$/.test(compact) && /\d/.test(compact);
  const needleChars = !needle || asCode ? null : new Set(charactersOf(needle));

  return glyphCells.filter((cell) => {
    const info = resolveCellInfoFromMap(cell, annotationByCodepoint, fontCodeSet);
    if (blockFilter === "annotated" && !info.annotated) return false;
    if (
      blockFilter !== "all" &&
      blockFilter !== "annotated" &&
      unicodeBlockId(info.codepoint) !== blockFilter
    ) {
      return false;
    }
    if (!needle) return true;
    if (asCode) {
      return cell.some(
        (c) => formatCodepoint(c).toLowerCase().replace("u+", "") === compact,
      );
    }
    if (needleChars && cell.some((c) => needleChars.has(safeFromCodePoint(c)))) {
      return true;
    }
    if (!info.annotated) return false;
    return (
      info.label.toLowerCase().includes(needle) ||
      info.compositionText.toLowerCase().includes(needle) ||
      info.phonemes.join(" ").toLowerCase().includes(needle)
    );
  });
}

export function mergeParentGlyphAnnotations(
  current: GlyphAnnotation[],
  parentNotes: GlyphAnnotation[],
): GlyphAnnotation[] {
  const byCode = new Map<number, GlyphAnnotation>();
  for (const item of current) byCode.set(item.codepoint, item);
  for (const parentItem of parentNotes) {
    const existing = byCode.get(parentItem.codepoint);
    byCode.set(
      parentItem.codepoint,
      existing
        ? {
            ...parentItem,
            ...existing,
            label: existing.label || parentItem.label,
            kind: existing.kind ?? parentItem.kind,
            phonemes:
              existing.phonemes && existing.phonemes.length > 0
                ? existing.phonemes
                : parentItem.phonemes,
          }
        : { ...parentItem },
    );
  }
  return [...byCode.values()].sort((a, b) => a.codepoint - b.codepoint);
}

export function upsertCellGlyphAnnotation(
  current: GlyphAnnotation[],
  cell: number[],
  patch: { label: string; kind: GlyphKind; phonemes: string[] },
): GlyphAnnotation[] {
  const primaryCode = representative(cell);
  const cellSet = new Set(cell);
  const normalizedPhonemes = patch.phonemes.map(normalizeToken).filter(Boolean);
  const existing = current.find((item) => cellSet.has(item.codepoint));
  const rest = current.filter((item) => !cellSet.has(item.codepoint));
  const { phonemes: _prevPhonemes, ...preserved } = existing ?? {
    codepoint: primaryCode,
    label: patch.label,
  };
  const nextItem: GlyphAnnotation = {
    ...preserved,
    codepoint: primaryCode,
    label: patch.label,
    kind: patch.kind,
    ...(normalizedPhonemes.length > 0 ? { phonemes: normalizedPhonemes } : {}),
  };
  return [...rest, nextItem].sort((a, b) => a.codepoint - b.codepoint);
}

export function useParentGlyphSource(
  projectPath: string,
  activeLanguageId: string,
  workspaceLanguages: LanguageEntry[],
): { name: string; annotations: GlyphAnnotation[] } | null {
  const [parentSource, setParentSource] = useState<{
    name: string;
    annotations: GlyphAnnotation[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const activeLang = workspaceLanguages.find(
      (l) => l.language_id === activeLanguageId,
    );
    if (!projectPath || !activeLang?.parent_id) {
      setParentSource(null);
      return;
    }
    (async () => {
      const seen = new Set<string>([activeLang.language_id]);
      let currId: string | null = activeLang.parent_id;
      while (currId && !seen.has(currId)) {
        seen.add(currId);
        const parentEntry = workspaceLanguages.find(
          (l) => l.language_id === currId,
        );
        if (!parentEntry) break;
        try {
          const parentPhono = await invoke<PhonologyLoadResult>(
            "load_phonology",
            {
              projectPath,
              languagePath: parentEntry.path,
            },
          );
          if (cancelled) return;
          const parentNotes =
            (parentPhono.local_config ?? parentPhono.config)
              .glyph_annotations ?? [];
          if (parentNotes.length > 0) {
            setParentSource({ name: parentEntry.name, annotations: parentNotes });
            return;
          }
        } catch (err) {
          console.warn(`读取祖先音系失败：${err}`);
        }
        currId = parentEntry.parent_id;
      }
      if (!cancelled) setParentSource(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, activeLanguageId, workspaceLanguages]);

  return parentSource;
}

export function usePopoverDismissAndPosition(
  popoverOpen: boolean,
  selectedCell: number[] | null,
  anchorRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLDivElement | null>,
  setPopoverPos: (pos: { top: number; left: number } | null) => void,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!popoverOpen) return;
    const update = (): void => {
      const anchor = anchorRef.current;
      if (!anchor || !anchor.isConnected) {
        setPopoverPos(null);
        return;
      }
      setPopoverPos(placePopover(anchor.getBoundingClientRect()));
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [popoverOpen, selectedCell, anchorRef, setPopoverPos]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onPointer = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || popoverRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest("[data-annotate-anchor]")) {
        return;
      }
      onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen, popoverRef, onClose]);
}
