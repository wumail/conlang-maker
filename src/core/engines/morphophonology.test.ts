import { describe, expect, test } from "bun:test";
import type { MorphophonologyRule, PhonologyConfig } from "../../types";
import { applyMorphophonology, surfaceOf, tokenizeWithBoundaries } from "./morphophonology";

const PHONO: PhonologyConfig = {
  language_id: "lang_mph",
  phoneme_inventory: {
    consonants: ["p", "b", "t", "d", "k", "g", "l", "r", "v", "m", "n", "s"],
    vowels: ["a", "e", "i", "o", "u", "ɯ"],
  },
  romanization_maps: [],
  allophony_rules: [],
  phonotactics: {
    macros: {},
    syllable_structure: "(C)V(C)",
    blacklist_patterns: [],
    vowel_harmony: { enabled: false, group_a: [], group_b: [] },
    tone_system: { enabled: false, tones: [] },
    stress: null,
  },
};

function rule(overrides: Partial<MorphophonologyRule>): MorphophonologyRule {
  return {
    rule_id: "r1",
    description: "",
    priority: 0,
    target: "",
    replacement: "",
    context_before: "",
    context_after: "",
    feature_mode: false,
    target_features: null,
    replacement_features: null,
    context_before_features: null,
    context_after_features: null,
    ...overrides,
  };
}

describe("tokenizeWithBoundaries", () => {
  test("marks the first token after each morpheme boundary", () => {
    const tokens = tokenizeWithBoundaries("ev+lar", PHONO.phoneme_inventory);
    expect(tokens.map((token) => token.value)).toEqual(["e", "v", "l", "a", "r"]);
    expect(tokens.map((token) => token.boundaryBefore)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  test("surfaceOf strips boundaries", () => {
    expect(surfaceOf("ev+lar")).toBe("evlar");
  });
});

describe("applyMorphophonology", () => {
  const harmony = rule({
    rule_id: "harmony",
    description: "a → e after front-vowel stems",
    target: "a",
    replacement: "e",
    context_before: "e C* +",
  });

  test("applies Turkish-style vowel harmony across the boundary", () => {
    const result = applyMorphophonology("ev+lar", [harmony], PHONO);
    expect(result.surface).toBe("evler");
    expect(result.intermediate).toBe("ev+ler");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.ruleId).toBe("harmony");
  });

  test("does not touch back-vowel stems", () => {
    const result = applyMorphophonology("at+lar", [harmony], PHONO);
    expect(result.surface).toBe("atlar");
    expect(result.steps).toHaveLength(0);
  });

  test("boundary is required: the same rule does not fire inside a morpheme", () => {
    const result = applyMorphophonology("evlat", [harmony], PHONO);
    expect(result.surface).toBe("evlat");
  });

  test("supports voicing conditioned on the following morpheme", () => {
    const voicing = rule({
      rule_id: "voice",
      target: "p",
      replacement: "b",
      context_before: "V",
      context_after: "+ V",
    });
    expect(applyMorphophonology("kitap+ɯ", [voicing], PHONO).surface).toBe("kitabɯ");
    expect(applyMorphophonology("kitap", [voicing], PHONO).surface).toBe("kitap");
  });

  test("respects priority order", () => {
    const drop = rule({
      rule_id: "drop",
      priority: 0,
      target: "e",
      replacement: "",
      context_after: "r #",
    });
    const raise = rule({
      rule_id: "raise",
      priority: 0,
      target: "a",
      replacement: "e",
      context_after: "r #",
    });
    // 同优先级保持数组顺序：先升后删 → 新升上来的 e 被删掉
    expect(applyMorphophonology("ev+lar", [raise, drop], PHONO).surface).toBe("evlr");
    // 先删后升 → 删除时还没有 e，升后的 e 保留
    expect(applyMorphophonology("ev+lar", [drop, raise], PHONO).surface).toBe("evler");

    // 显式 priority 覆盖数组顺序
    const lateRaise = { ...raise, priority: 5 };
    expect(applyMorphophonology("ev+lar", [lateRaise, drop], PHONO).surface).toBe("evler");
  });

  test("skips disabled and feature-mode rules", () => {
    const disabled = { ...harmony, disabled: true };
    expect(applyMorphophonology("ev+lar", [disabled], PHONO).surface).toBe("evlar");
    const featureRule = { ...harmony, feature_mode: true };
    expect(applyMorphophonology("ev+lar", [featureRule], PHONO).surface).toBe("evlar");
  });

  test("supports deletion and multi-token replacement", () => {
    const epenthesis = rule({
      rule_id: "epenthesis",
      target: "∅",
      replacement: "",
      context_before: "#",
      context_after: "s",
    });
    // ∅ 目标不匹配任何 token，天然不生效——此处只验证不崩
    expect(applyMorphophonology("st", [epenthesis], PHONO).surface).toBe("st");

    const prothesis = rule({
      rule_id: "prothesis",
      target: "a",
      replacement: "ʔ a",
      context_before: "#",
    });
    expect(applyMorphophonology("aka", [prothesis], PHONO).surface).toBe("ʔaka");
  });

  test("applies at every matching position", () => {
    const spread = rule({
      rule_id: "spread",
      target: "a",
      replacement: "e",
      context_before: "e",
    });
    expect(applyMorphophonology("e+akar", [spread], PHONO).surface).toBe("eekar");
    // 已稳定时再次应用不产生新步骤
    const once = applyMorphophonology("e+ekar", [spread], PHONO);
    expect(once.steps).toHaveLength(0);
  });
});
