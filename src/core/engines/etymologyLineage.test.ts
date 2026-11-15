import { describe, expect, test } from "bun:test";
import type { LanguageEntry, WordEntry } from "../../types";
import { buildEtymologyLineage } from "./etymologyLineage";

const LANGUAGES: LanguageEntry[] = [
  { language_id: "lang_proto", name: "Proto", path: "proto", parent_id: null },
  { language_id: "lang_middle", name: "Middle", path: "middle", parent_id: "lang_proto" },
  { language_id: "lang_modern", name: "Modern", path: "modern", parent_id: "lang_middle" },
  { language_id: "lang_island", name: "Island", path: "island", parent_id: null },
];

function makeWord(
  entryId: string,
  languageId: string,
  romanized: string,
  gloss: string,
  etymologyOverrides?: Partial<WordEntry["etymology"]>,
  extra?: Partial<WordEntry>,
): WordEntry {
  return {
    entry_id: entryId,
    language_id: languageId,
    con_word_romanized: romanized,
    phonetic_ipa: `/${romanized}/`,
    phonetic_override: false,
    senses: [
      {
        sense_id: `sense_${entryId}`,
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
      ...etymologyOverrides,
    },
    metadata: { tags: [], created_at: "2026-01-01", updated_at: "2026-01-01" },
    ...extra,
  };
}

function dictOf(words: WordEntry[]): Record<string, WordEntry> {
  return Object.fromEntries(words.map((w) => [w.entry_id, w]));
}

describe("buildEtymologyLineage — 历时继承链", () => {
  test("三代继承：modern ← middle ← proto，逐步展示词形与音变", () => {
    const proto = makeWord("w_proto", "lang_proto", "kapa", "stone");
    const middle = makeWord("w_middle", "lang_middle", "kafa", "stone", {
      origin_type: "evolved",
      parent_entry_id: "w_proto",
      source_language_id: "lang_proto",
      applied_sound_changes: ["rule_p_f"],
      semantic_change_kind: "narrowing",
      semantic_shift_note: "仅指建筑材料",
    });
    const modern = makeWord("w_modern", "lang_modern", "kava", "stone", {
      origin_type: "evolved",
      parent_entry_id: "w_middle",
      source_language_id: "lang_middle",
      applied_sound_changes: ["rule_f_v"],
    });

    const result = buildEtymologyLineage({
      word: modern,
      activeLanguageId: "lang_modern",
      languages: LANGUAGES,
      wordsByLanguage: {
        lang_proto: dictOf([proto]),
        lang_middle: dictOf([middle]),
        lang_modern: dictOf([modern]),
      },
    });

    expect(result.hasBrokenLinks).toBe(false);
    expect(result.brokenLinks).toEqual([]);
    expect(result.nodes.map((n) => n.stepKind)).toEqual([
      "self",
      "inherited",
      "inherited",
    ]);
    expect(result.nodes[0]).toMatchObject({
      entryId: "w_modern",
      romanized: "kava",
      languageName: "Modern",
      appliedSoundChanges: ["rule_f_v"],
    });
    expect(result.nodes[1]).toMatchObject({
      entryId: "w_middle",
      romanized: "kafa",
      languageName: "Middle",
      appliedSoundChanges: ["rule_p_f"],
      semanticChangeKind: "narrowing",
      semanticShiftNote: "仅指建筑材料",
    });
    expect(result.nodes[2]).toMatchObject({
      entryId: "w_proto",
      romanized: "kapa",
      languageName: "Proto",
      originType: "a_priori",
    });
  });

  test("source_language_id 为空时回退到当前语言的 parent_id", () => {
    const proto = makeWord("w_proto", "lang_proto", "kapa", "stone");
    const middle = makeWord("w_proto", "lang_middle", "kafa", "stone", {
      origin_type: "evolved",
      parent_entry_id: "w_proto",
      source_language_id: null,
    });

    const result = buildEtymologyLineage({
      word: middle,
      activeLanguageId: "lang_middle",
      languages: LANGUAGES,
      wordsByLanguage: {
        lang_proto: dictOf([proto]),
        lang_middle: dictOf([middle]),
      },
    });

    expect(result.hasBrokenLinks).toBe(false);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[1]).toMatchObject({
      stepKind: "inherited",
      languageId: "lang_proto",
      entryId: "w_proto",
    });
  });
});

