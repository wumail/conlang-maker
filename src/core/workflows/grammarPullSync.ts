/**
 * grammarPullSync.ts — 历时语法同步（父语言词缀 → 子语言音变结果）
 *
 * 提取父语言中 `sca_mutable !== false` 的屈折/派生词缀，运行子语言的 SCA
 * 规则集得到音变后形式，与子语言现有规则对比给出变更计划；同一词性下两条
 * 原本不同的规则在音变后表层相同即为**同音中和（syncretism）**。
 */
import type { GrammarConfig, SCAConfig } from "../../types";
import { applySoundChanges, buildMacrosFromInventory } from "../engines/scaEngine";
import type { PhonemeInventory, Phonotactics } from "../../types";

export interface GrammarSyncRow {
  ruleId: string;
  tag: string;
  posId: string;
  before: string;
  after: string;
  /** 子语言已有同 id 规则 */
  existsInChild: boolean;
  changed: boolean;
  /** `locked` = sca_mutable:false；`unchanged` = 音变后无差异 */
  status: "apply" | "unchanged" | "locked";
}

export interface SyncretismCollision {
  posId: string;
  /** 冲突的两个 tag（按字母序） */
  tags: [string, string];
  form: string;
  ruleIds: [string, string];
}

export interface GrammarSyncPlan {
  inflection: GrammarSyncRow[];
  derivation: GrammarSyncRow[];
  collisions: SyncretismCollision[];
  stats: {
    inflectionTotal: number;
    inflectionChanged: number;
    derivationTotal: number;
    derivationChanged: number;
    lockedCount: number;
    collisionCount: number;
  };
}

export interface PlanGrammarPullSyncOptions {
  parentGrammar: GrammarConfig;
  childGrammar: GrammarConfig;
  childSca: SCAConfig;
  /** 子语言音系（提供宏展开所需的辅音/元音表） */
  inventory?: PhonemeInventory;
  phonotactics?: Phonotactics;
  /** 仅同步这些词性（默认全部） */
  posIds?: readonly string[];
}

function macrosFor(inventory?: PhonemeInventory, phonotactics?: Phonotactics) {
  return buildMacrosFromInventory(
    inventory?.consonants ?? [],
    inventory?.vowels ?? [],
    phonotactics?.macros ?? {},
  );
}

function transform(
  affix: string,
  childSca: SCAConfig,
  macros: ReturnType<typeof macrosFor>,
): string {
  if (!affix.trim()) return affix;
  return applySoundChanges(affix, childSca.rule_sets, macros).result;
}

