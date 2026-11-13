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
import { buildAcceptedForms, findWordConcordance } from "./concordance";

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
  lines: { original: string; translation: string; tokens: { surface: string; linked?: string; break?: string }[] }[],
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
