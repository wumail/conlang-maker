import { describe, expect, test } from "bun:test";
import type { ConceptDefinition, LanguageEntry, WordEntry } from "../../types";
import {
  applyConceptMigration,
  candidateKey,
  extractConceptTagValue,
  previewMergeCustomConcepts,
  scanConceptTags,
  slugifyConceptId,
  suggestCrossLanguageConceptAlignments,
} from "./conceptMigration";

function word(
  entryId: string,
  tags: string[],
  options: { conceptId?: string; romanized?: string } = {},
): WordEntry {
  return {
    entry_id: entryId,
    language_id: "lang_1",
    con_word_romanized: options.romanized ?? entryId,
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      {
        sense_id: `sense_${entryId}`,
        pos_id: "noun",
        gloss: entryId,
        definitions: [],
        examples: [],
        ...(options.conceptId ? { concept_id: options.conceptId } : {}),
      },
    ],
    etymology: {
      origin_type: "a_priori",
      source_language_id: null,
      parent_entry_id: null,
      applied_sound_changes: [],
      semantic_shift_note: "",
    },
    metadata: {
      tags,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  };
}

describe("extractConceptTagValue", () => {
  test("recognises colon, ASCII colon, numeric and English prefixes", () => {
    expect(extractConceptTagValue("概念:水")).toBe("水");
    expect(extractConceptTagValue("概念：火")).toBe("火");
    expect(extractConceptTagValue("concept:water")).toBe("water");
    expect(extractConceptTagValue("Concept : Fire")).toBe("Fire");
    expect(extractConceptTagValue("概念12")).toBe("12");
  });

  test("ignores unrelated tags", () => {
    expect(extractConceptTagValue("仪式")).toBeNull();
    expect(extractConceptTagValue("concept")).toBeNull();
    expect(extractConceptTagValue("")).toBeNull();
  });
});

describe("scanConceptTags", () => {
  test("resolves Chinese, English and id forms to the same concept", () => {
    const plan = scanConceptTags([
      word("w1", ["概念:水"]),
      word("w2", ["concept:water"]),
      word("w3", ["概念:WATER"]),
    ]);
    expect(plan.resolved).toHaveLength(3);
    expect(plan.resolved.every((item) => item.conceptId === "water")).toBe(true);
    expect(plan.resolved[0]?.label).toBe("水");
  });

  test("numeric tags are only guessed by Swadesh index and need confirmation", () => {
    // Swadesh-100 第 1 项是 "I"，第 11 项是 "one"
    const plan = scanConceptTags([word("w1", ["概念1"]), word("w2", ["概念11"])]);
    expect(plan.resolved).toHaveLength(0);
    expect(plan.needsConfirm).toHaveLength(2);
    expect(plan.needsConfirm.map((item) => item.conceptId)).toEqual(["i", "one"]);
    expect(plan.needsConfirm.every((item) => item.status === "needs_confirm")).toBe(true);
    expect(plan.hasWork).toBe(false);
  });

  test("marks already-bound entries as no-op for idempotency", () => {
    const plan = scanConceptTags([word("w1", ["概念:水"], { conceptId: "water" })]);
    expect(plan.resolved).toHaveLength(0);
    expect(plan.alreadyApplied).toHaveLength(1);
    expect(plan.hasWork).toBe(false);
  });

  test("flags conflict when the entry already points at another concept", () => {
    const plan = scanConceptTags([word("w1", ["概念:水"], { conceptId: "fire" })]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]?.conflictWith).toBe("fire");
    expect(plan.hasWork).toBe(false);
  });

  test("flags conflict when two tags resolve to different concepts", () => {
    const plan = scanConceptTags([word("w1", ["概念:水", "concept:fire"])]);
    expect(plan.conflicts).toHaveLength(2);
    expect(plan.conflicts[0]?.conflictWith).toContain("water");
  });

  test("collects unresolved tags as suggested custom concepts", () => {
    const plan = scanConceptTags([word("w1", ["概念:青铜"]), word("w2", ["概念:青铜"])]);
    expect(plan.unresolved).toHaveLength(2);
    expect(plan.suggestedConcepts).toHaveLength(1);
    expect(plan.suggestedConcepts[0]?.gloss_zh).toBe("青铜");
    expect(plan.suggestedConcepts[0]?.concept_id).toStartWith("custom_");
  });

  test("resolves custom concepts supplied by the workspace", () => {
    const plan = scanConceptTags([word("w1", ["概念:青铜"])], [
      {
        concept_id: "bronze",
        gloss_en: "bronze",
        gloss_zh: "青铜",
        semantic_field: "substance",
        standard_lists: [],
      },
    ]);
    expect(plan.resolved).toHaveLength(1);
    expect(plan.resolved[0]?.conceptId).toBe("bronze");
  });
});

