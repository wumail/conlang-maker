import { describe, expect, test } from "bun:test";
import type { PhonologyConfig, RomanizationMap } from "../../types";
import {
  applyAllophony,
  applyAllophonyTraced,
  generateIPA,
  generateIPATraced,
  romanizationToPhonemes,
  romanizationToPhonemesTraced,
} from "./ipaGenerator";

function makeMap(
  rules: Array<{
    rule_id?: string;
    input: string;
    output_phoneme: string;
    context_before?: string;
    context_after?: string;
  }>,
): RomanizationMap {
  return {
    map_id: "default",
    name: "Default",
    is_default: true,
    rules: rules.map((r, idx) => ({
      rule_id: r.rule_id ?? `r${idx}`,
      input: r.input,
      output_phoneme: r.output_phoneme,
      context_before: r.context_before ?? "",
      context_after: r.context_after ?? "",
    })),
  };
}

function makeConfig(
  map: RomanizationMap,
  overrides?: Partial<PhonologyConfig>,
): PhonologyConfig {
  return {
    language_id: "test",
    phoneme_inventory: { consonants: ["p", "t", "d", "k", "s", "ʃ"], vowels: ["a", "i", "u", "aː"] },
    romanization_maps: [map],
    phonotactics: {
      macros: { V: ["a", "i", "u"], C: ["p", "t", "d", "k", "s", "ʃ"] },
      syllable_structure: "(C)V",
      blacklist_patterns: [],
      vowel_harmony: { enabled: false, group_a: [], group_b: [] },
      tone_system: { enabled: false, tones: [] },
    },
    allophony_rules: [],
    ...overrides,
  };
}

