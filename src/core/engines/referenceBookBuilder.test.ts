import { describe, expect, test } from "bun:test";
import type {
  CorpusText,
  GrammarConfig,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import {
  buildReferenceBookHtml,
  buildReferenceBookTypst,
  escapeHtml,
  escapeTypst,
  textToFontText,
  wordToFontText,
  type ReferenceBookOptions,
} from "./referenceBookBuilder";
import { buildFontInputIndex } from "./fontInput";

function word(id: string, form: string, gloss: string, ipa = ""): WordEntry {
  return {
    entry_id: id,
    language_id: "lang",
    con_word_romanized: form,
    phonetic_ipa: ipa,
    phonetic_override: false,
    senses: [
      {
        sense_id: `s_${id}`,
        pos_id: "pos_noun",
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
    metadata: { tags: [], created_at: "2026-01-01", updated_at: "2026-01-01" },
  };
}

const phono: PhonologyConfig = {
  language_id: "lang",
  phoneme_inventory: { consonants: ["p", "t", "k", "s"], vowels: ["a", "i", "u"] },
  romanization_maps: [
    {
      map_id: "default",
      name: "Default",
      is_default: true,
      rules: [
        { rule_id: "r1", input: "sh", output_phoneme: "ʃ", context_before: "", context_after: "" },
      ],
    },
  ],
  phonotactics: {
    macros: {},
    syllable_structure: "(C)V(C)",
    blacklist_patterns: [],
    vowel_harmony: { enabled: false, group_a: [], group_b: [] },
    tone_system: { enabled: false, tones: [] },
  },
  allophony_rules: [],
};

const grammar: GrammarConfig = {
  language_id: "lang",
  syntax: {
    word_order: "SOV",
    modifier_position: "before_head",
    adposition_type: "postposition",
    alignment: "erg_abs",
  },
  parts_of_speech: [
    {
      pos_id: "pos_noun",
      name: "Noun",
      gloss_abbr: "n",
      word_pattern: "",
      requires_definition: true,
      requires_pronunciation: false,
    },
  ],
  inflection_dimensions: [
    {
      dim_id: "dim_num",
      name: "Number",
      applies_to_pos: ["pos_noun"],
      values: [
        { val_id: "sg", name: "Singular", gloss: "SG" },
        { val_id: "pl", name: "Plural", gloss: "PL" },
      ],
    },
  ],
  inflection_rules: [
    {
      rule_id: "r_pl",
      pos_id: "pos_noun",
      dimension_values: { dim_num: "pl" },
      type: "suffix",
      affix: "ta",
      tag: "PL",
      match_regex: ".*",
      disabled: false,
      condition: null,
    },
  ],
  derivation_rules: [],
  grammar_manual: [
    {
      chapter_id: "ch1",
      title: "Noun inflection",
      content: "Plural is formed with -ta.\n{{paradigm:p1}}",
      order: 1,
      embedded_paradigms: [
        {
          paradigm_id: "p1",
          pos_id: "pos_noun",
          dimension_ids: ["dim_num"],
          test_word: "kasa",
        },
      ],
    },
  ],
  typology: {
    morphological_type: "agglutinative",
    synthesis_index: 2,
    fusion_index: 1,
    head_marking: "dependent",
    auto_estimated: false,
  },
  affix_slots: [],
  conjugation_classes: [],
  irregular_overrides: [],
};

const corpus: CorpusText = {
  corpus_id: "c1",
  language_id: "lang",
  title: "A short text",
  description: "Demo",
  original_text: "kasa ta",
  glossed_lines: [
    {
      line_id: "l1",
      original: "kasa ta",
      tokens: [
        {
          token_id: "t1",
          surface_form: "kasa",
          morpheme_break: "kasa",
          gloss_labels: "house",
          linked_entry_id: "",
          ipa: "kasa",
        },
        {
          token_id: "t2",
          surface_form: "ta",
          morpheme_break: "ta",
          gloss_labels: "PL",
          linked_entry_id: "",
          ipa: "ta",
        },
      ],
      translation: "houses",
    },
  ],
  free_translation: "houses",
  metadata: { tags: [], created_at: "2026-01-01", updated_at: "2026-01-01" },
};

function options(overrides: Partial<ReferenceBookOptions> = {}): ReferenceBookOptions {
  return {
    languageName: "Testlang",
    nativeName: "tɛstlan",
    phono,
    grammar,
    words: [word("w2", "sata", "stone"), word("w1", "kasa", "house", "kasa")],
    corpus: [corpus],
    sections: {
      phonology: true,
      typology: true,
      paradigms: true,
      manual: true,
      corpus: true,
      dictionary: true,
      reverseIndex: true,
    },
    ...overrides,
  };
}

describe("escapeHtml", () => {
  test("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<script>alert("x")&'y'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;y&#39;&lt;/script&gt;",
    );
  });

  test("leaves unicode and IPA untouched", () => {
    expect(escapeHtml("tʃʰ ˈkaːsə 中文")).toBe("tʃʰ ˈkaːsə 中文");
  });
});

describe("escapeTypst", () => {
  test("escapes markup control characters", () => {
    expect(escapeTypst("#let x = *bold* _it_ $m$")).toBe(
      "\\#let x = \\*bold\\* \\_it\\_ \\$m\\$",
    );
  });
});

describe("buildReferenceBookHtml", () => {
  test("embeds the font as a data URI only when supplied", () => {
    const without = buildReferenceBookHtml(options());
    expect(without).not.toContain("@font-face");

    const withFont = buildReferenceBookHtml(
      options({ fontBase64: "AAABAAE=", fontMime: "font/otf" }),
    );
    expect(withFont).toContain('@font-face { font-family: "ConlangBook"');
    expect(withFont).toContain("data:font/otf;base64,AAABAAE=");
  });

  test("renders the cover, TOC and every enabled section", () => {
    const html = buildReferenceBookHtml(options());
    expect(html).toContain("<title>Testlang — Reference Grammar</title>");
    expect(html).toContain("tɛstlan");
    expect(html).toContain('href="#phonology"');
    for (const id of ["phonology", "typology", "paradigms", "manual", "corpus", "dictionary", "reverse"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test("omits disabled sections", () => {
    const html = buildReferenceBookHtml(
      options({
        sections: {
          phonology: false,
          typology: false,
          paradigms: false,
          manual: false,
          corpus: false,
          dictionary: true,
          reverseIndex: false,
        },
      }),
    );
    expect(html).not.toContain('id="phonology"');
    expect(html).not.toContain('id="corpus"');
    expect(html).toContain('id="dictionary"');
    expect(html).not.toContain('id="reverse"');
  });

  test("replaces {{paradigm:...}} with a table but keeps user HTML escaped", () => {
    const html = buildReferenceBookHtml(
      options({
        grammar: {
          ...grammar,
          grammar_manual: [
            {
              ...grammar.grammar_manual[0]!,
              content: "<b>note</b> {{paradigm:p1}}",
            },
          ],
        },
      }),
    );
    expect(html).toContain("&lt;b&gt;note&lt;/b&gt;");
    expect(html).toContain('<table class="paradigm">');
    expect(html).toContain("<td>PL</td><td>ta</td>");
    expect(html).not.toContain("{{paradigm:p1}}");
  });

  test("flags a missing paradigm without breaking the page", () => {
    const html = buildReferenceBookHtml(
      options({
        grammar: {
          ...grammar,
          grammar_manual: [{ ...grammar.grammar_manual[0]!, content: "{{paradigm:nope}}" }],
        },
      }),
    );
    expect(html).toContain("[missing paradigm: nope]");
  });

  test("sorts the dictionary and builds a reverse index", () => {
    const html = buildReferenceBookHtml(options());
    const kasa = html.indexOf(">kasa<");
    const sata = html.indexOf(">sata<");
    expect(kasa).toBeGreaterThan(-1);
    expect(sata).toBeGreaterThan(-1);
    expect(kasa).toBeLessThan(sata);
    // 反向索引按释义排序：house 在 stone 之前
    expect(html.indexOf(">house<")).toBeLessThan(html.indexOf(">stone<"));
  });

  test("escapes corpus and lexicon values", () => {
    const html = buildReferenceBookHtml(
      options({ words: [word("w3", "<b>bad</b>", "a & b")] }),
    );
    expect(html).toContain("&lt;b&gt;bad&lt;/b&gt;");
    expect(html).toContain("a &amp; b");
    expect(html).not.toContain("<b>bad</b>");
  });
});

describe("buildReferenceBookHtml: native script rendering", () => {
  const fontInputPhono: PhonologyConfig = {
    ...phono,
    font_features: ["ss01=1"],
    font_input: {
      phonemes: { k: "K", a: "A", s: "S", t: "T" },
      vowels: ["a"],
      multigraphs: [],
      separator: "",
    },
  };

  function nativeWord(): WordEntry {
    return {
      ...word("w1", "kasa", "house", "kasa"),
      phonetic_override: true,
      phonetic_ipa: "kasa",
    };
  }

  test("injects font-feature-settings into the .conlang rule", () => {
    const html = buildReferenceBookHtml(options({ phono: fontInputPhono }));
    expect(html).toMatch(/\.conlang\s*\{[^}]*font-feature-settings:[^}]*"ss01" 1/);
    expect(html).toMatch(/\.conlang\s*\{[^}]*"liga" 1/);
  });

  test("selects the font format from the MIME type or file name", () => {
    const ttf = buildReferenceBookHtml(
      options({ fontBase64: "AAABAAE=", fontMime: "font/ttf" }),
    );
    expect(ttf).toContain('format("truetype")');

    const otf = buildReferenceBookHtml(
      options({ fontBase64: "AAABAAE=", fontMime: "font/otf" }),
    );
    expect(otf).toContain('format("opentype")');
    expect(otf).toContain("data:font/otf;base64,AAABAAE=");

    const byName = buildReferenceBookHtml(
      options({ fontBase64: "AAABAAE=", fontMime: "font/ttf", fontFileName: "Script.OTF" }),
    );
    expect(byName).toContain('format("opentype")');
  });

  test("converts lexical headwords and free text through the font input index", () => {
    const entry = nativeWord();
    const index = buildFontInputIndex([entry], grammar, fontInputPhono);
    expect(wordToFontText(entry, fontInputPhono, index)).toBe("KASA");
    expect(textToFontText("kasa", fontInputPhono, index)).toBe("KASA");
    expect(textToFontText("kasa", phono, null)).toBe("");

    const html = buildReferenceBookHtml(
      options({
        phono: fontInputPhono,
        words: [entry],
        fontBase64: "AAABAAE=",
        fontMime: "font/ttf",
      }),
    );
    expect(html).toContain('<span class="conlang native-headword">KASA</span>');
  });

  test("writes both the native headword and the romanized headword", () => {
    const html = buildReferenceBookHtml(options({ words: [word("w1", "kasa", "house")] }));
    expect(html).toContain('<span class="conlang native-headword">kasa</span> <span class="headword">kasa</span>');
  });

  test("renders a native corpus line above the romanized transcription", () => {
    const html = buildReferenceBookHtml(
      options({
        phono: fontInputPhono,
        words: [nativeWord()],
        fontBase64: "AAABAAE=",
        fontMime: "font/ttf",
      }),
    );
    const corpus = html.slice(html.indexOf('id="corpus"'), html.indexOf('id="dictionary"'));
    expect(corpus).toContain('<div class="conlang native-line">KASA  TA</div>');
    expect(corpus).toContain('<div class="romanized">kasa  ta</div>');
  });

  test("covers every sense, concept label and etymology in the reverse index", () => {
    const multiSense: WordEntry = {
      ...word("w9", "mira", "sea"),
      senses: [
        {
          sense_id: "s_sea",
          pos_id: "pos_noun",
          gloss: "sea",
          definitions: [],
          examples: [],
          concept_id: "custom_sea",
        },
        {
          sense_id: "s_ocean",
          pos_id: "pos_noun",
          gloss: "ocean",
          definitions: [],
          examples: [],
        },
      ],
    };
    const html = buildReferenceBookHtml(
      options({
        words: [multiSense],
        concepts: [
          {
            concept_id: "custom_sea",
            gloss_en: "sea",
            gloss_zh: "海",
            semantic_field: "nature",
          },
        ],
      }),
    );
    const reverse = html.slice(html.indexOf('id="reverse"'));
    expect(reverse).toContain(">sea<");
    expect(reverse).toContain(">ocean<");
    expect(reverse).toContain(">海<");
    expect(html).toContain('class="concept"');
  });

  test("adds compound etymology and the first example to a dictionary entry", () => {
    const head = word("w1", "kasa", "house");
    const modifier = word("w2", "sata", "stone");
    const compound: WordEntry = {
      ...word("w3", "kasata", "stone house"),
      etymology: {
        origin_type: "derived",
        parent_entry_id: null,
        source_language_id: null,
        applied_sound_changes: [],
        semantic_shift_note: "",
        components: [
          { entry_id: "w2", relation: "modifier" },
          { entry_id: "w1", relation: "head" },
        ],
      },
      senses: [
        {
          sense_id: "s_compound",
          pos_id: "pos_noun",
          gloss: "stone house",
          definitions: [],
          examples: ["kasa sata tami"],
        },
      ],
    };
    const html = buildReferenceBookHtml(options({ words: [head, modifier, compound] }));
    expect(html).toContain('<div class="etym">&lt; sata + kasa</div>');
    expect(html).toContain('<div class="example">‘kasa sata tami’</div>');
  });
});

describe("buildReferenceBookTypst", () => {  test("emits headings, tables and escaped content", () => {
    const typst = buildReferenceBookTypst(
      options({ words: [word("w1", "ka#sa", "hash # gloss")] }),
    );
    expect(typst).toContain('#set page(paper: "a4"');
    expect(typst).toContain("= Phonology");
    expect(typst).toContain("= Typology and Syntax");
    expect(typst).toContain("#table(columns: 3");
    expect(typst).toContain("ka\\#sa");
    expect(typst).toContain("hash \\# gloss");
    expect(typst).toContain("= Part I. Conlang to Meaning");
    expect(typst).toContain("= Part II. Meaning to Conlang");
  });

  test("respects the section switches", () => {
    const typst = buildReferenceBookTypst(
      options({
        sections: {
          phonology: false,
          typology: true,
          paradigms: false,
          manual: false,
          corpus: false,
          dictionary: false,
          reverseIndex: false,
        },
      }),
    );
    expect(typst).not.toContain("= Phonology");
    expect(typst).toContain("= Typology and Syntax");
    expect(typst).not.toContain("= Part I.");
  });
});
