import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Ruler, ScanLine } from "lucide-react";
import type {
  DistributionStats,
  FontGeometryAuditResult,
  FontMetricsInput,
  GeometryIssueKind,
} from "../../core/engines/fontGeometryAudit";
import { auditLanguageFont } from "../../utils/harfbuzzClient";
import { useGeometryIssueLabels } from "../../lib/labelMaps";
import { usePhonoStore } from "../../store/phonoStore";
import type { GlyphAnnotation } from "../../types";
import { BADGE, BTN_GHOST, CARD, CARD_BODY, SECTION_HEADER } from "../../lib/ui";

export interface GeometryOverlay {
  showRulers: boolean;
  metrics: FontMetricsInput | null;
  /** 命中筛选的字形码位；null = 不过滤 */
  flagged: Set<number> | null;
}

interface GlyphGeometryInspectorProps {
  projectPath: string;
  conlangFilePath: string;
  languageId: string;
  onChange: (overlay: GeometryOverlay) => void;
}

const FILTER_KINDS: GeometryIssueKind[] = [
  "ascender_misaligned",
  "baseline_drift",
  "mark_gap_too_large",
  "stem_too_thin",
  "weight_uneven",
];

const EMPTY_ANNOTATIONS: GlyphAnnotation[] = [];

/** 把分布统计渲染成百分比阅读文本 */
function formatPercent(stats: DistributionStats | null): string {
  if (!stats) return "—";
  return `${(stats.mean * 100).toFixed(1)}%`;
}

export function GlyphGeometryInspector({
  projectPath,
  conlangFilePath,
  languageId,
  onChange,
}: GlyphGeometryInspectorProps) {
  const { t } = useTranslation();
  const issueLabels = useGeometryIssueLabels();
  const config = usePhonoStore((state) => state.config);
  const annotations = config.glyph_annotations ?? EMPTY_ANNOTATIONS;
  const [result, setResult] = useState<FontGeometryAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showRulers, setShowRulers] = useState(false);
  const [activeKinds, setActiveKinds] = useState<Set<GeometryIssueKind>>(new Set());

  useEffect(() => {
    if (!projectPath || !conlangFilePath || !languageId) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    auditLanguageFont({
      projectPath,
      conlangFilePath,
      languageId,
      glyphAnnotations: annotations,
    })
      .then((audit) => {
        if (cancelled) return;
        setResult(audit);
        setFailed(audit === null);
      })
      .catch((error) => {
        console.warn(`Font geometry audit failed: ${error}`);
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, conlangFilePath, languageId, annotations]);

  const flagged = useMemo(() => {
    if (!result || activeKinds.size === 0) return null;
    const codepoints = new Set<number>();
    for (const row of result.rows) {
      if (!row.issues.some((issue) => activeKinds.has(issue.kind))) continue;
      for (const codepoint of row.codepoints) codepoints.add(codepoint);
    }
    return codepoints;
  }, [result, activeKinds]);

  const metrics = result?.metrics ?? null;

  useEffect(() => {
    onChange({ showRulers, metrics, flagged });
  }, [onChange, showRulers, metrics, flagged]);

  const toggleKind = (kind: GeometryIssueKind): void => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  return (
    <section className={CARD} data-testid="glyph-geometry-inspector">
      <div className={`${CARD_BODY} gap-3`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className={`${SECTION_HEADER} mb-0 flex items-center gap-2`}>
              <ScanLine className="w-4 h-4 text-primary" />
              {t("writing.geometry.title")}
            </h2>
            <p className="text-xs text-base-content/60">{t("writing.geometry.desc")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={showRulers ? `${BTN_GHOST} btn-active text-primary` : BTN_GHOST}
              onClick={() => setShowRulers((value) => !value)}
              disabled={loading || !metrics}
              title={!metrics ? t("writing.geometry.rulersUnavailable") : undefined}
              aria-pressed={showRulers}
              data-testid="toggle-glyph-rulers"
            >
              <Ruler className="w-3.5 h-3.5" />
              {t("writing.geometry.showRulers")}
            </button>
            {showRulers && metrics && (
              <span className={`${BADGE} badge-primary badge-sm`}>
                {t("writing.geometry.rulersOn")}
              </span>
            )}
            {activeKinds.size > 0 && (
              <button
                type="button"
                className={BTN_GHOST}
                onClick={() => setActiveKinds(new Set())}
              >
                {t("writing.geometry.clearFilter")}
              </button>
            )}
          </div>
        </div>

        {loading && (
          <p className="text-xs text-base-content/60">
            <span className="loading loading-spinner loading-xs mr-2" />
            {t("writing.geometry.loading")}
          </p>
        )}

        {failed && !loading && (
          <p className="text-xs text-base-content/60 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {t("writing.geometry.unavailable")}
          </p>
        )}

        {result && !loading && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`${BADGE} badge-ghost`}>
                {t("writing.geometry.audited", { count: result.summary.analyzedCount })}
              </span>
              <span
                className={`${BADGE} ${
                  result.summary.flaggedCount > 0 ? "badge-warning" : "badge-success"
                }`}
              >
                {t("writing.geometry.flagged", { count: result.summary.flaggedCount })}
              </span>
              {metrics && (
                <span className={`${BADGE} badge-ghost font-mono`}>
                  upm {metrics.upm} · x {metrics.xHeight} · cap {metrics.capHeight}
                </span>
              )}
            </div>

            <div
              className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono rounded-md border border-base-200 bg-base-200/20 px-2 py-1.5"
              data-testid="geometry-width-stats"
            >
              <span className="text-base-content/60">
                {t("writing.geometry.baseWidthRatio")}
              </span>
              <span className="text-right">
                {formatPercent(result.widthStats.baseAdvanceRatio)}
              </span>
              <span className="text-base-content/60">
                {t("writing.geometry.markWidthRatio")}
              </span>
              <span className="text-right">
                {formatPercent(result.widthStats.markAdvanceRatio)}
              </span>
              <span className="text-base-content/60">
                {t("writing.geometry.sideBearings")}
              </span>
              <span className="text-right">
                {formatPercent(result.widthStats.lsb)} /{" "}
                {formatPercent(result.widthStats.rsb)}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {FILTER_KINDS.map((kind) => {
                const count = result.summary.issueCounts[kind];
                const active = activeKinds.has(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={count === 0}
                    onClick={() => toggleKind(kind)}
                    className={`btn btn-xs ${active ? "btn-warning" : "btn-ghost"} ${
                      count === 0 ? "opacity-40" : ""
                    }`}
                    data-testid={`geometry-filter-${kind}`}
                  >
                    {issueLabels[kind]}
                    <span className="font-mono">{count}</span>
                  </button>
                );
              })}
            </div>

            {activeKinds.size > 0 && (
              <p className="text-[11px] text-base-content/60">
                {flagged && flagged.size > 0
                  ? t("writing.geometry.filterActive", { count: flagged.size })
                  : t("writing.geometry.filterEmpty")}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
