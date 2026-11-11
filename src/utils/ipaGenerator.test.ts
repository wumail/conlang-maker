import { describe, expect, test } from "bun:test";
import type { PhonologyConfig, RomanizationMap } from "../types";
import { generateIPA, romanizationToPhonemes } from "./ipaGenerator";

function makeMap(
  rules: Array<{
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
      rule_id: `r${idx}`,
      input: r.input,
      output_phoneme: r.output_phoneme,
      context_before: r.context_before ?? "",
      context_after: r.context_after ?? "",
    })),
  };
}

describe("romanizationToPhonemes & generateIPA", () => {
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
    const config: PhonologyConfig = {
      language_id: "test",
      phoneme_inventory: { consonants: ["t", "d"], vowels: ["a"] },
      romanization_maps: [
        makeMap([
          { input: "t", output_phoneme: "t" },
          { input: "a", output_phoneme: "a" },
        ]),
      ],
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
    };

    expect(generateIPA("tata", config)).toEqual({
      phonemic: "/tata/",
      surface: "[tada]",
    });
  });
});
