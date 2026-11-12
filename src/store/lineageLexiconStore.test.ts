import { afterEach, describe, expect, test } from "bun:test";
import type { PhonologyConfig, WordEntry } from "../types";
import {
  getLineageLexicon,
  invalidateLineageLexicon,
  isLineageLexiconLoading,
  loadLineageLexicon,
  resetLineageLexiconLoader,
  setLineageLexiconLoader,
  type LineageLexiconSnapshot,
} from "./lineageLexiconStore";

const phono: PhonologyConfig = {
  language_id: "lang_parent",
  phoneme_inventory: { consonants: ["p"], vowels: ["a"] },
  romanization_maps: [],
  allophony_rules: [],
} as unknown as PhonologyConfig;

function entry(id: string): WordEntry {
  return {
    entry_id: id,
    language_id: "lang_parent",
    con_word_romanized: "pa",
    phonetic_ipa: "pa",
    phonetic_override: false,
    senses: [],
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

function snapshot(revision: string, ids: string[]): LineageLexiconSnapshot {
  const wordsById: Record<string, WordEntry> = {};
  for (const id of ids) wordsById[id] = entry(id);
  return { wordsById, phonoConfig: phono, revision };
}

afterEach(() => {
  resetLineageLexiconLoader();
});

describe("lineageLexiconStore", () => {
  test("deduplicates concurrent loads for the same language", async () => {
    let calls = 0;
    let release: (value: LineageLexiconSnapshot) => void = () => {};
    setLineageLexiconLoader(async () => {
      calls += 1;
      return new Promise<LineageLexiconSnapshot>((resolve) => {
        release = resolve;
      });
    });

    const first = loadLineageLexicon("/proj", "/proj/parent");
    const second = loadLineageLexicon("/proj", "/proj/parent");
    expect(calls).toBe(1);
    expect(isLineageLexiconLoading("/proj", "/proj/parent")).toBe(true);

    release(snapshot("rev1", ["a"]));
    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe(b);
    expect(calls).toBe(1);
    expect(a?.revision).toBe("rev1");
    expect(isLineageLexiconLoading("/proj", "/proj/parent")).toBe(false);
  });

  test("serves cached snapshots without another load", async () => {
    let calls = 0;
    setLineageLexiconLoader(async () => {
      calls += 1;
      return snapshot("rev1", ["a", "b"]);
    });

    await loadLineageLexicon("/proj", "/proj/parent");
    const cached = await loadLineageLexicon("/proj", "/proj/parent");

    expect(calls).toBe(1);
    expect(Object.keys(cached?.wordsById ?? {})).toEqual(["a", "b"]);
    expect(getLineageLexicon("/proj", "/proj/parent")?.revision).toBe("rev1");
  });

  test("keeps the previous object when the revision is unchanged", async () => {
    let revision = "rev1";
    setLineageLexiconLoader(async () => snapshot(revision, ["a"]));

    const first = await loadLineageLexicon("/proj", "/proj/parent");
    invalidateLineageLexicon("/proj", "/proj/parent");
    const second = await loadLineageLexicon("/proj", "/proj/parent");
    expect(second).toBe(first);

    revision = "rev2";
    invalidateLineageLexicon("/proj", "/proj/parent");
    const third = await loadLineageLexicon("/proj", "/proj/parent");
    expect(third).not.toBe(first);
    expect(third?.revision).toBe("rev2");
  });

  test("invalidates by workspace and by single language", async () => {
    setLineageLexiconLoader(async (_p, languagePath) => snapshot(languagePath, ["a"]));

    await loadLineageLexicon("/proj", "/proj/a");
    await loadLineageLexicon("/proj", "/proj/b");
    await loadLineageLexicon("/other", "/other/a");

    invalidateLineageLexicon("/proj", "/proj/a");
    expect(getLineageLexicon("/proj", "/proj/a")).toBeNull();
    expect(getLineageLexicon("/proj", "/proj/b")).not.toBeNull();

    invalidateLineageLexicon("/proj");
    expect(getLineageLexicon("/proj", "/proj/b")).toBeNull();
    expect(getLineageLexicon("/other", "/other/a")).not.toBeNull();

    invalidateLineageLexicon();
    expect(getLineageLexicon("/other", "/other/a")).toBeNull();
  });

  test("records loader failures without throwing", async () => {
    setLineageLexiconLoader(async () => {
      throw new Error("boom");
    });

    const result = await loadLineageLexicon("/proj", "/proj/broken");
    expect(result).toBeNull();
    expect(getLineageLexicon("/proj", "/proj/broken")).toBeNull();
    expect(isLineageLexiconLoading("/proj", "/proj/broken")).toBe(false);
  });

  test("returns null for empty paths without calling the loader", async () => {
    let calls = 0;
    setLineageLexiconLoader(async () => {
      calls += 1;
      return snapshot("rev1", []);
    });

    expect(await loadLineageLexicon("", "/proj/a")).toBeNull();
    expect(await loadLineageLexicon("/proj", "")).toBeNull();
    expect(calls).toBe(0);
  });
});
