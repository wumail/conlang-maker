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
  InfixConfig,
  CircumfixConfig,
  IrregularOverride,
  PhonemeInventory,
  PhonologyConfig,
  Phonotactics,
  SCAConfig,
} from "../../types";
import {
  applySoundChanges,
  buildMacrosFromInventory,
  type SCAProsodyContext,
} from "../engines/scaEngine";

export type GrammarSyncKind = "inflection" | "derivation" | "irregular";

/** 单条规则内某个表面字段的音变前后值 */
export interface GrammarSyncFieldPatch {
  /** 如 `affix`、`condition.then_affix`、`circumfix_config.prefix_part` */
  field: string;
  before: string;
  after: string;
  changed: boolean;
}

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
  /** 词缀全部子字段的逐项音变结果（含 condition / infix / circumfix / ablaut） */
  fields?: GrammarSyncFieldPatch[];
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
  /** 完整音系（提供重音/音节所需的超音段上下文） */
  phonology?: PhonologyConfig;
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

function prosodyContextFor(
  phonology?: PhonologyConfig,
): SCAProsodyContext | undefined {
  if (!phonology) return undefined;
  return {
    phonotactics: phonology.phonotactics,
    inventory: phonology.phoneme_inventory,
    stress: phonology.phonotactics.stress ?? null,
  };
}

function transform(
  affix: string,
  childSca: SCAConfig,
  macros: ReturnType<typeof macrosFor>,
  prosodyContext?: SCAProsodyContext,
): string {
  if (!affix.trim()) return affix;
  return applySoundChanges(affix, childSca.rule_sets, macros, [], prosodyContext).result;
}

function evolveField(
  field: string,
  parentValue: string | undefined,
  childValue: string | undefined,
  locked: boolean,
  childSca: SCAConfig,
  macros: ReturnType<typeof macrosFor>,
  prosodyContext?: SCAProsodyContext,
): GrammarSyncFieldPatch | null {
  if (!parentValue || !parentValue.trim()) return null;
  const before = childValue ?? parentValue;
  const after = locked
    ? parentValue
    : transform(parentValue, childSca, macros, prosodyContext);
  return { field, before, after, changed: !locked && before !== after };
}

interface FieldContext {
  locked: boolean;
  childSca: SCAConfig;
  macros: ReturnType<typeof macrosFor>;
  prosodyContext?: SCAProsodyContext;
}

type FieldSource = {
  condition?: ConditionClause | null;
  infix_config?: { morpheme: string };
  circumfix_config?: { prefix_part: string; suffix_part: string };
  ablaut_config?: { target_vowel: string; replacement_vowel: string };
};

/** 除 affix 之外的全部词缀子字段（屈折/派生同构） */
function ruleFieldPatches(
  parent: FieldSource,
  child: FieldSource | undefined,
  ctx: FieldContext,
): GrammarSyncFieldPatch[] {
  const specs: Array<[string, string | undefined, string | undefined]> = [
    ["condition.then_affix", parent.condition?.then_affix, child?.condition?.then_affix],
    ["condition.else_affix", parent.condition?.else_affix, child?.condition?.else_affix],
    ["infix_config.morpheme", parent.infix_config?.morpheme, child?.infix_config?.morpheme],
    [
      "circumfix_config.prefix_part",
      parent.circumfix_config?.prefix_part,
      child?.circumfix_config?.prefix_part,
    ],
    [
      "circumfix_config.suffix_part",
      parent.circumfix_config?.suffix_part,
      child?.circumfix_config?.suffix_part,
    ],
    [
      "ablaut_config.target_vowel",
      parent.ablaut_config?.target_vowel,
      child?.ablaut_config?.target_vowel,
    ],
    [
      "ablaut_config.replacement_vowel",
      parent.ablaut_config?.replacement_vowel,
      child?.ablaut_config?.replacement_vowel,
    ],
  ];
  const patches: GrammarSyncFieldPatch[] = [];
  for (const [field, parentValue, childValue] of specs) {
    const patch = evolveField(
      field,
      parentValue,
      childValue,
      ctx.locked,
      ctx.childSca,
      ctx.macros,
      ctx.prosodyContext,
    );
    if (patch) patches.push(patch);
  }
  return patches;
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
  prosodyContext?: SCAProsodyContext;
  fields?: GrammarSyncFieldPatch[];
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
    prosodyContext,
    fields,
  } = input;
  const after = locked
    ? parentAffix
    : transform(parentAffix, childSca, macros, prosodyContext);
  const before = childAffix ?? parentAffix;
  const subFieldChanged = !locked && (fields ?? []).some((patch) => patch.changed);
  const status: GrammarSyncRow["status"] = locked
    ? "locked"
    : before === after && !subFieldChanged
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
    ...(fields && fields.length > 0 ? { fields } : {}),
  };
}

