import { describe, expect, test } from "bun:test";
import {
  auditFontGeometry,
  clusterInkComponents,
  inferFontMetrics,
  outlineToSubpaths,
  quantile,
  resolveShapedMarkPair,
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

describe("gapByComposite key collision", () => {
  test("aggregates the minimum gap per target row instead of overwriting it", () => {
    const baseNarrow = glyph(1, rect(0, 0, 500, 700));
    const baseWide = glyph(2, rect(0, 0, 600, 700), { advanceWidth: 700 });
    const mark = glyph(3, rect(520, 300, 600, 400), { isMark: true });
    const result = auditFontGeometry({
      glyphs: [baseNarrow, baseWide, mark],
      upm: UPM,
      metrics: METRICS,
      markPairs: [
        { compositeGid: 90, baseGid: 1, markGid: 3 },
        { compositeGid: 91, baseGid: 2, markGid: 3 },
      ],
    });
    const markRow = result.rows.find((row) => row.gid === 3)!;
    // 350px 宽的窄基字净距 +20，宽基字净距 -80：必须保留更小的 -80
    expect(markRow.opticalGapX).toBe(-80);
    expect(markRow.issues.map((issue) => issue.kind)).toContain("mark_gap_too_small");
    // 组合字形不在审计集合内时，测量结果落在附标本体上，且只计一次
    expect(result.summary.opticalGap?.count).toBe(1);
  });

  test("attributes the gap to the composite glyph when that GID is audited", () => {
    const base = glyph(1, rect(0, 0, 500, 700));
    const mark = glyph(2, rect(520, 300, 600, 400), { isMark: true });
    const composite = glyph(90, rect(0, 0, 600, 700), {
      codepoints: [0x00e9],
      advanceWidth: 600,
    });
    const result = auditFontGeometry({
      glyphs: [base, mark, composite],
      upm: UPM,
      metrics: METRICS,
      markPairs: [{ compositeGid: 90, baseGid: 1, markGid: 2 }],
    });
    const compositeRow = result.rows.find((row) => row.gid === 90)!;
    expect(compositeRow.opticalGapX).toBe(20);
    expect(result.rows.find((row) => row.gid === 2)?.opticalGapX).toBeNull();
  });

  test("applies GPOS offsets to the shaped mark before measuring", () => {
    const base = glyph(1, rect(0, 0, 500, 700));
    const mark = glyph(2, rect(0, 300, 80, 400), { isMark: true });
    const result = auditFontGeometry({
      glyphs: [base, mark],
      upm: UPM,
      metrics: METRICS,
      markPairs: [
        { compositeGid: 90, baseGid: 1, markGid: 2, xOffset: 520, yOffset: 0 },
      ],
    });
    expect(result.rows.find((row) => row.gid === 2)?.opticalGapX).toBe(20);
  });
});

describe("single-glyph internal mark blocks", () => {
  test("clusters nested contours into one component", () => {
    const donut = [...rect(0, 0, 400, 700), ...rect(100, 150, 300, 550)];
    const components = clusterInkComponents(outlineToSubpaths(donut));
    expect(components).toHaveLength(1);
  });

  test("measures the clearance between a trunk and a detached right-side mark", () => {
    const inked = glyph(1, [...rect(0, 0, 400, 700), ...rect(420, 500, 500, 640)], {
      advanceWidth: 600,
    });
    const result = auditFontGeometry({
      glyphs: [inked],
      upm: UPM,
      metrics: METRICS,
    });
    const row = result.rows[0]!;
    expect(row.opticalGapX).toBe(20);
    expect(row.issues.map((issue) => issue.kind)).not.toContain("mark_gap_too_large");
  });

  test("flags a detached mark drawn too far to the right", () => {
    const inked = glyph(1, [...rect(0, 0, 400, 700), ...rect(560, 500, 620, 640)], {
      advanceWidth: 700,
    });
    const result = auditFontGeometry({
      glyphs: [inked],
      upm: UPM,
      metrics: METRICS,
    });
    const row = result.rows[0]!;
    expect(row.opticalGapX).toBe(160);
    expect(row.issues.map((issue) => issue.kind)).toContain("mark_gap_too_large");
  });

  test("ignores inner rings and punctuation glyphs", () => {
    const donut = glyph(1, [...rect(0, 0, 400, 700), ...rect(100, 150, 300, 550)]);
    const punct = glyph(2, [...rect(0, 0, 120, 700), ...rect(0, 600, 120, 700)], {
      glyphKind: "punctuation",
      advanceWidth: 400,
    });
    const result = auditFontGeometry({
      glyphs: [donut, punct],
      upm: UPM,
      metrics: METRICS,
    });
    expect(result.rows.every((row) => row.opticalGapX === null)).toBe(true);
  });
});

describe("annotation-driven classification", () => {
  test("excludes punctuation and marks from baseline and top statistics", () => {
    const result = auditFontGeometry({
      glyphs: [
        glyph(1, rect(0, 0, 400, 700)),
        glyph(2, rect(0, 0, 400, 700), { glyphKind: "carrier" }),
        glyph(3, rect(0, 0, 80, 950), { glyphKind: "punctuation", advanceWidth: 400 }),
        glyph(4, rect(200, 750, 300, 800), { glyphKind: "mark" }),
      ],
      upm: UPM,
      metrics: METRICS,
    });
    expect(result.summary.medianYMax).toBe(700);
    const punctRow = result.rows.find((row) => row.gid === 3)!;
    expect(punctRow.glyphKind).toBe("punctuation");
    expect(punctRow.issues.map((issue) => issue.kind)).not.toContain("ascender_misaligned");
    expect(punctRow.issues.map((issue) => issue.kind)).not.toContain("baseline_drift");
    const markRow = result.rows.find((row) => row.gid === 4)!;
    expect(markRow.issues.map((issue) => issue.kind)).not.toContain("ascender_misaligned");
  });

  test("treats annotated vowels as marks for the width statistics", () => {
    const result = auditFontGeometry({
      glyphs: [
        glyph(1, rect(0, 0, 400, 700), { glyphKind: "base" }),
        glyph(2, rect(100, 0, 500, 700), { glyphKind: "carrier" }),
        glyph(3, rect(300, 900, 400, 1000), { glyphKind: "vowel", advanceWidth: 400 }),
      ],
      upm: UPM,
      metrics: METRICS,
    });
    const vowelRow = result.rows.find((row) => row.gid === 3)!;
    expect(vowelRow.opticalGapX).toBeNull();
    expect(result.widthStats.baseAdvanceRatio?.count).toBe(2);
    expect(result.widthStats.markAdvanceRatio?.count).toBe(1);
    expect(result.widthStats.markAdvanceRatio?.mean).toBeCloseTo(0.25, 6);
  });
});

describe("widthStats", () => {
  test("reports advance ratios and side bearings per class", () => {
    const result = auditFontGeometry({
      glyphs: [
        glyph(1, rect(100, 0, 500, 500), { glyphKind: "base", advanceWidth: 600 }),
        glyph(2, rect(50, 0, 450, 500), { glyphKind: "carrier", advanceWidth: 600 }),
        glyph(3, rect(300, 900, 400, 1000), { glyphKind: "mark", advanceWidth: 400 }),
        glyph(4, rect(310, 900, 410, 1000), { glyphKind: "vowel", advanceWidth: 400 }),
        glyph(5, rect(0, 0, 300, 200), { glyphKind: "punctuation", advanceWidth: 500 }),
        glyph(6, [], { glyphKind: "base", advanceWidth: 0 }),
      ],
      upm: UPM,
      metrics: METRICS,
    });

    const base = result.widthStats.baseAdvanceRatio!;
    expect(base.count).toBe(2);
    expect(base.min).toBeCloseTo(2 / 3, 6);
    expect(base.max).toBeCloseTo(2 / 3, 6);
    expect(base.mean).toBeCloseTo(2 / 3, 6);
    expect(base.stdDev).toBeCloseTo(0, 6);

    const mark = result.widthStats.markAdvanceRatio!;
    expect(mark.count).toBe(2);
    expect(mark.mean).toBeCloseTo(0.25, 6);
    expect(mark.stdDev).toBeCloseTo(0, 6);

    const lsb = result.widthStats.lsb!;
    expect(lsb.count).toBe(2);
    expect(lsb.min).toBeCloseTo(0.05, 6);
    expect(lsb.max).toBeCloseTo(0.1, 6);
    expect(lsb.mean).toBeCloseTo(0.075, 6);
    expect(lsb.stdDev).toBeCloseTo(0.025, 6);

    const rsb = result.widthStats.rsb!;
    expect(rsb.count).toBe(2);
    expect(rsb.min).toBeCloseTo(0.1, 6);
    expect(rsb.max).toBeCloseTo(0.15, 6);
    expect(rsb.mean).toBeCloseTo(0.125, 6);
    expect(rsb.stdDev).toBeCloseTo(0.025, 6);
  });

  test("returns null distributions when no glyph of a class has ink", () => {
    const result = auditFontGeometry({
      glyphs: [glyph(1, rect(0, 0, 400, 700), { glyphKind: "base" })],
      upm: UPM,
      metrics: METRICS,
    });
    expect(result.widthStats.markAdvanceRatio).toBeNull();
    expect(result.widthStats.baseAdvanceRatio?.count).toBe(1);
  });
});

describe("resolveShapedMarkPair", () => {
  test("derives a ligature composite from a single shaped glyph", () => {
    expect(
      resolveShapedMarkPair(11, 22, [
        { gid: 77, xAdvance: 620, xOffset: 0, yOffset: 0 },
      ]),
    ).toEqual({ compositeGid: 77, baseGid: 11, markGid: 22 });
  });

  test("derives GPOS offsets from a two-glyph run", () => {
    expect(
      resolveShapedMarkPair(11, 22, [
        { gid: 11, xAdvance: 500, xOffset: 0, yOffset: 0 },
        { gid: 22, xAdvance: 0, xOffset: 40, yOffset: 120 },
      ]),
    ).toEqual({
      compositeGid: 11,
      baseGid: 11,
      markGid: 22,
      xOffset: 540,
      yOffset: 120,
    });
  });

  test("rejects notdef and multi-glyph runs", () => {
    expect(resolveShapedMarkPair(11, 22, [])).toBeNull();
    expect(
      resolveShapedMarkPair(11, 22, [
        { gid: 0, xAdvance: 500, xOffset: 0, yOffset: 0 },
        { gid: 22, xAdvance: 0, xOffset: 0, yOffset: 0 },
      ]),
    ).toBeNull();
    expect(
      resolveShapedMarkPair(11, 22, [
        { gid: 11, xAdvance: 500, xOffset: 0, yOffset: 0 },
        { gid: 22, xAdvance: 0, xOffset: 0, yOffset: 0 },
        { gid: 22, xAdvance: 0, xOffset: 0, yOffset: 0 },
      ]),
    ).toBeNull();
  });
});
