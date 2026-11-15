/**
 * cognateMatrix.ts — 全语系同源词矩阵引擎
 *
 * 沿 `etymology.parent_entry_id` 逐代上溯到最终祖语词根，把共享同一词根的
 * 单元格归入同一个 `cognateSetId`；借词与独立创新各自成组，便于一眼看出
 * 哪几支保留了同源词、哪支发生了借用或创新。
 *
 * Roadmap v3 / Pillar 5：
 * - `traceRoot` 仅对 `origin_type === "evolved"` 的词沿 `parent_entry_id` 上溯；
 *   `derived` / `compound` 是本语言共时构词创新（innovation），不再误报断链；
 * - 借词优先读取 `borrowed_source` 快照归组（同一供语词条的多次借入共享同源组）；
 * - 单元格携带全部义项级候选（`candidates`）、词汇空缺（`gap`）、加载失败
 *   （`loadFailed`）与主词选择依据（`primaryReason`）；
 * - 支持历时比较筛选（借词替换 / 词形音变 / 多候选竞争 / 词源断链）。
 */
import type {
  ConceptDefinition,
  LanguageEntry,
  LexicalGap,
  OriginType,
  PrimaryCognateOverride,
  WordEntry,
} from "../../types";
import { SEMANTIC_FIELDS, type SemanticField } from "../../data/core_concepts";

export type CognateCellKind = "inherited" | "borrowed" | "innovation" | "empty";

/** 单元格候选：精确到「词条 × 义项」（Roadmap v3 / Pillar 5） */
export interface CognateCellCandidate {
  entryId: string;
  senseId: string;
  romanized: string;
  ipa: string;
  senseGloss: string;
  posId: string;
  originType: OriginType;
  tags: string[];
  isDeprecated: boolean;
  isPinnedPrimary: boolean;
}

export interface CognateMatrixCell {
  languageId: string;
  entryId: string | null;
  form: string;
  ipa: string;
  kind: CognateCellKind;
  cognateSetId: string | null;
  /** 同源组在本行内的序号（0 起，用于配色）；空单元格为 null */
  cognateIndex: number | null;
  /** 该语言在该概念下的同形变体数（>1 时 UI 显示 +n） */
  variants: number;
  /** 该概念下该语言的全部候选（含具体义项），空单元格为空数组 */
  candidates: CognateCellCandidate[];
  /** 已记录的词汇空缺状态（仅无候选的单元格携带） */
  gap?: LexicalGap;
  /** 该语言词典加载失败（区别于真正的「尚未收录」） */
  loadFailed?: boolean;
  /** 主词选择依据："manual_override"（人工指定）或 "auto_rank"（自动排序） */
  primaryReason?: "manual_override" | "auto_rank";
  /** innovation 单元格的构词类型：共时派生 / 复合 / 原始创新 */
  innovationKind?: "derived" | "compound" | "root";
  /** 继承词相对词根是否发生词形（音变）变化 */
  formChangedFromRoot?: boolean;
  /** 继承词相对词根是否发生语义变化 */
  meaningChangedFromRoot?: boolean;
  /** 上溯途中父词条缺失导致断链（仅 evolved 链条才可能为 true） */
  brokenChain?: boolean;
}

/** 兼容别名：PRD/执行计划中的 `CognateCell` 即本接口 */
export type CognateCell = CognateMatrixCell;

export interface CognateMatrixRow {
  conceptId: string;
  glossZh: string;
  glossEn: string;
  semanticField: string;
  cells: CognateMatrixCell[];
  filled: number;
  cognateSetCount: number;
}

export interface CognateMatrixLanguage {
  languageId: string;
  name: string;
  parentId: string | null;
  depth: number;
}

export interface CognateMatrixStats {
  conceptCount: number;
  cellCount: number;
  filledCount: number;
  cognateSetCount: number;
  borrowedCount: number;
  innovationCount: number;
  /** 祖先词条缺失导致上溯中断的次数 */
  brokenChainCount: number;
}

export interface CognateMatrixResult {
  rows: CognateMatrixRow[];
  languages: CognateMatrixLanguage[];
  stats: CognateMatrixStats;
  /** 截断（maxRows）前匹配的概念总数（含 onlyFilled / comparisonFilter 筛选） */
  totalMatchedConcepts: number;
  /** 各语言没有任何义项绑定 concept_id 的词条数 */
  unboundWordCounts: Record<string, number>;
}

