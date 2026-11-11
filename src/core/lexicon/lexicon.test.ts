import { describe, expect, test } from "bun:test";
import type { PhonologyConfig, WordEntry } from "../../types";
import {
  bucketFilename,
  bucketKey,
  computeWordIpa,
  isValidWordEntry,
  newEntryId,
  newLanguageId,
  newPrefixedId,
  nowIso,
  validateWordEntry,
} from "./index";

function makeWord(overrides?: Partial<WordEntry>): WordEntry {
  return {
    entry_id: "e1",
    language_id: "lang_root",
    con_word_romanized: "tala",
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      {
        sense_id: "s1",
        pos_id: "pos_n",
        gloss: "star",
        definitions: [],
        examples: [],
      },
    ],
    etymology: {
      origin_type: "a_priori",
      parent_entry_id: null,
      source_language_id: null,
      applied_sound_changes: [],
      semantic_shift_note: "",
    },
    metadata: {
      tags: [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

const phono: PhonologyConfig = {
  language_id: "lang_root",
  phoneme_inventory: { consonants: ["t", "l", "ʃ"], vowels: ["a"] },
  romanization_maps: [
    {
      map_id: "m1",
      name: "Default",
      is_default: true,
      rules: [
        { rule_id: "r1", input: "sh", output_phoneme: "ʃ", context_before: "", context_after: "" },
        { rule_id: "r2", input: "t", output_phoneme: "t", context_before: "", context_after: "" },
        { rule_id: "r3", input: "l", output_phoneme: "l", context_before: "", context_after: "" },
        { rule_id: "r4", input: "a", output_phoneme: "a", context_before: "", context_after: "" },
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

describe("core/lexicon utilities (T1.4)", () => {
  test("bucketKey matches Rust bucket_filename on ASCII, diacritics, IPA, empty, and digits", () => {
    expect(bucketKey("A")).toBe("lexicon_a");
    expect(bucketKey("apple")).toBe("lexicon_a");
    expect(bucketKey("ā")).toBe("lexicon_others");
    expect(bucketKey("ʃ")).toBe("lexicon_others");
    expect(bucketKey("")).toBe("lexicon_others");
    expect(bucketKey("1abc")).toBe("lexicon_others");
    expect(bucketFilename("Zeta")).toBe("lexicon_z.ndjson");
  });

  test("isValidWordEntry and validateWordEntry enforce non-empty spelling, non-placeholder, and non-empty gloss", () => {
    const valid = makeWord();
    expect(isValidWordEntry(valid)).toBe(true);
    expect(validateWordEntry(valid)).toEqual([]);

    const emptySpelling = makeWord({ con_word_romanized: "   " });
    expect(isValidWordEntry(emptySpelling)).toBe(false);
    expect(validateWordEntry(emptySpelling).some((e) => e.includes("empty"))).toBe(true);

    const placeholder = makeWord({ con_word_romanized: "new_word" });
    expect(isValidWordEntry(placeholder)).toBe(false);
    expect(validateWordEntry(placeholder).some((e) => e.includes("new_word"))).toBe(true);

    const emptyGloss = makeWord({
      senses: [
        { sense_id: "s1", pos_id: "pos_n", gloss: "   ", definitions: [], examples: [] },
      ],
    });
    expect(isValidWordEntry(emptyGloss)).toBe(false);
    expect(validateWordEntry(emptyGloss).some((e) => e.includes("non-empty gloss"))).toBe(true);

    expect(validateWordEntry({})).toHaveLength(2);
  });

  test("ID and timestamp generators follow §3.1 formats", () => {
    expect(newEntryId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(newPrefixedId("pos")).toMatch(/^pos_[0-9a-f]{8}$/i);
    expect(newPrefixedId("conj")).toMatch(/^conj_[0-9a-f]{8}$/i);
    expect(newLanguageId()).toMatch(/^lang_[0-9a-z]+$/);
    expect(() => new Date(nowIso()).toISOString()).not.toThrow();
  });

  test("computeWordIpa respects phonetic_override and otherwise generates phonemic IPA", () => {
    expect(
      computeWordIpa(
        { con_word_romanized: "shala", phonetic_ipa: "/custom/", phonetic_override: false },
        phono,
      ),
    ).toBe("/ʃala/");

    expect(
      computeWordIpa(
        { con_word_romanized: "shala", phonetic_ipa: "/custom/", phonetic_override: true },
        phono,
      ),
    ).toBe("/custom/");
  });
});
