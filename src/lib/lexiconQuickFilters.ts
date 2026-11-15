import type { BuiltinQuickFilterKind, OriginType } from "../types";

/** 结构化的「需要整理」快捷筛选，统一收进高级筛选项下拉 */
export const LEXICON_QUICK_FILTERS: Array<{
  kind: BuiltinQuickFilterKind;
  labelKey: string;
}> = [
  { kind: "unbound_concept", labelKey: "lexicon.filtersV3.quickUnboundConcept" },
  { kind: "missing_examples", labelKey: "lexicon.filtersV3.quickMissingExamples" },
  { kind: "tbd_gloss", labelKey: "lexicon.filtersV3.quickTbdGloss" },
  { kind: "borrowed_needs_review", labelKey: "lexicon.filtersV3.quickBorrowedReview" },
  { kind: "deprecated", labelKey: "lexicon.filtersV3.quickDeprecated" },
];

/**
 * 词源类型下拉的静态配置：完整覆盖 `OriginType` 的全部 7 种取值。
 *
 * 标签一律走显式 i18n key 映射（禁止用 `${origin.charAt(0).toUpperCase()}` 之类的
 * 模板拼接，否则 `compound` 会渲染出裸 key `lexicon.originCompound`）。
 */
export const LEXICON_ORIGIN_FILTERS: Array<{
  value: OriginType;
  labelKey: string;
}> = [
  { value: "a_priori", labelKey: "lexicon.originAPriori" },
  { value: "a_posteriori", labelKey: "lexicon.originAPosteriori" },
  { value: "evolved", labelKey: "lexicon.originEvolved" },
  { value: "borrowed", labelKey: "lexicon.originBorrowed" },
  { value: "derived", labelKey: "lexicon.originDerived" },
  { value: "mixed", labelKey: "lexicon.originMixed" },
  { value: "compound", labelKey: "lexicon.etymologyV3.originCompound" },
];

/** 词条生命周期筛选的静态配置 */
export const LEXICON_LIFECYCLE_FILTERS: Array<{
  value: "added" | "deprecated" | "changed";
  labelKey: string;
}> = [
  { value: "added", labelKey: "lexicon.lifecycle.added" },
  { value: "deprecated", labelKey: "lexicon.lifecycle.deprecated" },
  { value: "changed", labelKey: "lexicon.lifecycle.changed" },
];
