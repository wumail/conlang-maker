import { describe, expect, test } from "bun:test";
import type {
  GrammarConfig,
  InflectionRule,
  PhonologyConfig,
  SCARuleSet,
  StressConfig,
} from "../../types";
import rawGrammar from "../../../tests/fixtures/workspace-basic/roots/root/grammar.json";
import { computeTokenProsody, pickStressedSyllable } from "./prosody";
import { applySoundChanges } from "./scaEngine";
import { generateParadigm } from "./morphologyEngine";

function phonology(): PhonologyConfig {
  return {
    language_id: "lang_prosody",
    phoneme_inventory: {
      consonants: ["p", "t", "k", "n", "l", "r", "m", "s", "v"],
      vowels: ["a", "e", "i", "o", "u", "ə"],
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
}

const SYLLABLES = [
  { onset: ["k"], nucleus: ["a"], coda: [], weight: "light" as const },
  { onset: ["t"], nucleus: ["a"], coda: ["l"], weight: "heavy" as const },
  { onset: ["p"], nucleus: ["a"], coda: [], weight: "light" as const },
];

function stress(position: StressConfig["position"], extra: Partial<StressConfig> = {}): StressConfig {
  return { position, domain: "word", ...extra };
}

describe("pickStressedSyllable", () => {
  test("supports the five stress patterns", () => {
    expect(pickStressedSyllable(SYLLABLES, stress("initial"))).toBe(0);
    expect(pickStressedSyllable(SYLLABLES, stress("penultimate"))).toBe(1);
    expect(pickStressedSyllable(SYLLABLES, stress("ultimate"))).toBe(2);
    expect(pickStressedSyllable(SYLLABLES, stress("antepenultimate"))).toBe(0);
  });

  test("weight-sensitive prefers the last heavy syllable", () => {
    expect(pickStressedSyllable(SYLLABLES, stress("weight_sensitive"))).toBe(1);
  });

  test("weight-sensitive falls back when every syllable is light", () => {
    const light = SYLLABLES.map((syllable) => ({ ...syllable, coda: [], weight: "light" as const }));
    expect(pickStressedSyllable(light, stress("weight_sensitive"))).toBe(1);
    expect(
      pickStressedSyllable(light, stress("weight_sensitive", { weight_fallback: "initial" })),
    ).toBe(0);
    expect(
      pickStressedSyllable(
        light,
        stress("weight_sensitive", { weight_fallback: "antepenultimate" }),
      ),
    ).toBe(0);
  });

  test("returns -1 without a stress configuration", () => {
    expect(pickStressedSyllable(SYLLABLES, null)).toBe(-1);
  });
});

describe("computeTokenProsody", () => {
  test("marks stress, weight and edge syllables per token", () => {
    const phono = phonology();
    phono.phonotactics.stress = stress("penultimate");
    const metas = computeTokenProsody(
      ["k", "a", "t", "a", "l", "p", "a"],
      phono.phonotactics,
      phono.phoneme_inventory,
      phono.phonotactics.stress,
    );
    // ka.talp.a → 倒数第二音节是 talp（重音落在 t）
    expect(metas[2]).toMatchObject({
      stressed: true,
      closed_syllable: true,
      open_syllable: false,
    });
    expect(metas[0]).toMatchObject({ stressed: false, initial_syllable: true, open_syllable: true });
    expect(metas[6]).toMatchObject({ final_syllable: true });
  });

  test("degrades to all-false when the syllabifier rejects the word", () => {
    const phono = phonology();
    const metas = computeTokenProsody(
      ["k", "k", "k"],
      phono.phonotactics,
      phono.phoneme_inventory,
      stress("initial"),
    );
    expect(metas.every((meta) => !meta.stressed && !meta.open_syllable)).toBe(true);
  });
});

describe("suprasegmental SCA", () => {
  const featureRuleSet = (): SCARuleSet[] => [
    {
      ruleset_id: "rs_prosody",
      name: "Reduce unstressed vowels",
      order: 1,
      rules: [
        {
          rule_id: "r_reduce",
          description: "unstressed vowel → ə",
          target: "",
          replacement: "",
          context_before: "",
          context_after: "",
          exceptions: [],
          feature_mode: true,
          target_features: { positive: ["vowel", "unstressed"], negative: [] },
          replacement_features: {
            set_features: ["mid", "central"],
            remove_features: ["open", "front"],
          },
          context_before_features: null,
          context_after_features: null,
        },
      ],
    },
  ];

  test("reduces unstressed vowels only (with prosody context)", () => {
    const phono = phonology();
    // ka.tal.pa → 倒数第二音节 tal 重读
    phono.phonotactics.stress = stress("penultimate");
    const { result } = applySoundChanges(
      "katalpa",
      featureRuleSet(),
      {},
      phono.phoneme_inventory.vowels.concat(phono.phoneme_inventory.consonants),
      {
        phonotactics: phono.phonotactics,
        inventory: phono.phoneme_inventory,
        stress: phono.phonotactics.stress,
      },
    );
    // 重读的 tal 保留；ka 与 pa 的 a 弱化为 ə
    expect(result).toBe("kətalpə");
    expect(result).toContain("tal");
  });

  test("legacy call without prosody context is unchanged", () => {
    const phono = phonology();
    const { result } = applySoundChanges(
      "katalpa",
      featureRuleSet(),
      {},
      phono.phoneme_inventory.vowels.concat(phono.phoneme_inventory.consonants),
    );
    // 无法判断重音 → 伪特征不成立 → 原样返回
    expect(result).toBe("katalpa");
  });
});

describe("morphophonology integration", () => {
  function grammarWithRule(): GrammarConfig {
    const grammar = structuredClone(rawGrammar) as GrammarConfig;
    grammar.parts_of_speech = [
      {
        pos_id: "noun",
        name: "Noun",
        gloss_abbr: "N",
        word_pattern: "",
        requires_definition: false,
        requires_pronunciation: false,
      },
    ];
    grammar.morphophonology_rules = [
      {
        rule_id: "mph_harmony",
        description: "a → e after front vowels",
        priority: 1,
        target: "a",
        replacement: "e",
        context_before: "e C* +",
        context_after: "",
        feature_mode: false,
        target_features: null,
        replacement_features: null,
        context_before_features: null,
        context_after_features: null,
      },
    ];
    return grammar;
  }

  const plural: InflectionRule = {
    rule_id: "plural",
    pos_id: "noun",
    dimension_values: { number: "plural" },
    tag: "PL",
    type: "suffix",
    affix: "lar",
    match_regex: ".*",
    disabled: false,
    condition: null,
    sca_mutable: true,
  };

  test("applies morphophonology to generated paradigm cells", () => {
    const grammar = grammarWithRule();
    const phono = phonology();
    const cells = generateParadigm("ev", "noun", [plural], phono, {
      entryId: "e1",
      grammar,
    });
    expect(cells[0]?.result).toBe("evler");
  });

  test("leaves back-vowel stems untouched", () => {
    const grammar = grammarWithRule();
    const phono = phonology();
    const cells = generateParadigm("at", "noun", [plural], phono, {
      entryId: "e2",
      grammar,
    });
    expect(cells[0]?.result).toBe("atlar");
  });

  test("without rules the affix is concatenated verbatim", () => {
    const grammar = grammarWithRule();
    grammar.morphophonology_rules = [];
    const cells = generateParadigm("ev", "noun", [plural], phonology(), {
      entryId: "e3",
      grammar,
    });
    expect(cells[0]?.result).toBe("evlar");
  });
});
