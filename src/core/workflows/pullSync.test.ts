import { describe, expect, test } from "bun:test";
import type { SCARuleSet, WordEntry } from "../../types";
import { getWordSyncDigest } from "../engines/wordLifecycle";
import { computePullSync } from "./pullSync";

function makeWord(
  id: string,
  langId: string,
  romanized: string,
  gloss: string,
  overrides?: Partial<WordEntry>,
): WordEntry {
  return {
    entry_id: id,
    language_id: langId,
    con_word_romanized: romanized,
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      {
        sense_id: `${id}_s1`,
        pos_id: "pos_n",
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
    metadata: {
      tags: [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

const intervocalicVoicing: SCARuleSet[] = [
  {
    ruleset_id: "rs1",
    name: "Voicing",
    order: 1,
    rules: [
      {
        rule_id: "k_to_g",
        description: "k > g / V_V",
        target: "k",
        replacement: "g",
        context_before: "V",
        context_after: "V",
        exceptions: [],
        feature_mode: false,
        target_features: null,
        replacement_features: null,
        context_before_features: null,
        context_after_features: null,
      },
    ],
  },
];

const macros = { V: ["a", "i", "u"], C: ["p", "t", "k", "g"] };

describe("computePullSync workflow (T1.5)", () => {
  test("1. new word in parent produces mode 'add' with evolved SCA form", () => {
    const parent = makeWord("w1", "lang_parent", "aka", "water");
    const plan = computePullSync({
      parentLanguageId: "lang_parent",
      childLanguageId: "lang_child",
      parentWords: [parent],
      childWords: [],
      scaRuleSets: intervocalicVoicing,
      macros,
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.pending).toHaveLength(1);
    expect(plan.pending[0]?.mode).toBe("add");
    expect(plan.pending[0]?.word.con_word_romanized).toBe("aga");
    expect(plan.pending[0]?.word.language_id).toBe("lang_child");
    expect(plan.pending[0]?.word.etymology.parent_entry_id).toBe("w1");
    expect(plan.pending[0]?.word.etymology.applied_sound_changes).toEqual([
      "k_to_g",
    ]);
  });

  test("2. never synced (freshly forked) & content differs after SCA -> mode 'update'", () => {
    const parent = makeWord("w2", "lang_parent", "aka", "fire");
    // Freshly forked child still has un-evolved "aka" and null parent_snapshot_hash
    const child = makeWord("w2_child", "lang_child", "aka", "fire", {
      etymology: {
        origin_type: "evolved",
        parent_entry_id: "w2",
        source_language_id: "lang_parent",
        applied_sound_changes: [],
        semantic_shift_note: "",
      },
    });

    const plan = computePullSync({
      parentLanguageId: "lang_parent",
      childLanguageId: "lang_child",
      parentWords: [parent],
      childWords: [child],
      scaRuleSets: intervocalicVoicing,
      macros,
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.pending).toHaveLength(1);
    expect(plan.pending[0]?.mode).toBe("update");
    expect(plan.pending[0]?.word.entry_id).toBe("w2_child");
    expect(plan.pending[0]?.word.con_word_romanized).toBe("aga");
  });

  test("3. parent changed & child unchanged since last sync -> mode 'update'", () => {
    const oldParent = makeWord("w3", "lang_parent", "aka", "wind");
    // First sync to establish child's baseline evolution hashes
    const initialSync = computePullSync({
      parentLanguageId: "lang_parent",
      childLanguageId: "lang_child",
      parentWords: [oldParent],
      childWords: [],
      scaRuleSets: intervocalicVoicing,
      macros,
    });
    const syncedChild = {
      ...initialSync.pending[0]!.word,
      entry_id: "w3_child",
    };

    // Parent spelling changes from "aka" to "ika" -> should evolve to "iga"
    const updatedParent = makeWord("w3", "lang_parent", "ika", "wind");
    const plan = computePullSync({
      parentLanguageId: "lang_parent",
      childLanguageId: "lang_child",
      parentWords: [updatedParent],
      childWords: [syncedChild],
      scaRuleSets: intervocalicVoicing,
      macros,
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.pending).toHaveLength(1);
    expect(plan.pending[0]?.mode).toBe("update");
    expect(plan.pending[0]?.word.entry_id).toBe("w3_child");
    expect(plan.pending[0]?.word.con_word_romanized).toBe("iga");
  });

  test("4. both parent and child changed since last sync -> conflict", () => {
    const oldParent = makeWord("w4", "lang_parent", "aka", "sun");
    const oldParentHash = getWordSyncDigest(oldParent);

    const syncedChildSnapshot = makeWord("w4_child", "lang_child", "aga", "sun");
    const lastSyncedChildHash = getWordSyncDigest(syncedChildSnapshot);

    // Child was manually edited in daughter language ("aga" -> "agha")
    const editedChild = makeWord("w4_child", "lang_child", "agha", "sun", {
      etymology: {
        origin_type: "evolved",
        parent_entry_id: "w4",
        source_language_id: "lang_parent",
        applied_sound_changes: ["k_to_g"],
        semantic_shift_note: "",
      },
      evolution: {
        is_deprecated: false,
        deprecated_since_language_id: null,
        parent_snapshot_hash: oldParentHash,
        last_synced_word_hash: lastSyncedChildHash,
      },
    });

    // Parent also changed ("aka" -> "uka")
    const editedParent = makeWord("w4", "lang_parent", "uka", "sun");

    const plan = computePullSync({
      parentLanguageId: "lang_parent",
      childLanguageId: "lang_child",
      parentWords: [editedParent],
      childWords: [editedChild],
      scaRuleSets: intervocalicVoicing,
      macros,
    });

    expect(plan.pending).toEqual([]);
    expect(plan.conflicts).toEqual([
      { parentEntryId: "w4", childEntryId: "w4_child" },
    ]);
  });

  test("5. neither parent nor child changed since last sync -> skipped", () => {
    const parent = makeWord("w5", "lang_parent", "aka", "moon");
    const initial = computePullSync({
      parentLanguageId: "lang_parent",
      childLanguageId: "lang_child",
      parentWords: [parent],
      childWords: [],
      scaRuleSets: intervocalicVoicing,
      macros,
    });
    const syncedChild = initial.pending[0]!.word;

    const second = computePullSync({
      parentLanguageId: "lang_parent",
      childLanguageId: "lang_child",
      parentWords: [parent],
      childWords: [syncedChild],
      scaRuleSets: intervocalicVoicing,
      macros,
    });

    expect(second.pending).toEqual([]);
    expect(second.conflicts).toEqual([]);
  });
});
