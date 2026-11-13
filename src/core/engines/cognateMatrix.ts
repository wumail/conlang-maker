/**
 * cognateMatrix.ts — 全语系同源词矩阵引擎
 *
 * 沿 `etymology.parent_entry_id` 逐代上溯到最终祖语词根，把共享同一词根的
 * 单元格归入同一个 `cognateSetId`；借词与独立创新各自成组，便于一眼看出
 * 哪几支保留了同源词、哪支发生了借用或创新。
 */
import type { ConceptDefinition, LanguageEntry, WordEntry } from "../../types";
import { SEMANTIC_FIELDS, type SemanticField } from "../../data/core_concepts";

export type CognateCellKind = "inherited" | "borrowed" | "innovation" | "empty";

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
}

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
}

export interface BuildCognateMatrixOptions {
  languages: readonly LanguageEntry[];
  wordsByLanguage: Record<string, readonly WordEntry[]>;
  concepts: readonly ConceptDefinition[];
  /** 仅保留至少有一个词形的概念行（默认 false：保留全部概念，空格可点击补词） */
  onlyFilled?: boolean;
  /** 行数上限（默认 400） */
  maxRows?: number;
}

interface RootTrace {
  rootKey: string;
  broken: boolean;
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
 * `parent_entry_id` 指向**父语言**中的词条，因此每一步都要切换到
 * `language.parent_id` 所在的词表继续查找。
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
    const parentEntryId = currentWord.etymology?.parent_entry_id ?? null;
    if (!parentEntryId) {
      return { rootKey: `${currentLanguageId}::${currentWord.entry_id}`, broken: false };
    }
    const parentLanguageId = languageIndex.get(currentLanguageId)?.parent_id ?? null;
    if (!parentLanguageId) {
      return { rootKey: `${currentLanguageId}::${currentWord.entry_id}`, broken: true };
    }
    const parentWord = byLanguage.get(parentLanguageId)?.get(parentEntryId);
    if (!parentWord) {
      return { rootKey: `${currentLanguageId}::${currentWord.entry_id}`, broken: true };
    }
    const key = `${parentLanguageId}::${parentEntryId}`;
    if (seen.has(key)) {
      // 数据异常成环：停在当前节点，避免死循环
      return { rootKey: `${currentLanguageId}::${currentWord.entry_id}`, broken: true };
    }
    seen.add(key);
    currentWord = parentWord;
    currentLanguageId = parentLanguageId;
  }
}

function isDeprecated(word: WordEntry): boolean {
  return word.evolution?.is_deprecated === true;
}

/** 同一语言同一概念下优先取未废弃词条，其次取首个 */
function pickPrimary(candidates: WordEntry[]): WordEntry {
  const alive = candidates.filter((word) => !isDeprecated(word));
  return alive[0] ?? candidates[0]!;
}

export function buildCognateMatrix(
  options: BuildCognateMatrixOptions,
): CognateMatrixResult {
  const { languages, wordsByLanguage, concepts, onlyFilled = false, maxRows = 400 } = options;

  const languageIndex = buildLanguageIndex(languages);
  const depths = computeLanguageDepths(languages);

  const byLanguage = new Map<string, Map<string, WordEntry>>();
  const conceptIndex = new Map<string, Map<string, WordEntry[]>>();
  for (const language of languages) {
    const words = wordsByLanguage[language.language_id] ?? [];
    const wordMap = new Map(words.map((word) => [word.entry_id, word]));
    byLanguage.set(language.language_id, wordMap);

    const perConcept = new Map<string, WordEntry[]>();
    for (const word of words) {
      for (const sense of word.senses) {
        if (!sense.concept_id) continue;
        const list = perConcept.get(sense.concept_id) ?? [];
        if (!list.includes(word)) list.push(word);
        perConcept.set(sense.concept_id, list);
      }
    }
    conceptIndex.set(language.language_id, perConcept);
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

  const rows: CognateMatrixRow[] = [];
  for (const concept of sortedConcepts) {
    if (rows.length >= maxRows) break;
    const cells: CognateMatrixCell[] = [];
    const groupOrder: string[] = [];
    const groupIndex = new Map<string, number>();

    for (const language of languages) {
      const candidates = conceptIndex.get(language.language_id)?.get(concept.concept_id) ?? [];
      if (candidates.length === 0) {
        cells.push({
          languageId: language.language_id,
          entryId: null,
          form: "",
          ipa: "",
          kind: "empty",
          cognateSetId: null,
          cognateIndex: null,
          variants: 0,
        });
        continue;
      }

      const primary = pickPrimary(candidates);
      const origin = primary.etymology?.origin_type ?? "a_priori";
      let kind: CognateCellKind;
      let cognateSetId: string;

      if (origin === "borrowed") {
        kind = "borrowed";
        cognateSetId = `borrowed::${language.language_id}::${primary.entry_id}`;
        stats.borrowedCount += 1;
      } else {
        const trace = traceRoot(primary, language.language_id, byLanguage, languageIndex);
        if (trace.broken) stats.brokenChainCount += 1;
        const hasParent = Boolean(primary.etymology?.parent_entry_id);
        if (!hasParent && language.parent_id) {
          kind = "innovation";
          cognateSetId = `innovation::${language.language_id}::${primary.entry_id}`;
          stats.innovationCount += 1;
        } else {
          kind = "inherited";
          cognateSetId = trace.rootKey;
        }
      }

      if (!groupIndex.has(cognateSetId)) {
        groupIndex.set(cognateSetId, groupOrder.length);
        groupOrder.push(cognateSetId);
      }

      cells.push({
        languageId: language.language_id,
        entryId: primary.entry_id,
        form: primary.con_word_romanized,
        ipa: primary.phonetic_ipa ?? "",
        kind,
        cognateSetId,
        cognateIndex: groupIndex.get(cognateSetId) ?? 0,
        variants: candidates.length,
      });
    }

    const filled = cells.filter((cell) => cell.kind !== "empty").length;
    if (onlyFilled && filled === 0) continue;

    stats.conceptCount += 1;
    stats.cellCount += cells.length;
    stats.filledCount += filled;
    stats.cognateSetCount += groupOrder.length;

    rows.push({
      conceptId: concept.concept_id,
      glossZh: concept.gloss_zh ?? "",
      glossEn: concept.gloss_en ?? concept.concept_id,
      semanticField: concept.semantic_field ?? "",
      cells,
      filled,
      cognateSetCount: groupOrder.length,
    });
  }

  return { rows, languages: matrixLanguages, stats };
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
