import { describe, expect, test } from "bun:test";
import type { ConceptDefinition, Etymology, LanguageEntry, WordEntry } from "../../types";
import { buildCognateMatrix, computeLanguageDepths, cognateColor } from "./cognateMatrix";

const LANGUAGES: LanguageEntry[] = [
  { language_id: "lang_root", name: "Proto", path: "roots/root", parent_id: null },
  { language_id: "lang_a", name: "Branch A", path: "branches/a", parent_id: "lang_root" },
  { language_id: "lang_b", name: "Branch B", path: "branches/b", parent_id: "lang_root" },
  { language_id: "lang_a1", name: "A1", path: "branches/a1", parent_id: "lang_a" },
];

const CONCEPTS: ConceptDefinition[] = [
  { concept_id: "water", gloss_en: "water", gloss_zh: "水", semantic_field: "nature", standard_lists: [] },
  { concept_id: "fire", gloss_en: "fire", gloss_zh: "火", semantic_field: "nature", standard_lists: [] },
];

function etymology(overrides: Partial<Etymology> = {}): Etymology {
  return {
    origin_type: "a_priori",
    source_language_id: null,
    parent_entry_id: null,
    applied_sound_changes: [],
    semantic_shift_note: "",
    ...overrides,
  };
}

function word(
  entryId: string,
  languageId: string,
  conceptId: string | null,
  options: {
    form?: string;
    etymology?: Partial<Etymology>;
    deprecated?: boolean;
  } = {},
): WordEntry {
  return {
    entry_id: entryId,
    language_id: languageId,
    con_word_romanized: options.form ?? entryId,
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      {
        sense_id: `sense_${entryId}`,
        pos_id: "noun",
        gloss: conceptId ?? "",
        definitions: [],
        examples: [],
        ...(conceptId ? { concept_id: conceptId } : {}),
      },
    ],
    etymology: etymology(options.etymology),
    metadata: { tags: [], created_at: "", updated_at: "" },
    ...(options.deprecated ? { evolution: { is_deprecated: true } as WordEntry["evolution"] } : {}),
  };
}

describe("computeLanguageDepths", () => {
  test("computes depth from the genealogy chain", () => {
    const depths = computeLanguageDepths(LANGUAGES);
    expect(depths.get("lang_root")).toBe(0);
    expect(depths.get("lang_a")).toBe(1);
    expect(depths.get("lang_a1")).toBe(2);
  });
});

describe("buildCognateMatrix", () => {
  test("groups cells sharing the same ultimate root across generations", () => {
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: {
        lang_root: [word("root_water", "lang_root", "water", { form: "watar" })],
        lang_a: [
          word("a_water", "lang_a", "water", {
            form: "wadar",
            etymology: { origin_type: "evolved", parent_entry_id: "root_water" },
          }),
        ],
        lang_b: [
          word("b_water", "lang_b", "water", {
            form: "wator",
            etymology: { origin_type: "evolved", parent_entry_id: "root_water" },
          }),
        ],
        lang_a1: [
          word("a1_water", "lang_a1", "water", {
            form: "adar",
            etymology: { origin_type: "evolved", parent_entry_id: "a_water" },
          }),
        ],
      },
    });

    const row = result.rows.find((item) => item.conceptId === "water")!;
    const sets = row.cells.map((cell) => cell.cognateSetId);
    // 四门语言全部追溯到 lang_root::root_water（跨两代仍归同组）
    expect(new Set(sets).size).toBe(1);
    expect(sets[0]).toBe("lang_root::root_water");
    expect(row.cells.every((cell) => cell.kind === "inherited")).toBe(true);
    expect(row.cognateSetCount).toBe(1);
  });

  test("separates borrowed words and independent innovations", () => {
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: {
        lang_root: [word("root_water", "lang_root", "water")],
        lang_a: [
          word("a_water", "lang_b_loan", "water", {
            etymology: {
              origin_type: "borrowed",
              source_language_id: "lang_b",
              parent_entry_id: "b_water",
            },
          }),
        ],
        lang_b: [word("b_water", "lang_b", "water")],
        lang_a1: [word("a1_water", "lang_a1", "water")],
      },
    });

    const row = result.rows.find((item) => item.conceptId === "water")!;
    const byLang = new Map(row.cells.map((cell) => [cell.languageId, cell]));
    expect(byLang.get("lang_a")?.kind).toBe("borrowed");
    expect(byLang.get("lang_b")?.kind).toBe("innovation");
    expect(byLang.get("lang_a1")?.kind).toBe("innovation");
    expect(row.cognateSetCount).toBe(4); // 1 inherited + 1 borrowed + 2 innovations
    expect(result.stats.borrowedCount).toBe(1);
    expect(result.stats.innovationCount).toBe(2);
  });

  test("keeps empty cells clickable and counts fill rate", () => {
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: { lang_root: [word("root_water", "lang_root", "water")] },
    });
    const water = result.rows.find((row) => row.conceptId === "water")!;
    expect(water.filled).toBe(1);
    expect(water.cells.filter((cell) => cell.kind === "empty")).toHaveLength(3);
    expect(water.cells.find((cell) => cell.languageId === "lang_a")?.entryId).toBeNull();
    expect(result.stats.filledCount).toBe(1);
  });

  test("onlyFilled drops concepts with no forms", () => {
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: { lang_root: [word("root_water", "lang_root", "water")] },
      onlyFilled: true,
    });
    expect(result.rows.map((row) => row.conceptId)).toEqual(["water"]);
  });

  test("records broken chains when the parent entry is missing", () => {
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: {
        lang_a: [
          word("a_water", "lang_a", "water", {
            etymology: { origin_type: "evolved", parent_entry_id: "missing_root" },
          }),
        ],
      },
    });
    expect(result.stats.brokenChainCount).toBe(1);
    const row = result.rows.find((item) => item.conceptId === "water")!;
    expect(row.cells[1]?.cognateSetId).toBe("lang_a::a_water");
  });

  test("prefers the non-deprecated entry and reports variants", () => {
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: {
        lang_root: [
          word("root_water_old", "lang_root", "water", { form: "watar", deprecated: true }),
          word("root_water", "lang_root", "water", { form: "watta" }),
        ],
      },
    });
    const row = result.rows.find((item) => item.conceptId === "water")!;
    expect(row.cells[0]?.entryId).toBe("root_water");
    expect(row.cells[0]?.variants).toBe(2);
  });

  test("survives accidental cycles in parent links", () => {
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: {
        lang_root: [
          word("root_water", "lang_root", "water", {
            etymology: { parent_entry_id: "a_water" },
          }),
        ],
        lang_a: [
          word("a_water", "lang_a", "water", {
            etymology: { parent_entry_id: "root_water" },
          }),
        ],
      },
    });
    expect(result.stats.brokenChainCount).toBeGreaterThanOrEqual(1);
    expect(result.rows.find((row) => row.conceptId === "water")).toBeDefined();
  });
});

describe("cognateColor", () => {
  test("cycles through the palette and returns null for empty cells", () => {
    expect(cognateColor(0)).not.toBeNull();
    expect(cognateColor(0)).toBe(cognateColor(8));
    expect(cognateColor(null)).toBeNull();
  });
});