describe("romanizationToPhonemes & generateIPA (legacy + T1.7 traced)", () => {
  test("greedy longest match and case-insensitive spelling", () => {
    const map = makeMap([
      { input: "s", output_phoneme: "s" },
      { input: "sh", output_phoneme: "ʃ" },
      { input: "a", output_phoneme: "a" },
      { input: "ā", output_phoneme: "aː" },
    ]);
    expect(romanizationToPhonemes("Shāsa", map)).toBe("ʃaːsa");
  });

  test("context-specific rules beat general rules of equal input length", () => {
    const map = makeMap([
      { input: "c", output_phoneme: "k" },
      { input: "c", output_phoneme: "s", context_after: "e" },
      { input: "e", output_phoneme: "e" },
      { input: "a", output_phoneme: "a" },
    ]);
    expect(romanizationToPhonemes("ceca", map)).toBe("seka");
  });

  test("word boundaries (#) respect Unicode letters including supplementary planes", () => {
    const map = makeMap([
      { input: "s", output_phoneme: "z", context_before: "a", context_after: "#" },
      { input: "s", output_phoneme: "s" },
      { input: "a", output_phoneme: "a" },
    ]);
    expect(romanizationToPhonemes("as.", map)).toBe("az.");
    expect(romanizationToPhonemes("as sa", map)).toBe("az sa");
    expect(romanizationToPhonemes("as𐐀", map)).toBe("as𐐨");
  });

  test("generateIPA produces phonemic and surface representations", () => {
    const config = makeConfig(
      makeMap([
        { input: "t", output_phoneme: "t" },
        { input: "a", output_phoneme: "a" },
      ]),
      {
        phoneme_inventory: { consonants: ["t", "d"], vowels: ["a"] },
        phonotactics: {
          macros: { V: ["a"] },
          syllable_structure: "(C)V",
          blacklist_patterns: [],
          vowel_harmony: { enabled: false, group_a: [], group_b: [] },
          tone_system: { enabled: false, tones: [] },
        },
        allophony_rules: [
          {
            rule_id: "intervocalic-voicing",
            description: "t > d / V_V",
            target: "t",
            replacement: "d",
            context_before: "V",
            context_after: "V",
            priority: 1,
          },
        ],
      },
    );

    expect(generateIPA("tata", config)).toEqual({
      phonemic: "/tata/",
      surface: "[tada]",
    });
  });

  test("T1.7: cix context match reports exact segment spans and rule IDs", () => {
    const map = makeMap([
      { rule_id: "r_c_k", input: "c", output_phoneme: "k" },
      { rule_id: "r_c_s", input: "c", output_phoneme: "s", context_after: "i" },
      { rule_id: "r_i", input: "i", output_phoneme: "i" },
      { rule_id: "r_x", input: "x", output_phoneme: "ʃ" },
    ]);

    const traced = romanizationToPhonemesTraced("cix", map);
    expect(traced.output).toBe("siʃ");
    expect(traced.output).toBe(romanizationToPhonemes("cix", map));
    expect(traced.segments).toEqual([
      {
        start: 0,
        end: 1,
        normalized_start: 0,
        normalized_end: 1,
        source_spans: [{ start: 0, end: 1 }],
        input: "c",
        normalized_input: "c",
        output: "s",
        rule_id: "r_c_s",
        kind: "matched",
      },
      {
        start: 1,
        end: 2,
        normalized_start: 1,
        normalized_end: 2,
        source_spans: [{ start: 1, end: 2 }],
        input: "i",
        normalized_input: "i",
        output: "i",
        rule_id: "r_i",
        kind: "matched",
      },
      {
        start: 2,
        end: 3,
        normalized_start: 2,
        normalized_end: 3,
        source_spans: [{ start: 2, end: 3 }],
        input: "x",
        normalized_input: "x",
        output: "ʃ",
        rule_id: "r_x",
        kind: "matched",
      },
    ]);
  });

  test("T1.7: unknown uppercase character uses lowercase fallback with rule_id null", () => {
    const map = makeMap([{ rule_id: "r_a", input: "a", output_phoneme: "a" }]);
    const traced = romanizationToPhonemesTraced("Qa", map);
    expect(traced.output).toBe("qa");
    expect(traced.output).toBe(romanizationToPhonemes("Qa", map));
    expect(traced.segments[0]).toEqual({
      start: 0,
      end: 1,
      normalized_start: 0,
      normalized_end: 1,
      source_spans: [{ start: 0, end: 1 }],
      input: "Q",
      normalized_input: "Q",
      output: "q",
      rule_id: null,
      kind: "fallback",
    });
  });

  test("T1.7: empty map or empty-input-only map preserves case and returns NFC passthrough", () => {
    const emptyMap = makeMap([]);
    const raw = "Qa\u0304"; // 3 raw codepoints -> 2 NFC codepoints ("Qā")
    const traced = romanizationToPhonemesTraced(raw, emptyMap);
    expect(traced.output).toBe("Qā");
    expect(traced.output).toBe(romanizationToPhonemes(raw, emptyMap));
    expect(traced.segments).toEqual([
      {
        start: 0,
        end: 1,
        normalized_start: 0,
        normalized_end: 1,
        source_spans: [{ start: 0, end: 1 }],
        input: "Q",
        normalized_input: "Q",
        output: "Q",
        rule_id: null,
        kind: "passthrough",
      },
      {
        start: 1,
        end: 3,
        normalized_start: 1,
        normalized_end: 2,
        source_spans: [{ start: 1, end: 3 }],
        input: "a\u0304",
        normalized_input: "ā",
        output: "ā",
        rule_id: null,
        kind: "passthrough",
      },
    ]);

    const blankRulesMap = makeMap([{ rule_id: "empty", input: "", output_phoneme: "p" }]);
    const tracedBlank = romanizationToPhonemesTraced("AbC", blankRulesMap);
    expect(tracedBlank.output).toBe("AbC");
    expect(tracedBlank.segments.every((s) => s.kind === "passthrough")).toBe(true);
  });

  test("T1.7: NFD macron (a + U+0304) maps normalized ā back to 2-codepoint raw span", () => {
    const map = makeMap([
      { rule_id: "r_sh", input: "sh", output_phoneme: "ʃ" },
      { rule_id: "r_aa", input: "ā", output_phoneme: "aː" },
    ]);
    const raw = "sha\u0304"; // 's' (0), 'h' (1), 'a' (2), '\u0304' (3)
    const traced = romanizationToPhonemesTraced(raw, map);
    expect(traced.normalized_input).toBe("shā");
    expect(traced.output).toBe("ʃaː");
    expect(traced.segments).toEqual([
      {
        start: 0,
        end: 2,
        normalized_start: 0,
        normalized_end: 2,
        source_spans: [{ start: 0, end: 2 }],
        input: "sh",
        normalized_input: "sh",
        output: "ʃ",
        rule_id: "r_sh",
        kind: "matched",
      },
      {
        start: 2,
        end: 4,
        normalized_start: 2,
        normalized_end: 3,
        source_spans: [{ start: 2, end: 4 }],
        input: "a\u0304",
        normalized_input: "ā",
        output: "aː",
        rule_id: "r_aa",
        kind: "matched",
      },
    ]);
  });

  test("T1.7: canonical combining class reordering tracks exact raw codepoint provenance", () => {
    // 'q' (0) + macron U+0304 CCC=230 (1) + dot-below U+0323 CCC=220 (2)
    // NFC reorders to 'q' (from 0), U+0323 (from 2), U+0304 (from 1)
    const raw = "q\u0304\u0323";
    const map = makeMap([
      { rule_id: "r_q", input: "q", output_phoneme: "q" },
      { rule_id: "r_dot", input: "\u0323", output_phoneme: "ˤ" },
      { rule_id: "r_mac", input: "\u0304", output_phoneme: "ː" },
    ]);

    const traced = romanizationToPhonemesTraced(raw, map);
    expect(traced.output).toBe("qˤː");
    expect(traced.output).toBe(romanizationToPhonemes(raw, map));
    expect(traced.segments[0]?.source_spans).toEqual([{ start: 0, end: 1 }]);
    expect(traced.segments[1]?.source_spans).toEqual([{ start: 2, end: 3 }]);
    expect(traced.segments[1]?.input).toBe("\u0323");
    expect(traced.segments[2]?.source_spans).toEqual([{ start: 1, end: 2 }]);
    expect(traced.segments[2]?.input).toBe("\u0304");
  });

  test("T1.7: supplementary plane characters use Unicode codepoint indices (not UTF-16 units)", () => {
    // '𐐀' (U+10400, 2 UTF-16 code units, 1 codepoint) + 'a' (index 1)
    const map = makeMap([{ rule_id: "r_a", input: "a", output_phoneme: "a" }]);
    const raw = "𐐀a";
    const traced = romanizationToPhonemesTraced(raw, map);
    expect(traced.output).toBe("𐐨a");
    expect(traced.segments[0]).toMatchObject({
      start: 0,
      end: 1,
      normalized_start: 0,
      normalized_end: 1,
      input: "𐐀",
      output: "𐐨",
      kind: "fallback",
    });
    expect(traced.segments[1]).toMatchObject({
      start: 1,
      end: 2,
      normalized_start: 1,
      normalized_end: 2,
      input: "a",
      output: "a",
      rule_id: "r_a",
      kind: "matched",
    });
  });

  test("T1.7: generateIPATraced tracks t->d / V_V match, no-match, serial priority, replacement patterns, and invalid regex", () => {
    const map = makeMap([
      { rule_id: "r_t", input: "t", output_phoneme: "t" },
      { rule_id: "r_a", input: "a", output_phoneme: "a" },
      { rule_id: "r_n", input: "n", output_phoneme: "n" },
    ]);
    const config = makeConfig(map, {
      phonotactics: {
        macros: { V: ["a"] },
        syllable_structure: "(C)V",
        blacklist_patterns: [],
        vowel_harmony: { enabled: false, group_a: [], group_b: [] },
        tone_system: { enabled: false, tones: [] },
      },
      allophony_rules: [
        {
          rule_id: "r2_flap",
          description: "d > ɾ / V_V (lower priority, runs second)",
          target: "d",
          replacement: "ɾ",
          context_before: "V",
          context_after: "V",
          priority: 5,
        },
        {
          rule_id: "r1_voice",
          description: "t > d / V_V (higher priority, runs first)",
          target: "t",
          replacement: "d",
          context_before: "V",
          context_after: "V",
          priority: 10,
        },
        {
          rule_id: "r3_capture_and_dollar",
          description: "n > $2̃ at word end",
          target: "n",
          replacement: "$2̃",
          context_before: "",
          context_after: "#",
          priority: 1,
        },
        {
          rule_id: "r4_empty_target",
          description: "empty target skipped safely",
          target: "",
          replacement: "x",
          context_before: "",
          context_after: "",
          priority: 0,
        },
      ],
    });

    // Match + serial priority chain: tata -> tada -> taɾa
    const hit = generateIPATraced("tatan", config);
    expect(hit.phonemic).toBe("/tatan/");
    expect(hit.surface).toBe("[taɾañ]");
    expect({ phonemic: hit.phonemic, surface: hit.surface }).toEqual(
      generateIPA("tatan", config),
    );
    expect(hit.allophony_steps[0]).toEqual({
      rule_id: "r1_voice",
      before: "tatan",
      after: "tadan",
      coordinate_space: "step_input_codepoints",
      applications: [{ start: 2, end: 3, input: "t", output: "d" }],
    });
    expect(hit.allophony_steps[1]).toEqual({
      rule_id: "r2_flap",
      before: "tadan",
      after: "taɾan",
      coordinate_space: "step_input_codepoints",
      applications: [{ start: 2, end: 3, input: "d", output: "ɾ" }],
    });
    expect(hit.allophony_steps[2]).toEqual({
      rule_id: "r3_capture_and_dollar",
      before: "taɾan",
      after: "taɾañ",
      coordinate_space: "step_input_codepoints",
      applications: [{ start: 4, end: 5, input: "n", output: "ñ" }],
    });
    expect(hit.allophony_steps[3]).toEqual({
      rule_id: "r4_empty_target",
      before: "taɾañ",
      after: "taɾañ",
      coordinate_space: "step_input_codepoints",
      applications: [],
    });

    // No-match case: "tta" has no intervocalic t
    const miss = applyAllophonyTraced("tta", config.allophony_rules, { V: ["a"] });
    expect(miss.result).toBe(applyAllophony("tta", config.allophony_rules, { V: ["a"] }));
    expect(miss.result).toBe("tta");
    expect(miss.steps[0]?.applications).toEqual([]);
  });
});

