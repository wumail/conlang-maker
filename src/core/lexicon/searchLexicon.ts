/**
 * searchLexicon.ts — 词典统一搜索引擎（Roadmap v3 / Pillar 7.3）
 *
 * 唯一纯函数 `filterAndSearchWords`：词典侧边栏、表格视图与全局命令面板
 * 共用同一搜索规则（词形 / IPA / 义项 gloss / definitions / usage_note /
 * 标签 / 绑定概念的中英文名与别名），并支持 5 种内置快捷筛选。
 */
import type {
  BuiltinQuickFilterKind,
  ConceptDefinition,
  OriginType,
  WordEntry,
} from "../../types";

export interface LexiconFilterCriteria {
  /** 自由文本检索词（匹配词形、IPA、释义、定义、用法说明、标签与概念名/别名） */
  searchTerm?: string;
  /** 为 true 时检索词仅匹配 phonetic_ipa（IPA 检索模式） */
  ipaMode?: boolean;
  /** 限定词性（任一义项命中即保留） */
  posId?: string;
  /** 限定词源类型 */
  originType?: OriginType | "";
  /** 限定标签（精确匹配 metadata.tags 中的一项） */
  tag?: string;
  /** 内置快捷筛选类型 */
  quickKind?: BuiltinQuickFilterKind | "";
}

function matchesQuickKind(word: WordEntry, kind: BuiltinQuickFilterKind): boolean {
  switch (kind) {
    case "unbound_concept":
      // 所有义项均无 concept_id
      return word.senses.every((sense) => !sense.concept_id);
    case "missing_examples":
      // 所有义项 examples 均为空
      return word.senses.every((sense) => (sense.examples ?? []).length === 0);
    case "tbd_gloss":
      // 任一义项 gloss 含 TBD（不区分大小写）或 ?
      return word.senses.some((sense) => {
        const gloss = (sense.gloss ?? "").toLowerCase();
        return gloss.includes("tbd") || gloss.includes("?");
      });
    case "borrowed_needs_review": {
      // origin_type = borrowed 且无 borrowed_source 快照或语义说明为空
      const etymology = word.etymology;
      if (etymology?.origin_type !== "borrowed") return false;
      const snapshot = etymology.borrowed_source;
      return !snapshot || (snapshot.borrowed_gloss ?? "").trim().length === 0;
    }
    case "deprecated":
      return word.evolution?.is_deprecated === true;
  }
}

function wordHaystackParts(word: WordEntry): string[] {
  const parts: string[] = [word.con_word_romanized ?? ""];
  if (word.phonetic_ipa) parts.push(word.phonetic_ipa);
  for (const sense of word.senses) {
    if (sense.gloss) parts.push(sense.gloss);
    for (const definition of sense.definitions ?? []) parts.push(definition);
    if (sense.usage_note) parts.push(sense.usage_note);
  }
  for (const tag of word.metadata?.tags ?? []) parts.push(tag);
  return parts;
}

function conceptHaystackPart(
  word: WordEntry,
  conceptsMap?: Map<string, ConceptDefinition>,
): string | null {
  if (!conceptsMap) return null;
  const parts: string[] = [];
  for (const sense of word.senses) {
    if (!sense.concept_id) continue;
    const concept = conceptsMap.get(sense.concept_id);
    if (!concept) continue;
    if (concept.gloss_zh) parts.push(concept.gloss_zh);
    if (concept.gloss_en) parts.push(concept.gloss_en);
    for (const alias of concept.aliases ?? []) parts.push(alias);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function matchesSearchTerm(
  word: WordEntry,
  needle: string,
  ipaMode: boolean,
  conceptsMap?: Map<string, ConceptDefinition>,
): boolean {
  if (ipaMode) {
    return (word.phonetic_ipa ?? "").toLowerCase().includes(needle);
  }
  for (const part of wordHaystackParts(word)) {
    if (part.toLowerCase().includes(needle)) return true;
  }
  const conceptPart = conceptHaystackPart(word, conceptsMap);
  return conceptPart !== null && conceptPart.toLowerCase().includes(needle);
}

/**
 * 按组合条件过滤并检索词条（纯函数，保持输入顺序）。
 *
 * 各条件之间为「与」关系；`searchTerm` 在词形、IPA、全部义项文本、标签以及
 * 绑定概念（`conceptsMap` 提供）的中英文名与别名上做包含匹配。
 */
export function filterAndSearchWords(
  words: WordEntry[],
  criteria: LexiconFilterCriteria,
  conceptsMap?: Map<string, ConceptDefinition>,
): WordEntry[] {
  const {
    searchTerm,
    ipaMode = false,
    posId,
    originType,
    tag,
    quickKind,
  } = criteria;
  const needle = (searchTerm ?? "").trim().toLowerCase();

  return words.filter((word) => {
    if (posId && !word.senses.some((sense) => sense.pos_id === posId)) {
      return false;
    }
    if (originType && (word.etymology?.origin_type ?? "") !== originType) {
      return false;
    }
    if (tag && !(word.metadata?.tags ?? []).includes(tag)) return false;
    if (quickKind && !matchesQuickKind(word, quickKind)) return false;
    if (needle && !matchesSearchTerm(word, needle, ipaMode, conceptsMap)) {
      return false;
    }
    return true;
  });
}
