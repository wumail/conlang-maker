import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { invoke } from "@tauri-apps/api/core";
import { Copy, RefreshCw, Trash2, X } from "lucide-react";
import { usePhonoStore } from "../../store/phonoStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { GlyphAnnotation, GlyphKind, PhonologyConfig } from "../../types";
import {
  charactersOf,
  formatCodepoint,
  isCombiningMark,
  unicodeBlockId,
  type UnicodeBlockId,
} from "../../utils/unicodeBlocks";
import {
  BTN_GHOST,
  CARD,
  CARD_BODY,
  SECTION_HEADER,
} from "../../lib/ui";
import { useFontInspection } from "./FontInspectionContext";

const PAGE_SIZE = 160;
const POPOVER_WIDTH = 280;
const EMPTY_SET_SYMBOL = "∅";
const KINDS: GlyphKind[] = ["base", "vowel", "carrier", "mark", "punctuation"];
const ALL_BLOCKS: UnicodeBlockId[] = [
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

type BlockFilter = "all" | "annotated" | UnicodeBlockId;

interface ResolvedCellInfo {
  codepoint: number;
  annotation: GlyphAnnotation | null;
  label: string;
  kind: GlyphKind;
  phonemes: string[];
  compositionText: string;
  annotated: boolean;
  inFont: boolean;
}

function normalizeToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed === "∅" || trimmed === "Ø") return EMPTY_SET_SYMBOL;
  return trimmed;
}

