import { describe, expect, test } from "bun:test";
import type { PhonologyConfig, SCARuleSet, WordEntry } from "../../types";
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

  test("derived and borrowed records cannot replace the inherited target", () => {
    const parent = makeWord("source", "lang_parent", "aka", "water");
    const inherited = makeWord("inherited", "lang_child", "aka", "water", {
      etymology: { ...parent.etymology, origin_type: "evolved", parent_entry_id: "source", source_language_id: "lang_parent" },
    });
    const derived = makeWord("compound", "lang_child", "akam", "water jar", {
      etymology: { ...parent.etymology, origin_type: "derived", parent_entry_id: "source" },
    });
    const borrowed = makeWord("loan", "lang_child", "aka", "water", {
      etymology: { ...parent.etymology, origin_type: "borrowed", parent_entry_id: "source", source_language_id: "lang_parent" },
    });
    const plan = computePullSync({ parentLanguageId: "lang_parent", childLanguageId: "lang_child", parentWords: [parent], childWords: [inherited, derived, borrowed], scaRuleSets: intervocalicVoicing, macros });
    expect(plan.pending.map((item) => item.word.entry_id)).toEqual(["inherited"]);
    expect(derived.con_word_romanized).toBe("akam");
    expect(borrowed.etymology.origin_type).toBe("borrowed");
  });

  test("all inherited descendants are considered regardless of array order", () => {
    const parent = makeWord("source", "lang_parent", "aka", "water");
    const children = ["first", "second"].map((id) => makeWord(id, "lang_child", "aka", "water", {
      etymology: { ...parent.etymology, origin_type: "evolved", parent_entry_id: "source", source_language_id: "lang_parent" },
    }));
    const plan = computePullSync({ parentLanguageId: "lang_parent", childLanguageId: "lang_child", parentWords: [parent], childWords: children, scaRuleSets: intervocalicVoicing, macros });
    expect(plan.pending.map((item) => item.word.entry_id)).toEqual(["first", "second"]);
  });

  test("a non-inherited record occupying the stable ID produces a conflict", () => {
    const parent = makeWord("source", "lang_parent", "aka", "water");
    const child = makeWord("source", "lang_child", "akam", "water jar", {
      etymology: { ...parent.etymology, origin_type: "derived", parent_entry_id: "source" },
    });
    const plan = computePullSync({ parentLanguageId: "lang_parent", childLanguageId: "lang_child", parentWords: [parent], childWords: [child], scaRuleSets: intervocalicVoicing, macros });
    expect(plan.pending).toEqual([]);
    expect(plan.conflicts).toEqual([{ parentEntryId: "source", childEntryId: "source" }]);
  });

  test("weight-sensitive stress reaches the sound change applier via parentPhono", () => {
    const stressedPhono: PhonologyConfig = {
      language_id: "lang_parent",
      phoneme_inventory: {
        consonants: ["k", "g", "t", "n", "l"],
        vowels: ["a", "ɑ", "i", "u"],
      },
      romanization_maps: [],
      allophony_rules: [],
      phonotactics: {
        macros: { V: ["a", "ɑ", "i", "u"], C: ["k", "g", "t", "n", "l"] },
        syllable_structure: "(C)V(C)",
        blacklist_patterns: [],
        vowel_harmony: { enabled: false, group_a: [], group_b: [] },
        tone_system: { enabled: false, tones: [] },
        stress: {
          position: "weight_sensitive",
          domain: "word",
          weight_fallback: "penultimate",
        },
      },
    };

    const stressBacking: SCARuleSet[] = [
      {
        ruleset_id: "rs_stress",
        name: "Stressed a backing",
        order: 1,
        rules: [
          {
            rule_id: "a_to_alpha_when_stressed",
            description: "a > ɑ / [+stress]",
            target: "",
            replacement: "",
            context_before: "",
            context_after: "",
            exceptions: [],
            feature_mode: true,
            target_features: { positive: ["vowel", "stressed"], negative: [] },
            replacement_features: { set_features: ["back"], remove_features: ["front"] },
            context_before_features: null,
            context_after_features: null,
          },
        ],
      },
    ];

    const parent = makeWord("w_stress", "lang_parent", "aka", "water");

    const withProsody = computePullSync({
      parentLanguageId: "lang_parent",
      childLanguageId: "lang_child",
      parentWords: [parent],
      childWords: [],
      scaRuleSets: stressBacking,
      macros: {},
      parentPhono: stressedPhono,
    });
    // penultimate fallback stresses the first syllable → a → ɑ
    expect(withProsody.pending[0]?.word.con_word_romanized).toBe("ɑka");

    const withoutProsody = computePullSync({
      parentLanguageId: "lang_parent",
      childLanguageId: "lang_child",
      parentWords: [parent],
      childWords: [],
      scaRuleSets: stressBacking,
      macros: {},
    });
    expect(withoutProsody.pending[0]?.word.con_word_romanized).toBe("aka");
  });
});
