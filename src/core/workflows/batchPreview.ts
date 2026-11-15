/**
 * batchPreview.ts — 统一批量差异预览的纯逻辑（Roadmap v3 / Pillar 2）
 *
 * 复用于：词典批量编辑、全语系概念对齐批量确认、语料强制重标注、CSV 导入预览。
 * 预览生成时记录相关 Store 的 baseRevision；确认提交前由调用方比对最新 revision，
 * 若预览期间数据被后台修改则置 staleRevisionDetected 拦截覆盖。
 */

/** 一行差异预览（前后对照） */
export interface BatchDiffRow {
  id: string;
  label: string;
  sublabel?: string;
  before: string;
  after: string;
  warning?: string;
}

/** 引用影响摘要（删除词条/义项前的语料引用预检展示） */
export interface BatchImpactSummary {
  affectedEntries: number;
  affectedSenses: number;
  corpusHits?: number;
}

/** 生成预览摘要文案参数（供 UI 组合 t() 插值） */
export function summarizeImpact(summary: BatchImpactSummary): {
  entries: number;
  senses: number;
  corpusHits: number;
} {
  return {
    entries: summary.affectedEntries,
    senses: summary.affectedSenses,
    corpusHits: summary.corpusHits ?? 0,
  };
}

/** 判断预览是否过期：生成时记录的修订号 vs 当前最新修订号 */
export function isPreviewStale(
  baseRevision: string | null | undefined,
  currentRevision: string | null | undefined,
): boolean {
  if (!baseRevision || !currentRevision) return false;
  return baseRevision !== currentRevision;
}

/** 从「旧值 → 新值」映射构建差异行；无变化项自动跳过 */
export function buildDiffRows(
  changes: Array<{
    id: string;
    label: string;
    sublabel?: string;
    before: string;
    after: string;
    warning?: string;
  }>,
): BatchDiffRow[] {
  return changes.filter((change) => change.before !== change.after);
}
