import { describe, expect, test } from "bun:test";
import type {
  BorrowedSourceSnapshot,
  ConceptDefinition,
  Etymology,
  LanguageEntry,
  LexicalGap,
  PrimaryCognateOverride,
  WordEntry,
} from "../../types";
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
  { concept_id: "hand", gloss_en: "hand", gloss_zh: "手", semantic_field: "body", standard_lists: [] },
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
    ipa?: string;
    etymology?: Partial<Etymology>;
    deprecated?: boolean;
    senses?: Array<{ gloss: string; conceptId: string | null }>;
    semanticChangeKind?: Etymology["semantic_change_kind"];
  } = {},
): WordEntry {
  const senseSeeds =
    options.senses ??
    (conceptId !== null ? [{ gloss: conceptId, conceptId }] : []);
  return {
    entry_id: entryId,
    language_id: languageId,
    con_word_romanized: options.form ?? entryId,
    phonetic_ipa: options.ipa ?? "",
    phonetic_override: false,
    senses: senseSeeds.map((seed, index) => ({
      sense_id: `sense_${entryId}_${index}`,
      pos_id: "noun",
      gloss: seed.gloss,
      definitions: [],
      examples: [],
      ...(seed.conceptId ? { concept_id: seed.conceptId } : {}),
    })),
    etymology: etymology({
      ...(options.etymology ?? {}),
      ...(options.semanticChangeKind
        ? { semantic_change_kind: options.semanticChangeKind }
        : {}),
    }),
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

  test("merges descendants of a borrowed ancestor into one borrowed cognate set", () => {
    const family: LanguageEntry[] = [
      { language_id: "lang_p", name: "Proto", path: "roots/p", parent_id: null },
      { language_id: "lang_c1", name: "C1", path: "branches/c1", parent_id: "lang_p" },
      { language_id: "lang_c2", name: "C2", path: "branches/c2", parent_id: "lang_p" },
      { language_id: "lang_c3", name: "C3", path: "branches/c3", parent_id: "lang_p" },
    ];
    const result = buildCognateMatrix({
      languages: family,
      concepts: CONCEPTS,
      wordsByLanguage: {
        // 父语言从外部借入该词，自身没有本语系词根
        lang_p: [
          word("p_water", "lang_p", "water", {
            form: "watar",
            etymology: { origin_type: "borrowed", source_language_id: "lang_donor" },
          }),
        ],
        lang_c1: [
          word("c1_water", "lang_c1", "water", {
            etymology: { origin_type: "evolved", parent_entry_id: "p_water" },
          }),
        ],
        lang_c2: [
          word("c2_water", "lang_c2", "water", {
            etymology: { origin_type: "evolved", parent_entry_id: "p_water" },
          }),
        ],
        lang_c3: [
          word("c3_water", "lang_c3", "water", {
            etymology: { origin_type: "evolved", parent_entry_id: "p_water" },
          }),
        ],
      },
    });

    const row = result.rows.find((item) => item.conceptId === "water")!;
    // 父借入 + 3 子继承 → 4 门语言共享同一个借词源同源组
    expect(row.cells.every((cell) => cell.cognateSetId === "borrowed::lang_p::p_water")).toBe(true);
    expect(row.cells.every((cell) => cell.kind === "borrowed")).toBe(true);
    expect(row.cognateSetCount).toBe(1);
    expect(result.stats.borrowedCount).toBe(4);
    expect(result.stats.innovationCount).toBe(0);
  });

  test("groups repeated borrowings from the same donor snapshot into one set", () => {
    const snapshot: BorrowedSourceSnapshot = {
      source_language_id: "lang_donor",
      source_entry_id: "entry_donor_fire",
      borrowed_form: "fajr",
    };
    const family: LanguageEntry[] = [
      { language_id: "lang_x", name: "X", path: "branches/x", parent_id: null },
      { language_id: "lang_y", name: "Y", path: "branches/y", parent_id: null },
    ];
    const result = buildCognateMatrix({
      languages: family,
      concepts: CONCEPTS,
      wordsByLanguage: {
        lang_x: [
          word("x_fire", "lang_x", "fire", {
            etymology: { origin_type: "borrowed", borrowed_source: snapshot },
          }),
        ],
        lang_y: [
          word("y_fire", "lang_y", "fire", {
            etymology: { origin_type: "borrowed", borrowed_source: snapshot },
          }),
        ],
      },
    });

    const row = result.rows.find((item) => item.conceptId === "fire")!;
    expect(row.cells.every((cell) => cell.kind === "borrowed")).toBe(true);
    expect(row.cells.every((cell) => cell.cognateSetId === "borrowed::lang_donor::entry_donor_fire")).toBe(true);
    expect(row.cognateSetCount).toBe(1);
    expect(result.stats.borrowedCount).toBe(2);
  });

  test("treats derived and compound words as innovation without false broken chains", () => {
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: {
        lang_root: [word("root_fire", "lang_root", "fire", { form: "fajr" })],
        lang_a: [
          // derived / compound 即使遗留了 parent_entry_id（旧数据脏字段）也不上溯、不报断链
          word("a_fire_derived", "lang_a", "fire", {
            form: "fajras",
            etymology: {
              origin_type: "derived",
              parent_entry_id: "root_fire",
            },
          }),
        ],
        lang_b: [
          word("b_fire_compound", "lang_b", "fire", {
            form: "fajrum",
            etymology: {
              origin_type: "compound",
              parent_entry_id: null,
            },
          }),
        ],
      },
    });

    expect(result.stats.brokenChainCount).toBe(0);
    const row = result.rows.find((item) => item.conceptId === "fire")!;
    const byLang = new Map(row.cells.map((cell) => [cell.languageId, cell]));
    const derivedCell = byLang.get("lang_a")!;
    expect(derivedCell.kind).toBe("innovation");
    expect(derivedCell.innovationKind).toBe("derived");
    expect(derivedCell.brokenChain).toBeUndefined();
    expect(derivedCell.cognateSetId).toBe("innovation::lang_a::a_fire_derived");
    const compoundCell = byLang.get("lang_b")!;
    expect(compoundCell.kind).toBe("innovation");
    expect(compoundCell.innovationKind).toBe("compound");
    expect(byLang.get("lang_root")?.kind).toBe("inherited");
  });

  test("records broken chains when an evolved parent entry is missing", () => {
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
    const cell = row.cells.find((c) => c.languageId === "lang_a")!;
    expect(cell.cognateSetId).toBe("lang_a::a_water");
    expect(cell.brokenChain).toBe(true);
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
    expect(row.cells[0]?.candidates).toHaveLength(2);
    expect(row.cells[0]?.primaryReason).toBe("auto_rank");
  });

  test("auto rank prefers alive words, then evolved inheritors, then romanized order", () => {
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: {
        lang_a: [
          word("zeta", "lang_a", "water", {
            form: "zeta",
            etymology: { origin_type: "evolved", parent_entry_id: "root_water" },
            deprecated: true,
          }),
          word("alpha_new", "lang_a", "water", { form: "alpha", etymology: { origin_type: "a_priori" } }),
          word("beta_evo", "lang_a", "water", {
            form: "beta",
            etymology: { origin_type: "evolved", parent_entry_id: "root_water" },
          }),
        ],
      },
    });
    const row = result.rows.find((item) => item.conceptId === "water")!;
    const cell = row.cells.find((c) => c.languageId === "lang_a")!;
    // 废弃词出局；存活词中 evolved 继承词优先于 a_priori 创新词
    expect(cell.entryId).toBe("beta_evo");
    expect(cell.primaryReason).toBe("auto_rank");
  });

  test("manual primary override wins over auto ranking", () => {
    const overrides: PrimaryCognateOverride[] = [
      {
        language_id: "lang_a",
        concept_id: "water",
        entry_id: "alpha_new",
        reason: "frequency",
      },
    ];
    const words = {
      lang_a: [
        word("beta_evo", "lang_a", "water", {
          form: "beta",
          etymology: { origin_type: "evolved", parent_entry_id: "root_water" },
        }),
        word("alpha_new", "lang_a", "water", { form: "alpha", etymology: { origin_type: "a_priori" } }),
      ],
    };

    const withoutOverride = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: words,
    });
    const autoCell = withoutOverride.rows
      .find((item) => item.conceptId === "water")!
      .cells.find((c) => c.languageId === "lang_a")!;
    expect(autoCell.entryId).toBe("beta_evo");
    expect(autoCell.primaryReason).toBe("auto_rank");

    const withOverride = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: words,
      primaryOverrides: overrides,
    });
    const cell = withOverride.rows
      .find((item) => item.conceptId === "water")!
      .cells.find((c) => c.languageId === "lang_a")!;
    expect(cell.entryId).toBe("alpha_new");
    expect(cell.primaryReason).toBe("manual_override");
    const pinned = cell.candidates.find((c) => c.entryId === "alpha_new")!;
    expect(pinned.isPinnedPrimary).toBe(true);
    expect(cell.candidates.find((c) => c.entryId === "beta_evo")!.isPinnedPrimary).toBe(false);
  });

  test("marks form/meaning change of inherited words against the traced root", () => {
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: {
        lang_root: [word("root_water", "lang_root", "water", { form: "watar" })],
        lang_a: [
          word("a_water", "lang_a", "water", {
            form: "wadar",
            etymology: {
              origin_type: "evolved",
              parent_entry_id: "root_water",
              semantic_change_kind: "narrowing",
              semantic_shift_note: "",
            },
          }),
        ],
        lang_b: [
          word("b_water", "lang_b", "water", {
            form: "watar",
            etymology: {
              origin_type: "evolved",
              parent_entry_id: "root_water",
              semantic_shift_note: "",
            },
          }),
        ],
      },
    });
    const row = result.rows.find((item) => item.conceptId === "water")!;
    const cellA = row.cells.find((c) => c.languageId === "lang_a")!;
    expect(cellA.formChangedFromRoot).toBe(true);
    expect(cellA.meaningChangedFromRoot).toBe(true);
    const cellB = row.cells.find((c) => c.languageId === "lang_b")!;
    expect(cellB.formChangedFromRoot).toBe(false);
    expect(cellB.meaningChangedFromRoot).toBe(false);
    const cellRoot = row.cells.find((c) => c.languageId === "lang_root")!;
    expect(cellRoot.formChangedFromRoot).toBe(false);
  });

  test("exposes sense-level candidates for multi-sense entries like zov", () => {
    const zov = word("zov", "lang_a", null, {
      form: "zov",
      senses: [
        { gloss: "五", conceptId: "five" },
        { gloss: "hand", conceptId: "hand" },
        { gloss: "拿住", conceptId: "hold" },
      ],
    });
    const concepts: ConceptDefinition[] = [
      { concept_id: "five", gloss_en: "five", gloss_zh: "五", semantic_field: "quantity", standard_lists: [] },
      { concept_id: "hand", gloss_en: "hand", gloss_zh: "手", semantic_field: "body", standard_lists: [] },
      { concept_id: "hold", gloss_en: "hold", gloss_zh: "握", semantic_field: "action", standard_lists: [], aliases: ["拿住"] },
    ];
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts,
      wordsByLanguage: { lang_a: [zov] },
    });

    const fiveCell = result.rows.find((r) => r.conceptId === "five")!.cells.find((c) => c.languageId === "lang_a")!;
    expect(fiveCell.candidates).toHaveLength(1);
    expect(fiveCell.candidates[0]?.senseId).toBe("sense_zov_0");
    expect(fiveCell.candidates[0]?.senseGloss).toBe("五");

    const handCell = result.rows.find((r) => r.conceptId === "hand")!.cells.find((c) => c.languageId === "lang_a")!;
    expect(handCell.candidates[0]?.senseId).toBe("sense_zov_1");

    const holdCell = result.rows.find((r) => r.conceptId === "hold")!.cells.find((c) => c.languageId === "lang_a")!;
    expect(holdCell.candidates[0]?.senseId).toBe("sense_zov_2");
  });

  test("empty cells carry lexical gap and load failure states", () => {
    const gaps: LexicalGap[] = [
      { language_id: "lang_b", concept_id: "water", status: "periphrastic", note: "用短语「大水」表达" },
    ];
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: { lang_root: [word("root_water", "lang_root", "water")] },
      lexicalGaps: gaps,
      failedLanguageIds: ["lang_a1"],
    });
    const row = result.rows.find((item) => item.conceptId === "water")!;
    const gapCell = row.cells.find((c) => c.languageId === "lang_b")!;
    expect(gapCell.kind).toBe("empty");
    expect(gapCell.gap?.status).toBe("periphrastic");
    expect(gapCell.gap?.note).toBe("用短语「大水」表达");
    const failedCell = row.cells.find((c) => c.languageId === "lang_a1")!;
    expect(failedCell.loadFailed).toBe(true);
    expect(failedCell.gap).toBeUndefined();
    const plainCell = row.cells.find((c) => c.languageId === "lang_a")!;
    expect(plainCell.loadFailed).toBeUndefined();
    expect(plainCell.gap).toBeUndefined();
  });

  test("comparisonFilter keeps only rows with the targeted phenomenon", () => {
    const words = {
      lang_root: [
        word("root_water", "lang_root", "water", { form: "watar" }),
        word("root_fire", "lang_root", "fire", { form: "fajr" }),
        word("root_hand", "lang_root", "hand", { form: "mana" }),
      ],
      lang_a: [
        word("a_water", "lang_a", "water", {
          form: "wadar",
          etymology: { origin_type: "evolved", parent_entry_id: "root_water" },
        }),
        word("a_fire", "lang_a", "fire", {
          etymology: { origin_type: "borrowed", borrowed_source: {
            source_language_id: "lang_donor",
            source_entry_id: "entry_donor_fire",
            borrowed_form: "fajr",
          } },
        }),
        word("a_hand", "lang_a", "hand", {
          form: "mana",
          etymology: { origin_type: "evolved", parent_entry_id: "root_hand" },
        }),
      ],
      lang_b: [
        word("b_hand", "lang_b", "hand", { form: "manar" }),
      ],
    };

    const all = buildCognateMatrix({ languages: LANGUAGES, concepts: CONCEPTS, wordsByLanguage: words });
    expect(all.rows.map((r) => r.conceptId)).toEqual(["hand", "fire", "water"]);

    const borrowed = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: words,
      comparisonFilter: "borrowing_replacement",
    });
    expect(borrowed.rows.map((r) => r.conceptId)).toEqual(["fire"]);

    const formChanged = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: words,
      comparisonFilter: "form_changed",
    });
    // hand: a_hand 与 root_hand 同形未变；water: a_water 词形改变
    expect(formChanged.rows.map((r) => r.conceptId)).toEqual(["water"]);

    const broken = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: {
        ...words,
        lang_a: [
          ...words.lang_a.slice(0, 2),
          word("a_hand", "lang_a", "hand", {
            form: "mana",
            etymology: { origin_type: "evolved", parent_entry_id: "missing_hand" },
          }),
        ],
      },
      comparisonFilter: "broken_chain",
    });
    expect(broken.rows.map((r) => r.conceptId)).toEqual(["hand"]);

    const multi = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: {
        ...words,
        lang_b: [...words.lang_b, word("b_hand_2", "lang_b", "hand", { form: "manar2" })],
      },
      comparisonFilter: "multi_candidate",
    });
    expect(multi.rows.map((r) => r.conceptId)).toEqual(["hand"]);
  });

  test("reports totalMatchedConcepts before truncation and unbound word counts", () => {
    const concepts: ConceptDefinition[] = CONCEPTS;
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts,
      wordsByLanguage: {
        lang_root: [
          word("root_water", "lang_root", "water"),
          word("root_unbound", "lang_root", null, { senses: [{ gloss: "孤儿词", conceptId: null }] }),
        ],
        lang_a: [word("a_fire", "lang_a", "fire")],
      },
      maxRows: 1,
      onlyFilled: true,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.totalMatchedConcepts).toBe(2);
    expect(result.stats.conceptCount).toBe(1);
    expect(result.unboundWordCounts).toEqual({
      lang_root: 1,
      lang_a: 0,
      lang_b: 0,
      lang_a1: 0,
    });
  });

  test("survives accidental cycles in evolved parent links", () => {
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: {
        lang_root: [
          word("root_water", "lang_root", "water", {
            etymology: { origin_type: "evolved", parent_entry_id: "a_water" },
          }),
        ],
        lang_a: [
          word("a_water", "lang_a", "water", {
            etymology: { origin_type: "evolved", parent_entry_id: "root_water" },
          }),
        ],
      },
    });
    expect(result.stats.brokenChainCount).toBeGreaterThanOrEqual(1);
    expect(result.rows.find((row) => row.conceptId === "water")).toBeDefined();
  });

  test("non-evolved words with legacy parent_entry_id never trace or break", () => {
    const result = buildCognateMatrix({
      languages: LANGUAGES,
      concepts: CONCEPTS,
      wordsByLanguage: {
        lang_a: [
          word("a_water", "lang_a", "water", {
            etymology: { origin_type: "a_posteriori", parent_entry_id: "ghost" },
          }),
        ],
      },
    });
    expect(result.stats.brokenChainCount).toBe(0);
    const cell = result.rows.find((r) => r.conceptId === "water")!.cells.find((c) => c.languageId === "lang_a")!;
    expect(cell.kind).toBe("innovation");
    expect(cell.innovationKind).toBe("root");
  });
});

describe("cognateColor", () => {
  test("cycles through the palette and returns null for empty cells", () => {
    expect(cognateColor(0)).not.toBeNull();
    expect(cognateColor(0)).toBe(cognateColor(8));
    expect(cognateColor(null)).toBeNull();
  });
});