/** 生成同步计划（纯函数，不修改入参） */
export function planGrammarPullSync(
  options: PlanGrammarPullSyncOptions,
): GrammarSyncPlan {
  const { parentGrammar, childGrammar, childSca, inventory, phonotactics, posIds } = options;
  const macros = macrosFor(inventory, phonotactics);
  const posFilter = posIds && posIds.length > 0 ? new Set(posIds) : null;

  const childInflectionById = new Map(
    childGrammar.inflection_rules.map((rule) => [rule.rule_id, rule]),
  );
  const childDerivationById = new Map(
    childGrammar.derivation_rules.map((rule) => [rule.rule_id, rule]),
  );

  let lockedCount = 0;
  const inflection: GrammarSyncRow[] = [];
  for (const rule of parentGrammar.inflection_rules) {
    if (posFilter && !posFilter.has(rule.pos_id)) continue;
    const locked = rule.sca_mutable === false;
    if (locked) lockedCount += 1;
    const after = locked ? rule.affix : transform(rule.affix, childSca, macros);
    const existing = childInflectionById.get(rule.rule_id);
    inflection.push({
      ruleId: rule.rule_id,
      tag: rule.tag,
      posId: rule.pos_id,
      before: existing?.affix ?? rule.affix,
      after,
      existsInChild: Boolean(existing),
      changed: !locked && (existing?.affix ?? "") !== after,
      status: locked ? "locked" : (existing?.affix ?? "") === after ? "unchanged" : "apply",
    });
  }

  const derivation: GrammarSyncRow[] = [];
  for (const rule of parentGrammar.derivation_rules) {
    const locked = rule.sca_mutable === false;
    if (locked) lockedCount += 1;
    const after = locked ? rule.affix : transform(rule.affix, childSca, macros);
    const existing = childDerivationById.get(rule.rule_id);
    derivation.push({
      ruleId: rule.rule_id,
      tag: rule.name,
      posId: rule.source_pos_id,
      before: existing?.affix ?? rule.affix,
      after,
      existsInChild: Boolean(existing),
      changed: !locked && (existing?.affix ?? "") !== after,
      status: locked ? "locked" : (existing?.affix ?? "") === after ? "unchanged" : "apply",
    });
  }

  // 同音中和：同一词性下「音变后表层 + 形态类型」相同的不同 tag
  const buckets = new Map<string, GrammarSyncRow[]>();
  for (const row of inflection) {
    if (row.status === "locked") continue;
    const form = row.after.trim();
    if (!form) continue;
    const key = `${row.posId}::${form}`;
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }

  const collisions: SyncretismCollision[] = [];
  for (const rows of buckets.values()) {
    if (rows.length < 2) continue;
    const uniqueTags = [...new Set(rows.map((row) => row.tag))].sort();
    for (let i = 0; i < uniqueTags.length; i += 1) {
      for (let j = i + 1; j < uniqueTags.length; j += 1) {
        const a = rows.find((row) => row.tag === uniqueTags[i]);
        const b = rows.find((row) => row.tag === uniqueTags[j]);
        if (!a || !b) continue;
        collisions.push({
          posId: a.posId,
          tags: [a.tag, b.tag],
          form: a.after,
          ruleIds: [a.ruleId, b.ruleId],
        });
      }
    }
  }

  return {
    inflection,
    derivation,
    collisions,
    stats: {
      inflectionTotal: inflection.length,
      inflectionChanged: inflection.filter((row) => row.status === "apply").length,
      derivationTotal: derivation.length,
      derivationChanged: derivation.filter((row) => row.status === "apply").length,
      lockedCount,
      collisionCount: collisions.length,
    },
  };
}

/**
 * 落地同步计划：把 `apply` 行写入子语言语法（已有则改 affix，缺失则整条复制）。
 *
 * 返回新对象，不修改入参；`skipRuleIds` 可让用户取消勾选部分规则。
 */
export function applyGrammarPullSync(
  childGrammar: GrammarConfig,
  plan: GrammarSyncPlan,
  options: { skipRuleIds?: readonly string[] } = {},
): GrammarConfig {
  const skip = new Set(options.skipRuleIds ?? []);
  const inflectionByRuleId = new Map(
    plan.inflection
      .filter((row) => row.status === "apply" && !skip.has(row.ruleId))
      .map((row) => [row.ruleId, row] as const),
  );
  const derivationByRuleId = new Map(
    plan.derivation
      .filter((row) => row.status === "apply" && !skip.has(row.ruleId))
      .map((row) => [row.ruleId, row] as const),
  );

  const inflection_rules = childGrammar.inflection_rules.map((rule) => {
    const row = inflectionByRuleId.get(rule.rule_id);
    return row ? { ...rule, affix: row.after } : rule;
  });
  const derivation_rules = childGrammar.derivation_rules.map((rule) => {
    const row = derivationByRuleId.get(rule.rule_id);
    return row ? { ...rule, affix: row.after } : rule;
  });

  return { ...childGrammar, inflection_rules, derivation_rules };
}

/** 计划里是否还有待应用的变更 */
export function hasPendingChanges(plan: GrammarSyncPlan): boolean {
  return (
    plan.inflection.some((row) => row.status === "apply") ||
    plan.derivation.some((row) => row.status === "apply")
  );
}
