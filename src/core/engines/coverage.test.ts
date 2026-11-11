import { describe, expect, test } from "bun:test";
import type { CorpusText, PhonologyConfig, WordEntry } from "../../types";
import {
  auditFontCoverage,
  checkCoverage,
  classifyCharacterCoverage,
  extractCoverageRequirements,
  extractRequirements,
  GUI_DEFAULT_LAYOUT,
} from "./coverage";

const basePhono: PhonologyConfig = {
  language_id: "lang_cov",
  phoneme_inventory: {
    consonants: ["k", "s", "ʃ"],
    vowels: ["a", "i", "aː"],
  },
  romanization_maps: [
    {
      map_id: "map_def",
      name: "Default",
      is_default: true,
      rules: [
        { rule_id: "r_a", input: "a", output_phoneme: "a", context_before: "", context_after: "" },
        { rule_id: "r_aa", input: "ā", output_phoneme: "aː", context_before: "", context_after: "" },
        { rule_id: "r_i", input: "i", output_phoneme: "i", context_before: "", context_after: "" },
        { rule_id: "r_sh", input: "sh", output_phoneme: "ʃ", context_before: "", context_after: "" },
        { rule_id: "r_c_i", input: "c", output_phoneme: "s", context_before: "", context_after: "i" },
        { rule_id: "r_macro_ctx", input: "a", output_phoneme: "a", context_before: "V", context_after: "#" },
      ],
    },
  ],
  glyph_annotations: [
    { codepoint: 0x0061, label: "a", kind: "vowel", phonemes: ["a"] }, // covered & used
    { codepoint: 0x007a, label: "z", kind: "base", phonemes: ["z"] }, // unused & missing in cmap
  ],
  phonotactics: {
    macros: { V: ["a", "i"], C: ["k", "s", "ʃ"] },
    syllable_structure: "CV",
    blacklist_patterns: [],
    vowel_harmony: { enabled: false, group_a: [], group_b: [] },
    tone_system: {
      enabled: true,
      tones: [{ tone_id: "t_high", name: "High", marker: "ˊ" }],
    },
  },
  allophony_rules: [],
};