describe("initial stress and transcription separators", () => {
  function stressedConfig(): PhonologyConfig {
    const map = makeMap([
      { input: "m", output_phoneme: "m" },
      { input: "a", output_phoneme: "a" },
      { input: "l", output_phoneme: "l" },
      { input: "k", output_phoneme: "k" },
      { input: "ā", output_phoneme: "aː" },
      { input: "·", output_phoneme: "." },
    ]);
    map.rules[5].output_type = "separator";
    const config = makeConfig(map);
    config.phonotactics.stress = { position: "initial", domain: "word" };
    return config;
  }

  test("keeps stem stress after a real prefix and accepts NFC/NFD input", () => {
    const config = stressedConfig();
    expect(generateIPA("ma·ala", config, { stem_start: 3 }).phonemic).toBe("/maˈala/");
    expect(generateIPA("māla", config).phonemic).toBe("/ˈmaːla/");
    expect(generateIPA("ma\u0304la", config).phonemic).toBe("/ˈmaːla/");
    expect(generateIPATraced("ma·ala", config, { stem_start: 3 }).prosody?.phonemic_positions).toEqual([2]);
  });

  test("separators preserve phoneme parsing without adding an inventory phoneme", () => {
    const config = stressedConfig();
    expect(generateIPA("ka·ala", config).phonemic).toBe("/ˈkaala/");
    expect(romanizationToPhonemesTraced("ka·ala", config.romanization_maps[0]).segments[2].output).toBe("");
  });

  test("stress stays aligned through allophonic prefix changes", () => {
    const config = stressedConfig();
    config.allophony_rules = [{ rule_id: "shorten-prefix", description: "prefix deletion", target: "ma", replacement: "m", context_before: "#", context_after: "", priority: 1 }];
    const result = generateIPA("maala", config, { stem_start: 2 });
    expect(result.phonemic).toBe("/maˈala/");
    expect(result.surface).toBe("[mˈala]");
  });

  test("word and entry stress domains preserve explicit phrase choices", () => {
    const config = stressedConfig();
    expect(generateIPA("ala mala", config).phonemic).toBe("/ˈala ˈmala/");
    config.phonotactics.stress = { position: "initial", domain: "entry" };
    expect(generateIPA("ala mala", config).phonemic).toBe("/ˈala mala/");
  });
});
