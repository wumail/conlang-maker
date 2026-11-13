import { describe, expect, test } from "bun:test";
import type {
  GrammarConfig,
  PartOfSpeech,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import rawGrammar from "../../../tests/fixtures/workspace-basic/roots/root/grammar.json";
import { QC_RULE_KEYS, runQualityCheck, type QCRuleKey } from "./qualityCheck";

/** 关闭除目标规则外的全部规则，保证单测互不干扰 */
function only(rule: QCRuleKey): QCRuleKey[] {
  return QC_RULE_KEYS.filter((key) => key !== rule);
}

function nounPos(overrides: Partial<PartOfSpeech> = {}): PartOfSpeech {
  return {
    pos_id: "noun",
    name: "Noun",
    gloss_abbr: "N",
    word_pattern: "",
    requires_definition: false,
    requires_pronunciation: false,
    ...overrides,
  };
}

function grammarWith(partsOfSpeech: PartOfSpeech[]): GrammarConfig {
  const grammar = structuredClone(rawGrammar) as GrammarConfig;
  grammar.parts_of_speech = partsOfSpeech;
  return grammar;
}

function phonologyWith(
  structure: string,
  options: Partial<PhonologyConfig["phonotactics"]> = {},
  rules: { input: string; output: string }[] = [
    { input: "p", output: "p" },
    { input: "t", output: "t" },
    { input: "k", output: "k" },
    { input: "a", output: "a" },
    { input: "e", output: "e" },
    { input: "i", output: "i" },
    { input: "o", output: "o" },
    { input: "n", output: "n" },
  ],
): PhonologyConfig {
  return {
    language_id: "lang_qc",
    phoneme_inventory: {
      consonants: ["p", "t", "k", "n"],
      vowels: ["a", "e", "i", "o"],
    },
    romanization_maps: [
      {
        map_id: "map_qc",
        name: "QC",
        is_default: true,
        rules: rules.map((rule, index) => ({
          rule_id: `rule_${index}`,
          input: rule.input,
          output_phoneme: rule.output,
          context_before: "",
          context_after: "",
        })),
      },
    ],
    allophony_rules: [],
    phonotactics: {
      macros: {},
      syllable_structure: structure,
      blacklist_patterns: [],
      vowel_harmony: { enabled: false, group_a: [], group_b: [] },
      tone_system: { enabled: false, tones: [] },
      stress: null,
      ...options,
    },
  };
}

function word(
  id: string,
  romanized: string,
  overrides: Partial<WordEntry> = {},
): WordEntry {
  return {
    entry_id: id,
    language_id: "lang_qc",
    con_word_romanized: romanized,
    phonetic_ipa: "taka",
    phonetic_override: false,
    senses: [
      {
        sense_id: `sense_${id}`,
        pos_id: "noun",
        gloss: "gloss",
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
    metadata: { tags: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ...overrides,
  };
}

const grammar = grammarWith([nounPos()]);

describe("runQualityCheck: rule catalogue", () => {
  test("exposes exactly eleven rule keys", () => {
    expect(QC_RULE_KEYS).toHaveLength(11);
    expect(new Set(QC_RULE_KEYS).size).toBe(11);
    expect(QC_RULE_KEYS).toContain("staleCompound");
  });
});

describe("runQualityCheck: legacy rules", () => {
  test("missingPos flags entries without a part of speech", () => {
    const entries = [word("w1", "taka", { senses: [] })];
    const issues = runQualityCheck(entries, phonologyWith("(C)V(C)"), grammar, only("missingPos"));
    expect(issues.map((issue) => issue.rule)).toEqual(["missingPos"]);
  });

  test("emptyIpa flags blank transcriptions", () => {
    const entries = [word("w1", "taka", { phonetic_ipa: "" })];
    const issues = runQualityCheck(entries, phonologyWith("(C)V(C)"), grammar, only("emptyIpa"));
    expect(issues.map((issue) => issue.rule)).toEqual(["emptyIpa"]);
  });

  test("patternMismatch flags forms violating the POS pattern", () => {
    const strict = grammarWith([nounPos({ word_pattern: "^t" })]);
    const entries = [word("w1", "kaka")];
    const issues = runQualityCheck(entries, phonologyWith("(C)V(C)"), strict, only("patternMismatch"));
    expect(issues.map((issue) => issue.rule)).toEqual(["patternMismatch"]);
  });

  test("missingRequired flags senses that require a definition", () => {
    const strict = grammarWith([nounPos({ requires_definition: true })]);
    const entries = [word("w1", "taka")];
    const issues = runQualityCheck(entries, phonologyWith("(C)V(C)"), strict, only("missingRequired"));
    expect(issues.map((issue) => issue.rule)).toEqual(["missingRequired"]);
  });

  test("duplicateWord reports the first entry of a duplicated form once", () => {
    const entries = [word("w1", "Taka"), word("w2", "taka")];
    const issues = runQualityCheck(entries, phonologyWith("(C)V(C)"), grammar, only("duplicateWord"));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.entry_id).toBe("w1");
  });
});

describe("runQualityCheck: unmappedSpelling (traced)", () => {
  test("does not flag fully mapped spellings", () => {
    const entries = [word("w1", "taka")];
    const issues = runQualityCheck(entries, phonologyWith("(C)V(C)"), grammar, only("unmappedSpelling"));
    expect(issues).toHaveLength(0);
  });

  test("flags characters that fall through every romanization rule", () => {
    const entries = [word("w1", "tazka")];
    const issues = runQualityCheck(entries, phonologyWith("(C)V(C)"), grammar, only("unmappedSpelling"));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("z");
  });

  test("ignores separators and spaces", () => {
    const entries = [word("w1", "taka-ta ka")];
    const issues = runQualityCheck(entries, phonologyWith("(C)V(C)"), grammar, only("unmappedSpelling"));
    expect(issues).toHaveLength(0);
  });

  test("recognises digraphs mapped as a single rule without false positives", () => {
    const phono = phonologyWith(
      "(C)V(C)",
      {},
      [
        { input: "sh", output: "t" },
        { input: "a", output: "a" },
      ],
    );
    const entries = [word("w1", "sha")];
    const issues = runQualityCheck(entries, phono, grammar, only("unmappedSpelling"));
    expect(issues).toHaveLength(0);
  });
});

describe("runQualityCheck: phonotacticViolation", () => {
  test("accepts words that fit the syllable template", () => {
    const entries = [word("w1", "taka")];
    const issues = runQualityCheck(entries, phonologyWith("(C)V(C)"), grammar, only("phonotacticViolation"));
    expect(issues).toHaveLength(0);
  });

  test("locates the phoneme where syllabification gets stuck", () => {
    const entries = [word("w1", "ptka")];
    const issues = runQualityCheck(entries, phonologyWith("(C)V(C)"), grammar, only("phonotacticViolation"));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toContain("#0");
  });

  test("is skipped when no syllable template is configured", () => {
    const entries = [word("w1", "ptka")];
    const issues = runQualityCheck(entries, phonologyWith(""), grammar, only("phonotacticViolation"));
    expect(issues).toHaveLength(0);
  });
});

describe("runQualityCheck: blacklistHit", () => {
  test("flags forms matching a blacklist pattern", () => {
    const phono = phonologyWith("(C)V(C)", { blacklist_patterns: ["^p"] });
    const entries = [word("w1", "paka")];
    const issues = runQualityCheck(entries, phono, grammar, only("blacklistHit"));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
  });

  test("stays silent when nothing matches", () => {
    const phono = phonologyWith("(C)V(C)", { blacklist_patterns: ["^p"] });
    const entries = [word("w1", "taka")];
    expect(runQualityCheck(entries, phono, grammar, only("blacklistHit"))).toHaveLength(0);
  });
});

describe("runQualityCheck: vowelHarmonyViolation", () => {
  const harmony = { enabled: true, group_a: ["a", "o"], group_b: ["e", "i"] };

  test("flags roots mixing both harmony groups", () => {
    const phono = phonologyWith("(C)V(C)", { vowel_harmony: harmony });
    const entries = [word("w1", "take")];
    const issues = runQualityCheck(entries, phono, grammar, only("vowelHarmonyViolation"));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
  });

  test("accepts consistent roots and disabled harmony", () => {
    const phono = phonologyWith("(C)V(C)", { vowel_harmony: harmony });
    expect(runQualityCheck([word("w1", "tako")], phono, grammar, only("vowelHarmonyViolation"))).toHaveLength(0);

    const off = phonologyWith("(C)V(C)", { vowel_harmony: { ...harmony, enabled: false } });
    expect(runQualityCheck([word("w1", "take")], off, grammar, only("vowelHarmonyViolation"))).toHaveLength(0);
  });

  test("skips whole-word checking for compounds built from two checked roots", () => {
    const phono = phonologyWith("(C)V(C)", { vowel_harmony: harmony });
    const rootA = word("root_a", "tako");
    const rootB = word("root_b", "tiki");
    const compound = word("compound", "takotiki", {
      etymology: {
        origin_type: "derived",
        parent_entry_id: null,
        source_language_id: null,
        applied_sound_changes: [],
        semantic_shift_note: "",
        components: [
          { entry_id: "root_a", relation: "root" },
          { entry_id: "root_b", relation: "head" },
        ],
      },
    });
    const issues = runQualityCheck(
      [rootA, rootB, compound],
      phono,
      grammar,
      only("vowelHarmonyViolation"),
    );
    expect(issues.filter((issue) => issue.entry_id === "compound")).toEqual([]);
  });

  test("still flags a monomorphemic word and compounds with unknown components", () => {
    const phono = phonologyWith("(C)V(C)", { vowel_harmony: harmony });
    expect(runQualityCheck([word("w1", "taki")], phono, grammar, only("vowelHarmonyViolation"))).toHaveLength(1);

    const orphan = word("orphan", "takotiki", {
      etymology: {
        origin_type: "derived",
        parent_entry_id: null,
        source_language_id: null,
        applied_sound_changes: [],
        semantic_shift_note: "",
        components: [
          { entry_id: "ghost_a", relation: "root" },
          { entry_id: "ghost_b", relation: "root" },
        ],
      },
    });
    const issues = runQualityCheck([orphan], phono, grammar, only("vowelHarmonyViolation"));
    expect(issues.map((issue) => issue.entry_id)).toEqual(["orphan"]);
  });
});

describe("runQualityCheck: homophonyClash", () => {
  test("flags distinct entries with identical surface pronunciation and POS", () => {
    const phono = phonologyWith("(C)V(C)", {}, [
      { input: "c", output: "k" },
      { input: "k", output: "k" },
      { input: "a", output: "a" },
    ]);
    const entries = [word("w1", "caka"), word("w2", "kaka")];
    const issues = runQualityCheck(entries, phono, grammar, only("homophonyClash"));
    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.rule === "homophonyClash")).toBe(true);
  });

  test("does not clash across different parts of speech", () => {
    const phono = phonologyWith("(C)V(C)", {}, [
      { input: "c", output: "k" },
      { input: "k", output: "k" },
      { input: "a", output: "a" },
    ]);
    const mixed = grammarWith([nounPos(), nounPos({ pos_id: "verb", name: "Verb" })]);
    const second = word("w2", "kaka");
    second.senses[0]!.pos_id = "verb";
    const issues = runQualityCheck([word("w1", "caka"), second], phono, mixed, only("homophonyClash"));
    expect(issues).toHaveLength(0);
  });

  test("ignores duplicate IDs and blank pronunciations", () => {
    const phono = phonologyWith("(C)V(C)", {});
    const entries = [word("w1", "taka"), word("w1", "taka")];
    expect(runQualityCheck(entries, phono, grammar, only("homophonyClash"))).toHaveLength(0);
  });

  test("reports each clashing entry once even with several senses of the same POS", () => {
    const phono = phonologyWith("(C)V(C)", {}, [
      { input: "c", output: "k" },
      { input: "k", output: "k" },
      { input: "a", output: "a" },
    ]);
    const first = word("w1", "caka");
    first.senses.push({
      sense_id: "sense_extra",
      pos_id: "noun",
      gloss: "second gloss",
      definitions: [],
      examples: [],
    });
    const issues = runQualityCheck([first, word("w2", "kaka")], phono, grammar, only("homophonyClash"));
    expect(issues).toHaveLength(2);
    expect(new Set(issues.map((issue) => issue.entry_id)).size).toBe(2);
  });
});

describe("runQualityCheck: disabled rules", () => {
  test("returns nothing when every rule is disabled", () => {
    const entries = [word("w1", "tazka", { phonetic_ipa: "", senses: [] })];
    const issues = runQualityCheck(entries, phonologyWith("(C)V(C)"), grammar, [...QC_RULE_KEYS]);
    expect(issues).toEqual([]);
  });
});

describe("runQualityCheck: staleCompound", () => {
  test("flags compounds whose upstream pronunciation changed", () => {
    const root = word("root", "taka");
    const compound = word("compound", "taka", {
      etymology: {
        origin_type: "derived",
        parent_entry_id: null,
        source_language_id: null,
        applied_sound_changes: [],
        semantic_shift_note: "",
        components: [{ entry_id: "root", relation: "root" }],
        compounds_stale_digest: "deadbeef",
      },
    });
    const issues = runQualityCheck(
      [root, compound],
      phonologyWith("(C)V(C)"),
      grammarWith([nounPos()]),
      only("staleCompound"),
    );
    expect(issues.map((issue) => issue.entry_id)).toEqual(["compound"]);
    expect(issues[0]?.rule).toBe("staleCompound");
    expect(issues[0]?.severity).toBe("warning");
  });

  test("accepts a matching digest and ignores words without components", () => {
    const root = word("root", "taka");
    const compound = word("compound", "taka", {
      etymology: {
        origin_type: "derived",
        parent_entry_id: null,
        source_language_id: null,
        applied_sound_changes: [],
        semantic_shift_note: "",
        components: [{ entry_id: "root", relation: "root" }],
      },
    });
    const issues = runQualityCheck(
      [root, compound],
      phonologyWith("(C)V(C)"),
      grammarWith([nounPos()]),
      only("staleCompound"),
    );
    expect(issues).toEqual([]);
  });
});
