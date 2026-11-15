import { describe, expect, test } from "bun:test";
import type { GrammarConfig, PhonologyConfig, WordEntry } from "../../types";
import {
  buildSampleClauseFromLexicon,
  lookupSandboxWord,
  processSandboxText,
} from "./sandbox";

const phonology: PhonologyConfig = {
  language_id: "l6",
  phoneme_inventory: { consonants: ["s", "l", "n", "f", "r"], vowels: ["a", "i", "ə"] },
  romanization_maps: [
    {
      map_id: "default",
      name: "Default",
      is_default: true,
      rules: [
        { rule_id: "r1", input: "ā", output_phoneme: "aː", context_before: "", context_after: "" },
      ],
    },
  ],
  phonotactics: {
    syllable_structure: "(C)V(C)",
    macros: {},
    blacklist_patterns: [],
    vowel_harmony: { enabled: false, group_a: [], group_b: [] },
    tone_system: { enabled: false, tones: [] },
  },
  allophony_rules: [],
};

const grammar: GrammarConfig = {
  language_id: "l6",
  syntax: {
    word_order: "SVO",
    modifier_position: "before_head",
    adposition_type: "preposition",
    alignment: "nom_acc",
  },
  parts_of_speech: [
    {
      pos_id: "pos_n",
      name: "名词",
      gloss_abbr: "n",
      word_pattern: "",
      requires_definition: false,
      requires_pronunciation: false,
    },
    {
      pos_id: "pos_v",
      name: "动词",
      gloss_abbr: "v",
      word_pattern: "",
      requires_definition: false,
      requires_pronunciation: false,
    },
  ],
  inflection_dimensions: [
    {
      dim_id: "dim_tense",
      name: "Tense",
      applies_to_pos: ["pos_v"],
      values: [{ val_id: "val_pst", name: "Past", gloss: "PST" }],
    },
  ],
  inflection_rules: [
    {
      rule_id: "ir_pst",
      pos_id: "pos_v",
      tag: "PST",
      type: "suffix",
      affix: "ta",
      match_regex: ".*",
      disabled: false,
      condition: null,
      dimension_values: { dim_tense: "val_pst" },
    },
  ],
  derivation_rules: [],
  grammar_manual: [],
  typology: {
    morphological_type: "fusional",
    synthesis_index: 2,
    fusion_index: 2,
    head_marking: "dependent",
    auto_estimated: false,
  },
  affix_slots: [],
  conjugation_classes: [],
  irregular_overrides: [
    {
      entry_id: "w_end",
      dimension_values: { dim_tense: "val_pst" },
      surface_form: "aləra",
    },
  ],
};