const sampleWords: WordEntry[] = [
  {
    entry_id: "w1",
    language_id: "lang_cov",
    con_word_romanized: "shāci",
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      { sense_id: "s1", pos_id: "pos_n", gloss: "dawn", definitions: [], examples: [] },
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
    entry_id: "w2_unmapped",
    language_id: "lang_cov",
    // Uses NFD `a\u0304` (inconsistent with NFC `ā` above) AND unmapped letter `q`
    con_word_romanized: "qa\u0304",
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      { sense_id: "s2", pos_id: "pos_n", gloss: "cloud", definitions: [], examples: [] },
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

const sampleCorpora: CorpusText[] = [
  {
    corpus_id: "corp_1",
    language_id: "lang_cov",
    title: "Creation Myth",
    description: "",
    original_text: "Shāci!",
    glossed_lines: [
      {
        line_id: "l1",
        original: "Shāci!",
        tokens: [
          {
            token_id: "tok1",
            surface_form: "Shāci",
            morpheme_break: "shāci",
            gloss_labels: "dawn",
            linked_entry_id: "w1",
            ipa: "/ʃaːsi/",
          },
        ],
        translation: "Dawn!",
      },
    ],
    free_translation: "Dawn!",
    metadata: { tags: [], created_at: "", updated_at: "" },
  },
];

describe("coverage engine & GUI_DEFAULT_LAYOUT (PRD §6 / T2.9)", () => {
  test("exports exact GUI_DEFAULT_LAYOUT baseline", () => {
    expect(GUI_DEFAULT_LAYOUT).toEqual({
      direction: "ltr",
      script: undefined,
      language: undefined,
      features: [],
    });
  });

  test("extracts requirements across romanization, lexicon, corpus, tones, and flags mixed NFC/NFD in as_used mode", () => {
    const req = extractCoverageRequirements({
      phonology: basePhono,
      words: sampleWords,
      corpora: sampleCorpora,
      normalization: "as_used",
    });

    const chars = req.required_chars.map((c) => c.char);
    // Macro `V` in `context_before: "V"` must NOT be extracted as a character requirement!
    expect(chars).not.toContain("V");
    // Literal `i` in `context_after: "i"` IS extracted, as are `s`, `h`, `ā`, `a`, U+0304, `c`, `q`, `S`, `ˊ`
    expect(chars).toContain("a");
    expect(chars).toContain("ā");
    expect(chars).toContain("\u0304");
    expect(chars).toContain("i");
    expect(chars).toContain("ˊ");
    expect(chars).toContain("S");
    // Sentence punctuation `!` is separated into punctuation_chars
    expect(req.punctuation_chars.map((p) => p.char)).toEqual(["!"]);

    // Contextual combination `ci` and multichar `sh` are extracted
    const shSeq = req.sequences.find((s) => s.rule_id === "r_sh");
    expect(shSeq?.lexicon_samples).toEqual([{ entry_id: "w1", spelling: "shāci" }]);
    const ciSeq = req.sequences.find((s) => s.rule_id === "r_c_i");
    expect(ciSeq?.contextual_combinations).toEqual(["ci"]);

    // Unmapped spelling `q` in `qa\u0304` is reported
    expect(req.unmapped_spellings).toEqual([
      { entry_id: "w2_unmapped", spelling: "qa\u0304", unmapped_chars: ["q"] },
    ]);

    // NFC vs NFD inconsistency warning on `ā` vs `a\u0304`
    expect(req.warnings.length).toBeGreaterThan(0);

    // NFC normalization mode folds `a\u0304` into `ā` (no standalone U+0304)
    const nfcReq = extractCoverageRequirements({
      phonology: basePhono,
      words: sampleWords,
      normalization: "NFC",
    });
    expect(nfcReq.required_chars.map((c) => c.char)).not.toContain("\u0304");
    expect(nfcReq.warnings).toEqual([]);

    // NFD normalization mode decomposes `ā` into `a` + U+0304
    const nfdReq = extractCoverageRequirements({
      phonology: basePhono,
      words: sampleWords,
      normalization: "NFD",
    });
    expect(nfdReq.required_chars.map((c) => c.char)).not.toContain("ā");
    expect(nfdReq.required_chars.map((c) => c.char)).toContain("\u0304");
  });

  test("classifies covered, missing, decomposed_only, and case_missing in as_used vs both modes", () => {
    // Font has lowercase 'a' (0x61), 's' (0x73), combining macron (0x0304), but NOT 'ā' (0x0101), 'A' (0x41), 'S' (0x53), or 'x' (0x78)
    const cmap = new Set<number>([0x0061, 0x0073, 0x0304]);

    // 'a': covered in `as_used`, `case_missing` (missing 'A') in `both`
    expect(classifyCharacterCoverage(0x0061, cmap, "as_used").status).toBe("covered");
    expect(classifyCharacterCoverage(0x0061, cmap, "both")).toEqual({
      status: "case_missing",
      missing_case_variants: ["A"],
      nfd_codepoints: [0x0061],
    });

    // 'S': missing in cmap, lowercase 's' IS in cmap -> `case_missing` even in `as_used`!
    expect(classifyCharacterCoverage(0x0053, cmap, "as_used").status).toBe("case_missing");

    // 'ā' (U+0101): missing in cmap, but NFD [0x0061, 0x0304] are all in cmap -> `decomposed_only`
    expect(classifyCharacterCoverage(0x0101, cmap, "as_used").status).toBe("decomposed_only");

    // 'x' (U+0078): neither 'x' nor 'X' in cmap -> `missing`
    expect(classifyCharacterCoverage(0x0078, cmap, "both").status).toBe("missing");

    const audit = auditFontCoverage({
      phonology: basePhono,
      words: sampleWords,
      corpora: sampleCorpora,
      cmap,
      normalization: "NFC",
      caseMode: "as_used",
    });

    expect(audit.decomposed_only_chars.map((c) => c.char)).toEqual(["ā"]);
    expect(audit.case_missing_chars.map((c) => c.char)).toEqual(["S"]);
    expect(audit.missing_chars.map((c) => c.char)).toContain("c");
    expect(audit.missing_chars.map((c) => c.char)).toContain("h");
    expect(audit.glyph_annotations_check.annotated_missing_in_cmap).toEqual([0x007a]);
    expect(audit.glyph_annotations_check.unused_annotations.map((a) => a.label)).toEqual(["z"]);
  });

  test("maintains backward-compatible extractRequirements and checkCoverage", () => {
    const reqs = extractRequirements(basePhono);
    expect(reqs).toContain(0x0061);
    expect(reqs).toContain(0x0101);
    const rep = checkCoverage(reqs, new Set([0x0061]));
    expect(rep.missing_chars).toContain(0x0101);
  });
});
