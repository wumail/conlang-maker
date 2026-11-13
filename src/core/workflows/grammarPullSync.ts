/**
 * grammarPullSync.ts — 历时语法同步（父语言词缀 → 子语言音变结果）
 *
 * 提取父语言中 `sca_mutable !== false` 的屈折/派生词缀与不规则覆盖词形，
 * 运行子语言的 SCA 规则集得到音变后形式，与子语言现有规则对比给出变更计划；
 * 同一词性、同一条件下两条原本表层不同的规则音变后表层相同，即为
 * **同音中和（syncretism）**。
 */
import type {
  ConditionClause,
  DerivationRule,
  GrammarConfig,
  InflectionRule,
  IrregularOverride,
  PhonemeInventory,
  Phonotactics,
  SCAConfig,
} from "../../types";
import { applySoundChanges, buildMacrosFromInventory } from "../engines/scaEngine";

export type GrammarSyncKind = "inflection" | "derivation" | "irregular";

export interface GrammarSyncRow {
  kind: GrammarSyncKind;
  /** 屈折/派生为 rule_id；不规则词形为 `entry_id::维度指纹` */
  ruleId: string;
  tag: string;
  posId: string;
  /** 父语言表层，用于判断中和是否为「原本不同 → 现在相同」 */
  parentAffix: string;
  /** 子语言当前表层（子语言缺失时回落到父语言） */
  before: string;
  after: string;
  existsInChild: boolean;
  changed: boolean;
  /** `locked` = sca_mutable:false；`unchanged` = 音变后无差异 */
  status: "apply" | "unchanged" | "locked";
  /** 条件环境指纹（`"*"` 表示无条件） */
  environment: string;
}

export interface SyncretismCollision {
  posId: string;
  /** 冲突的两个 tag（按字母序） */
  tags: [string, string];
  form: string;
  ruleIds: [string, string];
  environment: string;
}

export interface GrammarSyncPlan {
  inflection: GrammarSyncRow[];
  derivation: GrammarSyncRow[];
  irregular: GrammarSyncRow[];
  collisions: SyncretismCollision[];
  stats: {
    inflectionTotal: number;
    inflectionChanged: number;
    derivationTotal: number;
    derivationChanged: number;
    irregularTotal: number;
    irregularChanged: number;
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

/** 稳定序列化条件子句，用作「同环境」判定与展示 */
export function conditionFingerprint(condition: ConditionClause | null | undefined): string {
  if (!condition) return "*";
  return JSON.stringify([
    condition.type,
    condition.class ?? "",
    condition.regex ?? "",
  ]);
}

/** 维度值 → 稳定键，用于定位不规则覆盖 */
export function dimensionKey(dimensions: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(dimensions)
      .sort()
      .map((key) => [key, dimensions[key]]),
  );
}

function irregularRowId(override: IrregularOverride): string {
  return `${override.entry_id}::${dimensionKey(override.dimension_values)}`;
}

function transform(
  affix: string,
  childSca: SCAConfig,
  macros: ReturnType<typeof macrosFor>,
): string {
  if (!affix.trim()) return affix;
  return applySoundChanges(affix, childSca.rule_sets, macros).result;
}

function buildRow(input: {
  kind: GrammarSyncKind;
  ruleId: string;
  tag: string;
  posId: string;
  parentAffix: string;
  childAffix: string | undefined;
  locked: boolean;
  environment: string;
  childSca: SCAConfig;
  macros: ReturnType<typeof macrosFor>;
}): GrammarSyncRow {
  const {
    kind,
    ruleId,
    tag,
    posId,
    parentAffix,
    childAffix,
    locked,
    environment,
    childSca,
    macros,
  } = input;
  const after = locked ? parentAffix : transform(parentAffix, childSca, macros);
  const before = childAffix ?? parentAffix;
  const status: GrammarSyncRow["status"] = locked
    ? "locked"
    : before === after
      ? "unchanged"
      : "apply";
  return {
    kind,
    ruleId,
    tag,
    posId,
    parentAffix,
    before,
    after,
    existsInChild: childAffix !== undefined,
    changed: status === "apply",
    status,
    environment,
  };
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
  const childIrregularById = new Map(
    childGrammar.irregular_overrides.map((override) => [irregularRowId(override), override]),
  );

  let lockedCount = 0;

  const inflection: GrammarSyncRow[] = [];
  for (const rule of parentGrammar.inflection_rules) {
    if (posFilter && !posFilter.has(rule.pos_id)) continue;
    const locked = rule.sca_mutable === false;
    if (locked) lockedCount += 1;
    inflection.push(
      buildRow({
        kind: "inflection",
        ruleId: rule.rule_id,
        tag: rule.tag,
        posId: rule.pos_id,
        parentAffix: rule.affix,
        childAffix: childInflectionById.get(rule.rule_id)?.affix,
        locked,
        environment: conditionFingerprint(rule.condition),
        childSca,
        macros,
      }),
    );
  }

  const derivation: GrammarSyncRow[] = [];
  for (const rule of parentGrammar.derivation_rules) {
    const locked = rule.sca_mutable === false;
    if (locked) lockedCount += 1;
    derivation.push(
      buildRow({
        kind: "derivation",
        ruleId: rule.rule_id,
        tag: rule.name,
        posId: rule.source_pos_id,
        parentAffix: rule.affix,
        childAffix: childDerivationById.get(rule.rule_id)?.affix,
        locked,
        environment: conditionFingerprint(rule.condition),
        childSca,
        macros,
      }),
    );
  }

  const irregular: GrammarSyncRow[] = [];
  for (const override of parentGrammar.irregular_overrides) {
    const ruleId = irregularRowId(override);
    irregular.push(
      buildRow({
        kind: "irregular",
        ruleId,
        tag: Object.values(override.dimension_values).join(".") || ruleId,
        posId: "",
        parentAffix: override.surface_form,
        childAffix: childIrregularById.get(ruleId)?.surface_form,
        locked: false,
        environment: dimensionKey(override.dimension_values),
        childSca,
        macros,
      }),
    );
  }

  // 同音中和：同一词性 + 同一条件下，「原本不同」的屈折表层音变后合流
  const buckets = new Map<string, GrammarSyncRow[]>();
  for (const row of inflection) {
    if (row.status === "locked") continue;
    const form = row.after.trim();
    if (!form) continue;
    const key = `${row.posId}::${form}::${row.environment}`;
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
        // 父语言表层已相同的两条规则不算「中和」，那是继承而来的固有同形
        if (a.parentAffix === b.parentAffix) continue;
        collisions.push({
          posId: a.posId,
          tags: [a.tag, b.tag],
          form: a.after,
          ruleIds: [a.ruleId, b.ruleId],
          environment: a.environment,
        });
      }
    }
  }

  const countApplied = (rows: GrammarSyncRow[]) =>
    rows.filter((row) => row.status === "apply").length;

  return {
    inflection,
    derivation,
    irregular,
    collisions,
    stats: {
      inflectionTotal: inflection.length,
      inflectionChanged: countApplied(inflection),
      derivationTotal: derivation.length,
      derivationChanged: countApplied(derivation),
      irregularTotal: irregular.length,
      irregularChanged: countApplied(irregular),
      lockedCount,
      collisionCount: collisions.length,
    },
  };
}

