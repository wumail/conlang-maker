/**
 * scaPreviewPatch.ts — SCA 批量预览的纯规则补丁推导
 *
 * 对屈折/派生规则中所有「可音变」的表面字段跑一遍音变链，产出预览行与新规则对象。
 * 纯函数：不接触 Store / React。
 */
import type { DerivationRule, InflectionRule, SCARuleSet } from "../types";
import { applySoundChanges, type SCAProsodyContext } from "./scaEngine";

export interface ScaPreviewRow {
  key: string;
  scope: "lexicon" | "inflection" | "derivation";
  label: string;
  field: string;
  original: string;
  result: string;
}

interface FieldPatch<T> {
  /** 展示用字段名，如 `circumfix.prefix` */
  field: string;
  get: (rule: T) => string | undefined;
  set: (rule: T, value: string) => T;
}

function patchRuleWithSca<T>(
  rule: T,
  ruleId: string,
  label: string,
  scope: ScaPreviewRow["scope"],
  keyPrefix: string,
  fields: FieldPatch<T>[],
  ruleSets: SCARuleSet[],
  macros: Record<string, string[]>,
  prosodyContext?: SCAProsodyContext,
): { changed: boolean; nextRule: T; rows: ScaPreviewRow[] } {
  const rows: ScaPreviewRow[] = [];
  let changed = false;
  let nextRule = rule;

  for (const patch of fields) {
    const source = patch.get(nextRule) ?? "";
    if (!source.trim()) continue;
    const result = applySoundChanges(source, ruleSets, macros, [], prosodyContext).result;
    if (result === source) continue;
    nextRule = patch.set(nextRule, result);
    changed = true;
    rows.push({
      key: `${keyPrefix}_${ruleId}_${patch.field}_${rows.length}`,
      scope,
      label,
      field: patch.field,
      original: source,
      result,
    });
  }

  return { changed, nextRule, rows };
}

const infixField = <T extends { infix_config?: { position_regex: string; morpheme: string } }>(
  rule: T,
  value: string,
): T => ({
  ...rule,
  infix_config: {
    ...(rule.infix_config ?? { position_regex: "", morpheme: "" }),
    morpheme: value,
  },
});

const circumfixField = <
  T extends { circumfix_config?: { prefix_part: string; suffix_part: string } },
>(
  rule: T,
  part: "prefix_part" | "suffix_part",
  value: string,
): T => ({
  ...rule,
  circumfix_config: {
    ...(rule.circumfix_config ?? { prefix_part: "", suffix_part: "" }),
    [part]: value,
  },
});

const ablautField = <
  T extends { ablaut_config?: { target_vowel: string; replacement_vowel: string } },
>(
  rule: T,
  part: "target_vowel" | "replacement_vowel",
  value: string,
): T => ({
  ...rule,
  ablaut_config: {
    ...(rule.ablaut_config ?? { target_vowel: "", replacement_vowel: "" }),
    [part]: value,
  },
});

/** 屈折规则：词缀 / 中缀 / 环缀 / 元音交替 全部表面字段 */
export function patchInflectionRuleWithSca(
  rule: InflectionRule,
  ruleIndex: number,
  ruleSets: SCARuleSet[],
  macros: Record<string, string[]>,
  prosodyContext?: SCAProsodyContext,
): { changed: boolean; nextRule: InflectionRule; rows: ScaPreviewRow[] } {
  const fields: FieldPatch<InflectionRule>[] = [
    { field: "affix", get: (r) => r.affix, set: (r, v) => ({ ...r, affix: v }) },
    {
      field: "infix",
      get: (r) => r.infix_config?.morpheme,
      set: (r, v) => infixField(r, v),
    },
    {
      field: "circumfix.prefix",
      get: (r) => r.circumfix_config?.prefix_part,
      set: (r, v) => circumfixField(r, "prefix_part", v),
    },
    {
      field: "circumfix.suffix",
      get: (r) => r.circumfix_config?.suffix_part,
      set: (r, v) => circumfixField(r, "suffix_part", v),
    },
    {
      field: "ablaut.target",
      get: (r) => r.ablaut_config?.target_vowel,
      set: (r, v) => ablautField(r, "target_vowel", v),
    },
    {
      field: "ablaut.replacement",
      get: (r) => r.ablaut_config?.replacement_vowel,
      set: (r, v) => ablautField(r, "replacement_vowel", v),
    },
  ];

  return patchRuleWithSca(
    rule,
    rule.rule_id,
    rule.tag || `#${ruleIndex + 1}`,
    "inflection",
    "inf",
    fields,
    ruleSets,
    macros,
    prosodyContext,
  );
}

/** 派生规则：词缀 / 中缀 / 环缀 */
export function patchDerivationRuleWithSca(
  rule: DerivationRule,
  ruleIndex: number,
  ruleSets: SCARuleSet[],
  macros: Record<string, string[]>,
  prosodyContext?: SCAProsodyContext,
): { changed: boolean; nextRule: DerivationRule; rows: ScaPreviewRow[] } {
  const fields: FieldPatch<DerivationRule>[] = [
    { field: "affix", get: (r) => r.affix, set: (r, v) => ({ ...r, affix: v }) },
    {
      field: "infix",
      get: (r) => r.infix_config?.morpheme,
      set: (r, v) => infixField(r, v),
    },
    {
      field: "circumfix.prefix",
      get: (r) => r.circumfix_config?.prefix_part,
      set: (r, v) => circumfixField(r, "prefix_part", v),
    },
    {
      field: "circumfix.suffix",
      get: (r) => r.circumfix_config?.suffix_part,
      set: (r, v) => circumfixField(r, "suffix_part", v),
    },
  ];

  return patchRuleWithSca(
    rule,
    rule.rule_id,
    rule.name || `#${ruleIndex + 1}`,
    "derivation",
    "der",
    fields,
    ruleSets,
    macros,
    prosodyContext,
  );
}
