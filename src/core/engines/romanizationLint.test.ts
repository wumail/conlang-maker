import { describe, expect, test } from "bun:test";
import type { PhonologyConfig } from "../../types";
import {
  analyzeRomanization,
  findCaseIssues,
  findConflictingRules,
  findDuplicateRules,
  findShadowedRules,
  findUnknownOutputPhonemes,
  findUnreachablePhonemes,
} from "./romanizationLint";

const testConfig: PhonologyConfig = {
  language_id: "lang_lint",
  phoneme_inventory: {
    // `ŋ` 的字形被规则改写且无任何规则生成回来 → 真正不可达（issue #1）
    consonants: ["p", "t", "k", "s", "tʃ", "n", "ŋ"],
    vowels: ["a", "i"],
  },
  romanization_maps: [
    {
      map_id: "map_main",
      name: "Main",
      is_default: true,
      rules: [
        // Duplicate rules (issue #4): p -> p twice
        { rule_id: "r_p1", input: "p", output_phoneme: "p", context_before: "", context_after: "" },
        { rule_id: "r_p2", input: "p", output_phoneme: "p", context_before: "", context_after: "" },
        // Conflicting rules (issue #3): k -> k and k -> t under same empty context
        { rule_id: "r_k1", input: "k", output_phoneme: "k", context_before: "", context_after: "" },
        { rule_id: "r_k2", input: "k", output_phoneme: "t", context_before: "", context_after: "" },
        // Unknown output phoneme (issue #2): z -> ʒ (not in inventory)
        { rule_id: "r_z", input: "z", output_phoneme: "ʒ", context_before: "", context_after: "" },
        // Greedy shadowing (issue #5): unconditional "ch" -> tʃ shadows "c" -> s / _h and "h" -> s / c_
        { rule_id: "r_ch", input: "ch", output_phoneme: "tʃ", context_before: "", context_after: "" },
        { rule_id: "r_c_before_h", input: "c", output_phoneme: "s", context_before: "", context_after: "h" },
        { rule_id: "r_h_after_c", input: "h", output_phoneme: "s", context_before: "c", context_after: "" },
        // Valid non-shadowed contextual rule: "c" -> s / _i vs "c" -> k
        { rule_id: "r_c_gen", input: "c", output_phoneme: "k", context_before: "", context_after: "" },
        { rule_id: "r_c_i", input: "c", output_phoneme: "s", context_before: "", context_after: "i" },
        // Case issue (issue #6): uppercase "S" -> s
        { rule_id: "r_upper_s", input: "S", output_phoneme: "s", context_before: "", context_after: "" },
        // `ŋ` 被改写成 n，且没有规则能生成 ŋ → 键入 ŋ 也拿不到它
        { rule_id: "r_eng", input: "ŋ", output_phoneme: "n", context_before: "", context_after: "" },
        // Vowels
        { rule_id: "r_a", input: "a", output_phoneme: "a", context_before: "", context_after: "" },
        { rule_id: "r_i", input: "i", output_phoneme: "i", context_before: "", context_after: "" },
      ],
    },
  ],
  phonotactics: {
    macros: {},
    syllable_structure: "CV",
    blacklist_patterns: [],
    vowel_harmony: { enabled: false, group_a: [], group_b: [] },
    tone_system: { enabled: false, tones: [] },
  },
  allophony_rules: [],
};

