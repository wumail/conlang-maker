/**
 * fontGeometryAudit.ts — 字形几何与排版度量审计（T3.1 / F3.2 / F3.3）
 *
 * 100% 纯计算：不 import HarfBuzz / DOM / Node，只接收已离散化的字形轮廓。
 * 1. 上缘与主干底边相对字体度量带的偏差（上缘偏低 / 基线悬空）；
 * 2. 附标高度带内的真实右侧光学净距 `opticalGapX` 及其离散度；
 * 3. 40 条水平/垂直扫描线的笔画弦长 Q1，估算字重均匀度；
 * 4. 人造文字：单字内部离群附标子轮廓（同一字形内的分离连通块）净距；
 * 5. 横向宽度占比与左右边距（LSB / RSB）的分布一致性统计。
 */
import type { GlyphKind } from "../../types";

export interface PathCmd {
  type: string;
  values: number[];
}

export interface GlyphOutlineInput {
  gid: number;
  name?: string | null;
  codepoints?: number[];
  advanceWidth: number;
  commands: PathCmd[];
  /** 组合字形（预组合重音字母）标记，用于区分附标本体 */
  isMark?: boolean;
  /**
   * 来自 `PhonologyConfig.glyph_annotations` 的结构分类。
   * 人造文字的 base / carrier / vowel / mark / punctuation 无法从 Unicode
   * 组合区段推断，必须由标注显式给出。
   */
  glyphKind?: GlyphKind;
}

export interface FontMetricsInput {
  upm: number;
  ascender: number;
  /** 负值（基线以下） */
  descender: number;
  capHeight: number;
  xHeight: number;
}

export interface MarkPairInput {
  compositeGid: number;
  baseGid: number;
  markGid: number;
  /**
   * GPOS 定位结果：附标原点相对基字原点的水平位移
   * （等于 `base.x_advance + mark.x_offset`）。
   */
  xOffset?: number;
  /** GPOS 定位结果：附标原点相对基字原点的垂直位移（`mark.y_offset`）。 */
  yOffset?: number;
}

/** `hb.shape` 输出的单字形度量（供 GPOS / GSUB 配对使用） */
export interface ShapedGlyphMetrics {
  gid: number;
  xAdvance: number;
  xOffset: number;
  yOffset: number;
}

/**
 * 从 `hb.shape` 的输出推导 base + mark 的排版关系：
 * - 单个连字字形（GSUB 替换）→ 组合字形 GID；
 * - 两个字形（GPOS 定位）→ 附标相对基字原点的位移。
 */
export function resolveShapedMarkPair(
  baseGid: number,
  markGid: number,
  shaped: readonly ShapedGlyphMetrics[],
): MarkPairInput | null {
  if (shaped.length === 1) {
    const ligature = shaped[0]!;
    if (ligature.gid === 0) return null;
    return { compositeGid: ligature.gid, baseGid, markGid };
  }
  if (shaped.length !== 2) return null;
  const base = shaped[0]!;
  const mark = shaped[1]!;
  if (base.gid === 0 || mark.gid === 0) return null;
  return {
    compositeGid: base.gid,
    baseGid: base.gid,
    markGid: mark.gid,
    xOffset: base.xAdvance + mark.xOffset,
    yOffset: mark.yOffset,
  };
}

export type GeometryIssueKind =
  | "ascender_misaligned"
  | "baseline_drift"
  | "mark_gap_too_large"
  | "mark_gap_too_small"
  | "stem_too_thin"
  | "weight_uneven";

export interface GeometryIssue {
  kind: GeometryIssueKind;
  /** 实测值（upm 单位或比值，见 unit） */
  value: number;
  threshold: number;
  unit: "upm" | "ratio";
}