/** 历时比较筛选（Roadmap v3 / Pillar 5.5） */
export type CognateComparisonFilter =
  | "all"
  | "borrowing_replacement"
  | "form_changed"
  | "multi_candidate"
  | "broken_chain";

export interface BuildCognateMatrixOptions {
  languages: readonly LanguageEntry[];
  wordsByLanguage: Record<string, readonly WordEntry[]>;
  concepts: readonly ConceptDefinition[];
  /** 仅保留至少有一个词形的概念行（默认 false：保留全部概念，空格可点击补词） */
  onlyFilled?: boolean;
  /** 行数上限（默认 400） */
  maxRows?: number;
  /** 工作区词汇空缺表（WorkspaceConfig.lexical_gaps） */
  lexicalGaps?: LexicalGap[];
  /** 同源矩阵人工主词指定表（WorkspaceConfig.primary_cognate_overrides） */
  primaryOverrides?: PrimaryCognateOverride[];
  /** 词典加载失败的语言（其空单元格标记 loadFailed 而非「尚未收录」） */
  failedLanguageIds?: string[];
  /** 历时比较筛选（默认 "all"） */
  comparisonFilter?: CognateComparisonFilter;
}

/** 兼容别名：执行计划中的 `BuildCognateMatrixInput` 即本接口 */
export type BuildCognateMatrixInput = BuildCognateMatrixOptions;

interface RootTrace {
  rootKey: string;
  broken: boolean;
  /** 上溯途中遇到借词祖先：借词源本身即该同源组的起点 */
  borrowed: boolean;
  /** 追溯到的最终词根词条（断链时为中断点；供词形/语义比较） */
  rootWord: WordEntry | null;
}

function buildLanguageIndex(
  languages: readonly LanguageEntry[],
): Map<string, LanguageEntry> {
  return new Map(languages.map((language) => [language.language_id, language]));
}

/** 计算每门语言在谱系中的深度（根为 0） */
export function computeLanguageDepths(
  languages: readonly LanguageEntry[],
): Map<string, number> {
  const index = buildLanguageIndex(languages);
  const depths = new Map<string, number>();
  const resolve = (languageId: string, seen: Set<string>): number => {
    const cached = depths.get(languageId);
    if (cached !== undefined) return cached;
    if (seen.has(languageId)) return 0; // 防御性：谱系里不应出现环
    seen.add(languageId);
    const language = index.get(languageId);
    const parentId = language?.parent_id ?? null;
    const depth = parentId ? resolve(parentId, seen) + 1 : 0;
    depths.set(languageId, depth);
    return depth;
  };
  for (const language of languages) resolve(language.language_id, new Set());
  return depths;
}

/**
 * 上溯到最终祖语词根。
 *
 * **仅当 `origin_type === "evolved"` 时**才沿 `parent_entry_id` 切换到父语言
 * 词表继续查找（Roadmap v3 / Pillar 1.5 的核心修复）：
 * - `borrowed`：借词不是本语系的遗传词根，立即停在借词节点，其全部子孙
 *   共享同一 `borrowed::lang::entry` 同源组；
 * - `derived` / `compound`：本语言共时构词创新，自身即组起点，**不报断链**；
 * - 其余类型（a_priori 等）或没有 parent 的 evolved 词：自身即词根。
 *
 * 断链仅在「evolved 声明了 parent_entry_id 但父词条/父语言缺失」或数据成环时产生。
 */
