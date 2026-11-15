import { describe, expect, test } from "bun:test";
import type {
  AffixSlot,
  ConjugationClass,
  GrammarConfig,
  InflectionRule,
  IrregularOverride,
  MorphophonologyRule,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import rawGrammar from "../../../tests/fixtures/workspace-basic/roots/root/grammar.json";
import rawPhonology from "../../../tests/fixtures/workspace-basic/roots/root/phonology.json";
import {
  applyAgglutinativeChain,
  applyInflectionTypologyAware,
  diagnoseInflectionRequest,
  generateParadigm,
  generateTypedParadigm,
  inflectWord,
  resolveEntryConjugationClass,
  ruleMatchesFeatures,
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

// ── Roadmap v3 / Pillar 3：统一 6 步形态引擎 ──────────────

const v3Phono: PhonologyConfig = {
  language_id: "lang_morph_v3",
  phoneme_inventory: {
    consonants: ["k", "m", "n", "l", "s", "t"],
    vowels: ["a", "i", "u"],
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

const v3Classes: ConjugationClass[] = [
  {
    class_id: "class_v1",
    name: "First conjugation",
    applies_to_pos: "pos_verb",
    stem_pattern: "",
    rule_ids: ["r_c1_pst"],
  },
  {
    class_id: "class_v2",
    name: "Second conjugation",
    applies_to_pos: "pos_verb",
    stem_pattern: "",
    rule_ids: ["r_c2_pst"],
  },
  {
    class_id: "class_stem_k",
    name: "Stem-pattern class (k-)",
    applies_to_pos: "pos_verb",
    stem_pattern: "^k",
    rule_ids: [],
  },
];

function v3Rule(overrides: Partial<InflectionRule> & Pick<InflectionRule, "rule_id">): InflectionRule {
  return {
    pos_id: "pos_verb",
    dimension_values: { dim_tense: "val_pst" },
    type: "suffix",
    affix: "an",
    tag: "PST",
    match_regex: ".*",
    disabled: false,
    condition: null,
    ...overrides,
  };
}

const v3Rules: InflectionRule[] = [
  v3Rule({ rule_id: "r_gen_pst", affix: "an" }),
  v3Rule({ rule_id: "r_c1_pst", affix: "ek", conjugation_class_id: "class_v1" }),
  v3Rule({ rule_id: "r_c2_pst", affix: "or", conjugation_class_id: "class_v2" }),
  v3Rule({
    rule_id: "r_fused_1",
    affix: "inta",
    tag: "PST.1",
    dimension_values: {},
    fused_dimensions: [{ dim_tense: "val_pst", dim_pers: "val_1" }],
  }),
  v3Rule({
    rule_id: "r_conf_a",
    pos_id: "pos_noun",
    dimension_values: { dim_num: "val_pl" },
    affix: "xa",
    tag: "PL",
  }),
  v3Rule({
    rule_id: "r_conf_b",
    pos_id: "pos_noun",
    dimension_values: { dim_num: "val_pl" },
    affix: "xb",
    tag: "PL",
  }),
];

const v3Slots: AffixSlot[] = [
  {
    slot_id: "slot_tense",
    position: 1,
    dimension_id: "dim_tense",
    is_obligatory: true,
    label: "Tense",
  },
];

function makeV3Grammar(
  rules: InflectionRule[],
  overrides: IrregularOverride[] = [],
  classes: ConjugationClass[] = v3Classes,
  slots: AffixSlot[] = [],
  mpRules: MorphophonologyRule[] = [],
): GrammarConfig {
  return {
    language_id: "lang_morph_v3",
    syntax: {
      word_order: "SVO",
      modifier_position: "after_head",
      adposition_type: "preposition",
    },
    parts_of_speech: [],
    inflection_dimensions: [
      {
        dim_id: "dim_tense",
        name: "Tense",
        applies_to_pos: ["pos_verb"],
        values: [
          { val_id: "val_pst", name: "Past", gloss: "PST" },
          { val_id: "val_prs", name: "Present", gloss: "PRS" },
        ],
      },
      {
        dim_id: "dim_pers",
        name: "Person",
        applies_to_pos: ["pos_verb"],
        values: [
          { val_id: "val_1", name: "First", gloss: "1" },
          { val_id: "val_2", name: "Second", gloss: "2" },
        ],
      },
      {
        dim_id: "dim_num",
        name: "Number",
        applies_to_pos: ["pos_noun"],
        values: [{ val_id: "val_pl", name: "Plural", gloss: "PL" }],
      },
    ],
    inflection_rules: rules,
    derivation_rules: [],
    grammar_manual: [],
    typology: {
      morphological_type: "fusional",
      synthesis_index: 3,
      fusion_index: 2,
      head_marking: "none",
      auto_estimated: false,
    },
    affix_slots: slots,
    conjugation_classes: classes,
    irregular_overrides: overrides,
    ...(mpRules.length > 0 ? { morphophonology_rules: mpRules } : {}),
  };
}

function makeV3Entry(
  entryId: string,
  romanized: string,
  options: {
    posId?: string;
    wordClassId?: string;
    senseClassId?: string;
    extraSense?: { gloss: string; inflectionClassId?: string };
  } = {},
): WordEntry {
  const posId = options.posId ?? "pos_verb";
  return {
    entry_id: entryId,
    language_id: "lang_morph_v3",
    con_word_romanized: romanized,
    phonetic_ipa: "",
    phonetic_override: false,
    ...(options.wordClassId ? { inflection_class_id: options.wordClassId } : {}),
    senses: [
      {
        sense_id: `s_${entryId}`,
        pos_id: posId,
        gloss: `gloss_${entryId}`,
        definitions: [],
        examples: [],
        ...(options.senseClassId ? { inflection_class_id: options.senseClassId } : {}),
      },
      ...(options.extraSense
        ? [
            {
              sense_id: `s2_${entryId}`,
              pos_id: posId,
              gloss: options.extraSense.gloss,
              definitions: [],
              examples: [],
              ...(options.extraSense.inflectionClassId
                ? { inflection_class_id: options.extraSense.inflectionClassId }
                : {}),
            },
          ]
        : []),
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

describe("resolveEntryConjugationClass priority chain", () => {
  const entry = makeV3Entry("e1", "mila", {
    wordClassId: "class_v1",
    senseClassId: "class_v2",
  });

  test("sense-level override beats word-level", () => {
    expect(
      resolveEntryConjugationClass(entry, "pos_verb", v3Classes, "s_e1"),
    ).toEqual({ classId: "class_v2", source: "sense" });
  });

  test("word-level applies when no senseId given", () => {
    expect(resolveEntryConjugationClass(entry, "pos_verb", v3Classes)).toEqual({
      classId: "class_v1",
      source: "word",
    });
  });

  test("stem_pattern fallback for unclassed entries (deterministic by class_id)", () => {
    const kStem = makeV3Entry("e2", "kulu");
    expect(resolveEntryConjugationClass(kStem, "pos_verb", v3Classes)).toEqual({
      classId: "class_stem_k",
      source: "stem_pattern",
    });
    const mStem = makeV3Entry("e3", "muna");
    expect(resolveEntryConjugationClass(mStem, "pos_verb", v3Classes)).toEqual({
      classId: null,
      source: "none",
    });
  });

  test("unknown class references fall through to the next tier", () => {
    const dangling = makeV3Entry("e4", "sula", { wordClassId: "class_missing" });
    expect(resolveEntryConjugationClass(dangling, "pos_verb", v3Classes)).toEqual({
      classId: null,
      source: "none",
    });
  });
});

describe("inflectWord: conjugation class isolation", () => {
  const grammar = makeV3Grammar(v3Rules);
  const classV1 = makeV3Entry("e_v1", "kala", { wordClassId: "class_v1" });
  const classV2 = makeV3Entry("e_v2", "mila", { wordClassId: "class_v2" });
  const plain = makeV3Entry("e_plain", "nula");

  test("two verb classes with different affixes never cross-apply", () => {
    const r1 = inflectWord({
      stem: "kala",
      posId: "pos_verb",
      dimensions: { dim_tense: "val_pst" },
      grammar,
      phono: v3Phono,
      entry: classV1,
    });
    expect(r1.surface_form).toBe("kalaek");
    expect(r1.applied_rule_ids).toEqual(["r_c1_pst"]);
    expect(r1.diagnosis.resolved_class_id).toBe("class_v1");
    expect(r1.diagnosis.resolved_class_source).toBe("word");

    const r2 = inflectWord({
      stem: "mila",
      posId: "pos_verb",
      dimensions: { dim_tense: "val_pst" },
      grammar,
      phono: v3Phono,
      entry: classV2,
    });
    expect(r2.surface_form).toBe("milaor");
    expect(r2.applied_rule_ids).toEqual(["r_c2_pst"]);
    expect(r2.diagnosis.resolved_class_id).toBe("class_v2");
  });

  test("unclassed stems keep the generic rule and skip class-bound rules", () => {
    const r = inflectWord({
      stem: "nula",
      posId: "pos_verb",
      dimensions: { dim_tense: "val_pst" },
      grammar,
      phono: v3Phono,
      entry: plain,
    });
    expect(r.surface_form).toBe("nulaan");
    expect(r.applied_rule_ids).toEqual(["r_gen_pst"]);
  });

  test("sense-level inflection_class_id overrides word-level inside the engine", () => {
    const mixed = makeV3Entry("e_mixed", "mila", {
      wordClassId: "class_v1",
      senseClassId: "class_v2",
    });
    const withSense = inflectWord({
      stem: "mila",
      posId: "pos_verb",
      dimensions: { dim_tense: "val_pst" },
      grammar,
      phono: v3Phono,
      entry: mixed,
      senseId: "s_e_mixed",
    });
    expect(withSense.surface_form).toBe("milaor");
    expect(withSense.diagnosis.resolved_class_source).toBe("sense");

    const withoutSense = inflectWord({
      stem: "mila",
      posId: "pos_verb",
      dimensions: { dim_tense: "val_pst" },
      grammar,
      phono: v3Phono,
      entry: mixed,
    });
    expect(withoutSense.surface_form).toBe("milaek");
    expect(withoutSense.diagnosis.resolved_class_source).toBe("word");
  });
});

describe("inflectWord: determinism and priority", () => {
  test("reversing the inflection_rules array never changes the output", () => {
    const grammarA = makeV3Grammar(v3Rules);
    const grammarB = makeV3Grammar([...v3Rules].reverse());
    const entry = makeV3Entry("e_v1", "kala", { wordClassId: "class_v1" });

    const single = (g: GrammarConfig): string =>
      JSON.stringify(
        inflectWord({
          stem: "kala",
          posId: "pos_verb",
          dimensions: { dim_tense: "val_pst", dim_pers: "val_1" },
          grammar: g,
          phono: v3Phono,
          entry,
        }),
      );
    expect(single(grammarA)).toBe(single(grammarB));

    const typed = (g: GrammarConfig): string =>
      JSON.stringify(
        generateTypedParadigm({
          stem: "kala",
          posId: "pos_verb",
          dimensionIds: ["dim_tense", "dim_pers"],
          grammar: g,
          phono: v3Phono,
          entry,
        }),
      );
    expect(typed(grammarA)).toBe(typed(grammarB));

    const legacy = (g: GrammarConfig): string =>
      JSON.stringify(
        generateParadigm("kala", "pos_verb", g.inflection_rules, v3Phono, {
          entryId: "e_v1",
          grammar: g,
        }),
      );
    expect(legacy(grammarA)).toBe(legacy(grammarB));
  });

  test("explicit priority beats lexicographic fallback between competing rules", () => {
    const grammar = makeV3Grammar([
      v3Rule({ rule_id: "r_low", affix: "an", priority: 5 }),
      v3Rule({ rule_id: "r_high", affix: "on", priority: -1 }),
    ]);
    const r = inflectWord({
      stem: "kala",
      posId: "pos_verb",
      dimensions: { dim_tense: "val_pst" },
      grammar,
      phono: v3Phono,
    });
    expect(r.surface_form).toBe("kalaon");
    expect(r.applied_rule_ids).toEqual(["r_high"]);
    expect(r.conflicts).toHaveLength(0);
  });

  test("tied same-priority rules report conflicts and resolve by rule_id", () => {
    const grammar = makeV3Grammar([v3Rules[4], v3Rules[5]]);
    const r = inflectWord({
      stem: "pata",
      posId: "pos_noun",
      dimensions: { dim_num: "val_pl" },
      grammar,
      phono: v3Phono,
    });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({
      candidate_rule_ids: ["r_conf_a", "r_conf_b"],
      winner_rule_id: "r_conf_a",
    });
    expect(r.surface_form).toBe("pataxa");
    expect(r.applied_rule_ids).toEqual(["r_conf_a"]);
  });
});

describe("inflectWord: fused dimensions and irregular overrides", () => {
  test("fused_dimensions match exact feature bundles and win over generic rules", () => {
    const fusedRule = v3Rules[3];
    expect(
      ruleMatchesFeatures(fusedRule, { dim_tense: "val_pst", dim_pers: "val_1" }),
    ).toBe(true);
    expect(ruleMatchesFeatures(fusedRule, { dim_tense: "val_pst" })).toBe(false);
    expect(
      ruleMatchesFeatures(fusedRule, { dim_tense: "val_pst", dim_pers: "val_2" }),
    ).toBe(false);
    expect(
      ruleMatchesFeatures(fusedRule, {
        dim_tense: "val_pst",
        dim_pers: "val_1",
        dim_num: "val_pl",
      }),
    ).toBe(true);

    const r = inflectWord({
      stem: "nula",
      posId: "pos_verb",
      dimensions: { dim_tense: "val_pst", dim_pers: "val_1" },
      grammar: makeV3Grammar(v3Rules),
      phono: v3Phono,
    });
    expect(r.surface_form).toBe("nulainta");
    expect(r.morpheme_break).toBe("nula+inta");
    expect(r.applied_rule_ids).toEqual(["r_fused_1"]);
    expect(r.gloss_labels).toBe("1.PST");
  });

  test("irregular overrides beat every regular path (exact match preferred)", () => {
    const overrides: IrregularOverride[] = [
      {
        entry_id: "e_tiki",
        dimension_values: { dim_tense: "val_pst", dim_pers: "val_1" },
        surface_form: "tiko",
      },
      {
        entry_id: "e_tiki",
        dimension_values: { dim_tense: "val_pst" },
        surface_form: "toka",
      },
    ];
    const grammar = makeV3Grammar(v3Rules, overrides);
    const entry = makeV3Entry("e_tiki", "tiki", { wordClassId: "class_v1" });

    const exact = inflectWord({
      stem: "tiki",
      posId: "pos_verb",
      dimensions: { dim_tense: "val_pst", dim_pers: "val_1" },
      grammar,
      phono: v3Phono,
      entry,
    });
    expect(exact.used_irregular).toBe(true);
    expect(exact.surface_form).toBe("tiko");
    expect(exact.steps[0]?.stage).toBe("irregular");

    const partial = inflectWord({
      stem: "tiki",
      posId: "pos_verb",
      dimensions: { dim_tense: "val_pst" },
      grammar,
      phono: v3Phono,
      entry,
    });
    expect(partial.surface_form).toBe("toka");
  });

  test("morphophonology adjustments are traced as morphophonology steps", () => {
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
    const grammar: GrammarConfig = {
      ...grammarWithHarmony("fusional"),
      inflection_rules: [plural],
    };
    const r = inflectWord({
      stem: "ev",
      posId: "noun",
      dimensions: { num: "pl" },
      grammar,
      phono: harmonyPhono,
    });
    expect(r.surface_form).toBe("evler");
    expect(r.steps.some((step) => step.stage === "morphophonology")).toBe(true);
    expect(r.steps.at(-1)?.stage).toBe("ipa");
  });
});

describe("diagnoseInflectionRequest & generateTypedParadigm", () => {
  test("reports missing obligatory slot dimensions", () => {
    const grammar = makeV3Grammar(v3Rules, [], v3Classes, v3Slots);
    const missing = diagnoseInflectionRequest(
      "pos_verb",
      { dim_pers: "val_1" },
      grammar,
    );
    expect(missing.missing_obligatory_dimensions).toEqual(["dim_tense"]);
    expect(missing.provided_dimensions).toEqual({ dim_pers: "val_1" });

    const complete = diagnoseInflectionRequest(
      "pos_verb",
      { dim_tense: "val_pst", dim_pers: "val_1" },
      grammar,
    );
    expect(complete.missing_obligatory_dimensions).toEqual([]);
  });

  test("enumerates the full feature-matrix with class-aware winners", () => {
    const grammar = makeV3Grammar([v3Rules[0], v3Rules[1]]);
    const entry = makeV3Entry("e_v1", "kala", { wordClassId: "class_v1" });
    const cells = generateTypedParadigm({
      stem: "kala",
      posId: "pos_verb",
      dimensionIds: ["dim_tense", "dim_pers"],
      grammar,
      phono: v3Phono,
      entry,
    });
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => c.dimensions)).toEqual([
      { dim_tense: "val_pst", dim_pers: "val_1" },
      { dim_tense: "val_pst", dim_pers: "val_2" },
      { dim_tense: "val_prs", dim_pers: "val_1" },
      { dim_tense: "val_prs", dim_pers: "val_2" },
    ]);
    expect(cells[0].result.surface_form).toBe("kalaek");
    // 只有 PST 规则真正生效（1 人称没有专属规则中标），故标签不再虚报 1。
    expect(cells[0].result.gloss_labels).toBe("PST");
    expect(cells[2].result.surface_form).toBe("kala");
    expect(cells[2].result.applied_rule_ids).toEqual([]);
  });

  test("entry-level irregular overrides outside the enumerated grid get their own cell", () => {
    const overrides: IrregularOverride[] = [
      {
        entry_id: "e_pata",
        dimension_values: { dim_num: "val_pl" },
        surface_form: "zorp",
      },
    ];
    const grammar = makeV3Grammar(
      [v3Rule({ rule_id: "r_noun_pl", pos_id: "pos_noun", dimension_values: { dim_num: "val_pl" }, affix: "ta" })],
      overrides,
    );
    const entry = makeV3Entry("e_pata", "pata", { posId: "pos_noun" });
    const cells = generateTypedParadigm({
      stem: "pata",
      posId: "pos_noun",
      dimensionIds: ["dim_tense"],
      grammar,
      phono: v3Phono,
      entry,
    });
    // dim_tense 不适用于名词 → 基础组合 + 覆盖补格
    expect(cells).toHaveLength(2);
    expect(cells[0].dimensions).toEqual({});
    expect(cells[0].result.surface_form).toBe("pata");
    expect(cells[1].result.used_irregular).toBe(true);
    expect(cells[1].result.surface_form).toBe("zorp");
  });
});

// ── Roadmap v3 / P1-7：generateParadigm 兼容层与多槽位记录 ─────────────

function makeClassOnlyGrammar(): GrammarConfig {
  return makeV3Grammar([
    v3Rule({ rule_id: "r_gen_pst", affix: "an" }),
    v3Rule({ rule_id: "r_c1_pst", affix: "ek", conjugation_class_id: "class_v1" }),
    v3Rule({ rule_id: "r_c2_pst", affix: "or", conjugation_class_id: "class_v2" }),
  ]);
}

describe("generateParadigm compatibility layer (P1-7)", () => {
  test("explicit entry + senseId resolve sense-level inflection classes", () => {
    const grammar = makeClassOnlyGrammar();
    const entry = makeV3Entry("e_mixed", "mila", {
      wordClassId: "class_v1",
      senseClassId: "class_v2",
    });
    const rules = grammar.inflection_rules;

    const withSense = generateParadigm("mila", "pos_verb", rules, v3Phono, {
      entryId: entry.entry_id,
      grammar,
      entry,
      senseId: "s_e_mixed",
    });
    expect(withSense.map((cell) => cell.result)).toEqual(["milaor"]);

    // 不传 senseId → 退回词条级变位类
    const wordLevel = generateParadigm("mila", "pos_verb", rules, v3Phono, {
      entryId: entry.entry_id,
      grammar,
      entry,
    });
    expect(wordLevel.map((cell) => cell.result)).toEqual(["milaek"]);
  });

  test("stub fallback keeps the pre-v3 behaviour when no entry is supplied", () => {
    const grammar = makeClassOnlyGrammar();
    const stub = generateParadigm("mila", "pos_verb", grammar.inflection_rules, v3Phono, {
      entryId: "e_mixed",
      grammar,
    });
    // 空壳词条没有变位类 → 只能套用无类别的通用规则（100% 向后兼容）
    expect(stub.map((cell) => cell.result)).toEqual(["milaan"]);
    // 完全不传 context 的旧签名仍然逐规则输出
    expect(
      generateParadigm("mila", "pos_verb", grammar.inflection_rules, v3Phono).map(
        (cell) => cell.result,
      ),
    ).toEqual(["milaan", "milaek", "milaor"]);
  });

  test("rules neutralised by an earlier affix are never recorded as applied", () => {
    const rules: InflectionRule[] = [
      v3Rule({ rule_id: "r_tense", affix: "an", slot_id: "slot_tense" }),
      v3Rule({
        rule_id: "r_pers",
        affix: "ta",
        type: "prefix",
        dimension_values: { dim_pers: "val_1" },
        // 词干以 a 结尾时成立；加上 -an 之后不再成立 → 多槽位未生效
        match_regex: "a$",
        slot_id: "slot_pers",
      }),
    ];
    const slots: AffixSlot[] = [
      { slot_id: "slot_tense", position: 1, dimension_id: "dim_tense", is_obligatory: false, label: "Tense" },
      { slot_id: "slot_pers", position: 2, dimension_id: "dim_pers", is_obligatory: false, label: "Person" },
    ];
    const result = inflectWord({
      stem: "kala",
      posId: "pos_verb",
      dimensions: { dim_tense: "val_pst", dim_pers: "val_1" },
      grammar: makeV3Grammar(rules, [], [], slots),
      phono: v3Phono,
    });

    expect(result.surface_form).toBe("kalaan");
    expect(result.applied_rule_ids).toEqual(["r_tense"]);
    expect(
      result.steps.some((step) => step.stage === "affix" && step.rule_id === "r_pers"),
    ).toBe(false);
    // 未生效的 1 人称不得出现在标签里
    expect(result.gloss_labels).toBe("PST");
  });
});

