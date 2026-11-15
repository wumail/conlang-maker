import { describe, expect, test } from "bun:test";
import type {
  CorpusText,
  GlossedLine,
  GlossToken,
  GrammarConfig,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import {
  applySuggestionToLines,
  autoGloss,
  AutoGlossCache,
  mergeAutoGlossIntoCorpus,
  rankTokenCandidates,
  reGlossLineUnresolvedTokens,
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

  test("re-glossing one line keeps manual annotations and never rewrites other lines (F1.5)", () => {
    const manualLine: GlossedLine = {
      line_id: "line_1",
      original: "Kana",
      translation: "hand translated",
      tokens: [
        {
          token_id: "tok_manual",
          surface_form: "Kana",
          morpheme_break: "ka-na",
          gloss_labels: "CUSTOM.GLOSS",
          linked_entry_id: "e_kana",
          ipa: "/ˈkana/",
        },
      ],
    };
    const newWordLine: GlossedLine = {
      line_id: "line_2",
      original: "Kana sani",
      translation: "",
      tokens: [
        {
          token_id: "tok_keep",
          surface_form: "Kana",
          morpheme_break: "kana",
          gloss_labels: "KEEP.ME",
          linked_entry_id: "e_kana",
          ipa: "/kana/",
        },
        {
          token_id: "tok_new",
          surface_form: "sani",
          morpheme_break: "sani",
          gloss_labels: "",
          linked_entry_id: "",
          ipa: "",
        },
      ],
    };

    const newEntry: WordEntry = {
      entry_id: "e_sani",
      language_id: "lang_root",
      con_word_romanized: "sani",
      phonetic_ipa: "",
      phonetic_override: false,
      senses: [
        { sense_id: "s9", pos_id: "pos_n", gloss: "song", definitions: [], examples: [] },
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
    const withNewWord = [...words, newEntry];

    const untouched = reGlossLineUnresolvedTokens(manualLine, withNewWord, grammar, phono);
    expect(untouched.tokens).toEqual(manualLine.tokens);
    expect(untouched.translation).toBe("hand translated");

    const refreshed = reGlossLineUnresolvedTokens(newWordLine, withNewWord, grammar, phono);
    expect(refreshed.tokens[0]).toEqual(newWordLine.tokens[0]);
    expect(refreshed.tokens[1]).toMatchObject({
      token_id: "tok_new",
      surface_form: "sani",
      morpheme_break: "sani",
      gloss_labels: "song",
      linked_entry_id: "e_sani",
      ipa: "/sani/",
    });
    expect(refreshed.original).toBe("Kana sani");
  });
});

// ── Roadmap v3 / Pillar 6：同形词多候选与义项级消歧 ────────────────────

const homographWords: WordEntry[] = [
  ...words,
  {
    entry_id: "e_kana2",
    language_id: "lang_root",
    con_word_romanized: "kana",
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      { sense_id: "s9", pos_id: "pos_n", gloss: "reed", definitions: [], examples: [] },
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

describe("rankTokenCandidates (Roadmap v3 W4)", () => {
  test("keeps every homograph entry instead of silently overwriting", () => {
    const candidates = rankTokenCandidates("kana", homographWords, grammar, phono);
    const exact = candidates.filter((candidate) => candidate.confidence === 1);
    expect(exact.map((candidate) => candidate.entry_id)).toEqual([
      "e_kana",
      "e_kana2",
    ]);
    expect(exact.map((candidate) => candidate.gloss_labels)).toEqual([
      "house",
      "reed",
    ]);
  });

  test("ranks inflected analyses with morpheme break, gloss and sense binding", () => {
    const candidates = rankTokenCandidates("kanasi", homographWords, grammar, phono);
    expect(candidates.length).toBeGreaterThan(0);
    const top = candidates[0]!;
    expect(top.entry_id).toBe("e_kana");
    expect(top.sense_id).toBe("s1");
    expect(top).toMatchObject({
      morpheme_break: "kana-si",
      gloss_labels: "house-PL",
      pos_id: "pos_n",
    });
    expect(top.ipa).toBe("/kanasi/");
    // 每个候选带稳定且互不重复的 candidate_id，便于 UI 采纳
    expect(new Set(candidates.map((c) => c.candidate_id)).size).toBe(
      candidates.length,
    );
  });

  test("returns an empty list for unknown surfaces and blank input", () => {
    expect(rankTokenCandidates("zoru", homographWords, grammar, phono)).toEqual([]);
    expect(rankTokenCandidates("   ", homographWords, grammar, phono)).toEqual([]);
  });
});

// ── Roadmap v3 / Pillar 2：非破坏合并三模式 ───────────────────────────

function corpusLine(
  lineId: string,
  original: string,
  translation: string,
  tokens: Array<Partial<GlossToken> & { surface_form: string }>,
): GlossedLine {
  return {
    line_id: lineId,
    original,
    translation,
    tokens: tokens.map((token, index) => ({
      token_id: token.token_id ?? `${lineId}_t${index + 1}`,
      surface_form: token.surface_form,
      morpheme_break: token.morpheme_break ?? "",
      gloss_labels: token.gloss_labels ?? "",
      linked_entry_id: token.linked_entry_id ?? "",
      linked_sense_id: token.linked_sense_id,
      ipa: token.ipa ?? "",
      status: token.status,
    })),
  };
}

function corpusOf(lines: GlossedLine[]): CorpusText {
  return {
    corpus_id: "corpus_merge",
    language_id: "lang_root",
    title: "Merge Corpus",
    description: "",
    original_text: lines.map((line) => line.original).join("\n"),
    glossed_lines: lines,
    free_translation: "",
    metadata: { tags: [], created_at: "", updated_at: "" },
  };
}

describe("mergeAutoGlossIntoCorpus (Roadmap v3 W4)", () => {
  test("fill_empty only fills blank tokens and never touches translations", () => {
    const text = "kana kanasi";
    const fresh = autoGloss({
      originalText: text,
      words,
      grammar,
      phono,
      createLineId: () => "line_1",
      createTokenId: (() => {
        let seq = 0;
        return () => `line_1_t${(seq += 1)}`;
      })(),
    }).lines[0]!;

    const corpus = corpusOf([
      corpusLine("line_1", text, "The house runs", [
        { token_id: "line_1_t1", surface_form: "kana" },
        {
          token_id: "line_1_t2",
          surface_form: "kanasi",
          gloss_labels: "house-PL(custom)",
          linked_entry_id: "e_kana",
          status: "edited",
        },
      ]),
    ]);

    const { nextLines, replacedProtectedTokens } = mergeAutoGlossIntoCorpus({
      corpus,
      freshLines: [fresh],
      mode: "fill_empty",
    });

    expect(replacedProtectedTokens).toEqual([]);
    expect(nextLines[0]!.translation).toBe("The house runs");
    expect(nextLines[0]!.tokens[0]).toMatchObject({
      token_id: "line_1_t1",
      gloss_labels: "house",
      linked_entry_id: "e_kana",
      status: "auto",
    });
    expect(nextLines[0]!.tokens[1]).toMatchObject({
      gloss_labels: "house-PL(custom)",
      status: "edited",
    });
  });

  test("recompute_auto refreshes machine tokens but preserves verified ones", () => {
    const text = "kana kanasi";
    const fresh = autoGloss({
      originalText: text,
      words,
      grammar,
      phono,
      createLineId: () => "line_1",
      createTokenId: (() => {
        let seq = 0;
        return () => `line_1_t${(seq += 1)}`;
      })(),
    }).lines[0]!;

    const corpus = corpusOf([
      corpusLine("line_1", text, "The house runs", [
        {
          token_id: "line_1_t1",
          surface_form: "kana",
          gloss_labels: "stale",
          linked_entry_id: "e_kana",
          status: "auto",
        },
        {
          token_id: "line_1_t2",
          surface_form: "kanasi",
          gloss_labels: "house-PL(verified)",
          linked_entry_id: "e_kana",
          status: "verified",
        },
      ]),
    ]);

    const { nextLines } = mergeAutoGlossIntoCorpus({
      corpus,
      freshLines: [fresh],
      mode: "recompute_auto",
    });

    expect(nextLines[0]!.translation).toBe("The house runs");
    expect(nextLines[0]!.tokens[0]).toMatchObject({
      gloss_labels: "house",
      status: "auto",
    });
    expect(nextLines[0]!.tokens[1]).toMatchObject({
      gloss_labels: "house-PL(verified)",
      status: "verified",
    });
  });

  test("reanalyze_selected only rewrites selected lines and reports replaced manual tokens", () => {
    let seq = 0;
    const fresh = autoGloss({
      originalText: "kana. kanasi.",
      words,
      grammar,
      phono,
      createLineId: (index) => `line_${index + 1}`,
      createTokenId: () => `fresh_${(seq += 1)}`,
    }).lines;

    const corpus = corpusOf([
      corpusLine("line_1", "kana", "first line", [
        {
          token_id: "line_1_t1",
          surface_form: "kana",
          gloss_labels: "my house",
          linked_entry_id: "e_kana",
          status: "edited",
        },
      ]),
      corpusLine("line_2", "kanasi", "second line", [
        {
          token_id: "line_2_t1",
          surface_form: "kanasi",
          gloss_labels: "old value",
          linked_entry_id: "e_kana",
          status: "edited",
        },
      ]),
    ]);

    const { nextLines, replacedProtectedTokens } = mergeAutoGlossIntoCorpus({
      corpus,
      freshLines: fresh,
      mode: "reanalyze_selected",
      selectedLineIds: new Set(["line_2"]),
    });

    expect(nextLines[0]!.translation).toBe("first line");
    expect(nextLines[0]!.tokens[0]!.gloss_labels).toBe("my house");
    expect(nextLines[0]!.tokens[0]!.status).toBe("edited");

    expect(nextLines[1]!.translation).toBe("second line");
    expect(nextLines[1]!.tokens[0]).toMatchObject({
      token_id: "line_2_t1",
      gloss_labels: "house-PL",
      status: "auto",
    });
    expect(replacedProtectedTokens).toEqual([
      {
        lineId: "line_2",
        tokenId: "line_2_t1",
        surface: "kanasi",
        beforeGloss: "old value",
        afterGloss: "house-PL",
      },
    ]);
  });

  test("treats legacy tokens with gloss + entry link as edited and keeps them", () => {
    const fresh = autoGloss({
      originalText: "kana",
      words,
      grammar,
      phono,
      createLineId: () => "line_1",
      createTokenId: () => "line_1_t1",
    }).lines[0]!;

    const corpus = corpusOf([
      corpusLine("line_1", "kana", "", [
        {
          token_id: "line_1_t1",
          surface_form: "kana",
          gloss_labels: "legacy gloss",
          linked_entry_id: "e_kana",
        },
      ]),
    ]);

    const { nextLines } = mergeAutoGlossIntoCorpus({
      corpus,
      freshLines: [fresh],
      mode: "fill_empty",
    });

    expect(nextLines[0]!.tokens[0]!.gloss_labels).toBe("legacy gloss");
    expect(nextLines[0]!.tokens[0]!.status).toBeUndefined();
  });

  test("appends tokens newly produced by the fresh analysis", () => {
    const fresh = autoGloss({
      originalText: "kana kanasi",
      words,
      grammar,
      phono,
      createLineId: () => "line_1",
      createTokenId: (() => {
        let seq = 0;
        return () => `line_1_t${(seq += 1)}`;
      })(),
    }).lines[0]!;

    const corpus = corpusOf([
      corpusLine("line_1", "kana", "short line", [
        { token_id: "line_1_t1", surface_form: "kana", gloss_labels: "house", linked_entry_id: "e_kana", status: "auto" },
      ]),
    ]);

    const { nextLines } = mergeAutoGlossIntoCorpus({
      corpus,
      freshLines: [fresh],
      mode: "fill_empty",
    });

    expect(nextLines[0]!.tokens).toHaveLength(2);
    expect(nextLines[0]!.tokens[1]).toMatchObject({
      token_id: "line_1_t2",
      gloss_labels: "house-PL",
      status: "auto",
    });
    expect(nextLines[0]!.translation).toBe("short line");
  });
});

// ── Roadmap v3 / P0-1：空语料与新增行不再被丢弃 ─────────────────────

describe("mergeAutoGlossIntoCorpus fresh-line driven merge (P0-1)", () => {
  test("a brand-new corpus with no glossed_lines receives the full fresh analysis", () => {
    const emptyCorpus = { ...corpusOf([]), glossed_lines: [] as GlossedLine[] };
    const fresh = autoGloss({
      originalText: "kana kanasi",
      words,
      grammar,
      phono,
      createLineId: (index) => `line_${index + 1}`,
    }).lines;

    const { nextLines } = mergeAutoGlossIntoCorpus({
      corpus: emptyCorpus,
      freshLines: fresh,
      mode: "fill_empty",
    });

    expect(nextLines).toHaveLength(1);
    expect(nextLines[0]!.line_id).toBe("line_1");
    expect(nextLines[0]!.original).toBe("kana kanasi");
    expect(nextLines[0]!.tokens).toHaveLength(2);
    expect(nextLines[0]!.tokens[0]).toMatchObject({
      gloss_labels: "house",
      linked_entry_id: "e_kana",
      status: "auto",
    });
    expect(nextLines[0]!.tokens[1]).toMatchObject({
      gloss_labels: "house-PL",
      status: "auto",
    });
  });

  test("sentences appended to original_text produce additional lines", () => {
    const corpus = corpusOf([
      corpusLine("line_1", "kana", "first", [
        { token_id: "line_1_t1", surface_form: "kana", gloss_labels: "house", linked_entry_id: "e_kana", status: "auto" },
      ]),
    ]);
    const fresh = autoGloss({
      originalText: "kana. kanasi.",
      words,
      grammar,
      phono,
      createLineId: (index) => (index === 0 ? "line_1" : `line_${index + 1}`),
    }).lines;

    const { nextLines } = mergeAutoGlossIntoCorpus({
      corpus,
      freshLines: fresh,
      mode: "fill_empty",
    });

    expect(nextLines).toHaveLength(2);
    expect(nextLines[0]!.translation).toBe("first");
    expect(nextLines[1]!.line_id).toBe("line_2");
    expect(nextLines[1]!.tokens[0]).toMatchObject({
      gloss_labels: "house-PL",
      status: "auto",
    });
  });

  test("falls back to positional alignment when the caller regenerates line ids", () => {
    const fresh = autoGloss({
      originalText: "kana kanasi",
      words,
      grammar,
      phono,
    }).lines;
    // 默认 createLineId 会生成全新的 line_id，只能靠位置兜底匹配旧行
    expect(fresh[0]!.line_id).not.toBe("legacy_line");

    const corpus = corpusOf([
      corpusLine("legacy_line", "kana kanasi", "旧句译", [
        { surface_form: "kana" },
        { surface_form: "kanasi" },
      ]),
    ]);

    const { nextLines } = mergeAutoGlossIntoCorpus({
      corpus,
      freshLines: fresh,
      mode: "fill_empty",
    });

    expect(nextLines).toHaveLength(1);
    expect(nextLines[0]!.line_id).toBe("legacy_line");
    expect(nextLines[0]!.translation).toBe("旧句译");
    expect(nextLines[0]!.tokens).toHaveLength(2);
    expect(nextLines[0]!.tokens[0]).toMatchObject({
      token_id: "legacy_line_t1",
      gloss_labels: "house",
      status: "auto",
    });
  });

  test("keeps manual lines that the fresh analysis never covered", () => {
    const manual: GlossedLine = {
      line_id: "line_manual",
      original: "",
      translation: "手写行",
      tokens: [],
    };
    const corpus = corpusOf([
      corpusLine("line_1", "kana", "第一行", [{ surface_form: "kana" }]),
      manual,
    ]);
    const fresh = autoGloss({
      originalText: "kana",
      words,
      grammar,
      phono,
      createLineId: () => "line_fresh",
    }).lines;

    const { nextLines } = mergeAutoGlossIntoCorpus({
      corpus,
      freshLines: fresh,
      mode: "fill_empty",
    });

    expect(nextLines.map((line) => line.line_id)).toEqual(["line_1", "line_manual"]);
    expect(nextLines[0]!.translation).toBe("第一行");
    expect(nextLines[1]!.translation).toBe("手写行");
  });

  test("recompute_auto clears the stale linked_sense_id of recomputed tokens", () => {
    const fresh = autoGloss({
      originalText: "kanasi",
      words,
      grammar,
      phono,
      createLineId: () => "line_1",
      createTokenId: () => "line_1_t1",
    }).lines;
    const corpus = corpusOf([
      corpusLine("line_1", "kanasi", "", [
        {
          token_id: "line_1_t1",
          surface_form: "kanasi",
          gloss_labels: "stale",
          linked_entry_id: "e_kana",
          linked_sense_id: "sense_stale",
          status: "auto",
        },
      ]),
    ]);

    const { nextLines } = mergeAutoGlossIntoCorpus({
      corpus,
      freshLines: fresh,
      mode: "recompute_auto",
    });

    const token = nextLines[0]!.tokens[0]!;
    expect(token.gloss_labels).toBe("house-PL");
    expect(token.status).toBe("auto");
    // 自有属性存在且为 undefined：浅合并不再残留旧义项绑定
    expect(Object.prototype.hasOwnProperty.call(token, "linked_sense_id")).toBe(true);
    expect(token.linked_sense_id).toBeUndefined();
  });
});

// ── Roadmap v3 / P1-6：同形词词缀拆解与义项展开 ─────────────────────

function wordEntry(
  entryId: string,
  form: string,
  posId: string,
  glosses: string[],
): WordEntry {
  return {
    entry_id: entryId,
    language_id: "lang_root",
    con_word_romanized: form,
    phonetic_ipa: "",
    phonetic_override: false,
    senses: glosses.map((gloss, index) => ({
      sense_id: `${entryId}_s${index + 1}`,
      pos_id: posId,
      gloss,
      definitions: [],
      examples: [],
    })),
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

/** 只保留一条作用于指定词性的后缀规则，用于验证同形词的词性判别 */
function grammarWithSuffix(posId: string, affix: string, tag: string): GrammarConfig {
  return {
    ...grammar,
    inflection_rules: [
      {
        rule_id: `r_${tag.toLowerCase()}`,
        pos_id: posId,
        dimension_values: {},
        type: "suffix",
        affix,
        tag,
        match_regex: ".*",
        disabled: false,
        sca_mutable: false,
        condition: null,
      },
    ],
  };
}

describe("homograph affix parsing (P1-6)", () => {
  test("picks the verb homograph when only the verb matches the affix", () => {
    const noun = wordEntry("e_kana_n", "kana", "pos_n", ["house"]);
    const verb = wordEntry("e_kana_v", "kana", "pos_v", ["sing"]);
    const verbGrammar = grammarWithSuffix("pos_v", "si", "VB");

    const result = autoGloss({
      originalText: "kanasi",
      words: [noun, verb],
      grammar: verbGrammar,
      phono,
      createLineId: () => "line_1",
      createTokenId: () => "tok_1",
    });

    expect(result.report.unresolved).toBe(0);
    expect(result.report.autoApplied).toBe(1);
    expect(result.lines[0]!.tokens[0]).toMatchObject({
      token_id: "tok_1",
      morpheme_break: "kana-si",
      gloss_labels: "sing-VB",
      linked_entry_id: "e_kana_v",
    });
  });

  test("downgrades equally scored homograph analyses to pending instead of picking one", () => {
    const verbA = wordEntry("e_taki_a", "taki", "pos_v", ["run"]);
    const verbB = wordEntry("e_taki_b", "taki", "pos_v", ["flow"]);
    const verbGrammar = grammarWithSuffix("pos_v", "si", "VB");

    const result = autoGloss({
      originalText: "takisi",
      words: [verbA, verbB],
      grammar: verbGrammar,
      phono,
      createLineId: () => "line_1",
      createTokenId: () => "tok_1",
    });

    expect(result.report.pending).toBe(1);
    expect(result.lines[0]!.tokens[0]).toMatchObject({
      gloss_labels: "",
      linked_entry_id: "",
      morpheme_break: "taki-si",
    });
    const suggestion = result.pending[0]!.suggestion;
    expect(["e_taki_a", "e_taki_b"]).toContain(suggestion.entry.entry_id);
  });

  test("expands every sense of a polysemous entry into its own candidate", () => {
    const polysemous = wordEntry("e_kana", "kana", "pos_n", ["house", "reed"]);
    const exact = rankTokenCandidates("kana", [polysemous], grammar, phono);
    expect(exact.map((candidate) => candidate.sense_id)).toEqual([
      "e_kana_s1",
      "e_kana_s2",
    ]);
    expect(exact.map((candidate) => candidate.gloss_labels)).toEqual(["house", "reed"]);
    expect(new Set(exact.map((candidate) => candidate.candidate_id)).size).toBe(2);

    const inflected = rankTokenCandidates("kanasi", [polysemous], grammar, phono);
    expect(inflected.map((candidate) => candidate.gloss_labels)).toEqual([
      "house-PL",
      "reed-PL",
    ]);
  });
});