function traceRoot(
  word: WordEntry,
  languageId: string,
  byLanguage: Map<string, Map<string, WordEntry>>,
  languageIndex: Map<string, LanguageEntry>,
): RootTrace {
  let currentWord = word;
  let currentLanguageId = languageId;
  const seen = new Set<string>([`${languageId}::${word.entry_id}`]);

  for (;;) {
    const originType = currentWord.etymology?.origin_type;

    if (originType === "borrowed") {
      return {
        rootKey: `borrowed::${currentLanguageId}::${currentWord.entry_id}`,
        broken: false,
        borrowed: true,
        rootWord: currentWord,
      };
    }

    if (originType !== "evolved") {
      // derived / compound / a_priori 等：共时创新或独立造词，自身即起点
      return {
        rootKey: `${currentLanguageId}::${currentWord.entry_id}`,
        broken: false,
        borrowed: false,
        rootWord: currentWord,
      };
    }

    const parentEntryId = currentWord.etymology?.parent_entry_id ?? null;
    if (!parentEntryId) {
      return {
        rootKey: `${currentLanguageId}::${currentWord.entry_id}`,
        broken: false,
        borrowed: false,
        rootWord: currentWord,
      };
    }
    const parentLanguageId = languageIndex.get(currentLanguageId)?.parent_id ?? null;
    if (!parentLanguageId) {
      return {
        rootKey: `${currentLanguageId}::${currentWord.entry_id}`,
        broken: true,
        borrowed: false,
        rootWord: currentWord,
      };
    }
    const parentWord = byLanguage.get(parentLanguageId)?.get(parentEntryId);
    if (!parentWord) {
      return {
        rootKey: `${currentLanguageId}::${currentWord.entry_id}`,
        broken: true,
        borrowed: false,
        rootWord: currentWord,
      };
    }
    const key = `${parentLanguageId}::${parentEntryId}`;
    if (seen.has(key)) {
      // 数据异常成环：停在当前节点，避免死循环
      return {
        rootKey: `${currentLanguageId}::${currentWord.entry_id}`,
        broken: true,
        borrowed: false,
        rootWord: currentWord,
      };
    }
    seen.add(key);
    currentWord = parentWord;
    currentLanguageId = parentLanguageId;
  }
}

function isDeprecated(word: WordEntry): boolean {
  return word.evolution?.is_deprecated === true;
}

interface RankedCandidate {
  candidate: CognateCellCandidate;
  word: WordEntry;
}

/**
 * 自动主词排序（`primaryReason === "auto_rank"`）：
 * 非废弃词 → evolved 继承词 → 罗马字字典序 → entryId 字典序（最终稳定兜底）。
 */
function compareAutoRank(a: RankedCandidate, b: RankedCandidate): number {
  const depA = a.candidate.isDeprecated ? 1 : 0;
  const depB = b.candidate.isDeprecated ? 1 : 0;
  if (depA !== depB) return depA - depB;
  const evoA = a.candidate.originType === "evolved" ? 0 : 1;
  const evoB = b.candidate.originType === "evolved" ? 0 : 1;
  if (evoA !== evoB) return evoA - evoB;
  const byForm = a.candidate.romanized.localeCompare(b.candidate.romanized);
  if (byForm !== 0) return byForm;
  return a.candidate.entryId.localeCompare(b.candidate.entryId);
}

function matchesOverride(
  override: PrimaryCognateOverride,
  candidate: CognateCellCandidate,
): boolean {
  if (override.entry_id !== candidate.entryId) return false;
  if (!override.sense_id) return true;
  return override.sense_id === candidate.senseId;
}

function matchesComparisonFilter(
  cells: readonly CognateMatrixCell[],
  filter: CognateComparisonFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "borrowing_replacement":
      return cells.some((cell) => cell.kind === "borrowed");
    case "form_changed":
      return cells.some((cell) => cell.formChangedFromRoot === true);
    case "multi_candidate":
      return cells.some((cell) => cell.candidates.length > 1);
    case "broken_chain":
      return cells.some((cell) => cell.brokenChain === true);
  }
}

