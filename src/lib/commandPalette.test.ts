import { describe, expect, test } from "bun:test";
import type { WordEntry } from "../types";
import { PALETTE_ROUTES, parsePaletteMode, searchWords } from "./commandPalette";

function word(
  id: string,
  romanized: string,
  gloss: string,
  extra: { ipa?: string; tags?: string[] } = {},
): WordEntry {
  return {
    entry_id: id,
    language_id: "lang_a",
    con_word_romanized: romanized,
    phonetic_ipa: extra.ipa ?? `/${romanized}/`,
    phonetic_override: false,
    senses: [
      {
        sense_id: `sense_${id}`,
        pos_id: "noun",
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
    metadata: { tags: extra.tags ?? [], created_at: "", updated_at: "" },
  };
}

const activeWords = [
  word("a1", "kata", "stone"),
  word("a2", "katalar", "stones", { ipa: "/katalar/" }),
  word("a3", "mira", "sea", { tags: ["nature"] }),
];
const cachedGroups = [
  {
    languageId: "lang_child",
    languageName: "Daughter",
    words: [word("c1", "kato", "rock"), word("c2", "kasa", "house")],
  },
];

describe("searchWords", () => {
  test("ranks prefix hits before substring hits and prefers the active language", () => {
    const hits = searchWords({
      query: "kat",
      activeLanguageId: "lang_a",
      activeWords,
      cachedGroups,
    });
    expect(hits.map((hit) => hit.entryId)).toEqual(["a1", "a2", "c1"]);
    expect(hits[0]!.isActiveLanguage).toBe(true);
    expect(hits[2]!.languageName).toBe("Daughter");
  });

  test("matches IPA with slashes stripped", () => {
    const hits = searchWords({
      query: "katalar",
      activeLanguageId: "lang_a",
      activeWords,
      cachedGroups: [],
    });
    expect(hits.some((hit) => hit.entryId === "a2")).toBe(true);
  });

  test("matches glosses and tags", () => {
    const byGloss = searchWords({
      query: "sea",
      activeLanguageId: "lang_a",
      activeWords,
      cachedGroups: [],
    });
    expect(byGloss.map((hit) => hit.entryId)).toEqual(["a3"]);

    const byTag = searchWords({
      query: "natu",
      activeLanguageId: "lang_a",
      activeWords,
      cachedGroups: [],
    });
    expect(byTag.map((hit) => hit.entryId)).toEqual(["a3"]);
  });

  test("is case insensitive and returns nothing for an empty query", () => {
    expect(
      searchWords({ query: "KATA", activeLanguageId: "lang_a", activeWords, cachedGroups: [] })
        .length,
    ).toBeGreaterThan(0);
    expect(
      searchWords({ query: "   ", activeLanguageId: "lang_a", activeWords, cachedGroups: [] }),
    ).toEqual([]);
  });

  test("honours the limit while keeping the best matches", () => {
    const hits = searchWords({
      query: "ka",
      activeLanguageId: "lang_a",
      activeWords,
      cachedGroups,
      limit: 2,
    });
    expect(hits).toHaveLength(2);
    expect(hits[0]!.entryId).toBe("a1");
  });
});

describe("parsePaletteMode", () => {
  test("detects action and calc prefixes", () => {
    expect(parsePaletteMode("> lexicon")).toEqual({ mode: "actions", body: "lexicon" });
    expect(parsePaletteMode("= kata")).toEqual({ mode: "calc", body: "kata" });
    expect(parsePaletteMode("  > x")).toEqual({ mode: "actions", body: "x" });
  });

  test("defaults to search and keeps the raw query", () => {
    expect(parsePaletteMode("kata")).toEqual({ mode: "search", body: "kata" });
    expect(parsePaletteMode("")).toEqual({ mode: "search", body: "" });
  });
});

describe("PALETTE_ROUTES", () => {
  test("exposes the nine navigable pages", () => {
    expect(PALETTE_ROUTES).toHaveLength(9);
    expect(PALETTE_ROUTES.map((route) => route.path)).toContain("/lexicon");
  });
});
