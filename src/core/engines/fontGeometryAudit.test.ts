import { describe, expect, test } from "bun:test";
import {
  auditFontGeometry,
  inferFontMetrics,
  outlineToSubpaths,
  quantile,
  type GlyphOutlineInput,
  type PathCmd,
} from "./fontGeometryAudit";

const UPM = 1000;
const METRICS = {
  upm: UPM,
  ascender: 750,
  descender: -200,
  capHeight: 700,
  xHeight: 500,
};

/** 轴对齐矩形轮廓 */
function rect(x0: number, y0: number, x1: number, y1: number): PathCmd[] {
  return [
    { type: "M", values: [x0, y0] },
    { type: "L", values: [x1, y0] },
    { type: "L", values: [x1, y1] },
    { type: "L", values: [x0, y1] },
    { type: "Z", values: [] },
  ];
}

function glyph(
  gid: number,
  commands: PathCmd[],
  overrides: Partial<GlyphOutlineInput> = {},
): GlyphOutlineInput {
  return {
    gid,
    name: `g${gid}`,
    codepoints: [],
    advanceWidth: 620,
    commands,
    ...overrides,
  };
}

describe("outlineToSubpaths", () => {
  test("walks lines and closes the contour", () => {
    const subpaths = outlineToSubpaths(rect(0, 0, 100, 200));
    expect(subpaths).toHaveLength(1);
    expect(subpaths[0]).toHaveLength(5);
    expect(subpaths[0]![0]).toEqual(subpaths[0]![4]);
  });

  test("samples quadratic and cubic curves into 16 steps", () => {
    const quadratic: PathCmd[] = [
      { type: "M", values: [0, 0] },
      { type: "Q", values: [50, 100, 100, 0] },
      { type: "Z", values: [] },
    ];
    expect(outlineToSubpaths(quadratic)[0]).toHaveLength(18);

    const cubic: PathCmd[] = [
      { type: "M", values: [0, 0] },
      { type: "C", values: [10, 50, 90, 50, 100, 0] },
      { type: "Z", values: [] },
    ];
    const points = outlineToSubpaths(cubic)[0]!;
    expect(points).toHaveLength(18);
    // 三次曲线顶点处的对称性：中点 x 应约为 50
    expect(points[8]!.x).toBeCloseTo(50, 5);
  });
});

describe("quantile", () => {
  test("interpolates and handles empty", () => {
    expect(quantile([], 0.25)).toBeNull();
    expect(quantile([10], 0.25)).toBe(10);
    expect(quantile([0, 10], 0.25)).toBeCloseTo(2.5, 6);
  });
});

describe("inferFontMetrics", () => {
  test("falls back to glyph tops and upm ratios", () => {
    const metrics = inferFontMetrics(
      [glyph(1, rect(0, 0, 500, 700)), glyph(2, rect(0, 0, 500, 700))],
      UPM,
    );
    expect(metrics.capHeight).toBe(700);
    expect(metrics.xHeight).toBeCloseTo(504, 6);
    expect(metrics.ascender).toBe(750);
    expect(metrics.descender).toBe(-200);
  });

  test("honours explicit overrides", () => {
    const metrics = inferFontMetrics([], UPM, { capHeight: 680, xHeight: 480 });
    expect(metrics.capHeight).toBe(680);
    expect(metrics.xHeight).toBe(480);
  });
});