describe("buildEtymologyLineage — 本语言复合词", () => {
  test("compound 成分解析为可点击节点，affix 成分取 surface_override", () => {
    const root = makeWord("w_fire", "lang_modern", "afa", "fire");
    const head = makeWord("w_house", "lang_modern", "kasa", "house");
    const compound = makeWord("w_firehouse", "lang_modern", "afakasa", "firehouse", {
      origin_type: "compound",
      parent_entry_id: null,
      components: [
        { entry_id: "w_fire", relation: "root" },
        { entry_id: "w_house", relation: "head" },
        {
          relation: "affix",
          derivation_rule_id: "rule_dim",
          surface_override: "-ta",
        },
      ],
    });

    const result = buildEtymologyLineage({
      word: compound,
      activeLanguageId: "lang_modern",
      languages: LANGUAGES,
      wordsByLanguage: { lang_modern: dictOf([root, head, compound]) },
    });

    expect(result.hasBrokenLinks).toBe(false);
    const self = result.nodes[0]!;
    expect(self.stepKind).toBe("self");
    expect(self.originType).toBe("compound");
    expect(self.components).toEqual([
      { relation: "root", entryId: "w_fire", surface: "afa", gloss: "fire", broken: false },
      { relation: "head", entryId: "w_house", surface: "kasa", gloss: "house", broken: false },
      { relation: "affix", derivationRuleId: "rule_dim", surface: "-ta", broken: false },
    ]);
    // 词根/中心语生成可点击的 component 链路节点；纯词缀不生成
    expect(result.nodes.map((n) => [n.stepKind, n.entryId])).toEqual([
      ["self", "w_firehouse"],
      ["component", "w_fire"],
      ["component", "w_house"],
    ]);
  });

  test("成分缺失 entry_id 时记入 brokenLinks（kind: component）", () => {
    const compound = makeWord("w_c", "lang_modern", "ab", "x", {
      origin_type: "compound",
      components: [
        { entry_id: "w_missing", relation: "root" },
        { entry_id: "w_ok", relation: "head" },
      ],
    });
    const ok = makeWord("w_ok", "lang_modern", "b", "y");

    const result = buildEtymologyLineage({
      word: compound,
      activeLanguageId: "lang_modern",
      languages: LANGUAGES,
      wordsByLanguage: { lang_modern: dictOf([ok, compound]) },
    });

    expect(result.hasBrokenLinks).toBe(true);
    expect(result.brokenLinks).toEqual([
      { kind: "component", missingId: "w_missing", languageId: "lang_modern" },
    ]);
    const brokenComponent = result.nodes[0]!.components![0]!;
    expect(brokenComponent.broken).toBe(true);
    expect(brokenComponent.surface).toBe("?w_missing");
  });
});

describe("buildEtymologyLineage — 借词与跨项目快照", () => {
  function makeBorrowed(overrides?: Partial<WordEntry["etymology"]>): WordEntry {
    return makeWord("w_loan", "lang_modern", "sula", "moon", {
      origin_type: "borrowed",
      parent_entry_id: null,
      source_language_id: "lang_island",
      borrowed_source: {
        source_conlang_path: "/other/project/workspace.conlang",
        source_family_name: "Other Family",
        source_language_id: "lang_island",
        source_language_name: "Island",
        source_entry_id: "w_donor",
        source_sense_id: "sense_w_donor",
        borrowed_form: "sula",
        borrowed_ipa: "/sula/",
        borrowed_gloss: "moon",
      },
      ...overrides,
    });
  }

  test("供语词条存在时关联实时状态并继续向上追溯", () => {
    const donorParent = makeWord("w_donor_parent", "lang_proto", "suna", "moon");
    const donor = makeWord("w_donor", "lang_island", "sula", "moon", {
      origin_type: "evolved",
      parent_entry_id: "w_donor_parent",
      source_language_id: "lang_proto",
    });
    const loan = makeBorrowed();

    const result = buildEtymologyLineage({
      word: loan,
      activeLanguageId: "lang_modern",
      languages: LANGUAGES,
      wordsByLanguage: {
        lang_proto: dictOf([donorParent]),
        lang_island: dictOf([donor]),
        lang_modern: dictOf([loan]),
      },
    });

    expect(result.hasBrokenLinks).toBe(false);
    expect(result.nodes.map((n) => n.stepKind)).toEqual([
      "self",
      "borrowed",
      "inherited",
    ]);
    const borrowedNode = result.nodes[1]!;
    expect(borrowedNode).toMatchObject({
      languageId: "lang_island",
      entryId: "w_donor",
      romanized: "sula", // 实时词形
    });
    expect(borrowedNode.borrowedSnapshot?.source_family_name).toBe("Other Family");
    expect(result.nodes[2]).toMatchObject({
      stepKind: "inherited",
      entryId: "w_donor_parent",
      romanized: "suna",
    });
  });

  test("供语词条删除后快照仍可读（broken:false，donor_removed_snapshot_kept）", () => {
    const loan = makeBorrowed();
    const result = buildEtymologyLineage({
      word: loan,
      activeLanguageId: "lang_modern",
      languages: LANGUAGES,
      wordsByLanguage: {
        // lang_island 词典缺失（供语词条已被删除或属于跨项目）
        lang_modern: dictOf([loan]),
      },
    });

    expect(result.hasBrokenLinks).toBe(false);
    expect(result.brokenLinks).toEqual([]);
    expect(result.nodes).toHaveLength(2);
    const borrowedNode = result.nodes[1]!;
    expect(borrowedNode).toMatchObject({
      stepKind: "borrowed",
      broken: false,
      brokenReason: "donor_removed_snapshot_kept",
      romanized: "sula",
      gloss: "moon",
      languageName: "Island",
    });
    expect(borrowedNode.borrowedSnapshot?.source_entry_id).toBe("w_donor");
  });

  test("既无快照又无有效引用时 broken:true 并定位缺失 ID", () => {
    const loan = makeWord("w_loan", "lang_modern", "sula", "moon", {
      origin_type: "borrowed",
      parent_entry_id: "w_ghost",
      source_language_id: "lang_island",
    });

    const result = buildEtymologyLineage({
      word: loan,
      activeLanguageId: "lang_modern",
      languages: LANGUAGES,
      wordsByLanguage: { lang_modern: dictOf([loan]) },
    });

    expect(result.hasBrokenLinks).toBe(true);
    expect(result.brokenLinks).toEqual([
      { kind: "borrowed", missingId: "w_ghost", languageId: "lang_island" },
    ]);
    const borrowedNode = result.nodes[1]!;
    expect(borrowedNode.broken).toBe(true);
    expect(borrowedNode.brokenReason).toBe("missing_borrowed_source");
  });

  test("无快照但旧版引用可解析时仍能展示供语实时状态", () => {
    const donor = makeWord("w_donor", "lang_island", "sula", "moon");
    const loan = makeWord("w_loan", "lang_modern", "sula", "moon", {
      origin_type: "borrowed",
      parent_entry_id: "w_donor",
      source_language_id: "lang_island",
    });

    const result = buildEtymologyLineage({
      word: loan,
      activeLanguageId: "lang_modern",
      languages: LANGUAGES,
      wordsByLanguage: {
        lang_island: dictOf([donor]),
        lang_modern: dictOf([loan]),
      },
    });

    expect(result.hasBrokenLinks).toBe(false);
    expect(result.nodes[1]).toMatchObject({
      stepKind: "borrowed",
      entryId: "w_donor",
      romanized: "sula",
    });
  });
});

