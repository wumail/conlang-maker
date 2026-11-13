import { describe, expect, test } from "bun:test";
import type { GrammarConfig, InflectionRule, SCAConfig } from "../../types";
import {
  applyGrammarPullSync,
  hasPendingChanges,
  planGrammarPullSync,
} from "./grammarPullSync";

function rule(
  id: string,
  tag: string,
  affix: string,
  overrides: Partial<InflectionRule> = {},
): InflectionRule {
  return {
    rule_id: id,
    pos_id: "noun",
    dimension_values: { number: tag.toLowerCase() },
    type: "suffix",
    affix,
    tag,
    match_regex: ".*",
    disabled: false,
    condition: null,
    sca_mutable: true,
    ...overrides,
  };
}

function grammar(rules: InflectionRule[]): GrammarConfig {
  return {
    language_id: "lang",
    parts_of_speech: [],
    typology: { morphological_type: "agglutinative" } as GrammarConfig["typology"],
    syntax: { word_order: "SOV", modifier_position: "before", adposition_type: "postposition" },
    inflection_dimensions: [],
    inflection_rules: rules,
    derivation_rules: [],
    affix_slots: [],
    conjugation_classes: [],
    irregular_overrides: [],
    chapters: [],
  } as GrammarConfig;
}

/** 把每个 a 变成 e 的子语言音变规则集 */
const SCA: SCAConfig = {
  language_id: "lang",
  rule_sets: [
    {
      ruleset_id: "rs1",
      name: "Raising",
      order: 1,
      rules: [
        {
          rule_id: "raise",
          description: "a → e",
          target: "a",
          replacement: "e",
          context_before: "",
          context_after: "",
          exceptions: [],
          feature_mode: false,
          target_features: null,
          replacement_features: null,
          context_before_features: null,
          context_after_features: null,
        },
      ],
    },
  ],
};

describe("planGrammarPullSync", () => {
  test("transforms affixes through the child sound changes", () => {
    const plan = planGrammarPullSync({
      parentGrammar: grammar([rule("r1", "PL", "lar")]),
      childGrammar: grammar([rule("r1", "PL", "lar")]),
      childSca: SCA,
    });
    expect(plan.inflection).toHaveLength(1);
    expect(plan.inflection[0]).toMatchObject({
      ruleId: "r1",
      before: "lar",
      after: "ler",
      status: "apply",
      existsInChild: true,
    });
    expect(plan.stats.inflectionChanged).toBe(1);
    expect(hasPendingChanges(plan)).toBe(true);
  });

  test("skips locked rules (sca_mutable: false)", () => {
    const plan = planGrammarPullSync({
      parentGrammar: grammar([rule("r1", "PL", "lar", { sca_mutable: false })]),
      childGrammar: grammar([]),
      childSca: SCA,
    });
    expect(plan.inflection[0]).toMatchObject({ after: "lar", status: "locked" });
    expect(plan.stats.lockedCount).toBe(1);
    expect(hasPendingChanges(plan)).toBe(false);
  });

  test("marks already-synced rules as unchanged", () => {
    const plan = planGrammarPullSync({
      parentGrammar: grammar([rule("r1", "PL", "ler")]),
      childGrammar: grammar([rule("r1", "PL", "ler")]),
      childSca: SCA,
    });
    expect(plan.inflection[0]?.status).toBe("unchanged");
    expect(hasPendingChanges(plan)).toBe(false);
  });

  test("detects syncretism when two tags collapse to the same form", () => {
    const plan = planGrammarPullSync({
      parentGrammar: grammar([rule("r1", "PL", "lar"), rule("r2", "DU", "ler")]),
      childGrammar: grammar([rule("r1", "PL", "lar"), rule("r2", "DU", "ler")]),
      childSca: SCA,
    });
    expect(plan.stats.collisionCount).toBe(1);
    expect(plan.collisions[0]).toMatchObject({
      posId: "noun",
      tags: ["DU", "PL"],
      form: "ler",
    });
  });

  test("does not flag collisions across different parts of speech", () => {
    const plan = planGrammarPullSync({
      parentGrammar: grammar([
        rule("r1", "PL", "lar"),
        rule("r2", "PL", "lar", { pos_id: "verb" }),
      ]),
      childGrammar: grammar([]),
      childSca: SCA,
    });
    expect(plan.stats.collisionCount).toBe(0);
  });

  test("filters by posIds and never mutates the inputs", () => {
    const parent = grammar([rule("r1", "PL", "lar"), rule("r2", "PST", "lar", { pos_id: "verb" })]);
    const plan = planGrammarPullSync({
      parentGrammar: parent,
      childGrammar: grammar([]),
      childSca: SCA,
      posIds: ["noun"],
    });
    expect(plan.inflection.map((row) => row.ruleId)).toEqual(["r1"]);
    expect(parent.inflection_rules[0]?.affix).toBe("lar");
  });
});

describe("applyGrammarPullSync", () => {
  test("writes transformed affixes into the child grammar", () => {
    const child = grammar([rule("r1", "PL", "lar")]);
    const plan = planGrammarPullSync({
      parentGrammar: grammar([rule("r1", "PL", "lar")]),
      childGrammar: child,
      childSca: SCA,
    });
    const next = applyGrammarPullSync(child, plan);
    expect(next.inflection_rules[0]?.affix).toBe("ler");
    // 入参未被就地修改
    expect(child.inflection_rules[0]?.affix).toBe("lar");
  });

  test("honours skipRuleIds", () => {
    const child = grammar([rule("r1", "PL", "lar"), rule("r2", "DU", "lar")]);
    const plan = planGrammarPullSync({
      parentGrammar: grammar([rule("r1", "PL", "lar"), rule("r2", "DU", "lar")]),
      childGrammar: child,
      childSca: SCA,
    });
    const next = applyGrammarPullSync(child, plan, { skipRuleIds: ["r2"] });
    expect(next.inflection_rules[0]?.affix).toBe("ler");
    expect(next.inflection_rules[1]?.affix).toBe("lar");
  });

  test("does not create rules that only exist in the parent", () => {
    const child = grammar([]);
    const plan = planGrammarPullSync({
      parentGrammar: grammar([rule("r1", "PL", "lar")]),
      childGrammar: child,
      childSca: SCA,
    });
    expect(plan.inflection[0]?.existsInChild).toBe(false);
    const next = applyGrammarPullSync(child, plan);
    expect(next.inflection_rules).toHaveLength(0);
  });
});
