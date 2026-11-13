import { describe, expect, test } from "bun:test";
import type {
  GrammarConfig,
  InflectionRule,
  MorphophonologyRule,
  PhonologyConfig,
} from "../../types";
import rawGrammar from "../../../tests/fixtures/workspace-basic/roots/root/grammar.json";
import rawPhonology from "../../../tests/fixtures/workspace-basic/roots/root/phonology.json";
import {
  applyAgglutinativeChain,
  applyInflectionTypologyAware,
  generateParadigm,
} from "./morphologyEngine";

const phono = rawPhonology as PhonologyConfig;

describe("compiled inflection paradigms", () => {
  test("complete forms remain visible when template rules are disabled", () => {
    const grammar = structuredClone(rawGrammar) as GrammarConfig;
    grammar.inflection_rules = grammar.inflection_rules.map((rule) => ({ ...rule, disabled: true }));
    grammar.inflection_dimensions = [{
      dim_id: "case", name: "Case", applies_to_pos: ["noun"],
      values: [{ val_id: "loc", name: "Locative", gloss: "LOC." }],
    }];
    grammar.irregular_overrides = [{
      entry_id: "entry", dimension_values: { case: "loc" }, surface_form: "ma·ala", stem_start: 3,
    }];
    const cells = generateParadigm("ala", "noun", grammar.inflection_rules, phono, { entryId: "entry", grammar });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ result: "ma·ala", stem_start: 3, tag: "LOC" });
    expect(generateParadigm("ala", "verb", [], phono, { entryId: "entry", grammar })).toEqual([]);
    expect(generateParadigm("ala", "noun", [], phono)).toEqual([]);
  });

  test("a partial override overlays regular cells without adding a duplicate pattern row", () => {
    const grammar = structuredClone(rawGrammar) as GrammarConfig;
    grammar.inflection_dimensions = [{ dim_id: "number", name: "Number", applies_to_pos: ["noun"], values: [] }];
    grammar.inflection_rules = [{ ...grammar.inflection_rules[0], pos_id: "noun", dimension_values: { number: "plural" }, disabled: false }];
    grammar.irregular_overrides = [{ entry_id: "entry", dimension_values: {}, surface_form: "irregular", stem_start: 1 }];
    const cells = generateParadigm("ala", "noun", grammar.inflection_rules, phono, { entryId: "entry", grammar });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ result: "irregular", stem_start: 1, dimensionValues: { number: "plural" } });
  });
});

const harmonyPhono: PhonologyConfig = {
  language_id: "lang_mph",
  phoneme_inventory: {
    consonants: ["v", "l", "r", "t"],
    vowels: ["a", "e"],
  },
  romanization_maps: [],
  allophony_rules: [],
  phonotactics: {
    macros: {},
    syllable_structure: "(C)V(C)",
    blacklist_patterns: [],
    vowel_harmony: { enabled: false, group_a: [], group_b: [] },
    tone_system: { enabled: false, tones: [] },
    stress: null,
  },
};

const featureHarmony: MorphophonologyRule = {
  rule_id: "mph_harmony",
  description: "open vowel → close-mid after front vowels",
  disabled: false,
  priority: 1,
  target: "[+vowel, +open]",
  replacement: "[-open, +close_mid]",
  context_before: "[+vowel, -back] C* + C*",
  context_after: "",
  feature_mode: true,
  target_features: null,
  replacement_features: null,
  context_before_features: null,
  context_after_features: null,
};

function grammarWithHarmony(
  morphologicalType: "agglutinative" | "fusional",
): GrammarConfig {
  const plural: InflectionRule = {
    rule_id: "r_pl",
    pos_id: "noun",
    dimension_values: { num: "pl" },
    type: "suffix",
    affix: "lar",
    tag: "PL",
    match_regex: ".*",
    disabled: false,
    condition: null,
    slot_id: "slot_num",
  };
  return {
    language_id: "lang_mph",
    syntax: { word_order: "SVO", modifier_position: "after_head", adposition_type: "preposition" },
    parts_of_speech: [],
    inflection_dimensions: [
      {
        dim_id: "num",
        name: "Number",
        applies_to_pos: ["noun"],
        values: [{ val_id: "pl", name: "Plural", gloss: "PL" }],
      },
    ],
    inflection_rules: [plural],
    derivation_rules: [],
    grammar_manual: [],
    typology: {
      morphological_type: morphologicalType,
      synthesis_index: 2,
      fusion_index: 1,
      head_marking: "none",
      auto_estimated: false,
    },
    affix_slots: [
      { slot_id: "slot_num", position: 1, dimension_id: "num", is_obligatory: false, label: "NUM" },
    ],
    conjugation_classes: [],
    irregular_overrides: [],
    morphophonology_rules: [featureHarmony],
  };
}

describe("morphophonology rules reach every inflection path", () => {
  test("agglutinative chain applies harmony at each slot concatenation", () => {
    const result = applyAgglutinativeChain(
      "ev",
      "noun",
      { num: "pl" },
      grammarWithHarmony("agglutinative"),
      harmonyPhono,
    );
    expect(result.result).toBe("evler");
  });

  test("fusional and typology-aware entries reuse the same rules", () => {
    const grammar = grammarWithHarmony("fusional");
    const typologyAware = applyInflectionTypologyAware(
      "ev",
      "entry_ev",
      "noun",
      { num: "pl" },
      grammar,
      harmonyPhono,
    );
    expect(typologyAware.result).toBe("evler");

    const isolating = applyInflectionTypologyAware(
      "ev",
      "entry_ev",
      "noun",
      { num: "pl" },
      { ...grammar, typology: { ...grammar.typology, morphological_type: "isolating" } },
      harmonyPhono,
    );
    expect(isolating.result).toBe("evler");
  });
});