describe("auditFontGeometry", () => {
  test("flags a glyph whose top misses every metric band", () => {
    const result = auditFontGeometry({
      glyphs: [
        glyph(1, rect(50, 0, 550, 700)),
        glyph(2, rect(50, 0, 550, 700)),
        glyph(3, rect(50, 0, 550, 700)),
        glyph(4, rect(50, 0, 550, 800)),
      ],
      upm: UPM,
      metrics: METRICS,
    });
    const outlier = result.rows.find((row) => row.gid === 4)!;
    expect(outlier.issues.map((issue) => issue.kind)).toContain("ascender_misaligned");
    expect(result.rows.find((row) => row.gid === 1)?.issues).toHaveLength(0);
    expect(result.summary.issueCounts.ascender_misaligned).toBe(1);
  });

  test("flags baseline drift when the trunk bottom sinks", () => {
    const result = auditFontGeometry({
      glyphs: [
        glyph(1, rect(50, 0, 550, 700)),
        glyph(2, rect(50, -5, 550, 700)),
        glyph(3, rect(50, -120, 550, 700)),
      ],
      upm: UPM,
      metrics: METRICS,
    });
    const drifted = result.rows.find((row) => row.gid === 3)!;
    expect(drifted.mainYMin).toBe(-120);
    expect(drifted.issues.map((issue) => issue.kind)).toContain("baseline_drift");
    expect(result.rows.find((row) => row.gid === 2)?.issues).toHaveLength(0);
  });

  test("ignores deep descenders when computing the trunk bottom", () => {
    const withTail: PathCmd[] = [
      ...rect(50, 0, 550, 700),
      ...rect(50, -400, 150, 0),
    ];
    const result = auditFontGeometry({
      glyphs: [glyph(1, rect(50, 0, 550, 700)), glyph(2, withTail)],
      upm: UPM,
      metrics: METRICS,
    });
    expect(result.rows.find((row) => row.gid === 2)?.mainYMin).toBe(0);
    expect(result.rows.find((row) => row.gid === 2)?.yMin).toBe(-400);
  });

  test("measures the optical gap of an above-mark and flags it when floating", () => {
    const base = glyph(1, rect(0, 0, 500, 700));
    const mark = glyph(2, rect(200, 950, 300, 1000), { isMark: true });
    const okMark = glyph(3, rect(200, 710, 300, 760), { isMark: true });
    const result = auditFontGeometry({
      glyphs: [base, mark, okMark],
      upm: UPM,
      metrics: METRICS,
      markPairs: [
        { compositeGid: 10, baseGid: 1, markGid: 2 },
        { compositeGid: 11, baseGid: 1, markGid: 3 },
      ],
    });
    const far = result.rows.find((row) => row.gid === 2)!;
    expect(far.opticalGapX).toBe(250);
    expect(far.issues.map((issue) => issue.kind)).toContain("mark_gap_too_large");
    const near = result.rows.find((row) => row.gid === 3)!;
    expect(near.opticalGapX).toBe(10);
    expect(near.issues.map((issue) => issue.kind)).not.toContain("mark_gap_too_large");
    expect(result.summary.opticalGap?.count).toBe(2);
  });

  test("measures a side mark and flags an overlap", () => {
    const base = glyph(1, rect(0, 0, 500, 700));
    const overlapping = glyph(2, rect(480, 300, 560, 400), { isMark: true });
    const result = auditFontGeometry({
      glyphs: [base, overlapping],
      upm: UPM,
      metrics: METRICS,
      markPairs: [{ compositeGid: 20, baseGid: 1, markGid: 2 }],
    });
    const row = result.rows.find((item) => item.gid === 2)!;
    expect(row.opticalGapX).toBe(-20);
    expect(row.issues.map((issue) => issue.kind)).toContain("mark_gap_too_small");
  });

  test("flags thin stems and uneven weight", () => {
    const thin = glyph(1, rect(0, 0, 10, 700));
    const mixed = glyph(2, [...rect(0, 0, 20, 700), ...rect(30, 400, 600, 430)]);
    const solid = glyph(3, rect(0, 0, 600, 700));
    const result = auditFontGeometry({
      glyphs: [thin, mixed, solid],
      upm: UPM,
      metrics: METRICS,
    });
    const thinRow = result.rows.find((row) => row.gid === 1)!;
    expect(thinRow.stemQ1).toBeCloseTo(10, 6);
    expect(thinRow.issues.map((issue) => issue.kind)).toContain("stem_too_thin");

    const mixedRow = result.rows.find((row) => row.gid === 2)!;
    expect(mixedRow.issues.map((issue) => issue.kind)).toContain("weight_uneven");
    expect(result.rows.find((row) => row.gid === 3)?.issues).toHaveLength(0);
  });

  test("reports side bearings from the advance width", () => {
    const result = auditFontGeometry({
      glyphs: [glyph(1, rect(40, 0, 560, 700), { advanceWidth: 620 })],
      upm: UPM,
      metrics: METRICS,
    });
    const row = result.rows[0]!;
    expect(row.leftSideBearing).toBe(40);
    expect(row.rightSideBearing).toBe(60);
    expect(row.inkMinX).toBe(40);
    expect(row.inkMaxX).toBe(560);
  });

  test("handles empty glyphs without throwing", () => {
    const result = auditFontGeometry({
      glyphs: [glyph(1, [])],
      upm: UPM,
      metrics: METRICS,
    });
    expect(result.rows[0]?.issues).toHaveLength(0);
    expect(result.summary.analyzedCount).toBe(1);
  });
});
