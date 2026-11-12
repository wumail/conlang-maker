import { describe, expect, test } from "bun:test";
import type { FontInputConfig, GrammarConfig, PhonologyConfig, WordEntry } from "../../types";
import rawPhonology from "../../../tests/fixtures/workspace-basic/roots/root/phonology.json";
import rawGrammar from "../../../tests/fixtures/workspace-basic/roots/root/grammar.json";
import { buildFontInputIndex, phonemesToFontInput, textToFontInput } from "./fontInput";

const settings: FontInputConfig = {
  phonemes: { k: "k", h: "h", x: "kh", s: "s", "ʃ": "sh", "ʒ": "zh", j: "y", a: "a", "aː": "ā", o: "o", u: "u", "ou̯": "ou", "əː": "ə̄" },
  vowels: ["a", "aː", "o", "u", "ou̯", "əː"],
  multigraphs: ["kh", "sh", "zh"],
  separator: "·",
};

function word(id: string, spelling: string, ipa: string): WordEntry {
  return {
    entry_id: id,
    language_id: "parent",
    con_word_romanized: spelling,
    phonetic_ipa: ipa,
    phonetic_override: true,
    senses: [],
    etymology: { origin_type: "a_priori", parent_entry_id: null, source_language_id: null, applied_sound_changes: [], semantic_shift_note: "" },
    metadata: { created_at: "", updated_at: "", tags: [] },
  };
}

describe("phoneme-aware font input", () => {
  test("separate consonants and vowel nuclei retain their boundaries", () => {
    expect(phonemesToFontInput("/kha/", settings)).toBe("k·ha");
    expect(phonemesToFontInput("/xa/", settings)).toBe("kha");
    expect(phonemesToFontInput("/ko.u/", settings)).toBe("ko·u");
    expect(phonemesToFontInput("/kou̯/", settings)).toBe("kou");
    expect(phonemesToFontInput("/sʃa/", settings)).toBe("ssha");
  });

  test("stress is omitted, length and unknown symbols survive", () => {
    expect(phonemesToFontInput("[ˈʒaː jəːq]", settings)).toBe("zhā yə̄q");
  });

  test("an inherited entry can retain parent spelling with the local s merger", () => {
    const parent = word("source", "shā", "ʃaː");
    const current = { ...word("child", "sa", "sa"), language_id: "child", etymology: { ...parent.etymology, origin_type: "evolved" as const, parent_entry_id: parent.entry_id, source_language_id: "parent" } };
    const config = { ...rawPhonology, font_input: { ...settings, use_parent_phonemes: true, source_substitutions: { "ʃ": "s" } } } as PhonologyConfig;
    const grammar = { ...rawGrammar, irregular_overrides: [] } as GrammarConfig;
    const index = buildFontInputIndex([current], grammar, config, { languageId: "parent", words: [parent], phonology: config, grammar });
    expect(textToFontInput("sa", config, index, current.entry_id)).toBe("sā");
    expect(textToFontInput("Sa!", config, index)).toBe("sā!");
    expect(textToFontInput("sa", { ...config, font_input: undefined }, index)).toBe("sa");
  });

  test("historical inflection uses the POS selected by the full dimensions", () => {
    const parent = word("source", "ala", "ala");
    parent.senses = ["noun", "verb"].map((posId) => ({
      sense_id: posId, pos_id: posId, gloss: posId, definitions: [], examples: [],
    }));
    const current = {
      ...parent,
      language_id: "child",
      etymology: { ...parent.etymology, origin_type: "evolved" as const, parent_entry_id: "source", source_language_id: "parent" },
    };
    const phonology = {
      ...rawPhonology,
      font_input: { ...settings, phonemes: { ...settings.phonemes, l: "l", m: "m" }, use_parent_phonemes: true },
    } as PhonologyConfig;
    const sourceGrammar = structuredClone(rawGrammar) as GrammarConfig;
    sourceGrammar.typology.morphological_type = "fusional";
    sourceGrammar.inflection_dimensions = [{ dim_id: "voice", name: "Voice", applies_to_pos: ["verb"], values: [{ val_id: "active", name: "Active", gloss: "ACT" }] }];
    sourceGrammar.inflection_rules = [{ ...sourceGrammar.inflection_rules[0], rule_id: "verb_suffix", pos_id: "verb", type: "suffix", affix: "m", dimension_values: { voice: "active" }, disabled: false }];
    sourceGrammar.irregular_overrides = [];
    const grammar = { ...sourceGrammar, irregular_overrides: [{ entry_id: current.entry_id, dimension_values: { voice: "active" }, surface_form: "aləm" }] };
    const index = buildFontInputIndex([current], grammar, phonology, { languageId: "parent", words: [parent], phonology, grammar: sourceGrammar });
    expect(textToFontInput("aləm", phonology, index)).toBe("alam");
  });
});