export function buildCognateMatrix(
  options: BuildCognateMatrixOptions,
): CognateMatrixResult {
  const {
    languages,
    wordsByLanguage,
    concepts,
    onlyFilled = false,
    maxRows = 400,
    lexicalGaps = [],
    primaryOverrides = [],
    failedLanguageIds = [],
    comparisonFilter = "all",
  } = options;

  const languageIndex = buildLanguageIndex(languages);
  const depths = computeLanguageDepths(languages);
  const failedLanguages = new Set(failedLanguageIds);
  const gapIndex = new Map(
    lexicalGaps.map((gap) => [`${gap.language_id}::${gap.concept_id}`, gap]),
  );
  const overrideIndex = new Map(
    primaryOverrides.map((override) => [
      `${override.language_id}::${override.concept_id}`,
      override,
    ]),
  );

  const byLanguage = new Map<string, Map<string, WordEntry>>();
  /** languageId → conceptId → 义项级候选（已按自动排序规则排序） */
  const candidateIndex = new Map<string, Map<string, RankedCandidate[]>>();
  const unboundWordCounts: Record<string, number> = {};

  for (const language of languages) {
    const words = wordsByLanguage[language.language_id] ?? [];
    const wordMap = new Map(words.map((word) => [word.entry_id, word]));
    byLanguage.set(language.language_id, wordMap);

    const perConcept = new Map<string, RankedCandidate[]>();
    let unbound = 0;
    for (const word of words) {
      const bound = word.senses.some((sense) => Boolean(sense.concept_id));
      if (!bound) unbound += 1;
      for (const sense of word.senses) {
        if (!sense.concept_id) continue;
        const ranked: RankedCandidate = {
          candidate: {
            entryId: word.entry_id,
            senseId: sense.sense_id,
            romanized: word.con_word_romanized,
            ipa: word.phonetic_ipa ?? "",
            senseGloss: sense.gloss ?? "",
            posId: sense.pos_id ?? "",
            originType: word.etymology?.origin_type ?? "a_priori",
            tags: word.metadata?.tags ?? [],
            isDeprecated: isDeprecated(word),
            isPinnedPrimary: false,
          },
          word,
        };
        const list = perConcept.get(sense.concept_id) ?? [];
        list.push(ranked);
        perConcept.set(sense.concept_id, list);
      }
    }
    for (const list of perConcept.values()) {
      list.sort(compareAutoRank);
    }
    candidateIndex.set(language.language_id, perConcept);
    unboundWordCounts[language.language_id] = unbound;
  }

  const matrixLanguages: CognateMatrixLanguage[] = languages.map((language) => ({
    languageId: language.language_id,
    name: language.name,
    parentId: language.parent_id,
    depth: depths.get(language.language_id) ?? 0,
  }));

  const stats: CognateMatrixStats = {
    conceptCount: 0,
    cellCount: 0,
    filledCount: 0,
    cognateSetCount: 0,
    borrowedCount: 0,
    innovationCount: 0,
    brokenChainCount: 0,
  };

  const fieldOrder = new Map<string, number>(
    SEMANTIC_FIELDS.map((field, index) => [field, index]),
  );
  const sortedConcepts = [...concepts].sort((a, b) => {
    const fa = fieldOrder.get(a.semantic_field as SemanticField) ?? 99;
    const fb = fieldOrder.get(b.semantic_field as SemanticField) ?? 99;
    if (fa !== fb) return fa - fb;
    return a.concept_id.localeCompare(b.concept_id);
  });

  interface RowWithStats {
    row: CognateMatrixRow;
    borrowed: number;
    innovation: number;
    broken: number;
  }
  const matchedRows: RowWithStats[] = [];

  for (const concept of sortedConcepts) {
    const cells: CognateMatrixCell[] = [];
    const groupOrder: string[] = [];
    const groupIndex = new Map<string, number>();
    let rowBorrowed = 0;
    let rowInnovation = 0;
    let rowBroken = 0;

    for (const language of languages) {
      const ranked = candidateIndex.get(language.language_id)?.get(concept.concept_id) ?? [];

      if (ranked.length === 0) {
        const gap = gapIndex.get(`${language.language_id}::${concept.concept_id}`);
        const loadFailed = failedLanguages.has(language.language_id);
        cells.push({
          languageId: language.language_id,
          entryId: null,
          form: "",
          ipa: "",
          kind: "empty",
          cognateSetId: null,
          cognateIndex: null,
          variants: 0,
          candidates: [],
          ...(gap && !loadFailed ? { gap } : {}),
          ...(loadFailed ? { loadFailed: true } : {}),
        });
        continue;
      }

      const override = overrideIndex.get(`${language.language_id}::${concept.concept_id}`);
      for (const item of ranked) {
        item.candidate.isPinnedPrimary = override
          ? matchesOverride(override, item.candidate)
          : false;
      }

      // 主词选择：人工指定优先，否则按自动排序取首位
      let primary: RankedCandidate | null = null;
      let primaryReason: "manual_override" | "auto_rank" = "auto_rank";
      if (override) {
        primary = ranked.find((item) => item.candidate.isPinnedPrimary) ?? null;
        if (primary) primaryReason = "manual_override";
      }
      primary = primary ?? ranked[0] ?? null;
      if (!primary) continue;

      const primaryWord = primary.word;
      const origin = primaryWord.etymology?.origin_type ?? "a_priori";
      let kind: CognateCellKind;
      let cognateSetId: string;
      let innovationKind: CognateMatrixCell["innovationKind"];
      let brokenChain = false;
      let formChangedFromRoot: boolean | undefined;
      let meaningChangedFromRoot: boolean | undefined;

      if (origin === "borrowed") {
        kind = "borrowed";
        const snapshot = primaryWord.etymology?.borrowed_source;
        // 优先读借入快照归组：同一供语词条的多次借入共享同源组
        cognateSetId = snapshot
          ? `borrowed::${snapshot.source_language_id}::${snapshot.source_entry_id}`
          : `borrowed::${language.language_id}::${primaryWord.entry_id}`;
        rowBorrowed += 1;
      } else if (origin === "derived" || origin === "compound") {
        // 本语言共时构词创新：不再沿 parent_entry_id 上溯，也不报断链
        kind = "innovation";
        innovationKind = origin;
        cognateSetId = `innovation::${language.language_id}::${primaryWord.entry_id}`;
        rowInnovation += 1;
      } else {
        const trace = traceRoot(
          primaryWord,
          language.language_id,
          byLanguage,
          languageIndex,
        );
        if (trace.broken) {
          rowBroken += 1;
          brokenChain = true;
        }
        if (trace.borrowed) {
          // 继承自借词祖先：整条子孙链与借词源共享同一同源组
          kind = "borrowed";
          cognateSetId = trace.rootKey;
          rowBorrowed += 1;
        } else if (
          language.parent_id &&
          !(origin === "evolved" && primaryWord.etymology?.parent_entry_id)
        ) {
          // 子语言中的非继承词（独立造词，或 evolved 但未挂父词）均为本语言创新；
          // 非 evolved 词遗留的 parent_entry_id 是脏数据，不参与判定
          kind = "innovation";
          innovationKind = "root";
          cognateSetId = `innovation::${language.language_id}::${primaryWord.entry_id}`;
          rowInnovation += 1;
        } else {
          kind = "inherited";
          cognateSetId = trace.rootKey;
        }
        if (trace.rootWord) {
          formChangedFromRoot =
            primaryWord.con_word_romanized !== trace.rootWord.con_word_romanized;
          const semanticKind = primaryWord.etymology?.semantic_change_kind;
          meaningChangedFromRoot =
            (semanticKind !== undefined && semanticKind !== "unchanged") ||
            (primaryWord.etymology?.semantic_shift_note ?? "").trim().length > 0;
        }
      }

      if (!groupIndex.has(cognateSetId)) {
        groupIndex.set(cognateSetId, groupOrder.length);
        groupOrder.push(cognateSetId);
      }

      cells.push({
        languageId: language.language_id,
        entryId: primaryWord.entry_id,
        form: primaryWord.con_word_romanized,
        ipa: primaryWord.phonetic_ipa ?? "",
        kind,
        cognateSetId,
        cognateIndex: groupIndex.get(cognateSetId) ?? 0,
        variants: ranked.length,
        candidates: ranked.map((item) => item.candidate),
        primaryReason,
        ...(innovationKind ? { innovationKind } : {}),
        ...(formChangedFromRoot !== undefined ? { formChangedFromRoot } : {}),
        ...(meaningChangedFromRoot !== undefined ? { meaningChangedFromRoot } : {}),
        ...(brokenChain ? { brokenChain: true } : {}),
      });
    }

    const filled = cells.filter((cell) => cell.kind !== "empty").length;
    if (onlyFilled && filled === 0) continue;
    if (!matchesComparisonFilter(cells, comparisonFilter)) continue;

    matchedRows.push({
      row: {
        conceptId: concept.concept_id,
        glossZh: concept.gloss_zh ?? "",
        glossEn: concept.gloss_en ?? concept.concept_id,
        semanticField: concept.semantic_field ?? "",
        cells,
        filled,
        cognateSetCount: groupOrder.length,
      },
      borrowed: rowBorrowed,
      innovation: rowInnovation,
      broken: rowBroken,
    });
  }

  const totalMatchedConcepts = matchedRows.length;
  const rows = matchedRows.slice(0, maxRows);

  stats.conceptCount = rows.length;
  for (const { row, borrowed, innovation, broken } of rows) {
    stats.cellCount += row.cells.length;
    stats.filledCount += row.filled;
    stats.cognateSetCount += row.cognateSetCount;
    stats.borrowedCount += borrowed;
    stats.innovationCount += innovation;
    stats.brokenChainCount += broken;
  }

  return {
    rows: rows.map((item) => item.row),
    languages: matrixLanguages,
    stats,
    totalMatchedConcepts,
    unboundWordCounts,
  };
}

/** 单元格配色（同源组轮转）；UI 与导出共用同一色板 */
export const COGNATE_PALETTE = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#65a30d",
  "#db2777",
] as const;

export function cognateColor(index: number | null): string | null {
  if (index === null || index < 0) return null;
  return COGNATE_PALETTE[index % COGNATE_PALETTE.length] ?? null;
}
