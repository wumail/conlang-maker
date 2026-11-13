import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import type { GlyphAnnotation, GlyphKind } from "../../types";
import { formatCodepoint } from "../../utils/unicodeBlocks";
import { GlyphPopoverHeader, GlyphZoomPreview } from "./GlyphZoomPreview";
import {
  asKind,
  EMPTY_SET_SYMBOL,
  glyphText,
  kindLabel,
  KINDS,
  normalizeToken,
  safeFromCodePoint,
  type ResolvedCellInfo,
} from "./glyphUtils";

interface GlyphAnnotationPopoverProps {
  cell: number[];
  info: ResolvedCellInfo;
  annotations: GlyphAnnotation[];
  inventory: string[];
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  onSave: (patch: {
    label: string;
    kind: GlyphKind;
    phonemes: string[];
  }) => void;
  onClear: () => void;
}

export const GlyphAnnotationPopover: React.FC<GlyphAnnotationPopoverProps> = ({
  cell,
  info,
  annotations,
  inventory,
  copied,
  onCopy,
  onClose,
  onSave,
  onClear,
}) => {
  const { t } = useTranslation();
  const [label, setLabel] = useState(info.label);
  const [kind, setKind] = useState<GlyphKind>(info.kind);
  const [phonemes, setPhonemes] = useState<string[]>(info.phonemes);
  const [zoomOpen, setZoomOpen] = useState(false);

  const joinedPhonemes = info.phonemes.join("\0");
  useEffect(() => {
    setLabel(info.label);
    setKind(info.kind);
    setPhonemes(info.phonemes);
  }, [info.label, info.kind, joinedPhonemes]);

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
  }): void => {
    if (info.annotated) {
      onSave({
        label: next.label ?? label,
        kind: next.kind ?? kind,
        phonemes: next.phonemes ?? phonemes,
      });
    }
  };

  const appendToken = (token: string): void => {
    const next = [...phonemes, token];
    setPhonemes(next);
    commitIfAnnotated({ phonemes: next });
  };

  const removeTokenAt = (index: number): void => {
    const next = phonemes.filter((_, idx) => idx !== index);
    setPhonemes(next);
    commitIfAnnotated({ phonemes: next });
  };

  const clearTokens = (): void => {
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
      <GlyphPopoverHeader
        codepoint={info.codepoint}
        formattedCodes={formattedCodes}
        previewComposition={previewComposition}
        copied={copied}
        onCopy={onCopy}
        onClose={onClose}
        onZoom={() => setZoomOpen(true)}
      />

      {zoomOpen && (
        <GlyphZoomPreview
          char={glyphText(info.codepoint)}
          codepoint={info.codepoint}
          onClose={() => setZoomOpen(false)}
        />
      )}

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

        <label
          className="flex flex-col gap-1 min-w-0"
          title={t("writing.romanMappingHint")}
        >
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
};
