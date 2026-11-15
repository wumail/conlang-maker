import { describe, expect, test } from "bun:test";
import type { WordEntry } from "../../types";
import {
  getWordComparableDigest,
  getWordEvolution,
  getWordSyncDigest,
  hasWordChangedFromParent,
  getWordChangeDetails,
  getInheritedParentEntryId,
} from "./wordLifecycle";

function makeSampleWord(overrides?: Partial<WordEntry>): WordEntry {
  return {
    entry_id: "entry_001",
    language_id: "lang_proto",
    con_word_romanized: "kapa",
    phonetic_ipa: "/kapa/",
    phonetic_override: false,
    senses: [
      {
        sense_id: "sense_001",
        pos_id: "pos_n",
        gloss: "stone",
        definitions: ["hard mineral"],
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
    metadata: {
      tags: [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("wordLifecycle pure synchronous digests (T1.2)", () => {
  test("pins exact deterministic DJB2 hex digests for known inputs", () => {
    const word = makeSampleWord();
    expect(getWordSyncDigest(word)).toBe("ab70fc92");
    expect(getWordComparableDigest(word)).toBe("bf5cdd85");

    const overridden = makeSampleWord({
      phonetic_override: true,
      phonetic_ipa: "/kʰa.pa/",
    });
    expect(getWordSyncDigest(overridden)).toBe("b253d19c");
    expect(getWordComparableDigest(overridden)).toBe("d6c02bcb");
  });

  test("ignores auto-generated phonetic_ipa when phonetic_override is false", () => {
    const w1 = makeSampleWord({ phonetic_ipa: "/kapa/", phonetic_override: false });
    const w2 = makeSampleWord({ phonetic_ipa: "/gaba/", phonetic_override: false });
    expect(getWordSyncDigest(w1)).toBe(getWordSyncDigest(w2));
    expect(getWordComparableDigest(w1)).toBe(getWordComparableDigest(w2));
    expect(hasWordChangedFromParent(w1, w2)).toBe(false);
  });

  test("normalizes default evolution fields and detects gloss changes", () => {
    const base = makeSampleWord();
    expect(getWordEvolution(base)).toEqual({
      is_deprecated: false,
      deprecated_since_language_id: null,
      parent_snapshot_hash: null,
      last_synced_word_hash: null,
    });

    const changedGloss = makeSampleWord({
      senses: [
        {
          sense_id: "sense_001",
          pos_id: "pos_n",
          gloss: "rock",
          definitions: ["hard mineral"],
          examples: [],
        },
      ],
    });
    expect(hasWordChangedFromParent(changedGloss, base)).toBe(true);
    expect(getWordComparableDigest(changedGloss)).not.toBe(
      getWordComparableDigest(base),
    );
    expect(getWordSyncDigest(changedGloss)).toBe(getWordSyncDigest(base));
  });

  test("ignores pure transcription differences and separates segments, prosody and technical state", () => {
    const parent = makeSampleWord({ con_word_romanized: "lozha", phonetic_ipa: "loʒa", phonetic_override: true });
    const spelling = makeSampleWord({ con_word_romanized: "loja", phonetic_ipa: "loʒa", phonetic_override: true });
    expect(getWordChangeDetails(spelling, parent)).toEqual({ segments: false, prosody: false, meaning: false, technical: false });
    const stress = { ...parent, phonetic_ipa: "ˈloʒa" };
    expect(getWordChangeDetails(stress, parent).prosody).toBe(true);
    expect(getWordChangeDetails(stress, parent).segments).toBe(false);
    expect(getWordChangeDetails({ ...stress, phonetic_ipa: "ˈloza" }, parent).segments).toBe(true);
    expect(getWordChangeDetails({ ...parent, phonetic_override: false }, parent).technical).toBe(true);
  });

  test("inheritance lookup returns a parent only for evolved origin (Roadmap v3)", () => {
    const word = makeSampleWord();
    // 仅 evolved 返回 parent_entry_id；借词/派生/复合词绝不被误判为继承词
    expect(getInheritedParentEntryId(word, "parent")).toBeNull();
    expect(getInheritedParentEntryId({ ...word, etymology: { ...word.etymology, origin_type: "derived", parent_entry_id: "root" } }, "parent")).toBeNull();
    expect(getInheritedParentEntryId({ ...word, etymology: { ...word.etymology, origin_type: "compound", parent_entry_id: "root" } }, "parent")).toBeNull();
    expect(getInheritedParentEntryId({ ...word, etymology: { ...word.etymology, origin_type: "borrowed", parent_entry_id: "root", source_language_id: "lang_donor" } }, "parent")).toBeNull();
    expect(getInheritedParentEntryId({ ...word, etymology: { ...word.etymology, origin_type: "borrowed", parent_entry_id: null, source_language_id: null } }, "parent")).toBeNull();
    expect(getInheritedParentEntryId({ ...word, etymology: { ...word.etymology, origin_type: "evolved", parent_entry_id: "root", source_language_id: "other" } }, "parent")).toBeNull();
    expect(getInheritedParentEntryId({ ...word, etymology: { ...word.etymology, origin_type: "evolved", parent_entry_id: "root", source_language_id: "parent" } }, "parent")).toBe("root");
    // 旧版 evolved 稳定 ID 克隆（无 parent_entry_id）仍按自身 ID 解析
    expect(getInheritedParentEntryId({ ...word, etymology: { ...word.etymology, origin_type: "evolved", parent_entry_id: null, source_language_id: null } }, "parent")).toBe(word.entry_id);
  });
});
