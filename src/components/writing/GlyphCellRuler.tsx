import React from "react";
import type { FontMetricsInput } from "../../core/engines/fontGeometryAudit";

const RULER_SIZE = 24;
const RULER_BASELINE = 30;
const RULER_WIDTH = 36;
const RULER_HEIGHT = 40;
/** 字宽（em）框在 SVG 内的左右边界 */
const TRACK_LEFT = 2;
const TRACK_WIDTH = 32;

interface GlyphCellRulerProps {
  char: string;
  metrics: FontMetricsInput;
  /** 左墨迹边界 = `GlyphAuditRow.inkMinX / upm` */
  lsbRatio?: number;
  /** 右墨迹边界 = `GlyphAuditRow.inkMaxX / upm` */
  rsbRatio?: number;
  /** 整体缩放倍数（单字放大检视使用），默认 1 */
  scale?: number;
  className?: string;
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

/** 带排版基准线的单字预览：Ascender / Cap / x-height / Baseline / Descender + LSB / RSB */
export const GlyphCellRuler: React.FC<GlyphCellRulerProps> = ({
  char,
  metrics,
  lsbRatio,
  rsbRatio,
  scale = 1,
  className,
}) => {
  const upm = metrics.upm || 1000;
  const yOf = (value: number): number => RULER_BASELINE - (value / upm) * RULER_SIZE;
  const horizontalLines = [
    { y: yOf(metrics.ascender), dashed: true },
    { y: yOf(metrics.capHeight), dashed: true },
    { y: yOf(metrics.xHeight), dashed: true },
    { y: RULER_BASELINE, dashed: false },
    { y: yOf(metrics.descender), dashed: true },
  ];
  const hasBearings = lsbRatio !== undefined || rsbRatio !== undefined;
  const leftLine = lsbRatio === undefined ? null : TRACK_LEFT + clampRatio(lsbRatio) * TRACK_WIDTH;
  const rightLine =
    rsbRatio === undefined ? null : TRACK_LEFT + clampRatio(rsbRatio) * TRACK_WIDTH;
  const top = yOf(metrics.ascender);
  const bottom = yOf(metrics.descender);

  return (
    <svg
      width={RULER_WIDTH * scale}
      height={RULER_HEIGHT * scale}
      viewBox={`0 0 ${RULER_WIDTH} ${RULER_HEIGHT}`}
      className={className ?? "min-h-8 text-base-content/25"}
      data-testid="glyph-cell-ruler"
      aria-hidden
    >
      <rect
        x={TRACK_LEFT}
        y={Math.min(top, bottom)}
        width={TRACK_WIDTH}
        height={Math.abs(bottom - top)}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.4}
        strokeOpacity={0.5}
      />
      {horizontalLines.map((line) => (
        <line
          key={`h-${line.y}`}
          x1={0}
          x2={RULER_WIDTH}
          y1={line.y}
          y2={line.y}
          stroke="currentColor"
          strokeWidth={line.dashed ? 0.6 : 1}
          strokeDasharray={line.dashed ? "2 2" : undefined}
        />
      ))}
      {hasBearings && (
        <>
          {leftLine !== null && (
            <line
              x1={leftLine}
              x2={leftLine}
              y1={top}
              y2={bottom}
              stroke="currentColor"
              strokeWidth={0.7}
              strokeDasharray="1 1"
              data-testid="glyph-ruler-lsb"
            />
          )}
          {rightLine !== null && (
            <line
              x1={rightLine}
              x2={rightLine}
              y1={top}
              y2={bottom}
              stroke="currentColor"
              strokeWidth={0.7}
              strokeDasharray="1 1"
              data-testid="glyph-ruler-rsb"
            />
          )}
        </>
      )}
      <text
        x={TRACK_LEFT + TRACK_WIDTH / 2}
        y={RULER_BASELINE}
        fontSize={RULER_SIZE}
        textAnchor="middle"
        fill="currentColor"
        className="conlang-script text-base-content"
      >
        {char}
      </text>
    </svg>
  );
};
