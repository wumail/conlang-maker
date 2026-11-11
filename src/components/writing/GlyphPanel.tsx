import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Archive, GitBranch } from "lucide-react";
import { usePhonoStore } from "../../store/phonoStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { GlyphAnnotation } from "../../types";
import { unicodeBlockId, type UnicodeBlockId } from "../../utils/unicodeBlocks";
import { BADGE, BTN_PRIMARY } from "../../lib/ui";
import { useFontInspection } from "./FontInspectionContext";
import { GlyphAnnotationPopover } from "./GlyphAnnotationPopover";
import { GlyphGridSection } from "./GlyphGridSection";
import {
  ALL_BLOCKS,
  buildGlyphCells,
  copyCharacter,
  filterGlyphCells,
  mergeParentGlyphAnnotations,
  PAGE_SIZE,
  placePopover,
  representative,
  resolveCellInfoFromMap,
  safeFromCodePoint,
  upsertCellGlyphAnnotation,
  useParentGlyphSource,
  usePopoverDismissAndPosition,
  type BlockFilter,
  type ResolvedCellInfo,
} from "./glyphUtils";

export function GlyphPanel() {
  const { t } = useTranslation();
  const { inspection, loading, error } = useFontInspection();
  const config = usePhonoStore((state) => state.config);
  const annotationsSource = usePhonoStore((state) => state.annotationsSource);
  const annotationsOwnerId = usePhonoStore((state) => state.annotationsOwnerId);
  const legacyFieldsPresent = usePhonoStore((state) => state.legacyFieldsPresent);
  const localizeInheritedAnnotations = usePhonoStore(
    (state) => state.localizeInheritedAnnotations,
  );
  const setGlyphAnnotations = usePhonoStore((state) => state.setGlyphAnnotations);
  const projectPath = useWorkspaceStore((state) => state.projectPath);
  const activeLanguageId = useWorkspaceStore((state) => state.activeLanguageId);
  const workspaceLanguages = useWorkspaceStore((state) => state.config.languages);

  const annotations = config.glyph_annotations ?? [];
  const ownerLanguageName = useMemo(() => {
    if (!annotationsOwnerId) return "";
    return (
      workspaceLanguages.find((l) => l.language_id === annotationsOwnerId)?.name ??
      annotationsOwnerId
    );
  }, [annotationsOwnerId, workspaceLanguages]);

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

  const parentSource = useParentGlyphSource(
    projectPath,
    activeLanguageId,
    workspaceLanguages,
  );

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
    for (const item of annotations) map.set(item.codepoint, item);
    return map;
  }, [annotations]);

  const glyphCells = useMemo(
    () => buildGlyphCells(inspection, annotations),
    [inspection, annotations],
  );
  const presentBlocks = useMemo(() => {
    const found = new Set<UnicodeBlockId>();
    for (const cell of glyphCells) found.add(unicodeBlockId(representative(cell)));
    return ALL_BLOCKS.filter((block) => found.has(block));
  }, [glyphCells]);

  useEffect(() => {
    if (blockFilter !== "all" && blockFilter !== "annotated" && !presentBlocks.includes(blockFilter)) {
      setBlockFilter("all");
    }
  }, [blockFilter, presentBlocks]);

  const resolveCellInfo = (cell: number[]): ResolvedCellInfo =>
    resolveCellInfoFromMap(cell, annotationByCodepoint, fontCodeSet);

  const filtered = useMemo(
    () => filterGlyphCells(glyphCells, query, blockFilter, annotationByCodepoint, fontCodeSet),
    [glyphCells, query, blockFilter, annotationByCodepoint, fontCodeSet],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const selectedCode = selectedCell ? representative(selectedCell) : null;
  const popoverOpen = selectedCell !== null;

  const closePopover = useCallback((): void => {
    anchorRef.current = null;
    setPopoverPos(null);
    setSelectedCell(null);
  }, []);

  usePopoverDismissAndPosition(
    popoverOpen,
    selectedCell,
    anchorRef,
    popoverRef,
    setPopoverPos,
    closePopover,
  );

  if (loading && !inspection && annotations.length === 0) {
    return (
      <div className="p-6 flex-1 bg-base-100">
        <span className="loading loading-spinner loading-md" />
        <span className="ml-2 text-sm">{t("writing.loading")}</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-y-auto flex-1 bg-base-100">
      {error && !inspection && (
        <div role="alert" className="alert alert-warning alert-soft text-xs py-2">
          {t("writing.loadFailed")}
          {error ? ` ${error}` : ""}
        </div>
      )}

      {annotationsSource === "inherited" && (
        <div
          className="alert alert-info alert-soft py-2.5 px-3 text-xs flex flex-wrap items-center justify-between gap-2"
          data-testid="glyph-inherited-notice"
        >
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 shrink-0" />
            <span className={`${BADGE} badge-info`}>
              {t("writing.inheritedAnnotationsBadge", { name: ownerLanguageName })}
            </span>
            <span>
              {t("writing.inheritedAnnotationsHint", { name: ownerLanguageName })}
            </span>
          </div>
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={localizeInheritedAnnotations}
            data-testid="localize-parent-annotations"
          >
            {t("writing.localizeAnnotations")}
          </button>
        </div>
      )}

      {legacyFieldsPresent && (
        <div
          className="alert alert-soft py-2 px-3 text-xs flex items-center gap-2 border border-base-300"
          data-testid="glyph-legacy-notice"
        >
          <Archive className="w-4 h-4 shrink-0 text-base-content/60" />
          <span className="text-base-content/70">
            {t("writing.legacyWritingNotice")}
          </span>
        </div>
      )}

      <GlyphGridSection
        hasFontPresent={Boolean(inspection?.present)}
        parentSourceName={parentSource?.name ?? null}
        onSyncFromParent={() => {
          if (!parentSource) return;
          const current = usePhonoStore.getState().config.glyph_annotations ?? [];
          setGlyphAnnotations(mergeParentGlyphAnnotations(current, parentSource.annotations));
          closePopover();
        }}
        totalCellsCount={glyphCells.length}
        filteredCount={filtered.length}
        annotationsCount={annotations.length}
        presentBlocks={presentBlocks}
        blockFilter={blockFilter}
        onBlockFilterChange={(next) => {
          setBlockFilter(next);
          setPage(0);
        }}
        query={query}
        onQueryChange={(next) => {
          setQuery(next);
          setPage(0);
        }}
        copyFailed={copyFailed}
        visibleCells={visible}
        selectedCode={selectedCode}
        selectedCell={selectedCell}
        resolveCellInfo={resolveCellInfo}
        onSelectCell={(cell, el) => {
          anchorRef.current = el;
          setSelectedCell(cell);
          setPopoverPos(placePopover(el.getBoundingClientRect()));
        }}
        safePage={safePage}
        pageCount={pageCount}
        onPageChange={setPage}
      />

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
                if (selectedCode === null) return;
                void copyCharacter(safeFromCodePoint(selectedCode)).then((ok) => {
                  setCopyFailed(!ok);
                  setCopied(ok ? selectedCode : null);
                  if (ok) {
                    window.setTimeout(() => {
                      setCopied((cur) => (cur === selectedCode ? null : cur));
                    }, 1200);
                  }
                });
              }}
              onClose={closePopover}
              onSave={(patch) => {
                const current = usePhonoStore.getState().config.glyph_annotations ?? [];
                setGlyphAnnotations(upsertCellGlyphAnnotation(current, selectedCell, patch));
              }}
              onClear={() => {
                const cellSet = new Set(selectedCell);
                const current = usePhonoStore.getState().config.glyph_annotations ?? [];
                setGlyphAnnotations(current.filter((item) => !cellSet.has(item.codepoint)));
                closePopover();
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
