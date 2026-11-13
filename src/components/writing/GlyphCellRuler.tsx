import React from "react";
import type { FontMetricsInput } from "../../core/engines/fontGeometryAudit";

const RULER_SIZE = 24;
const RULER_BASELINE = 30;

interface GlyphCellRulerProps {
  char: string;
  metrics: FontMetricsInput;
}

/** 带排版基准线的单字预览：Ascender / Cap / x-height / Baseline / Descender */
export const GlyphCellRuler: React.FC<GlyphCellRulerProps> = ({ char, metrics }) => {
  const upm = metrics.upm || 1000;
  const yOf = (value: number): number => RULER_BASELINE - (value / upm) * RULER_SIZE;
  const lines = [
    { y: yOf(metrics.ascender), dashed: true },
    { y: yOf(metrics.capHeight), dashed: true },
    { y: yOf(metrics.xHeight), dashed: true },
    { y: RULER_BASELINE, dashed: false },
    { y: yOf(metrics.descender), dashed: true },
  ];

  return (
    <svg
      width={36}
      height={40}
      viewBox="0 0 36 40"
      className="min-h-8 text-base-content/25"
      aria-hidden
    >
      {lines.map((line) => (
        <line
          key={line.y}
          x1={0}
          x2={36}
          y1={line.y}
          y2={line.y}
          stroke="currentColor"
          strokeWidth={line.dashed ? 0.6 : 1}
          strokeDasharray={line.dashed ? "2 2" : undefined}
        />
      ))}
      <text
        x={18}
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
