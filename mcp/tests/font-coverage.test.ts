import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { auditFontCoverage } from "../../src/core/engines/coverage";
import { analyzeRomanization } from "../../src/core/engines/romanizationLint";
import type { PhonologyConfig, WordEntry } from "../../src/types";
import { McpError } from "../errors";
import {
  enumerateAllGlyphs,
  inspectFontBytesCompat,
  loadFontFromBytes,
  loadFontFromFile,
} from "../font/loader";
import { shapeText } from "../font/shaper";

const FONTS_DIR = path.resolve(import.meta.dir, "../../tests/fixtures/fonts");
const LIGA_TTF = path.join(FONTS_DIR, "liga-test.ttf");
const NO_NAMES_TTF = path.join(FONTS_DIR, "no-names-test.ttf");
const REGULAR_TTF = path.resolve(
  import.meta.dir,
  "../../tests/fixtures/workspace-basic/roots/root/font.ttf",
);

describe("T2.6 Font Loader & HarfBuzz Wasm Shaper", () => {
  test("liga-test.ttf: loads GSUB liga, enumerates unencoded c_h & roman.x, and shapes ligatures + feature overrides", async () => {
    const font = await loadFontFromFile(LIGA_TTF);
    expect(font.familyName).toBe("Conlang Liga Test");
    expect(font.hasGlyphNames).toBe(true);
    expect(font.glyphCount).toBe(7);
    expect(font.gsubFeatures).toContain("liga");
    expect(font.unicodeList).toEqual([0x20, 0x61, 0x63, 0x68, 0x78]);

    const glyphs = enumerateAllGlyphs(font);
    const unencodedCh = glyphs.find((g) => g.name === "c_h");
    expect(unencodedCh).toBeDefined();
    expect(unencodedCh?.mapped_codepoints).toEqual([]);

    const residualRoman = glyphs.find((g) => g.name === "roman.x");
    expect(residualRoman).toBeDefined();
    expect(residualRoman?.mapped_codepoints).toEqual([0x78]);

    // Default GUI_DEFAULT_LAYOUT enables liga: "cha" -> [c_h, a]
    const shapedDefault = await shapeText(font, "cha");
    expect(shapedDefault.has_notdef).toBe(false);
    expect(shapedDefault.glyphs.length).toBe(2);
    expect(shapedDefault.glyphs[0].name).toBe("c_h");
    expect(shapedDefault.glyphs[0].codepoint_span).toEqual([0, 2]);
    expect(shapedDefault.glyphs[0].source_codepoint_span).toEqual([0, 2]);
    expect(shapedDefault.glyphs[0].source_text).toBe("ch");
    expect(shapedDefault.glyphs[0].x_advance).toBe(800);
    expect(shapedDefault.glyphs[1].name).toBe("a");
    expect(shapedDefault.glyphs[1].codepoint_span).toEqual([2, 3]);
    expect(shapedDefault.total_x_advance).toBe(1300);

    // Explicit -liga disables ligature: "cha" -> [c, h, a]
    const shapedNoLiga = await shapeText(font, "cha", { features: ["-liga"] });
    expect(shapedNoLiga.glyphs.map((g) => g.name)).toEqual(["c", "h", "a"]);

    // Missing codepoint 'z' triggers .notdef
    const shapedMissing = await shapeText(font, "cz");
    expect(shapedMissing.has_notdef).toBe(true);
    expect(shapedMissing.glyphs[1].is_notdef).toBe(true);

    // NFC normalization maps decomposed source span back to raw codepoint span
    const shapedDecomposed = await shapeText(font, "a\u0301c", {
      normalization: "NFC",
    });
    expect(shapedDecomposed.codepoint_count).toBe(2); // "ác"
    expect(shapedDecomposed.source_codepoint_count).toBe(3); // "a" + "\u0301" + "c"
    expect(shapedDecomposed.glyphs[0].codepoint_span).toEqual([0, 1]);
    expect(shapedDecomposed.glyphs[0].source_codepoint_span).toEqual([0, 2]);
    expect(shapedDecomposed.glyphs[0].source_text).toBe("a\u0301");
  });

  test("no-names-test.ttf: detects post v3.0 hasGlyphNames=false without crashing", async () => {
    const font = await loadFontFromFile(NO_NAMES_TTF);
    expect(font.familyName).toBe("Conlang NoNames Test");
    expect(font.hasGlyphNames).toBe(false);

    const enumerated = enumerateAllGlyphs(font);
    expect(enumerated[0].name).toBe(".notdef");
    for (let i = 1; i < enumerated.length; i++) {
      expect(enumerated[i].name).toBeNull();
    }

    const shaped = await shapeText(font, "cha");
    expect(shaped.has_notdef).toBe(false);
    expect(shaped.glyphs.length).toBe(2);
    expect(shaped.glyphs[0].name).toBeNull();
  });

  test("regular font & invalid font rejection", async () => {
    if (fs.existsSync(REGULAR_TTF)) {
      const bytes = fs.readFileSync(REGULAR_TTF);
      const compat = inspectFontBytesCompat(bytes);
      const loaded = await loadFontFromBytes(bytes, "font.ttf");
      expect(compat.codepoints).toEqual(loaded.unicodeList);
    }

    let err: unknown = null;
    try {
      await loadFontFromBytes(Buffer.from("not-a-font-file"), "bad.ttf");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe("VALIDATION");
  });
});

describe("T2.8 Pure Romanization Health Analysis (6 Lint Categories)", () => {
  test("detects unreachable, unknown_output, conflicting, duplicate, shadowed (same-pos & left-greedy), and case_issues", () => {
    const phono: PhonologyConfig = {
      language_id: "lang_lint",
      phoneme_inventory: {
        consonants: ["p", "t", "k", "tʃ", "x", "ɬ"], // "ɬ" is unreachable
        vowels: ["a", "i"],
      },
      romanization_maps: [
        {
          map_id: "map_main",
          name: "Main",
          is_default: true,
          rules: [
            {
              rule_id: "r_p1",
              input: "p",
              output_phoneme: "p",
              context_before: "",
              context_after: "",
            },
            {
              rule_id: "r_p_dup",
              input: "p",
              output_phoneme: "p",
              context_before: "",
              context_after: "",
            },
            {
              rule_id: "r_t_conf1",
              input: "t",
              output_phoneme: "t",
              context_before: "",
              context_after: "",
            },
            {
              rule_id: "r_t_conf2",
              input: "T", // also triggers case_collision + conflict!
              output_phoneme: "k",
              context_before: "",
              context_after: "",
            },
            {
              rule_id: "r_unknown",
              input: "q",
              output_phoneme: "ɢ", // not in phoneme_inventory
              context_before: "",
              context_after: "",
            },
            {
              rule_id: "r_ch",
              input: "ch",
              output_phoneme: "tʃ",
              context_before: "",
              context_after: "",
            },
            {
              rule_id: "r_h_after_c",
              input: "h",
              output_phoneme: "x",
              context_before: "c", // shadowed by left-greedy consumption of "ch"!
              context_after: "",
            },
            {
              rule_id: "r_a_general",
              input: "aa",
              output_phoneme: "a",
              context_before: "",
              context_after: "",
            },
            {
              rule_id: "r_a_shadowed_same_pos",
              input: "aa",
              output_phoneme: "i",
              context_before: "p", // wait: higher specificity wins, so let's make 3-char "aaa" vs 2-char "aa" with after "a"
              context_after: "",
            },
            {
              rule_id: "r_aaa",
              input: "aaa",
              output_phoneme: "i",
              context_before: "",
              context_after: "",
            },
            {
              rule_id: "r_aa_before_a",
              input: "aa",
              output_phoneme: "a",
              context_before: "",
              context_after: "a", // shadowed at same position by longer input "aaa"!
            },
          ],
        },
      ],
      phonotactics: {
        macros: {},
        syllable_structure: "(C)V",
        blacklist_patterns: [],
        vowel_harmony: { enabled: false, group_a: [], group_b: [] },
        tone_system: { enabled: false, tones: [] },
      },
      allophony_rules: [],
    };

    const res = analyzeRomanization(phono);
    expect(
      res.unreachable_phonemes.some((u) => u.phoneme === "ɬ"),
    ).toBe(true);
    expect(
      res.unknown_output_phonemes.some(
        (u) => u.rule_id === "r_unknown" && u.unknown_tokens.includes("ɢ"),
      ),
    ).toBe(true);
    expect(
      res.duplicate_rules.some((d) => d.rule_ids.includes("r_p_dup")),
    ).toBe(true);
    expect(
      res.conflicting_rules.some((c) =>
        c.rules.some((r) => r.rule_id === "r_t_conf1"),
      ),
    ).toBe(true);
    expect(
      res.shadowed_rules.some(
        (s) =>
          s.shadowed_rule_id === "r_h_after_c" &&
          s.reason === "left_greedy_consumption",
      ),
    ).toBe(true);
    expect(
      res.shadowed_rules.some(
        (s) =>
          s.shadowed_rule_id === "r_aa_before_a" &&
          s.reason === "same_position_greedy_or_specificity",
      ),
    ).toBe(true);
    expect(
      res.case_issues.some(
        (ci) => ci.rule_id === "r_t_conf2" && ci.reason === "case_collision",
      ),
    ).toBe(true);
  });
});

describe("T2.9 Pure Font Coverage Extraction & Classification", () => {
  test("classifies covered, missing, decomposed_only, case_missing, punctuation, unmapped_spellings, and glyph_annotations", () => {
    const phono: PhonologyConfig = {
      language_id: "lang_cov",
      phoneme_inventory: {
        consonants: ["k", "t"],
        vowels: ["a", "á"],
      },
      romanization_maps: [
        {
          map_id: "m1",
          name: "Default",
          is_default: true,
          rules: [
            {
              rule_id: "r1",
              input: "k",
              output_phoneme: "k",
              context_before: "",
              context_after: "",
            },
            {
              rule_id: "r2",
              input: "a",
              output_phoneme: "a",
              context_before: "",
              context_after: "",
            },
            {
              rule_id: "r3",
              input: "\u00e1", // precomposed á (U+00E1)
              output_phoneme: "á",
              context_before: "",
              context_after: "",
            },
          ],
        },
      ],
      phonotactics: {
        macros: {},
        syllable_structure: "CV",
        blacklist_patterns: [],
        vowel_harmony: { enabled: false, group_a: [], group_b: [] },
        tone_system: {
          enabled: true,
          tones: [{ tone_id: "t1", name: "High", marker: "ʼ" }],
        },
      },
      allophony_rules: [],
      glyph_annotations: [
        { codepoint: 0x6b, label: "ka" }, // covered & used
        { codepoint: 0xe000, label: "unused_pua" }, // missing in cmap & unused
      ],
    };

    const words: WordEntry[] = [
      {
        entry_id: "w1",
        language_id: "lang_cov",
        con_word_romanized: "ka\u0301z!", // decomposed a + U+0301 + unmapped 'z' + punctuation '!'
        phonetic_ipa: "káz",
        phonetic_override: false,
        senses: [
          {
            sense_id: "s1",
            pos_id: "n",
            gloss: "fire",
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
      },
    ];

    // cmap has 'k' (lowercase only), 'a' (both 'a' and 'A'), U+0301 combining acute, but NOT precomposed U+00E1, NOT 'z', NOT 'ʼ'
    const cmap = new Set<number>([
      0x6b, // k (missing K under caseMode: "both"!)
      0x61, // a
      0x41, // A
      0x0301, // combining acute (so U+00E1 becomes decomposed_only!)
    ]);

    const audit = auditFontCoverage({
      phonology: phono,
      words,
      cmap,
      normalization: "NFC",
      caseMode: "both",
    });

    // 'a' has both 'a' and 'A' -> covered
    expect(audit.covered_chars.some((c) => c.char === "a")).toBe(true);
    // 'k' lacks 'K' under caseMode: "both" -> case_missing
    expect(
      audit.case_missing_chars.some(
        (c) => c.char === "k" && c.missing_case_variants.includes("K"),
      ),
    ).toBe(true);
    // 'á' (U+00E1) is missing precomposed, but a + U+0301 are in cmap -> decomposed_only
    expect(
      audit.decomposed_only_chars.some((c) => c.codepoint === 0x00e1),
    ).toBe(true);
    // 'z' is missing
    expect(audit.missing_chars.some((c) => c.char === "z")).toBe(true);
    // '!' is separated into punctuation_chars
    expect(audit.punctuation_chars.some((c) => c.char === "!")).toBe(true);
    // 'z' is flagged in unmapped_spellings
    expect(
      audit.unmapped_spellings.some(
        (u) => u.entry_id === "w1" && u.unmapped_chars.includes("z"),
      ),
    ).toBe(true);
    // glyph_annotations cross-check flags 0xE000
    expect(audit.glyph_annotations_check.annotated_missing_in_cmap).toContain(
      0xe000,
    );
    expect(
      audit.glyph_annotations_check.unused_annotations.some(
        (a) => a.codepoint === 0xe000,
      ),
    ).toBe(true);

    // Also verify mixed NFC/NFD warning in "as_used" mode
    const asUsedAudit = auditFontCoverage({
      phonology: phono,
      words,
      cmap,
      normalization: "as_used",
    });
    expect(asUsedAudit.warnings.length).toBeGreaterThan(0);
  });
});

