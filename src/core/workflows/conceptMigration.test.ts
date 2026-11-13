import { describe, expect, test } from "bun:test";
import type { WordEntry } from "../../types";
import {
  applyConceptMigration,
  candidateKey,
  extractConceptTagValue,
  scanConceptTags,
  slugifyConceptId,
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
