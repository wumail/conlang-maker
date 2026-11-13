import { describe, expect, test } from "bun:test";
import type { MorphemeComponent, WordEntry } from "../../types";
import {
  computeComponentsDigest,
  getWordFamilyGraph,
  hasUnresolvedComponents,
  wouldIntroduceCycle,
} from "./wordFamily";

function word(
  entryId: string,
  form: string,
  components: MorphemeComponent[] = [],
  ipa = "",
): WordEntry {
  return {
    entry_id: entryId,
    language_id: "lang_1",
    con_word_romanized: form,
    phonetic_ipa: ipa,
    phonetic_override: false,
    senses: [
      { sense_id: `s_${entryId}`, pos_id: "noun", gloss: form, definitions: [], examples: [] },
    ],
    etymology: {
      origin_type: components.length > 0 ? "derived" : "a_priori",
      source_language_id: null,
      parent_entry_id: null,
      applied_sound_changes: [],
      semantic_shift_note: "",
      ...(components.length > 0 ? { components } : {}),
    },
    metadata: { tags: [], created_at: "", updated_at: "" },
  };
}

const SUN: MorphemeComponent = { entry_id: "sun", relation: "root" };
const MOON: MorphemeComponent = { entry_id: "moon", relation: "root" };

describe("wouldIntroduceCycle", () => {
  const words: Record<string, WordEntry> = {
    sun: word("sun", "sun"),
    moon: word("moon", "moon"),
    bright: word("bright", "ming", [SUN, MOON]),
    sunlight: word("sunlight", "sunlight", [{ entry_id: "bright", relation: "head" }]),
  };

  test("blocks self reference", () => {
    expect(wouldIntroduceCycle("sun", "sun", words)).toBe(true);
  });

  test("blocks indirect cycles A -> B -> C -> A", () => {
    // 把 sun 的成分设为 sunlight（sunlight -> bright -> sun）会成环
    expect(wouldIntroduceCycle("sun", "sunlight", words)).toBe(true);
    expect(wouldIntroduceCycle("bright", "sunlight", words)).toBe(true);
  });

  test("allows acyclic additions and unknown ids", () => {
    expect(wouldIntroduceCycle("sunlight", "sun", words)).toBe(false);
    expect(wouldIntroduceCycle("bright", "moon", words)).toBe(false);
    expect(wouldIntroduceCycle("ghost", "sun", words)).toBe(false);
  });

  test("is not fooled by shared components (diamond shape)", () => {
    expect(wouldIntroduceCycle("sunlight", "moon", words)).toBe(false);
  });
});

describe("computeComponentsDigest", () => {
  const words: Record<string, WordEntry> = {
    sun: word("sun", "sun", [], "/sun/"),
    moon: word("moon", "moon", [], "/muːn/"),
  };

  test("is order sensitive and stable", () => {
    const a = computeComponentsDigest([SUN, MOON], words);
    const b = computeComponentsDigest([MOON, SUN], words);
    expect(a).not.toBe(b);
    expect(computeComponentsDigest([SUN, MOON], words)).toBe(a);
  });

  test("changes when an upstream form or IPA changes", () => {
    const base = computeComponentsDigest([SUN], words);
    const changedForm = computeComponentsDigest([SUN], {
      ...words,
      sun: { ...words.sun!, con_word_romanized: "sol" },
    });
    const changedIpa = computeComponentsDigest([SUN], {
      ...words,
      sun: { ...words.sun!, phonetic_ipa: "/sol/" },
    });
    expect(changedForm).not.toBe(base);
    expect(changedIpa).not.toBe(base);
  });

  test("returns an empty string for component-less words", () => {
    expect(computeComponentsDigest([], words)).toBe("");
  });
});

describe("getWordFamilyGraph", () => {
  const words: Record<string, WordEntry> = {
    sun: word("sun", "sun"),
    moon: word("moon", "moon"),
    bright: word("bright", "ming", [SUN, MOON]),
    sunlight: word("sunlight", "sunlight", [{ entry_id: "bright", relation: "head" }]),
    moonbeam: word("moonbeam", "moonbeam", [
      { entry_id: "moon", relation: "modifier" },
      { entry_id: "bright", relation: "head" },
    ]),
  };

  test("lists the upstream component tree", () => {
    const graph = getWordFamilyGraph("bright", words);
    expect(graph.upstream.map((node) => node.entryId)).toEqual(["sun", "moon"]);
    expect(graph.upstream[0]?.relation).toBe("root");
    expect(graph.rootForm).toBe("ming");
  });

  test("lists downstream derivatives at the shortest depth", () => {
    const graph = getWordFamilyGraph("bright", words);
    const ids = graph.downstream.map((node) => node.entryId);
    expect(ids).toContain("sunlight");
    expect(ids).toContain("moonbeam");
    expect(graph.downstream.every((node) => node.depth === 1)).toBe(true);
  });

  test("walks multiple levels and de-duplicates", () => {
    const deep: Record<string, WordEntry> = {
      ...words,
      sunlit: word("sunlit", "sunlit", [{ entry_id: "sunlight", relation: "head" }]),
    };
    const graph = getWordFamilyGraph("bright", deep);
    expect(graph.downstream.find((node) => node.entryId === "sunlit")?.depth).toBe(2);
    expect(new Set(graph.downstream.map((node) => node.entryId)).size).toBe(
      graph.downstream.length,
    );
  });

  test("survives a pre-existing cycle without hanging", () => {
    const cyclic: Record<string, WordEntry> = {
      a: word("a", "a", [{ entry_id: "b", relation: "root" }]),
      b: word("b", "b", [{ entry_id: "a", relation: "root" }]),
    };
    const graph = getWordFamilyGraph("a", cyclic);
    expect(graph.upstream).toHaveLength(1);
    expect(graph.downstream.map((node) => node.entryId)).toEqual(["b"]);
  });

  test("marks missing components", () => {
    const partial: Record<string, WordEntry> = {
      broken: word("broken", "broken", [{ entry_id: "ghost", relation: "root" }]),
    };
    const graph = getWordFamilyGraph("broken", partial);
    expect(graph.upstream[0]?.missing).toBe(true);
    expect(hasUnresolvedComponents(partial.broken!, partial)).toBe(true);
    expect(hasUnresolvedComponents(words.bright!, words)).toBe(false);
  });
});
