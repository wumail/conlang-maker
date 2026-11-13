import { afterEach, describe, expect, test } from "bun:test";
import type { WordEntry } from "../types";
import {
  getLineageLexicon,
  loadLineageLexicon,
  resetLineageLexiconLoader,
  setLineageLexiconLoader,
  type LineageLexiconSnapshot,
} from "../store/lineageLexiconStore";
import {
  PALETTE_ROUTES,
  parsePaletteMode,
  searchWords,
  warmLineageLexiconCache,
} from "./commandPalette";

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

describe("warmLineageLexiconCache", () => {
  const requested: string[] = [];

  const installLoader = () => {
    requested.length = 0;
    setLineageLexiconLoader(async (_projectPath, languagePath) => {
      requested.push(languagePath);
      const snapshot: LineageLexiconSnapshot = {
        wordsById: {},
        phonoConfig: {} as LineageLexiconSnapshot["phonoConfig"],
        revision: `rev:${languagePath}`,
      };
      return snapshot;
    });
  };

  afterEach(() => {
    resetLineageLexiconLoader();
  });

  test("preloads every uncached language once and skips cached ones", async () => {
    installLoader();

    const started = warmLineageLexiconCache("/proj", [
      "/proj/a",
      "/proj/b",
      "/proj/a",
      "",
    ]);
    expect(started).toBe(2);

    await Promise.all([
      loadLineageLexicon("/proj", "/proj/a"),
      loadLineageLexicon("/proj", "/proj/b"),
    ]);
    expect(requested.sort()).toEqual(["/proj/a", "/proj/b"]);
    expect(getLineageLexicon("/proj", "/proj/a")).not.toBeNull();
    expect(getLineageLexicon("/proj", "/proj/b")).not.toBeNull();

    // 已进入缓存的语言不再触发 IPC
    expect(warmLineageLexiconCache("/proj", ["/proj/a", "/proj/b"])).toBe(0);
    // 没有工作区路径时不预热
    expect(warmLineageLexiconCache("", ["/proj/c"])).toBe(0);
    expect(requested).toHaveLength(2);
  });
});
