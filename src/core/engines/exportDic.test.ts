import { describe, expect, test } from "bun:test";
import type {
  ConjugationClass,
  GrammarConfig,
  IrregularOverride,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import { generateAff, generateDic, generateDicFromGrammar } from "./exportDic";

const dicPhono: PhonologyConfig = {
  language_id: "lang_dic_v3",
  phoneme_inventory: {
    consonants: ["p", "t", "k", "l", "m", "n", "s", "z", "r"],
    vowels: ["a", "i", "u", "o", "e"],
  },
  romanization_maps: [],
  allophony_rules: [],
  phonotactics: {
    macros: {},
    syllable_structure: "CVC",
    blacklist_patterns: [],
    vowel_harmony: { enabled: false, group_a: [], group_b: [] },
    tone_system: { enabled: false, tones: [] },
    stress: null,
  },
};

function makeWord(
  entryId: string,
  romanized: string,
  posId: string,
  classId?: string,
): WordEntry {
  return {
    entry_id: entryId,
    language_id: "lang_dic_v3",
    con_word_romanized: romanized,
    phonetic_ipa: "",
    phonetic_override: false,
    ...(classId ? { inflection_class_id: classId } : {}),
    senses: [
      {
        sense_id: `s_${entryId}`,
        pos_id: posId,
        gloss: `gloss_${entryId}`,
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
    metadata: { tags: [], created_at: "", updated_at: "" },
  };
}

describe("generateAff & legacy generateDic", () => {
  test("aff file keeps the minimal Hunspell header", () => {
    const aff = generateAff("Test-Lang");
    expect(aff).toContain("# Affix file for Test-Lang");
    expect(aff).toContain("SET UTF-8");
  });

  test("without phonology config only base forms are emitted", () => {
    const words = [makeWord("e1", "pata", "pos_noun"), makeWord("e2", "kala", "pos_noun")];
    const dic = generateDic(words);
    expect(dic.split("\n")).toEqual(["2", "kala", "pata"]);
  });

  test("legacy (rules, phono) signature expands inflected forms via the unified engine", () => {
    const words = [makeWord("e1", "shapa", "pos_noun")];
    const dic = generateDic(
      words,
      [
        {
          rule_id: "inf_pl",
          pos_id: "pos_noun",
          dimension_values: { dim_num: "val_pl" },
          type: "suffix",
          affix: "i",
          tag: "PL",
          match_regex: ".*",
          disabled: false,
          condition: null,
        },
      ],
      dicPhono,
    );
    expect(dic.split("\n")).toEqual(["2", "shapa", "shapai"]);
  });
});

describe("generateDicFromGrammar (Roadmap v3)", () => {
  const classes: ConjugationClass[] = [
    {
      class_id: "class_cn1",
      name: "First declension",
      applies_to_pos: "pos_noun",
      stem_pattern: "",
      rule_ids: ["r_cn1_pl"],
    },
  ];
  const overrides: IrregularOverride[] = [
    {
      entry_id: "e_pata",
      dimension_values: { dim_num: "val_pl" },
      surface_form: "zorp",
    },
  ];
  const grammar: GrammarConfig = {
    language_id: "lang_dic_v3",
    syntax: {
      word_order: "SVO",
      modifier_position: "after_head",
      adposition_type: "preposition",
    },
    parts_of_speech: [],
    inflection_dimensions: [
      {
        dim_id: "dim_num",
        name: "Number",
        applies_to_pos: ["pos_noun"],
        values: [
          { val_id: "val_sg", name: "Singular", gloss: "SG" },
          { val_id: "val_pl", name: "Plural", gloss: "PL" },
        ],
      },
    ],
    inflection_rules: [
      {
        rule_id: "r_sg_infix",
        pos_id: "pos_noun",
        dimension_values: { dim_num: "val_sg" },
        type: "infix",
        affix: "",
        tag: "SG",
        match_regex: ".*",
        disabled: false,
        condition: null,
        infix_config: { position_regex: "a", morpheme: "l" },
      },
      {
        rule_id: "r_pl_circum",
        pos_id: "pos_noun",
        dimension_values: { dim_num: "val_pl" },
        type: "circumfix",
        affix: "",
        tag: "PL",
        match_regex: ".*",
        disabled: false,
        condition: null,
        circumfix_config: { prefix_part: "ge", suffix_part: "na" },
      },
      {
        rule_id: "r_cn1_pl",
        pos_id: "pos_noun",
        dimension_values: { dim_num: "val_pl" },
        type: "suffix",
        affix: "mi",
        tag: "PL",
        match_regex: ".*",
        disabled: false,
        condition: null,
        conjugation_class_id: "class_cn1",
      },
    ],
    derivation_rules: [],
    grammar_manual: [],
    typology: {
      morphological_type: "fusional",
      synthesis_index: 3,
      fusion_index: 2,
      head_marking: "none",
      auto_estimated: false,
    },
    affix_slots: [],
    conjugation_classes: classes,
    irregular_overrides: overrides,
  };

  test("covers circumfix, infix, conjugation class and irregular forms, deduplicated", () => {
    const words = [
      makeWord("e_pata", "pata", "pos_noun"),
      makeWord("e_kala", "kala", "pos_noun", "class_cn1"),
    ];
    const lines = generateDicFromGrammar(words, grammar, dicPhono).split("\n");
    expect(lines[0]).toBe("6");
    // pata: 原形 + 单数中缀形 + 复数不规则覆盖；kala: 原形 + 单数中缀形 + 变位类复数后缀
    expect(lines.slice(1)).toEqual([
      "kala",
      "kalami",
      "kalla",
      "palta",
      "pata",
      "zorp",
    ]);
  });

  test("deprecated entries are still exported only when present in the input list", () => {
    const words = [makeWord("e_kala", "kala", "pos_noun", "class_cn1")];
    const lines = generateDicFromGrammar(words, grammar, dicPhono).split("\n");
    expect(lines.slice(1)).toEqual(["kala", "kalami", "kalla"]);
  });
});