export interface GlyphAuditRow {
  gid: number;
  name: string | null;
  codepoints: number[];
  /** 解析后的字形结构分类（标注优先，其次 isMark 回退） */
  glyphKind: GlyphKind;
  advanceWidth: number;
  yMax: number;
  yMin: number;
  /** 剔除深降部轮廓后的主干底边 */
  mainYMin: number;
  inkMinX: number;
  inkMaxX: number;
  leftSideBearing: number;
  rightSideBearing: number;
  /** 水平扫描线弦长下四分位（近似竖笔粗细） */
  stemQ1: number | null;
  /** 垂直扫描线弦长下四分位（近似横笔粗细） */
  barQ1: number | null;
  /** 全部弦长离散系数 */
  weightCv: number | null;
  /** 附标高度带内的最小右侧净距（外部附标对或单字内部附标块） */
  opticalGapX: number | null;
  issues: GeometryIssue[];
}

export interface GeometryTolerances {
  /** 上缘相对 {xHeight, capHeight, ascender} 最近带的容差（×upm） */
  ascender: number;
  /** 主干底边相对字体基线中位数的容差（×upm） */
  baseline: number;
  /** 附标净距下限（×upm）：过小视为粘连 */
  markGapMin: number;
  /** 附标净距上限（×upm）：过大视为悬空 */
  markGapMax: number;
  /** 竖笔 Q1 绝对下限（×upm） */
  stemMin: number;
  /** 弦长离散系数上限 */
  weightCv: number;
}

export const DEFAULT_GEOMETRY_TOLERANCES: GeometryTolerances = {
  ascender: 0.03,
  baseline: 0.02,
  markGapMin: 0,
  markGapMax: 0.12,
  stemMin: 0.03,
  weightCv: 0.55,
};

export interface OpticalGapStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
}

export interface DistributionStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
}

export interface WidthConsistencyStats {
  /** base / carrier：`(inkMaxX - inkMinX) / advanceWidth` */
  baseAdvanceRatio: DistributionStats | null;
  /** vowel / mark：`(inkMaxX - inkMinX) / advanceWidth` */
  markAdvanceRatio: DistributionStats | null;
  /** 左墨迹边距占 upm 的比例（仅 base / carrier） */
  lsb: DistributionStats | null;
  /** 右墨迹边距占 upm 的比例（仅 base / carrier） */
  rsb: DistributionStats | null;
}

export interface FontGeometryAuditResult {
  metrics: FontMetricsInput;
  rows: GlyphAuditRow[];
  summary: {
    glyphCount: number;
    analyzedCount: number;
    flaggedCount: number;
    medianYMax: number;
    medianMainYMin: number;
    medianStemQ1: number | null;
    issueCounts: Record<GeometryIssueKind, number>;
    opticalGap: OpticalGapStats | null;
  };
  widthStats: WidthConsistencyStats;
}

export interface GeometryAuditOptions {
  glyphs: GlyphOutlineInput[];
  upm: number;
  /** 缺省项从字形集合推断 */
  metrics?: Partial<Omit<FontMetricsInput, "upm">>;
  markPairs?: MarkPairInput[];
  scanlineCount?: number;
  tolerances?: Partial<GeometryTolerances>;
}

interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 由若干闭合子路径聚成的连通墨迹块 */
export interface InkComponent {
  bounds: Bounds;
  subpaths: Point[][];
}

const BEZIER_STEPS = 16;