describe("applyConceptMigration", () => {
  test("never auto-binds numeric guesses without explicit confirmation", () => {
    const words = [word("w1", ["概念1"]), word("w2", ["概念:水"])];
    const plan = scanConceptTags(words);
    const result = applyConceptMigration(words, plan);
    expect(result.changedEntries).toBe(1);
    expect(result.words[0]?.senses[0]?.concept_id).toBeUndefined();
    expect(result.words[1]?.senses[0]?.concept_id).toBe("water");
  });

  test("binds a numeric guess once the user ticks that row", () => {
    const words = [word("w1", ["概念1"])];
    const plan = scanConceptTags(words);
    const guess = plan.needsConfirm[0]!;
    const result = applyConceptMigration(words, plan, {
      applyKeys: new Set([candidateKey(guess)]),
    });
    expect(result.changedEntries).toBe(1);
    expect(result.words[0]?.senses[0]?.concept_id).toBe("i");
  });

  test("binds concept_id on the first sense and keeps other fields intact", () => {
    const words = [word("w1", ["概念:水"], { romanized: "sui" })];
    const plan = scanConceptTags(words);
    const result = applyConceptMigration(words, plan);
    expect(result.changedEntries).toBe(1);
    expect(result.words[0]?.senses[0]?.concept_id).toBe("water");
    expect(result.words[0]?.con_word_romanized).toBe("sui");
    expect(result.words[0]?.metadata.tags).toEqual(["概念:水"]);
    // 原数组未被就地修改
    expect(words[0]?.senses[0]?.concept_id).toBeUndefined();
  });

  test("is idempotent across repeated runs", () => {
    const words = [word("w1", ["概念:水"]), word("w2", ["概念:火"])];
    const first = applyConceptMigration(words, scanConceptTags(words));
    expect(first.changedEntries).toBe(2);

    const secondPlan = scanConceptTags(first.words);
    expect(secondPlan.hasWork).toBe(false);
    const second = applyConceptMigration(first.words, secondPlan);
    expect(second.changedEntries).toBe(0);
    expect(second.words).toEqual(first.words);
  });

  test("strips migrated tags only when asked", () => {
    const words = [word("w1", ["概念:水", "仪式"])];
    const plan = scanConceptTags(words);
    const result = applyConceptMigration(words, plan, { stripTags: true });
    expect(result.strippedTags).toBe(1);
    expect(result.words[0]?.metadata.tags).toEqual(["仪式"]);
  });

  test("creates custom concepts for unresolved tags in one pass", () => {
    const words = [word("w1", ["概念:青铜"], { romanized: "bron" })];
    const plan = scanConceptTags(words);
    const result = applyConceptMigration(words, plan);
    expect(result.customConcepts).toHaveLength(1);
    expect(result.words[0]?.senses[0]?.concept_id).toBe(
      result.customConcepts[0]?.concept_id,
    );
  });

  test("leaves conflicting entries untouched", () => {
    const words = [word("w1", ["概念:水"], { conceptId: "fire" })];
    const plan = scanConceptTags(words);
    const result = applyConceptMigration(words, plan);
    expect(result.changedEntries).toBe(0);
    expect(result.words[0]?.senses[0]?.concept_id).toBe("fire");
  });
});

describe("slugifyConceptId", () => {
  test("keeps ascii words readable and hashes CJK", () => {
    expect(slugifyConceptId("Bronze Age")).toBe("bronze_age");
    expect(slugifyConceptId("青铜")).toStartWith("custom_");
    expect(slugifyConceptId("   ")).toStartWith("custom_");
  });
});

// ── Roadmap v3 / Pillar 4：全语系概念对齐与概念合并 ─────────────────────

const ALIGN_LANGUAGES: LanguageEntry[] = [
  { language_id: "lang_1", name: "One", path: "one", parent_id: null },
  { language_id: "lang_2", name: "Two", path: "two", parent_id: "lang_1" },
];

