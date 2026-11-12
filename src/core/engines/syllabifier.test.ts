import { describe, expect, test } from "bun:test";
import type { PhonemeInventory, Phonotactics } from "../../types";
import {
  buildParsedSyllable,
  compileSyllableUnits,
  formatSyllables,
  syllabify,
  syllabifyWithUnits,
} from "./syllabifier";

const inventory: PhonemeInventory = {
  consonants: ["p", "t", "k", "s", "n", "m", "l", "tʃ", "dʒ"],
  vowels: ["a", "e", "i", "o", "u", "aː"],
};

function phonotactics(
  structure: string,
  macros: Record<string, string[]> = {},
): Phonotactics {
  return {
    macros,
    syllable_structure: structure,
    blacklist_patterns: [],
    vowel_harmony: { enabled: false, group_a: [], group_b: [] },
    tone_system: { enabled: false, tones: [] },
    stress: null,
  };
}

const cvc = phonotactics("(C)V(C)");

describe("compileSyllableUnits", () => {
  test("compiles (C)V(C) into three slots with correct roles and optionality", () => {
    const units = compileSyllableUnits("(C)V(C)", {}, inventory);
    expect(units).toHaveLength(3);
    expect(units[0]!.optional).toBe(true);
    expect(units[0]!.role).toBe("onset");
    expect(units[1]!.optional).toBe(false);
    expect(units[1]!.role).toBe("nucleus");
    expect(units[2]!.optional).toBe(true);
    expect(units[2]!.role).toBe("coda");
    expect(units[0]!.allowed.has("tʃ")).toBe(true);
    expect(units[1]!.allowed.has("aː")).toBe(true);
  });

  test("supports the C?VC? shorthand without exponential expansion", () => {
    const units = compileSyllableUnits("C?VC?", {}, inventory);
    expect(units.map((u) => u.optional)).toEqual([true, false, true]);
  });

  test("classifies multi-slot (C)(L)V(N) templates and custom macros", () => {
    const units = compileSyllableUnits("(C)(L)V(N)", { L: ["l", "m"], N: ["n"] }, inventory);
    expect(units).toHaveLength(4);
    expect(units.map((u) => u.role)).toEqual(["onset", "onset", "nucleus", "coda"]);
    expect(units[1]!.optional).toBe(true);
    expect(units[1]!.allowed.has("l")).toBe(true);
    expect(units[3]!.allowed.has("n")).toBe(true);
  });

  test("falls back to a literal slot for unknown macros", () => {
    const units = compileSyllableUnits("CVQ", {}, inventory);
    expect(units[2]!.allowed.has("Q")).toBe(true);
  });
});

describe("syllabify: maximal onset principle", () => {
  test("splits a-pa rather than ap-a", () => {
    const result = syllabify(["a", "p", "a"], cvc, inventory);
    expect(result.valid).toBe(true);
    expect(result.syllables).toHaveLength(2);
    expect(result.syllables[0]!.onset).toEqual([]);
    expect(result.syllables[0]!.nucleus).toEqual(["a"]);
    expect(result.syllables[1]!.onset).toEqual(["p"]);
    expect(formatSyllables(result.syllables)).toBe("a.pa");
  });

  test("prefers fewer syllables before applying maximal onset", () => {
    const single = syllabify(["t", "a", "n"], cvc, inventory);
    expect(single.valid).toBe(true);
    expect(single.syllables).toHaveLength(1);
    expect(formatSyllables(single.syllables)).toBe("tan");
  });

  test("maximises every subsequent onset from left to right", () => {
    const result = syllabify(["a", "p", "a", "t", "a"], cvc, inventory);
    expect(result.valid).toBe(true);
    expect(result.syllables.map((s) => s.onset.length)).toEqual([0, 1, 1]);
    expect(formatSyllables(result.syllables)).toBe("a.pa.ta");
  });

  test("handles consonant clusters in the onset", () => {
    const cluster = phonotactics("(C)(C)V(C)", {});
    const result = syllabify(["s", "t", "a", "n"], cluster, inventory);
    expect(result.valid).toBe(true);
    expect(result.syllables[0]!.onset).toEqual(["s", "t"]);
    expect(result.syllables[0]!.nucleus).toEqual(["a"]);
    expect(result.syllables[0]!.coda).toEqual(["n"]);
  });
});

describe("syllabify: multi-character phonemes", () => {
  test("never splits tʃ / dʒ tokens", () => {
    const result = syllabify(["tʃ", "a", "dʒ", "i"], cvc, inventory);
    expect(result.valid).toBe(true);
    expect(formatSyllables(result.syllables)).toBe("tʃa.dʒi");
    expect(result.syllables[0]!.onset).toEqual(["tʃ"]);
    expect(result.syllables[1]!.onset).toEqual(["dʒ"]);
  });

  test("keeps long vowels intact and marks them heavy", () => {
    const result = syllabify(["k", "aː"], cvc, inventory);
    expect(result.valid).toBe(true);
    expect(result.syllables[0]!.nucleus).toEqual(["aː"]);
    expect(result.syllables[0]!.weight).toBe("heavy");
  });
});

describe("syllabify: weight and failures", () => {
  test("classifies light open syllables and heavy closed syllables", () => {
    const open = syllabify(["k", "a"], cvc, inventory);
    expect(open.syllables[0]!.weight).toBe("light");
    const closed = syllabify(["k", "a", "n"], cvc, inventory);
    expect(closed.syllables[0]!.weight).toBe("heavy");
  });

  test("diphthong nuclei count as heavy", () => {
    const syllable = buildParsedSyllable(["k", "a", "i"], new Set(inventory.vowels));
    expect(syllable?.nucleus).toEqual(["a", "i"]);
    expect(syllable?.weight).toBe("heavy");
  });

  test("returns null when a slice has no nucleus", () => {
    expect(buildParsedSyllable(["p", "t"], new Set(inventory.vowels))).toBeNull();
  });

  test("reports the token index where syllabification gets stuck", () => {
    const result = syllabify(["p", "t", "k", "a"], cvc, inventory);
    expect(result.valid).toBe(false);
    expect(result.failedAtTokenIndex).toBe(0);
    expect(result.syllables).toEqual([]);
  });

  test("treats an empty phoneme list as valid and empty", () => {
    expect(syllabify([], cvc, inventory)).toEqual({ valid: true, syllables: [] });
  });

  test("invalid template yields a failure at index 0", () => {
    const units = compileSyllableUnits("", {}, inventory);
    const result = syllabifyWithUnits(["a"], units, new Set(inventory.vowels));
    expect(result.valid).toBe(false);
    expect(result.failedAtTokenIndex).toBe(0);
  });
});