/**
 * 落地同步计划：把 `apply` 行写入子语言语法（已有则改表层，缺失则跳过）。
 *
 * 返回新对象，不修改入参；`skipRuleIds` 可让用户取消勾选部分规则。
 */
export function applyGrammarPullSync(
  childGrammar: GrammarConfig,
  plan: GrammarSyncPlan,
  options: { skipRuleIds?: readonly string[] } = {},
): GrammarConfig {
  const skip = new Set(options.skipRuleIds ?? []);
  const pick = (rows: GrammarSyncRow[]) =>
    new Map(
      rows
        .filter((row) => row.status === "apply" && !skip.has(row.ruleId))
        .map((row) => [row.ruleId, row] as const),
    );

  const inflectionByRuleId = pick(plan.inflection);
  const derivationByRuleId = pick(plan.derivation);
  const irregularByRuleId = pick(plan.irregular);

  const inflection_rules: InflectionRule[] = childGrammar.inflection_rules.map((rule) => {
    const row = inflectionByRuleId.get(rule.rule_id);
    return row ? { ...rule, affix: row.after } : rule;
  });
  const derivation_rules: DerivationRule[] = childGrammar.derivation_rules.map((rule) => {
    const row = derivationByRuleId.get(rule.rule_id);
    return row ? { ...rule, affix: row.after } : rule;
  });
  const irregular_overrides: IrregularOverride[] = childGrammar.irregular_overrides.map(
    (override) => {
      const row = irregularByRuleId.get(irregularRowId(override));
      return row ? { ...override, surface_form: row.after } : override;
    },
  );

  return {
    ...childGrammar,
    inflection_rules,
    derivation_rules,
    irregular_overrides,
  };
}

/** 计划里是否还有待应用的变更 */
export function hasPendingChanges(plan: GrammarSyncPlan): boolean {
  return (
    plan.inflection.some((row) => row.status === "apply") ||
    plan.derivation.some((row) => row.status === "apply") ||
    plan.irregular.some((row) => row.status === "apply")
  );
}
