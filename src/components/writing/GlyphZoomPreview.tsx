import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Maximize2, X } from "lucide-react";
import { ModalPortal } from "../common/ModalPortal";
import type { GlyphAnnotation } from "../../types";
import type {
  FontGeometryAuditResult,
  GlyphAuditRow,
} from "../../core/engines/fontGeometryAudit";
import { auditLanguageFont } from "../../utils/harfbuzzClient";
import { usePhonoStore } from "../../store/phonoStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { formatCodepoint } from "../../utils/unicodeBlocks";
import { BTN_GHOST_SQ, CARD, CARD_BODY } from "../../lib/ui";
import { glyphText } from "./glyphUtils";
import { GlyphCellRuler } from "./GlyphCellRuler";

const EMPTY_ANNOTATIONS: GlyphAnnotation[] = [];
const ZOOM_SCALE = 6;

interface GlyphPopoverHeaderProps {
  codepoint: number;
  formattedCodes: string;
  previewComposition: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  onZoom: () => void;
}

/** 标注弹窗头部：缩略字形、编码、复制 / 放大 / 关闭 */
export const GlyphPopoverHeader: React.FC<GlyphPopoverHeaderProps> = ({
  codepoint,
  formattedCodes,
  previewComposition,
  copied,
  onCopy,
  onClose,
  onZoom,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 pb-2 border-b border-base-200">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-9 h-9 rounded-lg border border-base-300 bg-base-200/60 flex items-center justify-center shrink-0">
          <span className="conlang-script text-2xl leading-none">
            {glyphText(codepoint)}
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
              className={`${BTN_GHOST_SQ} h-5 w-5 min-h-0 text-base-content/60 hover:text-base-content`}
              onClick={onCopy}
              title={copied ? t("writing.copied") : t("writing.copyGlyph")}
            >
              <Copy className="w-3 h-3" />
            </button>
            <button
              type="button"
              className={`${BTN_GHOST_SQ} h-5 w-5 min-h-0 text-base-content/60 hover:text-base-content`}
              onClick={onZoom}
              title={t("writing.geometry.showRulers")}
              aria-label={t("writing.geometry.showRulers")}
              data-testid="glyph-zoom-open"
            >
              <Maximize2 className="w-3 h-3" />
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
        className={`${BTN_GHOST_SQ} h-6 w-6 min-h-0 shrink-0`}
        onClick={onClose}
        aria-label={t("common.close")}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

interface GlyphZoomPreviewProps {
  char: string;
  codepoint: number;
  onClose: () => void;
}

/**
 * 单字放大检视弹窗：放大字形 + 完整排版标尺叠加层
 * （Ascender / Cap / x-height / Baseline / Descender + LSB / RSB 纵向虚线）。
 */
export const GlyphZoomPreview: React.FC<GlyphZoomPreviewProps> = ({
  char,
  codepoint,
  onClose,
}) => {
  const { t } = useTranslation();
  const config = usePhonoStore((state) => state.config);
  const projectPath = useWorkspaceStore((state) => state.projectPath);
  const conlangFilePath = useWorkspaceStore((state) => state.conlangFilePath);
  const activeLanguageId = useWorkspaceStore((state) => state.activeLanguageId);
  const annotations = config.glyph_annotations ?? EMPTY_ANNOTATIONS;
  const [audit, setAudit] = useState<FontGeometryAuditResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectPath || !conlangFilePath || !activeLanguageId) return;
    let cancelled = false;
    setLoading(true);
    auditLanguageFont({
      projectPath,
      conlangFilePath,
      languageId: activeLanguageId,
      glyphAnnotations: annotations,
    })
      .then((result) => {
        if (!cancelled) setAudit(result);
      })
      .catch((error) => {
        console.warn(`Glyph geometry audit failed: ${error}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, conlangFilePath, activeLanguageId, annotations]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const row: GlyphAuditRow | null = useMemo(() => {
    if (!audit) return null;
    return audit.rows.find((item) => item.codepoints.includes(codepoint)) ?? null;
  }, [audit, codepoint]);

  const metrics = audit?.metrics ?? null;
  const lsbRatio = row && metrics ? row.inkMinX / metrics.upm : undefined;
  const rsbRatio = row && metrics ? row.inkMaxX / metrics.upm : undefined;
  const widthRatioLabel =
    row?.glyphKind === "vowel" || row?.glyphKind === "mark"
      ? t("writing.geometry.markWidthRatio")
      : t("writing.geometry.baseWidthRatio");
  const inkWidthRatio =
    row && row.advanceWidth > 0
      ? ((row.inkMaxX - row.inkMinX) / row.advanceWidth) * 100
      : null;

  return (
    <ModalPortal open>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral/50 p-4"
        role="dialog"
        aria-modal="true"
        data-testid="glyph-zoom-preview"
        onClick={onClose}
      >
        <div
          className={`${CARD} w-[min(22rem,92vw)] shadow-xl`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={`${CARD_BODY} gap-3 p-4`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t("writing.geometry.title")}</p>
                <p className="font-mono text-[11px] text-base-content/60">
                  {formatCodepoint(codepoint)}
                </p>
              </div>
              <button
                type="button"
                className={`${BTN_GHOST_SQ} h-6 w-6 min-h-0`}
                onClick={onClose}
                aria-label={t("common.close")}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-center rounded-lg border border-base-200 bg-base-200/30 py-3 overflow-hidden">
              {metrics ? (
                <GlyphCellRuler
                  char={char}
                  metrics={metrics}
                  lsbRatio={lsbRatio}
                  rsbRatio={rsbRatio}
                  scale={ZOOM_SCALE}
                  className="text-base-content/70"
                />
              ) : (
                <span className="conlang-script text-6xl leading-none">{char}</span>
              )}
            </div>

            {loading && !metrics && (
              <p className="text-xs text-base-content/60">
                <span className="loading loading-spinner loading-xs mr-2" />
                {t("writing.geometry.loading")}
              </p>
            )}

            {row && metrics ? (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px] font-mono">
                <dt className="text-base-content/60">{widthRatioLabel}</dt>
                <dd className="text-right">
                  {inkWidthRatio === null ? "—" : `${inkWidthRatio.toFixed(1)}%`}
                </dd>
                <dt className="text-base-content/60">{t("writing.geometry.sideBearings")}</dt>
                <dd className="text-right">
                  {row.leftSideBearing} / {row.rightSideBearing}
                </dd>
                <dt className="text-base-content/60">upm</dt>
                <dd className="text-right">{metrics.upm}</dd>
              </dl>
            ) : (
              !loading && (
                <p className="text-xs text-base-content/60 flex items-center gap-1.5">
                  {t("writing.geometry.unavailable")}
                </p>
              )
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