/** 生成同步计划（纯函数，不修改入参） */
export function planGrammarPullSync(
  options: PlanGrammarPullSyncOptions,
): GrammarSyncPlan {
  const {
    parentGrammar,
    childGrammar,
    childSca,
    inventory,
    phonotactics,
    phonology,
    posIds,
  } = options;
  const macros = macrosFor(inventory ?? phonology?.phoneme_inventory, phonotactics ?? phonology?.phonotactics);
  const prosodyContext = prosodyContextFor(phonology);
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
    const childRule = childInflectionById.get(rule.rule_id);
    inflection.push(
      buildRow({
        kind: "inflection",
        ruleId: rule.rule_id,
        tag: rule.tag,
        posId: rule.pos_id,
        parentAffix: rule.affix,
        childAffix: childRule?.affix,
        locked,
        environment: conditionFingerprint(rule.condition),
        childSca,
        macros,
        prosodyContext,
        fields: ruleFieldPatches(rule, childRule, { locked, childSca, macros, prosodyContext }),
      }),
    );
  }

  const derivation: GrammarSyncRow[] = [];
  for (const rule of parentGrammar.derivation_rules) {
    const locked = rule.sca_mutable === false;
    if (locked) lockedCount += 1;
    const childRule = childDerivationById.get(rule.rule_id);
    derivation.push(
      buildRow({
        kind: "derivation",
        ruleId: rule.rule_id,
        tag: rule.name,
        posId: rule.source_pos_id,
        parentAffix: rule.affix,
        childAffix: childRule?.affix,
        locked,
        environment: conditionFingerprint(rule.condition),
        childSca,
        macros,
        prosodyContext,
        fields: ruleFieldPatches(rule, childRule, { locked, childSca, macros, prosodyContext }),
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
        prosodyContext,
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
    if (!row) return rule;
    return applyInflectionFieldPatches({ ...rule, affix: row.after }, row.fields ?? []);
  });
  const derivation_rules: DerivationRule[] = childGrammar.derivation_rules.map((rule) => {
    const row = derivationByRuleId.get(rule.rule_id);
    if (!row) return rule;
    return applySharedFieldPatches({ ...rule, affix: row.after }, row.fields ?? []);
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

interface SharedFieldCarrier {
  condition: ConditionClause | null;
  infix_config?: InfixConfig;
  circumfix_config?: CircumfixConfig;
}

/** 把 condition / infix / circumfix 子字段补丁写入规则（返回新对象） */
function applySharedFieldPatches<T extends SharedFieldCarrier>(
  rule: T,
  patches: readonly GrammarSyncFieldPatch[],
): T {
  let next: T = rule;
  for (const patch of patches) {
    if (!patch.changed) continue;
    switch (patch.field) {
      case "condition.then_affix":
        if (next.condition) {
          next = { ...next, condition: { ...next.condition, then_affix: patch.after } } as T;
        }
        break;
      case "condition.else_affix":
        if (next.condition) {
          next = { ...next, condition: { ...next.condition, else_affix: patch.after } } as T;
        }
        break;
      case "infix_config.morpheme":
        if (next.infix_config) {
          next = {
            ...next,
            infix_config: { ...next.infix_config, morpheme: patch.after },
          } as T;
        }
        break;
      case "circumfix_config.prefix_part":
        if (next.circumfix_config) {
          next = {
            ...next,
            circumfix_config: { ...next.circumfix_config, prefix_part: patch.after },
          } as T;
        }
        break;
      case "circumfix_config.suffix_part":
        if (next.circumfix_config) {
          next = {
            ...next,
            circumfix_config: { ...next.circumfix_config, suffix_part: patch.after },
          } as T;
        }
        break;
      default:
        break;
    }
  }
  return next;
}

/** 屈折规则的全部子字段（含 ablaut） */
function applyInflectionFieldPatches(
  rule: InflectionRule,
  patches: readonly GrammarSyncFieldPatch[],
): InflectionRule {
  let next = applySharedFieldPatches(rule, patches);
  for (const patch of patches) {
    if (!patch.changed || !next.ablaut_config) continue;
    if (patch.field === "ablaut_config.target_vowel") {
      next = {
        ...next,
        ablaut_config: { ...next.ablaut_config, target_vowel: patch.after },
      };
    } else if (patch.field === "ablaut_config.replacement_vowel") {
      next = {
        ...next,
        ablaut_config: { ...next.ablaut_config, replacement_vowel: patch.after },
      };
    }
  }
  return next;
}

/** 计划里是否还有待应用的变更 */
export function hasPendingChanges(plan: GrammarSyncPlan): boolean {
  return (
    plan.inflection.some((row) => row.status === "apply") ||
    plan.derivation.some((row) => row.status === "apply") ||
    plan.irregular.some((row) => row.status === "apply")
  );
}