const ALIGN_CONCEPTS: ConceptDefinition[] = [
  { concept_id: "five", gloss_en: "five", gloss_zh: "五", semantic_field: "quantity", standard_lists: [] },
  { concept_id: "hand", gloss_en: "hand", gloss_zh: "手", semantic_field: "body", standard_lists: [] },
  { concept_id: "hold", gloss_en: "hold", gloss_zh: "握", semantic_field: "action", standard_lists: [], aliases: ["拿住", "grasp"] },
];

function multiSenseWord(
  entryId: string,
  languageId: string,
  senses: Array<{ gloss: string; conceptId?: string; definitions?: string[] }>,
): WordEntry {
  return {
    entry_id: entryId,
    language_id: languageId,
    con_word_romanized: entryId,
    phonetic_ipa: "",
    phonetic_override: false,
    senses: senses.map((seed, index) => ({
      sense_id: `sense_${entryId}_${index}`,
      pos_id: "noun",
      gloss: seed.gloss,
      definitions: seed.definitions ?? [],
      examples: [],
      ...(seed.conceptId ? { concept_id: seed.conceptId } : {}),
    })),
    etymology: {
      origin_type: "a_priori",
      source_language_id: null,
      parent_entry_id: null,
      applied_sound_changes: [],
      semantic_shift_note: "",
    },
    metadata: { tags: [], created_at: "", updated_at: "" },
  };
}

describe("suggestCrossLanguageConceptAlignments", () => {
  test("caps candidates per language without changing ranking order", () => {
    const words = Array.from({ length: 12 }, (_, i) =>
      multiSenseWord(`w${i}`, "lang_1", [{ gloss: "hand" }]),
    );
    const uncapped = suggestCrossLanguageConceptAlignments({
      concepts: ALIGN_CONCEPTS,
      languages: ALIGN_LANGUAGES,
      wordsByLanguage: { lang_1: words },
    });
    const capped = suggestCrossLanguageConceptAlignments({
      concepts: ALIGN_CONCEPTS,
      languages: ALIGN_LANGUAGES,
      wordsByLanguage: { lang_1: words },
      maxCandidatesPerLanguage: 3,
    });
    const conceptId = "hand";
    const full = uncapped[conceptId]?.lang_1 ?? [];
    const limited = capped[conceptId]?.lang_1 ?? [];
    expect(limited).toHaveLength(3);
    expect(limited).toEqual(full.slice(0, 3));
  });

  test("zov's three senses land in five / hand / hold respectively", () => {
    const zov = multiSenseWord("zov", "lang_1", [
      { gloss: "五" },
      { gloss: "hand" },
      { gloss: "拿住" },
    ]);
    const result = suggestCrossLanguageConceptAlignments({
      concepts: ALIGN_CONCEPTS,
      languages: ALIGN_LANGUAGES,
      wordsByLanguage: { lang_1: [zov] },
    });

    const five = result.five?.lang_1 ?? [];
    expect(five).toHaveLength(1);
    expect(five[0]).toMatchObject({
      entryId: "zov",
      senseId: "sense_zov_0",
      matchReason: "exact_gloss",
    });

    const hand = result.hand?.lang_1 ?? [];
    expect(hand).toHaveLength(1);
    expect(hand[0]?.senseId).toBe("sense_zov_1");

    const hold = result.hold?.lang_1 ?? [];
    expect(hold).toHaveLength(1);
    expect(hold[0]).toMatchObject({
      senseId: "sense_zov_2",
      matchReason: "alias",
    });
  });

  test("already-bound senses rank first and survive across languages", () => {
    const words = {
      lang_1: [
        multiSenseWord("miza", "lang_1", [{ gloss: "手掌部位" }, { gloss: "hand", conceptId: "hand" }]),
      ],
      lang_2: [
        multiSenseWord("sula", "lang_2", [{ gloss: "the human hand" }]),
      ],
    };
    const result = suggestCrossLanguageConceptAlignments({
      concepts: ALIGN_CONCEPTS,
      languages: ALIGN_LANGUAGES,
      wordsByLanguage: words,
    });
    const lang1 = result.hand?.lang_1 ?? [];
    expect(lang1[0]).toMatchObject({ entryId: "miza", senseId: "sense_miza_1", matchReason: "already_bound", score: 100 });
    // 未绑定的「手掌部位」义项不进入 hand 候选
    expect(lang1.find((c) => c.senseId === "sense_miza_0")).toBeUndefined();
    const lang2 = result.hand?.lang_2 ?? [];
    expect(lang2[0]?.matchReason).toBe("token");
    expect(lang2[0]?.entryId).toBe("sula");
  });

  test("definitions and tokenized glosses match concept gloss and aliases", () => {
    const words = {
      lang_1: [
        multiSenseWord("kaba", "lang_1", [
          { gloss: "器物", definitions: ["a tool used to grasp things"] },
        ]),
        multiSenseWord("numa", "lang_1", [{ gloss: "five fingers" }]),
      ],
    };
    const result = suggestCrossLanguageConceptAlignments({
      concepts: ALIGN_CONCEPTS,
      languages: ALIGN_LANGUAGES,
      wordsByLanguage: words,
    });
    // definitions 分词命中别名 grasp
    expect(result.hold?.lang_1?.find((c) => c.entryId === "kaba")?.matchReason).toBe("token");
    // gloss 分词命中 five
    expect(result.five?.lang_1?.find((c) => c.entryId === "numa")?.matchReason).toBe("token");
  });
});