function num(values: number[], index: number): number {
  const value = values[index];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 把 SVG path 命令离散为闭合多边形子路径（顶点折线） */
export function outlineToSubpaths(commands: readonly PathCmd[]): Point[][] {
  const subpaths: Point[][] = [];
  let current: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };

  const flush = (): void => {
    if (current.length >= 3) subpaths.push(current);
    current = [];
  };

  for (const command of commands) {
    const type = command.type.toUpperCase();
    const v = command.values;
    if (type === "M") {
      flush();
      cursor = { x: num(v, 0), y: num(v, 1) };
      start = { ...cursor };
      current = [{ ...cursor }];
    } else if (type === "L") {
      cursor = { x: num(v, 0), y: num(v, 1) };
      current.push({ ...cursor });
    } else if (type === "Q") {
      const c = { x: num(v, 0), y: num(v, 1) };
      const end = { x: num(v, 2), y: num(v, 3) };
      const p0 = cursor;
      for (let s = 1; s <= BEZIER_STEPS; s += 1) {
        const t = s / BEZIER_STEPS;
        const mt = 1 - t;
        current.push({
          x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * end.x,
          y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * end.y,
        });
      }
      cursor = end;
    } else if (type === "C") {
      const c1 = { x: num(v, 0), y: num(v, 1) };
      const c2 = { x: num(v, 2), y: num(v, 3) };
      const end = { x: num(v, 4), y: num(v, 5) };
      const p0 = cursor;
      for (let s = 1; s <= BEZIER_STEPS; s += 1) {
        const t = s / BEZIER_STEPS;
        const mt = 1 - t;
        current.push({
          x: mt ** 3 * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * end.x,
          y: mt ** 3 * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * end.y,
        });
      }
      cursor = end;
    } else if (type === "Z") {
      if (current.length >= 3) {
        current.push({ ...start });
      }
      flush();
      cursor = { ...start };
    }
  }
  flush();
  return subpaths;
}

function contourBottom(subpath: Point[]): number {
  return Math.min(...subpath.map((point) => point.y));
}

/** 水平射线与轮廓边的交点横坐标 */
function horizontalHits(subpaths: readonly Point[][], y: number): number[] {
  const hits: number[] = [];
  for (const subpath of subpaths) {
    for (let i = 0; i < subpath.length; i += 1) {
      const a = subpath[i]!;
      const b = subpath[(i + 1) % subpath.length]!;
      if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y)) {
        hits.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
  }
  return hits.sort((left, right) => left - right);
}

function verticalHits(subpaths: readonly Point[][], x: number): number[] {
  const hits: number[] = [];
  for (const subpath of subpaths) {
    for (let i = 0; i < subpath.length; i += 1) {
      const a = subpath[i]!;
      const b = subpath[(i + 1) % subpath.length]!;
      if ((a.x <= x && x < b.x) || (b.x <= x && x < a.x)) {
        hits.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
      }
    }
  }
  return hits.sort((left, right) => left - right);
}

/** 升序数组的分位值（线性插值） */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const weight = pos - lo;
  return sorted[lo]! * (1 - weight) + sorted[hi]! * weight;
}

function median(values: readonly number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5) ?? 0;
}

function blackRunWidths(hits: readonly number[]): number[] {
  const widths: number[] = [];
  for (let i = 0; i + 1 < hits.length; i += 2) {
    const width = hits[i + 1]! - hits[i]!;
    if (width > 0) widths.push(width);
  }
  return widths;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

/** 构造分布统计；空集合返回 null */
export function distributionStats(
  values: readonly number[],
): DistributionStats | null {
  if (values.length === 0) return null;
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: mean(values),
    stdDev: stdDev(values),
  };
}

