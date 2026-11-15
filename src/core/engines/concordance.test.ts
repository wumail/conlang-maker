import { describe, expect, test } from "bun:test";
import type {
  CorpusText,
  GrammarConfig,
  InflectionRule,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import rawGrammar from "../../../tests/fixtures/workspace-basic/roots/root/grammar.json";
import rawPhono from "../../../tests/fixtures/workspace-basic/roots/root/phonology.json";
import { buildAcceptedForms, computeCorpusReferenceImpact, findWordConcordance } from "./concordance";

const phono = structuredClone(rawPhono) as PhonologyConfig;

function grammarWith(rules: InflectionRule[]): GrammarConfig {
  const grammar = structuredClone(rawGrammar) as GrammarConfig;
  grammar.inflection_rules = rules;
  grammar.inflection_dimensions = [
    {
      dim_id: "number",
      name: "Number",
      applies_to_pos: ["noun"],
      values: [{ val_id: "plural", name: "Plural", gloss: "PL." }],
    },
  ];
  return grammar;
}

const pluralRule: InflectionRule = {
  rule_id: "rule_plural",
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

function word(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    entry_id: "entry_kata",
    language_id: "lang_qc",
    con_word_romanized: "kata",
    phonetic_ipa: "kata",
    phonetic_override: false,
    senses: [
      {
        sense_id: "sense_1",
        pos_id: "noun",
        gloss: "stone",
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
    ...overrides,
  };
}

function corpus(
  corpusId: string,
  lines: {
    original: string;
    translation: string;
    tokens: {
      surface: string;
      linked?: string;
      break?: string;
      sense?: string;
      status?: "auto" | "edited" | "verified";
    }[];
  }[],
): CorpusText {
  return {
    corpus_id: corpusId,
    language_id: "lang_qc",
    title: `Text ${corpusId}`,
    description: "",
    original_text: lines.map((line) => line.original).join("\n"),
    free_translation: "",
    glossed_lines: lines.map((line, index) => ({
      line_id: `line_${index + 1}`,
      original: line.original,
      translation: line.translation,
      tokens: line.tokens.map((token, tokenIndex) => ({
        token_id: `tok_${index + 1}_${tokenIndex + 1}`,
        surface_form: token.surface,
        morpheme_break: token.break ?? token.surface,
        gloss_labels: token.break ?? "",
        linked_entry_id: token.linked ?? "",
        linked_sense_id: token.sense,
        status: token.status,
        ipa: "",
      })),
    })),
    metadata: { tags: [], created_at: "", updated_at: "" },
  };
}

describe("buildAcceptedForms", () => {
  test("includes the base form and every generated inflection", () => {
    const forms = buildAcceptedForms(word(), grammarWith([pluralRule]), phono);
    expect(forms.has("kata")).toBe(true);
    expect(forms.has("katalar")).toBe(true);
  });

  test("merges caller supplied extra forms", () => {
    const forms = buildAcceptedForms(word(), grammarWith([]), phono, ["Kata·wa"]);
    expect(forms.has("kata·wa")).toBe(true);
  });

  test("honours the entry's conjugation class instead of only generic rules", () => {
    // 回归（P1-7）：范式生成曾用空壳词条，义项级 inflection_class_id 被丢弃，
    // 导致反向索引只认通用规则的形式、漏掉专属变位类的屈折形。
    const classedRule: InflectionRule = {
      ...pluralRule,
      rule_id: "rule_class_plural",
      affix: "kwa",
      conjugation_class_id: "class_a",
    };
    const grammar = grammarWith([pluralRule, classedRule]);
    grammar.conjugation_classes = [
      {
        class_id: "class_a",
        name: "A",
        applies_to_pos: "noun",
        stem_pattern: "",
        rule_ids: ["rule_class_plural"],
      },
    ];
    const entry = word({
      senses: [
        {
          sense_id: "sense_1",
          pos_id: "noun",
          gloss: "stone",
          definitions: [],
          examples: [],
          inflection_class_id: "class_a",
        },
      ],
    });

    const forms = buildAcceptedForms(entry, grammar, phono);
    expect(forms.has("kata")).toBe(true);
    expect(forms.has("katakwa")).toBe(true);
    expect(forms.has("katalar")).toBe(false);
  });

  test("includes inflected forms for every sense class when a polysemous word shares the same POS", () => {
    const classARule: InflectionRule = {
      ...pluralRule,
      rule_id: "rule_class_a",
      affix: "kwa",
      conjugation_class_id: "class_a",
    };
    const classBRule: InflectionRule = {
      ...pluralRule,
      rule_id: "rule_class_b",
      affix: "nui",
      conjugation_class_id: "class_b",
    };
    const grammar = grammarWith([pluralRule, classARule, classBRule]);
    grammar.conjugation_classes = [
      { class_id: "class_a", name: "A", applies_to_pos: "noun", stem_pattern: "", rule_ids: ["rule_class_a"] },
      { class_id: "class_b", name: "B", applies_to_pos: "noun", stem_pattern: "", rule_ids: ["rule_class_b"] },
    ];
    const entry = word({
      senses: [
        { sense_id: "s1", pos_id: "noun", gloss: "stone", definitions: [], examples: [], inflection_class_id: "class_a" },
        { sense_id: "s2", pos_id: "noun", gloss: "rock-spirit", definitions: [], examples: [], inflection_class_id: "class_b" },
      ],
    });
    const forms = buildAcceptedForms(entry, grammar, phono);
    expect(forms.has("katakwa")).toBe(true);
    expect(forms.has("katanui")).toBe(true);
  });
});

describe("findWordConcordance", () => {
  test("matches the base form regardless of case", () => {
    const texts = [
      corpus("t1", [
        { original: "Kata miru.", translation: "A stone falls.", tokens: [{ surface: "Kata" }] },
      ]),
    ];
    const result = findWordConcordance({
      entry: word(),
      corpusTexts: texts,
      grammar: grammarWith([pluralRule]),
      phono,
    });
    expect(result.total).toBe(1);
    expect(result.matches[0]).toMatchObject({
      textId: "t1",
      lineId: "line_1",
      matchedTokenSurface: "Kata",
      freeTranslation: "A stone falls.",
    });
  });

  test("matches an inflected form produced by the paradigm", () => {
    const texts = [
      corpus("t1", [
        {
          original: "katalar miru.",
          translation: "Stones fall.",
          tokens: [{ surface: "katalar", break: "kata-lar", linked: "entry_kata" }],
        },
        {
          original: "katalar kata.",
          translation: "Stones, a stone.",
          tokens: [{ surface: "katalar", break: "kata-lar" }, { surface: "kata" }],
        },
      ]),
    ];
    const result = findWordConcordance({
      entry: word(),
      corpusTexts: texts,
      grammar: grammarWith([pluralRule]),
      phono,
    });
    expect(result.total).toBe(3);
  });

  test("prefers explicit token links even when the surface differs", () => {
    const texts = [
      corpus("t1", [
        { original: "kt.", translation: "Stone (abbr).", tokens: [{ surface: "kt", linked: "entry_kata" }] },
      ]),
    ];
    const result = findWordConcordance({
      entry: word(),
      corpusTexts: texts,
      grammar: grammarWith([pluralRule]),
      phono,
    });
    expect(result.total).toBe(1);
    expect(result.matches[0]!.matchedTokenSurface).toBe("kt");
  });

  test("ignores homographs that are explicitly linked to another entry", () => {
    const texts = [
      corpus("t1", [
        { original: "kata", translation: "harvest", tokens: [{ surface: "kata", linked: "entry_harvest" }] },
      ]),
    ];
    const result = findWordConcordance({
      entry: word(),
      corpusTexts: texts,
      grammar: grammarWith([pluralRule]),
      phono,
    });
    expect(result.total).toBe(0);
    expect(result.matches).toEqual([]);
  });

  test("returns an empty result for an empty corpus library", () => {
    const result = findWordConcordance({
      entry: word(),
      corpusTexts: [],
      grammar: grammarWith([pluralRule]),
      phono,
    });
    expect(result).toEqual({ matches: [], total: 0 });
  });

  test("skips blank tokens and honours the limit while reporting the full total", () => {
    const texts = [
      corpus("t1", [
        {
          original: "kata kata",
          translation: "x",
          tokens: [{ surface: "  " }, { surface: "kata" }, { surface: "kata" }],
        },
      ]),
      corpus("t2", [
        { original: "kata", translation: "y", tokens: [{ surface: "kata" }] },
      ]),
    ];
    const result = findWordConcordance({
      entry: word(),
      corpusTexts: texts,
      grammar: grammarWith([pluralRule]),
      phono,
      limit: 2,
    });
    expect(result.total).toBe(3);
    expect(result.matches).toHaveLength(2);
  });

  test("uses token gloss labels and falls back to the entry gloss", () => {
    const texts = [
      corpus("t1", [
        {
          original: "kata",
          translation: "",
          tokens: [{ surface: "kata", break: "kata\\N" }, { surface: "kata" }],
        },
      ]),
    ];
    const result = findWordConcordance({
      entry: word(),
      corpusTexts: texts,
      grammar: grammarWith([pluralRule]),
      phono,
    });
    expect(result.matches[0]!.gloss).toBe("kata\\N");
    expect(result.matches[1]!.gloss).toBe("stone");
  });
});

// ── Roadmap v3 / Pillar 6：义项级反向索引与删除前引用预检 ───────────────

function polysemousWord(): WordEntry {
  return word({
    senses: [
      {
        sense_id: "sense_1",
        pos_id: "noun",
        gloss: "stone",
        definitions: [],
        examples: [],
      },
      {
        sense_id: "sense_2",
        pos_id: "noun",
        gloss: "weight",
        definitions: [],
        examples: [],
      },
    ],
  });
}

describe("findWordConcordance sense filtering (Roadmap v3 W4)", () => {
  test("keeps only the exact sense binding for polysemous entries", () => {
    const texts = [
      corpus("t1", [
        {
          original: "kata kata kata",
          translation: "stones and weight",
          tokens: [
            { surface: "kata", linked: "entry_kata", sense: "sense_1" },
            { surface: "kata", linked: "entry_kata", sense: "sense_2" },
            { surface: "kata", linked: "entry_kata" },
          ],
        },
      ]),
    ];
    const base = {
      entry: polysemousWord(),
      corpusTexts: texts,
      grammar: grammarWith([pluralRule]),
      phono,
    };

    expect(findWordConcordance(base).total).toBe(3);
    const sense1 = findWordConcordance({ ...base, senseId: "sense_1" });
    expect(sense1.total).toBe(1);
    expect(sense1.matches[0]!.lineId).toBe("line_1");

    const sense2 = findWordConcordance({ ...base, senseId: "sense_2" });
    expect(sense2.total).toBe(1);
  });

  test("counts unbound tokens only for single-sense entries", () => {
    const texts = [
      corpus("t1", [
        {
          original: "kata",
          translation: "",
          tokens: [{ surface: "kata", linked: "entry_kata" }],
        },
      ]),
    ];
    const single = findWordConcordance({
      entry: word(),
      corpusTexts: texts,
      grammar: grammarWith([pluralRule]),
      phono,
      senseId: "sense_1",
    });
    expect(single.total).toBe(1);

    const poly = findWordConcordance({
      entry: polysemousWord(),
      corpusTexts: texts,
      grammar: grammarWith([pluralRule]),
      phono,
      senseId: "sense_1",
    });
    expect(poly.total).toBe(0);
  });
});

describe("computeCorpusReferenceImpact (Roadmap v3 W4)", () => {
  test("counts hits, verified hits and distinct corpus titles", () => {
    const texts = [
      corpus("t1", [
        {
          original: "kata",
          translation: "",
          tokens: [
            { surface: "kata", linked: "entry_kata", status: "verified" },
            { surface: "kata", linked: "entry_kata", status: "auto" },
          ],
        },
      ]),
      corpus("t2", [
        {
          original: "kata katalar",
          translation: "",
          tokens: [
            { surface: "kata", linked: "entry_other" },
            { surface: "katalar", linked: "entry_kata", status: "verified" },
          ],
        },
      ]),
    ];

    expect(computeCorpusReferenceImpact({ corpusTexts: texts, entryId: "entry_kata" })).toEqual({
      totalHits: 3,
      verifiedHits: 2,
      affectedCorpusTitles: ["Text t1", "Text t2"],
    });
  });

  test("narrows counting to a single sense when requested", () => {
    const texts = [
      corpus("t1", [
        {
          original: "kata kata",
          translation: "",
          tokens: [
            { surface: "kata", linked: "entry_kata", sense: "sense_1" },
            { surface: "kata", linked: "entry_kata", sense: "sense_2" },
          ],
        },
      ]),
    ];

    expect(
      computeCorpusReferenceImpact({
        corpusTexts: texts,
        entryId: "entry_kata",
        senseId: "sense_2",
      }),
    ).toEqual({ totalHits: 1, verifiedHits: 0, affectedCorpusTitles: ["Text t1"] });
  });

  test("returns zero for unreferenced entries", () => {
    expect(
      computeCorpusReferenceImpact({ corpusTexts: [], entryId: "entry_kata" }),
    ).toEqual({ totalHits: 0, verifiedHits: 0, affectedCorpusTitles: [] });
  });
});