describe("buildEtymologyLineage — 环路与断链", () => {
  test("环路防护：A→B→A 不死循环且不重复节点", () => {
    const a = makeWord("w_a", "lang_modern", "a", "a", {
      origin_type: "evolved",
      parent_entry_id: "w_b",
      source_language_id: "lang_proto",
    });
    const b = makeWord("w_b", "lang_proto", "b", "b", {
      origin_type: "evolved",
      parent_entry_id: "w_a",
      source_language_id: "lang_modern",
    });

    const result = buildEtymologyLineage({
      word: a,
      activeLanguageId: "lang_modern",
      languages: LANGUAGES,
      wordsByLanguage: {
        lang_proto: dictOf([b]),
        lang_modern: dictOf([a]),
      },
    });

    expect(result.nodes.map((n) => n.entryId)).toEqual(["w_a", "w_b"]);
    expect(result.hasBrokenLinks).toBe(false);
  });

  test("继承断链定位：parent_entry_id 缺失与指向不存在词条", () => {
    const missingRef = makeWord("w_m1", "lang_modern", "x", "x", {
      origin_type: "evolved",
      parent_entry_id: "w_ghost",
      source_language_id: "lang_proto",
    });
    const r1 = buildEtymologyLineage({
      word: missingRef,
      activeLanguageId: "lang_modern",
      languages: LANGUAGES,
      wordsByLanguage: { lang_modern: dictOf([missingRef]) },
    });
    expect(r1.hasBrokenLinks).toBe(true);
    expect(r1.brokenLinks).toEqual([
      { kind: "parent", missingId: "w_ghost", languageId: "lang_proto" },
    ]);
    expect(r1.nodes[1]).toMatchObject({
      broken: true,
      brokenReason: "missing_parent_entry",
      romanized: "?w_ghost",
    });

    const noRef = makeWord("w_m2", "lang_modern", "y", "y", {
      origin_type: "evolved",
      parent_entry_id: null,
      source_language_id: "lang_proto",
    });
    const r2 = buildEtymologyLineage({
      word: noRef,
      activeLanguageId: "lang_modern",
      languages: LANGUAGES,
      wordsByLanguage: { lang_modern: dictOf([noRef]) },
    });
    expect(r2.brokenLinks).toEqual([
      { kind: "parent", missingId: "", languageId: "lang_proto" },
    ]);
    expect(r2.nodes[1]).toMatchObject({
      broken: true,
      brokenReason: "missing_parent_entry_id",
    });
  });

  test("复合词成分自指环路不死循环", () => {
    const selfRef = makeWord("w_self", "lang_modern", "ab", "x", {
      origin_type: "compound",
      components: [{ entry_id: "w_self", relation: "root" }],
    });
    const result = buildEtymologyLineage({
      word: selfRef,
      activeLanguageId: "lang_modern",
      languages: LANGUAGES,
      wordsByLanguage: { lang_modern: dictOf([selfRef]) },
    });
    expect(result.nodes.map((n) => n.entryId)).toEqual(["w_self"]);
    expect(result.hasBrokenLinks).toBe(false);
  });
});