describe("previewMergeCustomConcepts", () => {
  const CUSTOM: ConceptDefinition[] = [
    { concept_id: "bronze_a", gloss_en: "bronze", gloss_zh: "青铜", semantic_field: "substance", standard_lists: [], aliases: ["铜锡合金"] },
    { concept_id: "bronze_b", gloss_en: "bronze (alloy)", gloss_zh: "青铜合金", semantic_field: "substance", standard_lists: ["swadesh_100"] },
    { concept_id: "unrelated", gloss_en: "iron", gloss_zh: "铁", semantic_field: "substance", standard_lists: [] },
  ];

  test("merges aliases into the target, drops the source and counts affected bindings", () => {
    const words = {
      lang_1: [
        multiSenseWord("tama", "lang_1", [{ gloss: "青铜", conceptId: "bronze_a" }]),
        multiSenseWord("sono", "lang_1", [
          { gloss: "青铜合金", conceptId: "bronze_a" },
          { gloss: "铁", conceptId: "unrelated" },
        ]),
      ],
      lang_2: [
        multiSenseWord("pila", "lang_2", [{ gloss: "青铜合金", conceptId: "bronze_b" }]),
      ],
    };
    const { nextConcepts, affectedBindings } = previewMergeCustomConcepts({
      sourceConceptId: "bronze_a",
      targetConceptId: "bronze_b",
      customConcepts: CUSTOM,
      wordsByLanguage: words,
    });

    expect(nextConcepts.map((c) => c.concept_id)).toEqual(["bronze_b", "unrelated"]);
    const target = nextConcepts.find((c) => c.concept_id === "bronze_b")!;
    expect(target.aliases).toEqual(["铜锡合金"]);
    expect(target.standard_lists).toEqual(["swadesh_100"]);

    expect(affectedBindings).toHaveLength(2);
    expect(affectedBindings[0]).toMatchObject({
      languageId: "lang_1",
      entryId: "tama",
      senseId: "sense_tama_0",
      romanized: "tama",
    });
    expect(affectedBindings[1]).toMatchObject({ entryId: "sono", senseId: "sense_sono_0" });
  });

  test("merging into a core concept keeps custom list untouched but still reports bindings", () => {
    const { nextConcepts, affectedBindings } = previewMergeCustomConcepts({
      sourceConceptId: "bronze_a",
      targetConceptId: "water", // 核心概念，不在自定义表
      customConcepts: CUSTOM,
      wordsByLanguage: {
        lang_1: [multiSenseWord("tama", "lang_1", [{ gloss: "青铜", conceptId: "bronze_a" }])],
      },
    });
    expect(nextConcepts.map((c) => c.concept_id)).toEqual(["bronze_a", "bronze_b", "unrelated"]);
    expect(affectedBindings).toHaveLength(1);
  });

  test("merging a concept into itself is a no-op", () => {
    const { nextConcepts, affectedBindings } = previewMergeCustomConcepts({
      sourceConceptId: "bronze_a",
      targetConceptId: "bronze_a",
      customConcepts: CUSTOM,
      wordsByLanguage: {
        lang_1: [multiSenseWord("tama", "lang_1", [{ gloss: "青铜", conceptId: "bronze_a" }])],
      },
    });
    expect(nextConcepts).toHaveLength(3);
    expect(affectedBindings).toHaveLength(0);
  });
});