function makeWord(
  id: string,
  romanized: string,
  gloss: string,
  posId: string,
): WordEntry {
  return {
    entry_id: id,
    language_id: "l6",
    con_word_romanized: romanized,
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      {
        sense_id: `s_${id}`,
        pos_id: posId,
        gloss,
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

const wordsMap: Record<string, WordEntry> = {
  w_ash: makeWord("w_ash", "alafiri", "灰烬, ash", "pos_n"),
  w_this: makeWord("w_this", "alan", "这个, this", "pos_n"),
  w_end: makeWord("w_end", "alə", "结束, end", "pos_v"),
};

describe("lookupSandboxWord & processSandboxText", () => {
  test("matches bilingual gloss segments and romanized stems", () => {
    expect(lookupSandboxWord("灰烬", wordsMap)?.word.con_word_romanized).toBe(
      "alafiri",
    );
    expect(lookupSandboxWord("ash", wordsMap)?.word.con_word_romanized).toBe(
      "alafiri",
    );
    expect(lookupSandboxWord("alan", wordsMap)?.word.con_word_romanized).toBe(
      "alan",
    );
  });

  test("marks missing words with unresolved=true and applies irregular overrides via entry_id", () => {
    const results = processSandboxText(
      "ash end-PST unknown",
      wordsMap,
      grammar,
      phonology,
    );
    expect(results[0]?.conlang).toBe("alafiri");
    expect(results[0]?.unresolved).toBeUndefined();
    expect(results[1]?.conlang).toBe("aləra");
    expect(results[2]?.conlang).toBe("?unknown?");
    expect(results[2]?.unresolved).toBe(true);
  });

  test("buildSampleClauseFromLexicon picks real nouns and verbs from active lexicon", () => {
    const sample = buildSampleClauseFromLexicon(wordsMap, grammar, {
      subject: { head: "dog" },
      verb: { gloss: "bite" },
      object: { head: "bone" },
    });
    expect(sample.subject.head).toBe("灰烬");
    expect(sample.object?.head).toBe("这个");
    expect(sample.verb.gloss).toBe("结束");
    expect(sample.verb.tam).toEqual(["PST"]);
  });
});

// ── Roadmap v3 / Pillar 3：统一形态引擎接入 ──────────────

const classGrammar: GrammarConfig = {
  ...grammar,
  conjugation_classes: [
    {
      class_id: "class_run",
      name: "Run conjugation",
      applies_to_pos: "pos_v",
      stem_pattern: "",
      rule_ids: ["ir_pst_run"],
    },
    {
      class_id: "class_walk",
      name: "Walk conjugation",
      applies_to_pos: "pos_v",
      stem_pattern: "",
      rule_ids: ["ir_pst_walk"],
    },
  ],
  inflection_rules: [
    ...grammar.inflection_rules,
    {
      rule_id: "ir_pst_run",
      pos_id: "pos_v",
      tag: "PST",
      type: "suffix",
      affix: "ek",
      match_regex: ".*",
      disabled: false,
      condition: null,
      dimension_values: { dim_tense: "val_pst" },
      conjugation_class_id: "class_run",
    },
    {
      rule_id: "ir_pst_walk",
      pos_id: "pos_v",
      tag: "PST",
      type: "suffix",
      affix: "or",
      match_regex: ".*",
      disabled: false,
      condition: null,
      dimension_values: { dim_tense: "val_pst" },
      conjugation_class_id: "class_walk",
    },
  ],
};

const classWordsMap: Record<string, WordEntry> = {
  ...wordsMap,
  w_run: {
    ...makeWord("w_run", "sala", "run", "pos_v"),
    inflection_class_id: "class_run",
  },
  w_walk: {
    ...makeWord("w_walk", "tama", "walk", "pos_v"),
    senses: [
      {
        ...makeWord("w_walk", "tama", "walk", "pos_v").senses[0],
        inflection_class_id: "class_walk",
      },
    ],
  },
};

describe("processSandboxText uses inflectWord with entry & sense context", () => {
  test("class-specific rules apply per word and results carry inflection steps", () => {
    const results = processSandboxText(
      "run-PST walk-PST",
      classWordsMap,
      classGrammar,
      phonology,
    );
    expect(results[0]?.conlang).toBe("salaek");
    expect(results[1]?.conlang).toBe("tamaor");

    const steps0 = results[0]?.inflectionSteps ?? [];
    expect(steps0.some((step) => step.stage === "class_select")).toBe(true);
    expect(steps0.some((step) => step.stage === "affix" && step.rule_id === "ir_pst_run")).toBe(true);
    expect(Array.isArray(results[0]?.conflicts)).toBe(true);
    expect(results[0]?.conflicts).toHaveLength(0);

    const steps1 = results[1]?.inflectionSteps ?? [];
    expect(
      steps1.find((step) => step.stage === "class_select")?.label,
    ).toContain("class_walk (sense)");
  });

  test("untagged tokens keep the legacy shape without inflection fields", () => {
    const results = processSandboxText("ash", wordsMap, grammar, phonology);
    expect(results[0]?.conlang).toBe("alafiri");
    expect(results[0]?.inflectionSteps).toBeUndefined();
    expect(results[0]?.conflicts).toBeUndefined();
  });
});
