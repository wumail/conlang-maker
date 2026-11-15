import { describe, expect, test } from "bun:test";
import type { ConceptDefinition, Etymology, WordEntry } from "../../types";
import { filterAndSearchWords } from "./searchLexicon";

const CONCEPTS: ConceptDefinition[] = [
  { concept_id: "water", gloss_en: "water", gloss_zh: "水", semantic_field: "nature", standard_lists: [] },
  { concept_id: "hold", gloss_en: "hold", gloss_zh: "握", semantic_field: "action", standard_lists: [], aliases: ["拿住", "grasp"] },
];

const CONCEPTS_MAP = new Map(CONCEPTS.map((concept) => [concept.concept_id, concept]));

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

interface WordSeed {
  entryId: string;
  form: string;
  ipa?: string;
  posId?: string;
  gloss: string;
  definitions?: string[];
  examples?: string[];
  usageNote?: string;
  conceptId?: string;
  tags?: string[];
  etymology?: Partial<Etymology>;
  deprecated?: boolean;
}

function word(seed: WordSeed): WordEntry {
  return {
    entry_id: seed.entryId,
    language_id: "lang_1",
    con_word_romanized: seed.form,
    phonetic_ipa: seed.ipa ?? "",
    phonetic_override: false,
    senses: [
      {
        sense_id: `sense_${seed.entryId}`,
        pos_id: seed.posId ?? "noun",
        gloss: seed.gloss,
        definitions: seed.definitions ?? [],
        examples: seed.examples ?? [],
        ...(seed.usageNote ? { usage_note: seed.usageNote } : {}),
        ...(seed.conceptId ? { concept_id: seed.conceptId } : {}),
      },
    ],
    etymology: etymology(seed.etymology ?? {}),
    metadata: { tags: seed.tags ?? [], created_at: "", updated_at: "" },
    ...(seed.deprecated ? { evolution: { is_deprecated: true } as WordEntry["evolution"] } : {}),
  };
}

const WORDS: WordEntry[] = [
  word({ entryId: "w_sui", form: "sui", ipa: "/sui/", gloss: "水", conceptId: "water", tags: ["nature"] }),
  word({ entryId: "w_zov", form: "zov", ipa: "/zov/", gloss: "拿住", definitions: ["to grasp"], conceptId: "hold", posId: "verb" }),
  word({ entryId: "w_tama", form: "tama", gloss: "TBD", tags: ["ritual"] }),
  word({
    entryId: "w_kala",
    form: "kala",
    ipa: "/kala/",
    gloss: "借入词",
    etymology: {
      origin_type: "borrowed",
      borrowed_source: {
        source_language_id: "lang_donor",
        source_entry_id: "entry_donor",
        borrowed_form: "kala",
        borrowed_gloss: "",
      },
    },
  }),
  word({
    entryId: "w_pila",
    form: "pila",
    gloss: "已定借词",
    etymology: {
      origin_type: "borrowed",
      borrowed_source: {
        source_language_id: "lang_donor",
        source_entry_id: "entry_donor_2",
        borrowed_form: "pila",
        borrowed_gloss: "stone",
      },
    },
  }),
  word({ entryId: "w_old", form: "oldu", gloss: "旧词", deprecated: true, examples: ["oldu sen"] }),
];