describe("romanizationLint 6 analyses (PRD §5.2 / T2.8)", () => {
  test("1. findUnreachablePhonemes detects inventory phonemes with zero producing rules", () => {
    const unreachable = findUnreachablePhonemes(
      testConfig.phoneme_inventory,
      testConfig.romanization_maps,
    );
    expect(unreachable).toEqual([{ phoneme: "ŋ", category: "consonant" }]);
  });

  test("1b. phonemes without rules stay reachable through generator passthrough", () => {
    // 用户实际遇到的场景：inventory 里有 ə / ʊ / uˑ，映射表未覆盖，
    // 但 ipaGenerator 会原样透传，因此键入字形即可写出，不应报「不可达」。
    const inventory = {
      consonants: ["p", "t"],
      vowels: ["a", "ə", "ʊ", "uˑ"],
    };
    const maps = [
      {
        map_id: "map_pass",
        name: "Pass",
        is_default: true,
        rules: [
          { rule_id: "p", input: "p", output_phoneme: "p", context_before: "", context_after: "" },
          { rule_id: "a", input: "a", output_phoneme: "a", context_before: "", context_after: "" },
        ],
      },
    ];
    expect(findUnreachablePhonemes(inventory, maps)).toEqual([]);
  });

  test("1c. word-initial / word-final mutations do not fake an unreachable phoneme", () => {
    // 回归：`a → æ / #_` 与 `a → ɑ / _#` 同时命中单音素探针，
    // 会让词中的 `a`（原样透传）被误报为不可达。
    const inventory = { consonants: ["p", "t", "k"], vowels: ["a", "i"] };
    const maps = [
      {
        map_id: "map_boundary",
        name: "Boundary",
        is_default: true,
        rules: [
          { rule_id: "a_init", input: "a", output_phoneme: "æ", context_before: "#", context_after: "" },
          { rule_id: "a_final", input: "a", output_phoneme: "ɑ", context_before: "", context_after: "#" },
          { rule_id: "i", input: "i", output_phoneme: "i", context_before: "", context_after: "" },
        ],
      },
    ];
    expect(findUnreachablePhonemes(inventory, maps)).toEqual([]);
  });

  test("1d. a phoneme rewritten in every position is still reported", () => {
    // 反向保护：词中各位置都被规则改写（哨兵探测也无法透传）时必须继续报不可达，
    // 修复假阳性不能把真阳性一起吞掉。
    const inventory = { consonants: ["p", "ŋ"], vowels: ["a"] };
    const maps = [
      {
        map_id: "map_rewrite",
        name: "Rewrite",
        is_default: true,
        rules: [
          { rule_id: "eng", input: "ŋ", output_phoneme: "n", context_before: "", context_after: "" },
          { rule_id: "a", input: "a", output_phoneme: "a", context_before: "", context_after: "" },
        ],
      },
    ];
    expect(findUnreachablePhonemes(inventory, maps)).toEqual([
      { phoneme: "ŋ", category: "consonant" },
    ]);
  });

  test("2. findUnknownOutputPhonemes detects rule outputs outside phoneme_inventory", () => {
    const unknown = findUnknownOutputPhonemes(
      testConfig.phoneme_inventory,
      testConfig.romanization_maps,
    );
    expect(unknown).toEqual([
      {
        map_id: "map_main",
        map_name: "Main",
        rule_id: "r_z",
        input: "z",
        output_phoneme: "ʒ",
        unknown_tokens: ["ʒ"],
      },
    ]);
  });

  test("3. findConflictingRules detects same condition with different output_phoneme", () => {
    const conflicts = findConflictingRules(testConfig.romanization_maps);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.input).toBe("k");
    expect(conflicts[0]?.rules.map((r) => r.rule_id)).toEqual(["r_k1", "r_k2"]);
  });

  test("4. findDuplicateRules detects identical input, context, and output_phoneme", () => {
    const duplicates = findDuplicateRules(testConfig.romanization_maps);
    expect(duplicates).toEqual([
      {
        map_id: "map_main",
        map_name: "Main",
        input: "p",
        context_before: "",
        context_after: "",
        output_phoneme: "p",
        rule_ids: ["r_p1", "r_p2"],
      },
    ]);
  });

  test("5. findShadowedRules detects rules shadowed by greedy longer match or consumption, without flagging valid contextual rules", () => {
    const shadowed = findShadowedRules(testConfig.romanization_maps);
    const shadowedIds = shadowed.map((s) => s.shadowed_rule_id);
    expect(shadowedIds).toContain("r_c_before_h");
    expect(shadowedIds).toContain("r_h_after_c");
    expect(shadowedIds).not.toContain("r_c_i");
    expect(shadowedIds).not.toContain("r_p2");
  });

  test("6. findCaseIssues detects uppercase/mixed-case rules and case collisions", () => {
    const caseIssues = findCaseIssues(testConfig.romanization_maps);
    expect(caseIssues).toEqual([
      {
        map_id: "map_main",
        map_name: "Main",
        rule_id: "r_upper_s",
        input: "S",
        context_before: "",
        context_after: "",
        reason: "uppercase_input_case_folded",
      },
    ]);
  });

  test("analyzeRomanization aggregates all 6 checks cleanly", () => {
    const result = analyzeRomanization(testConfig);
    expect(result.map_ids).toEqual(["map_main"]);
    expect(result.summary.unreachable_phonemes).toBe(1);
    expect(result.summary.unknown_output_phonemes).toBe(1);
    expect(result.summary.conflicting_rules).toBe(1);
    expect(result.summary.duplicate_rules).toBe(1);
    expect(result.summary.shadowed_rules).toBe(2);
    expect(result.summary.case_issues).toBe(1);
    expect(result.summary.issue_count).toBe(7);
  });
});