function boundsOf(subpaths: readonly Point[][]): Bounds {
  const points = subpaths.flat();
  if (points.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

/** 字形轮廓包围盒（供上层提取 capHeight / xHeight） */
export function outlineBounds(commands: readonly PathCmd[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return boundsOf(outlineToSubpaths(commands));
}

function boxesOverlap(a: Bounds, b: Bounds): boolean {
  return (
    a.minX <= b.maxX &&
    b.minX <= a.maxX &&
    a.minY <= b.maxY &&
    b.minY <= a.maxY
  );
}

/**
 * 按外接矩形重叠 / 包含关系把闭合子路径聚为连通墨迹块。
 * 字母 O 的内外两圈互相包含，属于同一主干块；而基线主干与
 * 右上角分离的附标轮廓会得到两个互不重叠的块。
 */
export function clusterInkComponents(
  subpaths: readonly Point[][],
): InkComponent[] {
  const components: InkComponent[] = subpaths.map((subpath) => ({
    bounds: boundsOf([subpath]),
    subpaths: [[...subpath]],
  }));

  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < components.length; i += 1) {
      for (let j = i + 1; j < components.length; j += 1) {
        const left = components[i]!;
        const right = components[j]!;
        if (!boxesOverlap(left.bounds, right.bounds)) continue;
        const combined = [...left.subpaths, ...right.subpaths];
        components[i] = { bounds: boundsOf(combined), subpaths: combined };
        components.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return components;
}

function isMarkLikeGlyph(glyph: GlyphOutlineInput): boolean {
  if (glyph.glyphKind === "mark" || glyph.glyphKind === "vowel") return true;
  if (glyph.glyphKind !== undefined) return false;
  return glyph.isMark === true;
}

function isPunctuationGlyph(glyph: GlyphOutlineInput): boolean {
  return glyph.glyphKind === "punctuation";
}

export function resolvedGlyphKind(glyph: GlyphOutlineInput): GlyphKind {
  if (glyph.glyphKind) return glyph.glyphKind;
  return glyph.isMark === true ? "mark" : "base";
}

/** 从字形集合推断缺失的字体度量（capHeight / xHeight / ascender / descender） */
export function inferFontMetrics(
  glyphs: readonly GlyphOutlineInput[],
  upm: number,
  overrides: Partial<Omit<FontMetricsInput, "upm">> = {},
): FontMetricsInput {
  const inked = glyphs
    .map((glyph) => ({ glyph, bounds: boundsOf(outlineToSubpaths(glyph.commands)) }))
    .filter((item) => item.bounds.maxY > item.bounds.minY);
  // 标点与独立附标会污染上缘中位数；只有当字体里没有可参照的基字时才回退
  const reference = inked.filter(
    (item) => !isMarkLikeGlyph(item.glyph) && !isPunctuationGlyph(item.glyph),
  );
  const pool = reference.length > 0 ? reference : inked;
  const tops = pool
    .map((item) => item.bounds.maxY)
    .sort((a, b) => a - b);

  return {
    upm,
    capHeight: overrides.capHeight ?? median(tops),
    xHeight: overrides.xHeight ?? median(tops) * 0.72,
    ascender: overrides.ascender ?? Math.max(median(tops), upm * 0.75),
    descender: overrides.descender ?? -Math.max(upm * 0.2, 0),
  };
}

function topDeviation(yMax: number, metrics: FontMetricsInput): number {
  const bands = [metrics.xHeight, metrics.capHeight, metrics.ascender].filter(
    (band) => band > 0,
  );
  if (bands.length === 0) return 0;
  return Math.min(...bands.map((band) => Math.abs(yMax - band)));
}

/**
 * 附标块左缘与基字块右缘之间的最小水平光学净距。
 * `dx` / `dy` 为 GPOS 定位后附标的位移。
 */
function lateralGap(
  baseSubpaths: readonly Point[][],
  baseBounds: Bounds,
  markSubpaths: readonly Point[][],
  markBounds: Bounds,
  dx: number,
  dy: number,
): number | null {
  const bandHeight = markBounds.maxY - markBounds.minY;
  if (bandHeight <= 0) return null;

  const shiftedMinY = markBounds.minY + dy;
  if (shiftedMinY >= baseBounds.maxY) {
    // 附标整体位于基字上缘之上时，有意义的净距是纵向悬空高度
    return shiftedMinY - baseBounds.maxY;
  }

  let best: number | null = null;
  for (let i = 1; i <= 5; i += 1) {
    const y = shiftedMinY + (bandHeight * i) / 6;
    const baseHits = horizontalHits(baseSubpaths, y);
    const markHits = horizontalHits(markSubpaths, y - dy);
    if (baseHits.length === 0 || markHits.length === 0) continue;
    const gap = Math.min(...markHits) + dx - Math.max(...baseHits);
    if (best === null || gap < best) best = gap;
  }
  return best;
}

/**
 * 单字内部离群附标子轮廓检测：主块右缘到右侧次级小块左缘的净距。
 * 适用于把 base 与附标画在同一个字形轮廓内的音节文字 / 元音附标文字。
 */
function internalMarkGap(
  glyph: GlyphOutlineInput,
  subpaths: readonly Point[][],
  bounds: Bounds,
): number | null {
  if (subpaths.length < 2) return null;
  if (isMarkLikeGlyph(glyph) || isPunctuationGlyph(glyph)) return null;

  const components = clusterInkComponents(subpaths);
  if (components.length < 2) return null;

  let main = components[0]!;
  let mainArea = 0;
  for (const component of components) {
    const area =
      (component.bounds.maxX - component.bounds.minX) *
      (component.bounds.maxY - component.bounds.minY);
    if (area > mainArea) {
      main = component;
      mainArea = area;
    }
  }

  const mainWidth = main.bounds.maxX - main.bounds.minX;
  const mainHeight = main.bounds.maxY - main.bounds.minY;
  if (mainWidth <= 0 || mainHeight <= 0 || bounds.maxX <= bounds.minX) {
    return null;
  }
  const advanceWidth = glyph.advanceWidth;

  let best: number | null = null;
  for (const component of components) {
    if (component === main) continue;
    const width = component.bounds.maxX - component.bounds.minX;
    const height = component.bounds.maxY - component.bounds.minY;
    if (width <= 0 || height <= 0) continue;
    if (advanceWidth > 0 && width >= 0.45 * advanceWidth) continue;
    if (height >= 0.65 * mainHeight) continue;
    if (component.bounds.minX < main.bounds.minX + 0.4 * mainWidth) continue;
    const gap = lateralGap(
      main.subpaths,
      main.bounds,
      component.subpaths,
      component.bounds,
      0,
      0,
    );
    if (gap === null) continue;
    if (best === null || gap < best) best = gap;
  }
  return best;
}

export function auditFontGeometry(
  options: GeometryAuditOptions,
): FontGeometryAuditResult {
  const tolerances = { ...DEFAULT_GEOMETRY_TOLERANCES, ...options.tolerances };
  const metrics = inferFontMetrics(options.glyphs, options.upm, options.metrics);
  const scanlineCount = Math.max(4, options.scanlineCount ?? 40);

  const prepared = options.glyphs.map((glyph) => {
    const subpaths = outlineToSubpaths(glyph.commands);
    return {
      glyph,
      subpaths,
      bounds: boundsOf(subpaths),
      bottoms: subpaths.map(contourBottom),
    };
  });

  const deepCut = Math.min(metrics.descender * 0.5, -options.upm * 0.15);
  const mains = prepared.map((item) => {
    const shallow = item.bottoms.filter((bottom) => bottom >= deepCut);
    return shallow.length > 0 ? Math.min(...shallow) : item.bounds.minY;
  });
  const isBaselineReference = (item: (typeof prepared)[number]): boolean =>
    !isMarkLikeGlyph(item.glyph) && !isPunctuationGlyph(item.glyph);

  const baseMains = prepared
    .map((item, index) => (isBaselineReference(item) ? mains[index]! : null))
    .filter((value): value is number => value !== null);
  const medianMainYMin =
    baseMains.length > 0 ? median(baseMains) : median(mains);
  const inkedTops = prepared
    .filter((item) => item.bounds.maxY > 0)
    .filter(isBaselineReference)
    .map((item) => item.bounds.maxY);
  const medianYMax = median(
    inkedTops.length > 0
      ? inkedTops
      : prepared.map((item) => item.bounds.maxY).filter((value) => value > 0),
  );

  const perGlyph = new Map<
    number,
    { stem: number | null; bar: number | null; cv: number | null }
  >();

  for (const item of prepared) {
    const { minX, maxX, minY, maxY } = item.bounds;
    const heights = maxY - minY;
    if (item.subpaths.length === 0 || heights <= 0) {
      perGlyph.set(item.glyph.gid, { stem: null, bar: null, cv: null });
      continue;
    }
    const horizontal: number[] = [];
    const vertical: number[] = [];
    for (let i = 1; i <= scanlineCount; i += 1) {
      const y = minY + (heights * i) / (scanlineCount + 1);
      horizontal.push(...blackRunWidths(horizontalHits(item.subpaths, y)));
      const x = minX + ((maxX - minX) * i) / (scanlineCount + 1);
      vertical.push(...blackRunWidths(verticalHits(item.subpaths, x)));
    }
    const chords = [...horizontal, ...vertical];
    const avg = mean(chords);
    const sortedHorizontal = [...horizontal].sort((a, b) => a - b);
    const sortedVertical = [...vertical].sort((a, b) => a - b);
    perGlyph.set(item.glyph.gid, {
      stem: quantile(sortedHorizontal, 0.25),
      bar: quantile(sortedVertical, 0.25),
      cv: avg > 0 ? stdDev(chords) / avg : null,
    });
  }

  const medianStemQ1 = median(
    [...perGlyph.values()]
      .map((entry) => entry.stem)
      .filter((value): value is number => value !== null && value > 0),
  );

  const preparedGids = new Set(prepared.map((item) => item.glyph.gid));
  /** 目标行 gid → 最小净距（同一附标在多个基字上取最小值，绝不互相覆盖） */
  const gapByTargetGid = new Map<number, number>();
  for (const pair of options.markPairs ?? []) {
    const base = prepared.find((item) => item.glyph.gid === pair.baseGid);
    const mark = prepared.find((item) => item.glyph.gid === pair.markGid);
    if (!base || !mark || mark.subpaths.length === 0) continue;
    const best = lateralGap(
      base.subpaths,
      base.bounds,
      mark.subpaths,
      mark.bounds,
      pair.xOffset ?? 0,
      pair.yOffset ?? 0,
    );
    if (best === null) continue;
    const hasRealComposite =
      pair.compositeGid !== pair.baseGid &&
      pair.compositeGid !== pair.markGid &&
      preparedGids.has(pair.compositeGid);
    const target = hasRealComposite ? pair.compositeGid : pair.markGid;
    const previous = gapByTargetGid.get(target);
    if (previous === undefined || best < previous) {
      gapByTargetGid.set(target, best);
    }
  }

  /** 单字内部离群附标块净距（GSUB 未参与、base + mark 画在同一轮廓内） */
  const internalGapByGid = new Map<number, number>();
  for (const item of prepared) {
    const gap = internalMarkGap(item.glyph, item.subpaths, item.bounds);
    if (gap === null) continue;
    const previous = gapByTargetGid.get(item.glyph.gid);
    if (previous !== undefined) continue;
    internalGapByGid.set(item.glyph.gid, gap);
  }

  const rows: GlyphAuditRow[] = prepared.map((item, index) => {
    const { glyph, bounds } = item;
    const stats = perGlyph.get(glyph.gid) ?? { stem: null, bar: null, cv: null };
    const issues: GeometryIssue[] = [];
    const hasInk = item.subpaths.length > 0;

    if (isBaselineReference(item) && hasInk) {
      const topGap = topDeviation(bounds.maxY, metrics) / options.upm;
      if (topGap > tolerances.ascender) {
        issues.push({
          kind: "ascender_misaligned",
          value: topGap,
          threshold: tolerances.ascender,
          unit: "ratio",
        });
      }
      const baselineGap = Math.abs(mains[index]! - medianMainYMin) / options.upm;
      if (baselineGap > tolerances.baseline) {
        issues.push({
          kind: "baseline_drift",
          value: baselineGap,
          threshold: tolerances.baseline,
          unit: "ratio",
        });
      }
    }

    const opticalGapX =
      gapByTargetGid.get(glyph.gid) ?? internalGapByGid.get(glyph.gid) ?? null;
    if (opticalGapX !== null) {
      const ratio = opticalGapX / options.upm;
      if (ratio > tolerances.markGapMax) {
        issues.push({
          kind: "mark_gap_too_large",
          value: ratio,
          threshold: tolerances.markGapMax,
          unit: "ratio",
        });
      } else if (ratio < tolerances.markGapMin) {
        issues.push({
          kind: "mark_gap_too_small",
          value: ratio,
          threshold: tolerances.markGapMin,
          unit: "ratio",
        });
      }
    }

    if (stats.stem !== null && stats.stem / options.upm < tolerances.stemMin) {
      issues.push({
        kind: "stem_too_thin",
        value: stats.stem / options.upm,
        threshold: tolerances.stemMin,
        unit: "ratio",
      });
    }
    if (stats.cv !== null && stats.cv > tolerances.weightCv) {
      issues.push({
        kind: "weight_uneven",
        value: stats.cv,
        threshold: tolerances.weightCv,
        unit: "ratio",
      });
    }

    return {
      gid: glyph.gid,
      name: glyph.name ?? null,
      codepoints: glyph.codepoints ?? [],
      glyphKind: resolvedGlyphKind(glyph),
      advanceWidth: glyph.advanceWidth,
      yMax: bounds.maxY,
      yMin: bounds.minY,
      mainYMin: mains[index]!,
      inkMinX: bounds.minX,
      inkMaxX: bounds.maxX,
      leftSideBearing: bounds.minX,
      rightSideBearing: glyph.advanceWidth - bounds.maxX,
      stemQ1: stats.stem,
      barQ1: stats.bar,
      weightCv: stats.cv,
      opticalGapX,
      issues,
    };
  });

  const issueCounts: Record<GeometryIssueKind, number> = {
    ascender_misaligned: 0,
    baseline_drift: 0,
    mark_gap_too_large: 0,
    mark_gap_too_small: 0,
    stem_too_thin: 0,
    weight_uneven: 0,
  };
  for (const row of rows) {
    for (const issue of row.issues) issueCounts[issue.kind] += 1;
  }

  const gaps = rows
    .map((row) => row.opticalGapX)
    .filter((value): value is number => value !== null);
  const gapStats: OpticalGapStats | null =
    gaps.length === 0
      ? null
      : {
          count: gaps.length,
          min: Math.min(...gaps),
          max: Math.max(...gaps),
          mean: mean(gaps),
          stdDev: stdDev(gaps),
        };

  const baseRatios: number[] = [];
  const markRatios: number[] = [];
  const lsbRatios: number[] = [];
  const rsbRatios: number[] = [];
  for (const row of rows) {
    if (row.inkMaxX <= row.inkMinX) continue;
    if (row.glyphKind === "punctuation") continue;
    const inkWidth = row.inkMaxX - row.inkMinX;
    if (row.glyphKind === "vowel" || row.glyphKind === "mark") {
      if (row.advanceWidth > 0) markRatios.push(inkWidth / row.advanceWidth);
    } else {
      if (row.advanceWidth > 0) baseRatios.push(inkWidth / row.advanceWidth);
      lsbRatios.push(row.leftSideBearing / options.upm);
      rsbRatios.push(row.rightSideBearing / options.upm);
    }
  }

  const widthStats: WidthConsistencyStats = {
    baseAdvanceRatio: distributionStats(baseRatios),
    markAdvanceRatio: distributionStats(markRatios),
    lsb: distributionStats(lsbRatios),
    rsb: distributionStats(rsbRatios),
  };

  return {
    metrics,
    rows,
    summary: {
      glyphCount: options.glyphs.length,
      analyzedCount: rows.length,
      flaggedCount: rows.filter((row) => row.issues.length > 0).length,
      medianYMax,
      medianMainYMin,
      medianStemQ1: medianStemQ1 > 0 ? medianStemQ1 : null,
      issueCounts,
      opticalGap: gapStats,
    },
    widthStats,
  };
}