function placePopover(rect: DOMRect): { top: number; left: number } {
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

function kindLabel(t: TFunction, kind: GlyphKind): string {
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

function blockLabel(t: TFunction, block: UnicodeBlockId): string {
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

function safeFromCodePoint(codepoint: number): string {
  if (!Number.isInteger(codepoint) || codepoint < 0 || codepoint > 0x10ffff) return "";
  try {
    return String.fromCodePoint(codepoint);
  } catch {
    return "";
  }
}

function glyphText(codepoint: number): string {
  const character = safeFromCodePoint(codepoint);
  return isCombiningMark(codepoint) ? `\u25CC${character}` : character;
}

function representative(codepoints: number[]): number {
  const lower = codepoints.find((code) => {
    const text = safeFromCodePoint(code);
    return text.length > 0 && text.toLowerCase() === text && text.toUpperCase() !== text;
  });
  return lower ?? codepoints[0] ?? 0;
}

function asKind(value: string): GlyphKind {
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

async function copyCharacter(character: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(character);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = character;
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

export function GlyphPanel() {
  const { t } = useTranslation();
  const { inspection, loading, error } = useFontInspection();
  const config = usePhonoStore((state) => state.config);
  const setGlyphAnnotations = usePhonoStore((state) => state.setGlyphAnnotations);
  const projectPath = useWorkspaceStore((state) => state.projectPath);
  const activeLanguageId = useWorkspaceStore((state) => state.activeLanguageId);
  const workspaceLanguages = useWorkspaceStore((state) => state.config.languages);

  const annotations = config.glyph_annotations ?? [];

  const inventory = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const token of [
      ...config.phoneme_inventory.consonants,
      ...config.phoneme_inventory.vowels,
    ]) {
      const trimmed = token.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        result.push(trimmed);
      }
    }
    return result;
  }, [config.phoneme_inventory.consonants, config.phoneme_inventory.vowels]);

  const [parentSource, setParentSource] = useState<{
    name: string;
    annotations: GlyphAnnotation[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const activeLang = workspaceLanguages.find((l) => l.language_id === activeLanguageId);
    if (!projectPath || !activeLang?.parent_id) {
      setParentSource(null);
      return;
    }
    (async () => {
      const seen = new Set<string>([activeLang.language_id]);
      let currId: string | null = activeLang.parent_id;
      while (currId && !seen.has(currId)) {
        seen.add(currId);
        const parentEntry = workspaceLanguages.find((l) => l.language_id === currId);
        if (!parentEntry) break;
        try {
          const parentPhono = await invoke<PhonologyConfig>("load_phonology", {
            projectPath,
            languagePath: parentEntry.path,
          });
          if (cancelled) return;
          const parentNotes = parentPhono.glyph_annotations ?? [];
          if (parentNotes.length > 0) {
            setParentSource({ name: parentEntry.name, annotations: parentNotes });
            return;
          }
        } catch {
          // Ignore and continue walking up
        }
        currId = parentEntry.parent_id;
      }
      if (!cancelled) setParentSource(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, activeLanguageId, workspaceLanguages]);

  const [query, setQuery] = useState("");
  const [blockFilter, setBlockFilter] = useState<BlockFilter>("all");
  const [page, setPage] = useState(0);
  const [selectedCell, setSelectedCell] = useState<number[] | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const fontCodeSet = useMemo(
    () => new Set(inspection?.present ? inspection.codepoints : []),
    [inspection],
  );

  const annotationByCodepoint = useMemo(() => {
    const map = new Map<number, GlyphAnnotation>();
    for (const item of annotations) {
      map.set(item.codepoint, item);
    }
    return map;
  }, [annotations]);

  const glyphCells = useMemo(() => {
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
      ...[...extra].sort((left, right) => left - right).map((code) => [code]),
    ];
    cells.sort((left, right) => left[0] - right[0]);
    return cells;
  }, [inspection, annotations]);

  const presentBlocks = useMemo(() => {
    const found = new Set<UnicodeBlockId>();
    for (const cell of glyphCells) {
      found.add(unicodeBlockId(representative(cell)));
    }
    return ALL_BLOCKS.filter((block) => found.has(block));
  }, [glyphCells]);

  useEffect(() => {
    if (
      blockFilter !== "all" &&
      blockFilter !== "annotated" &&
      !presentBlocks.includes(blockFilter)
    ) {
      setBlockFilter("all");
    }
  }, [blockFilter, presentBlocks]);

  const resolveCellInfo = (cell: number[]): ResolvedCellInfo => {
    const codepoint = representative(cell);
    const inFont = cell.some((code) => fontCodeSet.has(code));
    const found = cell.map((code) => annotationByCodepoint.get(code)).find(Boolean) ?? null;
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
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const compact = needle.replace(/^u\+/, "");
    const asCode = Boolean(needle) && /^[0-9a-f]{2,6}$/.test(compact) && /\d/.test(compact);
    const needleChars = !needle || asCode ? null : new Set(charactersOf(needle));

    return glyphCells.filter((cell) => {
      const info = resolveCellInfo(cell);
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
          (code) => formatCodepoint(code).toLowerCase().replace("u+", "") === compact,
        );
      }
      if (needleChars && cell.some((code) => needleChars.has(safeFromCodePoint(code)))) {
        return true;
      }
      if (!info.annotated) return false;
      if (info.label.toLowerCase().includes(needle)) return true;
      if (info.compositionText.toLowerCase().includes(needle)) return true;
      if (info.phonemes.join(" ").toLowerCase().includes(needle)) return true;
      return false;
    });
  }, [glyphCells, query, blockFilter, annotationByCodepoint, fontCodeSet]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const selectedCode = selectedCell ? representative(selectedCell) : null;

  const onCopy = async (codepoint: number) => {
    const ok = await copyCharacter(safeFromCodePoint(codepoint));
    setCopyFailed(!ok);
    setCopied(ok ? codepoint : null);
    if (ok) {
      window.setTimeout(() => {
        setCopied((current) => (current === codepoint ? null : current));
      }, 1200);
    }
  };

  const closePopover = () => {
    anchorRef.current = null;
    setPopoverPos(null);
    setSelectedCell(null);
  };

  const selectCell = (cell: number[], element: HTMLElement) => {
    anchorRef.current = element;
    setSelectedCell(cell);
    setPopoverPos(placePopover(element.getBoundingClientRect()));
  };

  const popoverOpen = selectedCell !== null;

  useEffect(() => {
    if (!popoverOpen) return;
    const update = () => {
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
  }, [popoverOpen, selectedCell]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-annotate-anchor]")) return;
      closePopover();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePopover();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  const syncFromParent = () => {
    if (!parentSource) return;
    const current = usePhonoStore.getState().config.glyph_annotations ?? [];
    const byCode = new Map<number, GlyphAnnotation>();
    for (const item of current) {
      byCode.set(item.codepoint, item);
    }
    for (const parentItem of parentSource.annotations) {
      const existing = byCode.get(parentItem.codepoint);
      if (!existing) {
        byCode.set(parentItem.codepoint, { ...parentItem });
      } else {
        byCode.set(parentItem.codepoint, {
          ...existing,
          label: existing.label || parentItem.label,
          kind: existing.kind ?? parentItem.kind,
          phonemes:
            existing.phonemes && existing.phonemes.length > 0
              ? existing.phonemes
              : parentItem.phonemes,
        });
      }
    }
    const merged = [...byCode.values()].sort((a, b) => a.codepoint - b.codepoint);
    setGlyphAnnotations(merged);
    closePopover();
  };

  const saveCellAnnotation = (
    cell: number[],
    patch: {
      label: string;
      kind: GlyphKind;
      phonemes: string[];
    },
  ) => {
    const primaryCode = representative(cell);
    const cellSet = new Set(cell);
    const current = usePhonoStore.getState().config.glyph_annotations ?? [];
    const normalizedPhonemes = patch.phonemes.map(normalizeToken).filter(Boolean);

    const rest = current.filter((item) => !cellSet.has(item.codepoint));

    const nextItem: GlyphAnnotation = {
      codepoint: primaryCode,
      label: patch.label,
      kind: patch.kind,
      ...(normalizedPhonemes.length > 0 ? { phonemes: normalizedPhonemes } : {}),
    };

    const next = [...rest, nextItem].sort((a, b) => a.codepoint - b.codepoint);
    setGlyphAnnotations(next);
  };

  const clearCellAnnotation = (cell: number[]) => {
    const cellSet = new Set(cell);
    const current = usePhonoStore.getState().config.glyph_annotations ?? [];
    const next = current.filter((item) => !cellSet.has(item.codepoint));
    setGlyphAnnotations(next);
    closePopover();
  };

  if (loading && !inspection && annotations.length === 0) {
    return (
      <div className="p-6 flex-1 bg-base-100">
        <span className="loading loading-spinner loading-md" />
        <span className="ml-2 text-sm">{t("writing.loading")}</span>
      </div>
    );
  }

  const showGrid = filtered.length > 0;
  const showEmptyFont = glyphCells.length === 0;

  return (
    <div className="p-6 space-y-4 overflow-y-auto flex-1 bg-base-100">
      {error && !inspection && (
        <div role="alert" className="alert alert-warning alert-soft text-xs py-2">
          {t("writing.loadFailed")}
          {error ? ` ${error}` : ""}
        </div>
      )}

      <section className={CARD}>
        <div className={`${CARD_BODY} gap-3`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-0.5 max-w-2xl">
              <h2 className={`${SECTION_HEADER} mb-0`}>{t("writing.glyphsTab")}</h2>
              <p className="text-xs text-base-content/60">{t("writing.glyphsHint")}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {parentSource && (
                <button
                  type="button"
                  className={BTN_GHOST}
                  onClick={syncFromParent}
                  title={t("writing.syncParentHint")}
                  data-testid="sync-parent-annotations"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t("writing.syncParent", { name: parentSource.name })}
                </button>
              )}

              {glyphCells.length > 0 && (
                <select
                  className="select select-sm bg-base-200/30 border-base-300 focus:border-primary focus:outline-none"
                  value={blockFilter}
                  data-testid="glyph-block-filter"
                  onChange={(event) => {
                    setBlockFilter(event.target.value as BlockFilter);
                    setPage(0);
                  }}
                >
                  <option value="all">{t("writing.filterAll")}</option>
                  {annotations.length > 0 && (
                    <option value="annotated">{t("writing.filterAnnotated")}</option>
                  )}
                  {presentBlocks.map((block) => (
                    <option key={block} value={block}>
                      {blockLabel(t, block)}
                    </option>
                  ))}
                </select>
              )}

              {glyphCells.length > 0 && (
                <span className="text-xs font-mono text-base-content/50">
                  {t("writing.showing", { shown: filtered.length, total: glyphCells.length })}
                </span>
              )}

              <input
                className="input input-sm w-60 bg-base-200/30 border-base-300 focus:border-primary focus:outline-none"
                value={query}
                placeholder={t("writing.search")}
                data-testid="glyph-search"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </div>
          </div>

          {copyFailed && (
            <p className="text-xs text-error" data-testid="glyph-copy-failed">
              {t("writing.copyFailed")}
            </p>
          )}

          {showEmptyFont ? (
            <p className="text-xs text-base-content/60 py-4">
              {inspection?.present ? t("writing.emptyGlyphs") : t("writing.noFontGlyphs")}
            </p>
          ) : glyphCells.length > 0 && filtered.length === 0 ? (
            <p className="text-xs text-base-content/60 py-4">{t("writing.noMatches")}</p>
          ) : showGrid ? (
            <div
              className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-2"
              data-testid="glyph-grid"
            >
              {visible.map((cell) => {
                const info = resolveCellInfo(cell);
                const { codepoint, label, compositionText, annotated, inFont } = info;
                const selected = selectedCell !== null && cell.includes(selectedCode ?? -1);
                const note =
                  codepoint === 0x20
                    ? t("writing.space")
                    : codepoint === 0x00a0
                      ? t("writing.nbsp")
                      : null;
                return (
                  <button
                    key={cell[0]}
                    type="button"
                    title={!inFont && inspection?.present ? t("writing.notInFont") : undefined}
                    className={`rounded-lg border px-1.5 py-2 flex flex-col items-center gap-0.5 min-w-0 overflow-hidden transition-colors cursor-pointer ${
                      selected
                        ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                        : annotated
                          ? "border-base-300 bg-base-100 hover:border-primary/60"
                          : "border-base-200 bg-base-200/20 hover:border-base-300"
                    } ${!inFont && inspection?.present ? "opacity-60 border-dashed" : ""}`}
                    data-testid="glyph-cell"
                    data-annotate-anchor
                    data-cp={codepoint}
                    aria-pressed={selected}
                    onClick={(event) => selectCell(cell, event.currentTarget)}
                  >
                    <span
                      className={`conlang-script text-2xl leading-none min-h-8 min-w-6 flex items-center justify-center ${
                        codepoint === 0x20 || codepoint === 0x00a0
                          ? "border-b border-dashed border-base-content/30"
                          : ""
                      }`}
                    >
                      {glyphText(codepoint)}
                    </span>
                    <span
                      className={`text-xs truncate max-w-full ${
                        label ? "font-medium text-base-content" : "text-base-content/40"
                      }`}
                      data-testid="glyph-label"
                    >
                      {label || note || t("writing.unassigned")}
                    </span>
                    <span
                      className="text-[10px] font-mono text-primary/80 truncate max-w-full min-h-3"
                      data-testid="glyph-composition"
                    >
                      {compositionText || "\u00a0"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {pageCount > 1 && showGrid && (
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                className={BTN_GHOST}
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                {t("writing.prev")}
              </button>
              <span className="text-xs font-mono text-base-content/60">
                {t("writing.page", { page: safePage + 1, pages: pageCount })}
              </span>
              <button
                className={BTN_GHOST}
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
              >
                {t("writing.next")}
              </button>
            </div>
          )}
        </div>
      </section>

      {popoverOpen &&
        popoverPos &&
        selectedCell &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-50 max-h-[min(24rem,calc(100vh-1rem))] w-[280px] overflow-y-auto rounded-xl border border-base-300 bg-base-100 p-3 shadow-xl"
            style={{ top: popoverPos.top, left: popoverPos.left }}
            data-testid="glyph-popover"
          >
            <GlyphAnnotationPopover
              key={selectedCell.join(",")}
              cell={selectedCell}
              info={resolveCellInfo(selectedCell)}
              annotations={annotations}
              inventory={inventory}
              copied={copied === selectedCode}
              onCopy={() => {
                if (selectedCode !== null) void onCopy(selectedCode);
              }}
              onClose={closePopover}
              onSave={(patch) => saveCellAnnotation(selectedCell, patch)}
              onClear={() => clearCellAnnotation(selectedCell)}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

function GlyphAnnotationPopover({
  cell,
  info,
  annotations,
  inventory,
  copied,
  onCopy,
  onClose,
  onSave,
  onClear,
}: {
  cell: number[];
  info: ResolvedCellInfo;
  annotations: GlyphAnnotation[];
  inventory: string[];
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  onSave: (patch: { label: string; kind: GlyphKind; phonemes: string[] }) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(info.label);
  const [kind, setKind] = useState<GlyphKind>(info.kind);
  const [phonemes, setPhonemes] = useState<string[]>(info.phonemes);

  useEffect(() => {
    setLabel(info.label);
    setKind(info.kind);
    setPhonemes(info.phonemes);
  }, [info.label, info.kind, info.phonemes.join("\0")]);

  const availablePhonemes = useMemo(() => {
    const set = new Set<string>(inventory);
    for (const item of annotations) {
      for (const p of item.phonemes ?? []) {
        const norm = normalizeToken(p);
        if (norm && norm !== EMPTY_SET_SYMBOL) set.add(norm);
      }
    }
    return [...set];
  }, [inventory, annotations]);

  const commitIfAnnotated = (next: {
    label?: string;
    kind?: GlyphKind;
    phonemes?: string[];
  }) => {
    if (info.annotated) {
      onSave({
        label: next.label ?? label,
        kind: next.kind ?? kind,
        phonemes: next.phonemes ?? phonemes,
      });
    }
  };

  const appendToken = (token: string) => {
    const next = [...phonemes, token];
    setPhonemes(next);
    commitIfAnnotated({ phonemes: next });
  };

  const removeTokenAt = (index: number) => {
    const next = phonemes.filter((_, idx) => idx !== index);
    setPhonemes(next);
    commitIfAnnotated({ phonemes: next });
  };

  const clearTokens = () => {
    setPhonemes([]);
    commitIfAnnotated({ phonemes: [] });
  };

  const formattedCodes = cell.map((code) => formatCodepoint(code)).join(" ");
  const previewComposition = phonemes.length > 0 ? `[${phonemes.join("")}]` : "";

  return (
    <form
      className="space-y-2.5 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          label: label.trim() || safeFromCodePoint(info.codepoint),
          kind,
          phonemes,
        });
      }}
    >
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-base-200">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg border border-base-300 bg-base-200/60 flex items-center justify-center shrink-0">
            <span className="conlang-script text-2xl leading-none">
              {glyphText(info.codepoint)}
            </span>
          </div>
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <span
                className="font-mono text-[11px] text-base-content/70 truncate select-all"
                data-testid="glyph-encoding-readonly"
              >
                {formattedCodes}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square h-5 w-5 min-h-0 text-base-content/60 hover:text-base-content"
                onClick={onCopy}
                title={copied ? t("writing.copied") : t("writing.copyGlyph")}
              >
                <Copy className="w-3 h-3" />
              </button>
              {copied && (
                <span className="text-[10px] text-success whitespace-nowrap">
                  {t("writing.copied")}
                </span>
              )}
            </div>
            {previewComposition && (
              <span
                className="font-mono text-[11px] font-semibold text-primary leading-tight"
                data-testid="glyph-composition-preview"
              >
                {previewComposition}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-xs btn-ghost btn-square h-6 w-6 min-h-0 shrink-0"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-[6.25rem_minmax(0,1fr)] gap-2 items-start">
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-[11px] font-medium text-base-content/70 leading-4">
            {t("writing.glyphKind")}
          </span>
          <select
            className="select select-xs w-full bg-base-200/30 border-base-300 focus:border-primary focus:outline-none"
            value={kind}
            data-testid="glyph-kind"
            onChange={(event) => {
              const nextKind = asKind(event.target.value);
              setKind(nextKind);
              commitIfAnnotated({ kind: nextKind });
            }}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(t, k)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 min-w-0" title={t("writing.romanMappingHint")}>
          <span className="text-[11px] font-medium text-base-content/70 leading-4">
            {t("writing.romanMapping")}
          </span>
          <input
            name="label"
            className="input input-xs w-full bg-base-200/30 border-base-300 focus:border-primary focus:outline-none"
            value={label}
            placeholder="s, c"
            autoFocus={!info.annotated}
            data-testid="glyph-roman-input"
            onChange={(event) => {
              const nextLabel = event.target.value;
              setLabel(nextLabel);
              commitIfAnnotated({ label: nextLabel });
            }}
          />
        </label>
      </div>

      {kind !== "punctuation" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-base-content/70">
              {t("writing.composedUnits")}
            </span>
            {phonemes.length > 0 && (
              <button
                type="button"
                className="text-[11px] text-base-content/50 hover:text-error cursor-pointer"
                onClick={clearTokens}
              >
                {t("writing.clearComposition")}
              </button>
            )}
          </div>

          <div className="min-h-7 rounded-md border border-base-300 bg-base-200/40 px-1.5 py-1 flex flex-wrap items-center gap-1">
            {phonemes.length === 0 ? (
              <span className="text-[11px] text-base-content/40">
                {t("writing.compositionEmpty")}
              </span>
            ) : (
              phonemes.map((tok, index) => (
                <button
                  key={`${tok}-${index}`}
                  type="button"
                  className="badge badge-xs badge-primary gap-0.5 font-mono cursor-pointer py-2"
                  data-testid="glyph-composition-chip"
                  onClick={() => removeTokenAt(index)}
                  title={t("common.delete")}
                >
                  {tok} ×
                </button>
              ))
            )}
          </div>

          <div
            className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1 rounded-md border border-base-200 bg-base-200/20"
            title={t("writing.compositionHint")}
          >
            <button
              type="button"
              className="px-1.5 py-0.5 text-[11px] font-mono rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer"
              data-testid="compose-token-empty"
              onClick={() => appendToken(EMPTY_SET_SYMBOL)}
            >
              {t("writing.emptySet")}
            </button>
            {availablePhonemes.map((phoneme) => (
              <button
                key={phoneme}
                type="button"
                className="px-1.5 py-0.5 text-[11px] font-mono rounded border border-base-300 bg-base-100 hover:border-primary hover:text-primary cursor-pointer min-w-5 text-center"
                data-testid="compose-token"
                onClick={() => appendToken(phoneme)}
              >
                {phoneme}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end pt-1 border-t border-base-200">
        {!info.annotated ? (
          <button
            className="btn btn-xs btn-primary w-full"
            type="submit"
            data-testid="glyph-annotate"
          >
            {t("writing.annotate")}
          </button>
        ) : (
          <button
            className="btn btn-xs btn-ghost text-error whitespace-nowrap gap-1 h-6 min-h-0 px-2"
            type="button"
            data-testid="glyph-clear"
            onClick={onClear}
          >
            <Trash2 className="w-3 h-3" />
            {t("writing.clearMark")}
          </button>
        )}
      </div>
    </form>
  );
}
