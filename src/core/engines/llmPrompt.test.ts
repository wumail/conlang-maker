import { describe, expect, test } from "bun:test";
import type { GrammarConfig, PhonologyConfig, WordEntry } from "../../types";
import { generateAff, generateDic } from "./exportDic";
import { generateLLMPrompt } from "./llmPrompt";

const samplePhono: PhonologyConfig = {
  language_id: "lang_root",
  phoneme_inventory: {
    consonants: ["p", "t", "k", "s", "ʃ"],
    vowels: ["a", "i", "u"],
  },
  romanization_maps: [
    {
      map_id: "map_default",
      name: "Standard Orthography",
      is_default: true,
      rules: [
        {
          rule_id: "r_sh",
          input: "sh",
          output_phoneme: "ʃ",
          context_before: "",
          context_after: "",
        },
        {
          rule_id: "r_a",
          input: "a",
          output_phoneme: "a",
          context_before: "",
          context_after: "",
        },
      ],
    },
  ],
  phonotactics: {
    macros: { C: ["p", "t", "k", "s", "ʃ"], V: ["a", "i", "u"] },
    syllable_structure: "CV",
    blacklist_patterns: [],
    vowel_harmony: { enabled: false, group_a: [], group_b: [] },
    tone_system: { enabled: false, tones: [] },
  },
  allophony_rules: [],
};

const sampleGrammar: GrammarConfig = {
  language_id: "lang_root",
  syntax: {
    word_order: "SOV",
    modifier_position: "before_head",
    adposition_type: "postposition",
  },
  parts_of_speech: [
    {
      pos_id: "pos_noun",
      name: "Noun",
      gloss_abbr: "N",
      word_pattern: "",
      requires_definition: false,
      requires_pronunciation: false,
    },
  ],
  inflection_dimensions: [
    {
      dim_id: "dim_num",
      name: "Number",
      applies_to_pos: ["pos_noun"],
      values: [
        { val_id: "val_pl", name: "Plural", gloss: "PL" },
      ],
    },
  ],
  inflection_rules: [
    {
      rule_id: "inf_pl",
      pos_id: "pos_noun",
      dimension_values: { dim_num: "val_pl" },
      type: "suffix",
      affix: "i",
      tag: "PL",
      match_regex: ".*",
      disabled: false,
      sca_mutable: false,
      condition: null,
    },
  ],
  derivation_rules: [],
  grammar_manual: [],
  typology: {
    morphological_type: "agglutinative",
    synthesis_index: 2.2,
    fusion_index: 1.1,
    head_marking: "dependent",
    auto_estimated: false,
  },
  affix_slots: [],
  conjugation_classes: [],
  irregular_overrides: [],
};

const sampleWords: WordEntry[] = [
  {
    entry_id: "w1",
    language_id: "lang_root",
    con_word_romanized: "shapa",
    phonetic_ipa: "/ʃapa/",
    phonetic_override: false,
    senses: [
      {
        sense_id: "s1",
        pos_id: "pos_noun",
        gloss: "river",
        definitions: ["flowing water"],
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
      tags: ["nature"],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  },
];

describe("llmPrompt & exportDic pure generators (T1.3)", () => {
  test("generateLLMPrompt includes language name, phoneme inventory, and romanization rules", () => {
    const md = generateLLMPrompt({
      langName: "Proto-Lumitic",
      phonoConfig: samplePhono,
      grammarConfig: sampleGrammar,
      words: sampleWords,
    });

    expect(md).toContain("# Proto-Lumitic — Language Reference Prompt");
    expect(md).toContain("p t k s ʃ");
    expect(md).toContain("a i u");
    expect(md).toContain("| sh | ʃ |");
    expect(md).toContain("shapa");
  });

  test("generateAff and generateDic produce valid Hunspell dictionary outputs with inflected forms", () => {
    const aff = generateAff("Proto-Lumitic");
    expect(aff).toContain("# Affix file for Proto-Lumitic");
    expect(aff).toContain("SET UTF-8");

    const dic = generateDic(
      sampleWords,
      sampleGrammar.inflection_rules,
      samplePhono,
    );
    const lines = dic.split("\n");
    expect(lines[0]).toBe("2");
    expect(lines.slice(1)).toEqual(["shapa", "shapai"]);
  });
});
