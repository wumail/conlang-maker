import { describe, expect, test } from "bun:test";
import type { GrammarConfig, PhonologyConfig, WordEntry } from "../../types";
import {
  applySuggestionToLines,
  autoGloss,
  AutoGlossCache,
  resolveEntryIpa,
} from "./autoGloss";

const phono: PhonologyConfig = {
  language_id: "lang_root",
  phoneme_inventory: { consonants: ["k", "t", "n", "s"], vowels: ["a", "i", "u"] },
  romanization_maps: [
    {
      map_id: "m1",
      name: "Default",
      is_default: true,
      rules: [
        { rule_id: "r1", input: "k", output_phoneme: "k", context_before: "", context_after: "" },
        { rule_id: "r2", input: "t", output_phoneme: "t", context_before: "", context_after: "" },
        { rule_id: "r3", input: "n", output_phoneme: "n", context_before: "", context_after: "" },
        { rule_id: "r4", input: "s", output_phoneme: "s", context_before: "", context_after: "" },
        { rule_id: "r5", input: "a", output_phoneme: "a", context_before: "", context_after: "" },
        { rule_id: "r6", input: "i", output_phoneme: "i", context_before: "", context_after: "" },
        { rule_id: "r7", input: "u", output_phoneme: "u", context_before: "", context_after: "" },
      ],
    },
  ],
  phonotactics: {
    macros: { C: ["k", "t", "n", "s"], V: ["a", "i", "u"] },
    syllable_structure: "CV",
    blacklist_patterns: [],
    vowel_harmony: { enabled: false, group_a: [], group_b: [] },
    tone_system: { enabled: false, tones: [] },
  },
  allophony_rules: [],
};

const grammar: GrammarConfig = {
  language_id: "lang_root",
  syntax: {
    word_order: "SVO",
    modifier_position: "after_head",
    adposition_type: "preposition",
  },
  parts_of_speech: [
    {
      pos_id: "pos_n",
      name: "Noun",
      gloss_abbr: "N",
      word_pattern: "",
      requires_definition: false,
      requires_pronunciation: false,
    },
    {
      pos_id: "pos_v",
      name: "Verb",
      gloss_abbr: "V",
      word_pattern: "",
      requires_definition: false,
      requires_pronunciation: false,
    },
  ],
  inflection_dimensions: [
    {
      dim_id: "dim_num",
      name: "Number",
      applies_to_pos: ["pos_n"],
      values: [{ val_id: "val_pl", name: "Plural", gloss: "PL" }],
    },
    {
      dim_id: "dim_int",
      name: "Intensity",
      applies_to_pos: ["pos_v"],
      values: [{ val_id: "val_int", name: "Intensive", gloss: "INT" }],
    },
  ],
  inflection_rules: [
    {
      rule_id: "r_pl",
      pos_id: "pos_n",
      dimension_values: { dim_num: "val_pl" },
      type: "suffix",
      affix: "si",
      tag: "PL",
      match_regex: ".*",
      disabled: false,
      sca_mutable: false,
      condition: null,
    },
    {
      rule_id: "r_red",
      pos_id: "pos_v",
      dimension_values: { dim_int: "val_int" },
      type: "reduplication",
      affix: "",
      tag: "INT",
      match_regex: ".*",
      disabled: false,
      sca_mutable: false,
      condition: null,
      reduplication_config: { mode: "full" },
    },
  ],
  derivation_rules: [],
  grammar_manual: [],
  typology: {
    morphological_type: "agglutinative",
    synthesis_index: 2,
    fusion_index: 1,
    head_marking: "none",
    auto_estimated: false,
  },
  affix_slots: [],
  conjugation_classes: [],
  irregular_overrides: [],
};

const words: WordEntry[] = [
  {
    entry_id: "e_kana",
    language_id: "lang_root",
    con_word_romanized: "kana",
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      { sense_id: "s1", pos_id: "pos_n", gloss: "house", definitions: [], examples: [] },
    ],
    etymology: {
      origin_type: "a_priori",
      parent_entry_id: null,
      source_language_id: null,
      applied_sound_changes: [],
      semantic_shift_note: "",
    },
    metadata: { tags: [], created_at: "", updated_at: "" },
  },
  {
    entry_id: "e_taki",
    language_id: "lang_root",
    con_word_romanized: "taki",
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      { sense_id: "s2", pos_id: "pos_v", gloss: "run", definitions: [], examples: [] },
    ],
    etymology: {
      origin_type: "a_priori",
      parent_entry_id: null,
      source_language_id: null,
      applied_sound_changes: [],
      semantic_shift_note: "",
    },
    metadata: { tags: [], created_at: "", updated_at: "" },
  },
];