describe("filterAndSearchWords — searchTerm", () => {
  test("matches romanized form, ipa, gloss, definitions, usage_note and tags", () => {
    expect(filterAndSearchWords(WORDS, { searchTerm: "sui" }).map((w) => w.entry_id)).toEqual(["w_sui"]);
    expect(filterAndSearchWords(WORDS, { searchTerm: "/zov/" }).map((w) => w.entry_id)).toEqual(["w_zov"]);
    expect(filterAndSearchWords(WORDS, { searchTerm: "拿住" }).map((w) => w.entry_id)).toEqual(["w_zov"]);
    expect(filterAndSearchWords(WORDS, { searchTerm: "grasp" }).map((w) => w.entry_id)).toEqual(["w_zov"]);
    expect(filterAndSearchWords(WORDS, { searchTerm: "ritual" }).map((w) => w.entry_id)).toEqual(["w_tama"]);

    const withNote = [
      word({ entryId: "w_note", form: "nota", gloss: "某词", usageNote: "正式语域 formal register" }),
    ];
    expect(filterAndSearchWords(withNote, { searchTerm: "formal" })).toHaveLength(1);
    expect(filterAndSearchWords(withNote, { searchTerm: "正式" })).toHaveLength(1);
  });

  test("matches bound concept gloss_zh / gloss_en / aliases via conceptsMap", () => {
    expect(filterAndSearchWords(WORDS, { searchTerm: "water" }, CONCEPTS_MAP).map((w) => w.entry_id)).toEqual(["w_sui"]);
    expect(filterAndSearchWords(WORDS, { searchTerm: "握" }, CONCEPTS_MAP).map((w) => w.entry_id)).toEqual(["w_zov"]);
    // alias 命中：概念 hold 的别名 grasp
    expect(filterAndSearchWords([word({ entryId: "w_g", form: "ga", gloss: "动词", conceptId: "hold" })], { searchTerm: "grasp" }, CONCEPTS_MAP)).toHaveLength(1);
    // 无 conceptsMap 时不检索概念字段
    expect(filterAndSearchWords(WORDS, { searchTerm: "water" })).toHaveLength(0);
  });

  test("ipaMode restricts the search to phonetic_ipa only", () => {
    expect(filterAndSearchWords(WORDS, { searchTerm: "sui", ipaMode: true }).map((w) => w.entry_id)).toEqual(["w_sui"]);
    // 词形含 "ala" 但 IPA 不含的词不被命中；IPA 检索不看 gloss
    expect(filterAndSearchWords(WORDS, { searchTerm: "水", ipaMode: true })).toHaveLength(0);
    expect(filterAndSearchWords(WORDS, { searchTerm: "/kala", ipaMode: true }).map((w) => w.entry_id)).toEqual(["w_kala"]);
  });

  test("search is case-insensitive and blank terms match everything", () => {
    expect(filterAndSearchWords(WORDS, { searchTerm: "  SUI " }).map((w) => w.entry_id)).toEqual(["w_sui"]);
    expect(filterAndSearchWords(WORDS, { searchTerm: "   " })).toHaveLength(WORDS.length);
  });
});

describe("filterAndSearchWords — field filters", () => {
  test("posId, originType and tag combine with AND semantics", () => {
    expect(filterAndSearchWords(WORDS, { posId: "verb" }).map((w) => w.entry_id)).toEqual(["w_zov"]);
    expect(filterAndSearchWords(WORDS, { originType: "borrowed" }).map((w) => w.entry_id)).toEqual(["w_kala", "w_pila"]);
    expect(filterAndSearchWords(WORDS, { tag: "nature" }).map((w) => w.entry_id)).toEqual(["w_sui"]);
    expect(
      filterAndSearchWords(WORDS, { originType: "borrowed", tag: "nature" }),
    ).toHaveLength(0);
  });
});

describe("filterAndSearchWords — builtin quick filters", () => {
  test("unbound_concept: words whose senses all lack concept_id", () => {
    expect(
      filterAndSearchWords(WORDS, { quickKind: "unbound_concept" }).map((w) => w.entry_id),
    ).toEqual(["w_tama", "w_kala", "w_pila", "w_old"]);
  });

  test("missing_examples: words whose senses all have empty examples", () => {
    expect(
      filterAndSearchWords(WORDS, { quickKind: "missing_examples" }).map((w) => w.entry_id),
    ).toEqual(["w_sui", "w_zov", "w_tama", "w_kala", "w_pila"]);
  });

  test("tbd_gloss: any sense gloss contains TBD (case-insensitive) or ?", () => {
    const extra = [
      word({ entryId: "w_q", form: "que", gloss: "待定?" }),
      word({ entryId: "w_ok", form: "oka", gloss: "确定" }),
    ];
    expect(
      filterAndSearchWords([...WORDS, ...extra], { quickKind: "tbd_gloss" }).map((w) => w.entry_id),
    ).toEqual(["w_tama", "w_q"]);
  });

  test("borrowed_needs_review: borrowed without snapshot or with empty borrowed_gloss", () => {
    const legacyBorrow = word({
      entryId: "w_legacy",
      form: "legac",
      gloss: "旧借词",
      etymology: { origin_type: "borrowed", parent_entry_id: "some_parent" },
    });
    expect(
      filterAndSearchWords([...WORDS, legacyBorrow], { quickKind: "borrowed_needs_review" }).map((w) => w.entry_id),
    ).toEqual(["w_kala", "w_legacy"]);
  });

  test("deprecated: evolution.is_deprecated is true", () => {
    expect(
      filterAndSearchWords(WORDS, { quickKind: "deprecated" }).map((w) => w.entry_id),
    ).toEqual(["w_old"]);
  });

  test("quick filter combines with searchTerm", () => {
    expect(
      filterAndSearchWords(WORDS, { quickKind: "borrowed_needs_review", searchTerm: "kala" }).map((w) => w.entry_id),
    ).toEqual(["w_kala"]);
  });
});
