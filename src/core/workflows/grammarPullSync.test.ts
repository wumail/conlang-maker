import { describe, expect, test } from "bun:test";
import type {
  GrammarConfig,
  InflectionRule,
  IrregularOverride,
  SCAConfig,
} from "../../types";
import {
  applyGrammarPullSync,
  conditionFingerprint,
  dimensionKey,
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

function override(
  entryId: string,
  surface: string,
  dims: Record<string, string> = { number: "sg" },
): IrregularOverride {
  return { entry_id: entryId, dimension_values: dims, surface_form: surface };
}

function grammar(
  rules: InflectionRule[],
  irregulars: IrregularOverride[] = [],
): GrammarConfig {
  return {
    language_id: "lang",
    parts_of_speech: [],
    typology: {
      morphological_type: "agglutinative",
      synthesis_index: 2,
      fusion_index: 1,
      head_marking: "dependent",
      auto_estimated: false,
    },
    syntax: {
      word_order: "SOV",
      modifier_position: "before_head",
      adposition_type: "postposition",
    },
    inflection_dimensions: [],
    inflection_rules: rules,
    derivation_rules: [],
    affix_slots: [],
    conjugation_classes: [],
    irregular_overrides: irregulars,
    grammar_manual: [],
  };
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

  test("ignores pairs that were already homophonous in the parent", () => {
    const plan = planGrammarPullSync({
      parentGrammar: grammar([rule("r1", "PL", "ler"), rule("r2", "DU", "ler")]),
      childGrammar: grammar([rule("r1", "PL", "ler"), rule("r2", "DU", "ler")]),
      childSca: SCA,
    });
    expect(plan.stats.collisionCount).toBe(0);
  });

  test("does not flag collisions across different environments", () => {
    const plan = planGrammarPullSync({
      parentGrammar: grammar([
        rule("r1", "PL", "lar"),
        rule("r2", "DU", "ler", {
          condition: {
            type: "ends_with_phoneme_class",
            class: "vowel",
            then_affix: "ler",
            else_affix: "lar",
          },
        }),
      ]),
      childGrammar: grammar([]),
      childSca: SCA,
    });
    expect(plan.stats.collisionCount).toBe(0);
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

  test("syncs irregular overrides through the same sound changes", () => {
    const plan = planGrammarPullSync({
      parentGrammar: grammar([], [override("w1", "karan")]),
      childGrammar: grammar([], [override("w1", "karan"), override("w2", "mita")]),
      childSca: SCA,
    });
    expect(plan.irregular).toHaveLength(1);
    expect(plan.irregular[0]).toMatchObject({
      kind: "irregular",
      parentAffix: "karan",
      after: "keren",
      status: "apply",
    });
    expect(plan.stats.irregularChanged).toBe(1);
  });

  test("filters by posIds and never mutates the inputs", () => {
    const parent = grammar([
      rule("r1", "PL", "lar"),
      rule("r2", "PST", "lar", { pos_id: "verb" }),
    ]);
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

describe("stable keys", () => {
  test("conditionFingerprint is order independent and marks no condition", () => {
    expect(conditionFingerprint(null)).toBe("*");
    expect(
      conditionFingerprint({
        type: "matches_regex",
        regex: "^[aeiou]",
        then_affix: "a",
        else_affix: "b",
      }),
    ).toBe('["matches_regex","","^[aeiou]"]');
  });

  test("dimensionKey sorts keys", () => {
    expect(dimensionKey({ number: "sg", case: "nom" })).toBe(
      dimensionKey({ case: "nom", number: "sg" }),
    );
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

  test("writes transformed irregular surface forms", () => {
    const child = grammar([], [override("w1", "karan")]);
    const plan = planGrammarPullSync({
      parentGrammar: grammar([], [override("w1", "karan")]),
      childGrammar: child,
      childSca: SCA,
    });
    const next = applyGrammarPullSync(child, plan);
    expect(next.irregular_overrides[0]?.surface_form).toBe("keren");
    expect(child.irregular_overrides[0]?.surface_form).toBe("karan");
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

  test("evolves and applies every affix subfield (condition / infix / circumfix)", () => {
    const circumfixRule = rule("r_circ", "CIRC", "ler", {
      type: "circumfix",
      condition: {
        type: "ends_with_phoneme_class",
        class: "vowel",
        then_affix: "lar",
        else_affix: "tar",
      },
      circumfix_config: { prefix_part: "ka", suffix_part: "la" },
    });
    const infixRule = rule("r_inf", "INF", "", {
      type: "infix",
      infix_config: { position_regex: "^", morpheme: "an" },
    });
    const parent = grammar([circumfixRule, infixRule]);
    const child = grammar([circumfixRule, infixRule]);

    const plan = planGrammarPullSync({
      parentGrammar: parent,
      childGrammar: child,
      childSca: SCA,
    });

    const circumfixRow = plan.inflection.find((row) => row.ruleId === "r_circ");
    // affix 本身没有变化，但子字段变化同样必须触发 apply
    expect(circumfixRow?.before).toBe("ler");
    expect(circumfixRow?.after).toBe("ler");
    expect(circumfixRow?.status).toBe("apply");
    expect(circumfixRow?.fields).toEqual(
      expect.arrayContaining([
        { field: "condition.then_affix", before: "lar", after: "ler", changed: true },
        { field: "condition.else_affix", before: "tar", after: "ter", changed: true },
        { field: "circumfix_config.prefix_part", before: "ka", after: "ke", changed: true },
        { field: "circumfix_config.suffix_part", before: "la", after: "le", changed: true },
      ]),
    );

    const infixRow = plan.inflection.find((row) => row.ruleId === "r_inf");
    expect(infixRow?.status).toBe("apply");
    expect(infixRow?.fields).toEqual([
      { field: "infix_config.morpheme", before: "an", after: "en", changed: true },
    ]);

    const next = applyGrammarPullSync(child, plan);
    const nextCircumfix = next.inflection_rules.find((item) => item.rule_id === "r_circ");
    expect(nextCircumfix?.condition).toMatchObject({
      then_affix: "ler",
      else_affix: "ter",
    });
    expect(nextCircumfix?.circumfix_config).toEqual({
      prefix_part: "ke",
      suffix_part: "le",
    });
    const nextInfix = next.inflection_rules.find((item) => item.rule_id === "r_inf");
    expect(nextInfix?.infix_config?.morpheme).toBe("en");

    // 入参未被就地修改
    expect(child.inflection_rules[0]?.circumfix_config?.prefix_part).toBe("ka");
    expect(child.inflection_rules[1]?.infix_config?.morpheme).toBe("an");
  });
});