describe("autoGloss workflow (T1.6)", () => {
  test("produces deterministic glossed lines, pending transformative suggestions, and unresolved counts", () => {
    const cache: AutoGlossCache = {};
    let tokSeq = 0;

    // Sentence 1: exact word "Kana", concatenative suffix "kanasi", reduplicated "takitaki", unknown "zoru"
    const result = autoGloss({
      originalText: "Kana kanasi. Takitaki zoru!",
      words,
      grammar,
      phono,
      cache,
      createLineId: (i) => `line_${i}`,
      createTokenId: () => `tok_${(tokSeq += 1)}`,
    });

    expect(result.report).toEqual({
      total: 4,
      autoApplied: 2, // "Kana" (exact) + "kanasi" (concatenative confidence 0.96 >= 0.88)
      pending: 1, // "Takitaki" (full reduplication confidence 0.78 < 0.88)
      unresolved: 1, // "zoru"
    });

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]?.tokens).toEqual([
      {
        token_id: "tok_1",
        surface_form: "Kana",
        morpheme_break: "kana",
        gloss_labels: "house",
        linked_entry_id: "e_kana",
        ipa: "/kana/",
      },
      {
        token_id: "tok_2",
        surface_form: "kanasi",
        morpheme_break: "kana-si",
        gloss_labels: "house-PL",
        linked_entry_id: "e_kana",
        ipa: "/kanasi/",
      },
    ]);

    // Pending suggestion can be applied cleanly to produce exact GUI token state
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]?.surfaceForm).toBe("Takitaki");
    expect(result.pending[0]?.suggestion.morphemeBreak).toBe("taki~RED(full)");
    expect(result.pending[0]?.suggestion.glossLabels).toBe("run-INT");

    const updatedLines = applySuggestionToLines(
      result.lines,
      result.pending[0]!,
      (entry) => resolveEntryIpa(entry, phono),
    );
    expect(updatedLines[1]?.tokens[0]).toMatchObject({
      token_id: "tok_3",
      surface_form: "Takitaki",
      morpheme_break: "taki~RED(full)",
      gloss_labels: "run-INT",
      linked_entry_id: "e_taki",
      ipa: "/taki/",
    });

    // Transformative cache was populated and can be reused identically
    expect(cache.transformIndex).toBeDefined();
    const secondRun = autoGloss({
      originalText: "Kana kanasi. Takitaki zoru!",
      words,
      grammar,
      phono,
      cache,
      createLineId: (i) => `line_${i}`,
      createTokenId: (l, t) => `t_${l}_${t}`,
    });
    expect(secondRun.report).toEqual(result.report);
  });

  test("compiled forms generate their full pronunciation with stem stress", () => {
    const stressed = structuredClone(phono);
    stressed.phonotactics.stress = { position: "initial", domain: "word" };
    const compiled = structuredClone(grammar);
    compiled.irregular_overrides = [{
      entry_id: "e_kana",
      dimension_values: { dim_num: "val_pl" },
      surface_form: "kakanasi",
      stem_start: 2,
    }];
    const result = autoGloss({ originalText: "kakanasi", words, grammar: compiled, phono: stressed });
    expect(result.lines[0]?.tokens[0]?.ipa).toBe("/kaˈkanasi/");
    stressed.phoneme_inventory.vowels.push("aː");
    stressed.romanization_maps[0].rules.push({
      rule_id: "long_a", input: "ā", output_phoneme: "aː", context_before: "", context_after: "",
    });
    compiled.irregular_overrides[0].surface_form = "ka\u0304kanasi";
    compiled.irregular_overrides[0].stem_start = 3;
    const decomposed = autoGloss({ originalText: "kākanasi".normalize("NFD"), words, grammar: compiled, phono: stressed });
    expect(decomposed.report.unresolved).toBe(0);
    expect(decomposed.lines[0]?.tokens[0]?.ipa).toBe("/kaːˈkanasi/");
  });
});
