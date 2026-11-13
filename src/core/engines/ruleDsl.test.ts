import { describe, expect, test } from "bun:test";
import type { AllophonyRule, RomanizationRule, SCARule } from "../../types";
import {
  parseAllophonyDsl,
  parseRomanizationDsl,
  parseScaRulesDsl,
  serializeAllophonyDsl,
  serializeRomanizationDsl,
  serializeScaRulesDsl,
} from "./ruleDsl";

describe("romanization DSL", () => {
  const rules: RomanizationRule[] = [
    {
      rule_id: "rule_sh",
      input: "sh",
      output_phoneme: "ʃ",
      context_before: "",
      context_after: "",
    },
    {
      rule_id: "rule_k",
      input: "k",
      output_phoneme: "tʃ",
      context_before: "",
      context_after: "i",
    },
    {
      rule_id: "rule_sep",
      input: "'-",
      output_phoneme: "",
      context_before: "",
      context_after: "",
      output_type: "separator",
    },
    {
      rule_id: "rule_drop",
      input: "h",
      output_phoneme: "",
      context_before: "V",
      context_after: "V",
    },
  ];

  test("round-trips form → DSL → form losslessly, keeping rule ids", () => {
    const dsl = serializeRomanizationDsl(rules);
    expect(dsl).toContain("sh -> ʃ  @id:rule_sh");
    expect(dsl).toContain("'- -> [sep]  @id:rule_sep");
    const parsed = parseRomanizationDsl(dsl);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rules).toEqual(rules);
  });

  test("accepts > and → arrows plus the 0 empty marker", () => {
    const parsed = parseRomanizationDsl("a > 0 / b _ c\nsh → ʃ");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rules[0]).toMatchObject({
      input: "a",
      output_phoneme: "",
      context_before: "b",
      context_after: "c",
    });
    expect(parsed.rules[1]).toMatchObject({ input: "sh", output_phoneme: "ʃ" });
    expect(parsed.rules[0]!.rule_id).toStartWith("rule_");
  });

  test("ignores blank lines and full-line comments", () => {
    const parsed = parseRomanizationDsl("\n# 注释\n   \nsh -> ʃ\n");
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.diagnostics).toEqual([]);
  });

  test("reports a diagnostic with the 1-based line number when the arrow is missing", () => {
    const parsed = parseRomanizationDsl("sh -> ʃ\nbroken line");
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.diagnostics).toEqual([{ line: 2, message: "Missing arrow (-> / > / →)" }]);
  });
});

describe("allophony DSL", () => {
  const rules: AllophonyRule[] = [
    {
      rule_id: "allo_1",
      description: "voicing between vowels",
      target: "t",
      replacement: "d",
      context_before: "V",
      context_after: "V",
      priority: 1,
    },
    {
      rule_id: "allo_2",
      description: "",
      target: "k",
      replacement: "x",
      context_before: "",
      context_after: "",
      priority: 2,
    },
  ];

  test("round-trips with description, empty context and priority renumbering", () => {
    const dsl = serializeAllophonyDsl(rules);
    expect(dsl).toContain("t -> d / V _ V  # voicing between vowels  @id:allo_1");
    expect(dsl).toContain("k -> x  @id:allo_2");
    const parsed = parseAllophonyDsl(dsl);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rules).toEqual(rules);
  });

  test("renumbers priority by line order", () => {
    const parsed = parseAllophonyDsl("a -> b  @id:x\nc -> d  @id:y");
    expect(parsed.rules.map((rule) => rule.priority)).toEqual([1, 2]);
  });

  test("keeps word-boundary contexts intact instead of treating # as a comment", () => {
    const parsed = parseAllophonyDsl("t -> d / # _ #  @id:allo_boundary");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rules[0]).toMatchObject({
      context_before: "#",
      context_after: "#",
      description: "",
    });
  });

  test("treats # descriptions containing _ or / as comments, not word boundaries", () => {
    const parsed = parseAllophonyDsl(
      "t -> d / V _ V  # voiced_stop  @id:allo_desc1\nk -> g  # C/V  @id:allo_desc2",
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rules[0]).toMatchObject({
      target: "t",
      replacement: "d",
      context_before: "V",
      context_after: "V",
      description: "voiced_stop",
    });
    expect(parsed.rules[1]).toMatchObject({
      target: "k",
      replacement: "g",
      context_before: "",
      context_after: "",
      description: "C/V",
    });
  });

  test("keeps both word-boundary markers when a description follows them", () => {
    const parsed = parseAllophonyDsl(
      "t -> d / # _ #  # word boundary devoicing  @id:allo_boundary_desc",
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rules[0]).toMatchObject({
      context_before: "#",
      context_after: "#",
      description: "word boundary devoicing",
    });
  });

  test("comment-only input clears the rule set instead of failing", () => {
    const parsed = parseAllophonyDsl("# 只有注释\n   \n# another C/V / _ note");
    expect(parsed.rules).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe("SCA rules DSL", () => {
  const rules: SCARule[] = [
    {
      rule_id: "sca_voice",
      description: "intervocalic voicing",
      target: "p t k",
      replacement: "b d g",
      context_before: "V",
      context_after: "V",
      exceptions: ["pt", "kt"],
      feature_mode: false,
      target_features: null,
      replacement_features: null,
      context_before_features: null,
      context_after_features: null,
    },
    {
      rule_id: "sca_feature",
      description: "feature voicing",
      target: "",
      replacement: "",
      context_before: "",
      context_after: "",
      exceptions: [],
      feature_mode: true,
      target_features: { positive: ["stop"], negative: ["voiced"] },
      replacement_features: { set_features: ["voiced"], remove_features: [] },
      context_before_features: { positive: ["vowel"], negative: [] },
      context_after_features: { positive: ["vowel"], negative: [] },
    },
  ];

  test("round-trips character and feature rules with ids and exceptions", () => {
    const dsl = serializeScaRulesDsl(rules);
    expect(dsl).toContain("p t k -> b d g / V _ V  ! pt, kt  # intervocalic voicing  @id:sca_voice");
    expect(dsl).toContain(
      "[+stop, -voiced] -> [+voiced] / [+vowel] _ [+vowel]  # feature voicing  @id:sca_feature",
    );
    const parsed = parseScaRulesDsl(dsl);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rules).toEqual(rules);
  });

  test("detects feature mode from bracketed targets", () => {
    const parsed = parseScaRulesDsl("[+vowel, -long] -> [-stressed]");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rules[0]).toMatchObject({
      feature_mode: true,
      target_features: { positive: ["vowel"], negative: ["long"] },
      replacement_features: { set_features: [], remove_features: ["stressed"] },
    });
  });

  test("reports malformed feature rules without dropping other lines", () => {
    const parsed = parseScaRulesDsl("[+stop] -> voiced\np -> b");
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]!.line).toBe(1);
  });

  test("normalises whitespace and trailing ids on new lines", () => {
    const parsed = parseScaRulesDsl("  a   ->   b   /   C _   ");
    expect(parsed.rules[0]).toMatchObject({
      target: "a",
      replacement: "b",
      context_before: "C",
      context_after: "",
    });
    expect(parsed.rules[0]!.rule_id).toStartWith("sca_");
  });
});
