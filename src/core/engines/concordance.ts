/**
 * concordance.ts — 语料反向索引（Concordance）纯引擎
 *
 * 双轨匹配（PRD §3.2）：
 *  1. 精准轨：`GlossToken.linked_entry_id` 命中该词条（或语素切分首段等于该词条词干）；
 *  2. 兜底轨：Token 表层归一化词形属于「基础形 ∪ 已知屈折形」集合。
 *
 * 同形异义（homograph）防护：若 Token 已显式关联到**其他**词条，则任何兜底匹配都不成立。
 */
import type {
  CorpusText,
  GrammarConfig,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import { normalizeToken } from "../workflows/autoGloss";
import { generateParadigm } from "./morphologyEngine";

export interface ConcordanceHit {
  textId: string;
  title: string;
  lineId: string;
  originalLine: string;
  freeTranslation: string;
  matchedTokenSurface: string;
  gloss: string;
}

export interface ConcordanceResult {
  matches: ConcordanceHit[];
  total: number;
}

export interface ConcordanceOptions {
  entry: WordEntry;
  corpusTexts: CorpusText[];
  grammar: GrammarConfig;
  phono: PhonologyConfig;
  /** 额外承认的表层形式（例如用户手工标注的变体） */
  extraForms?: string[];
  /** 返回条数上限，默认 200（total 仍返回全量计数） */
  limit?: number;
  /**
   * 精确到义项筛选（Roadmap v3 / Pillar 6）：
   * 优先匹配 token.linked_sense_id === senseId；未绑 linked_sense_id 的 token
   * 仅在「单义项词条且 entry_id 匹配」时计入。
   */
  senseId?: string;
}

const DEFAULT_LIMIT = 200;
const MORPHEME_SEPARATOR = /[-·]/;

/** 词素切分串的首段（去空白后归一化），用于「词干 + 词缀」型命中 */
function firstMorpheme(form: string): string {
  const head = form.split(MORPHEME_SEPARATOR)[0] ?? "";
  return normalizeToken(head.trim());
}

/**
 * 该词条可被语料表层命中的全部归一化形式：基础形 + 各词性屈折形 + 额外形式。
 */
export function buildAcceptedForms(
  entry: WordEntry,
  grammar: GrammarConfig,
  phono: PhonologyConfig,
  extraForms: string[] = [],
): Set<string> {
  const forms = new Set<string>();
  const base = normalizeToken(entry.con_word_romanized);
  if (base) forms.add(base);
  for (const extra of extraForms) {
    const normalized = normalizeToken(extra);
    if (normalized) forms.add(normalized);
  }

  // 按 (pos_id, sense 级 inflection_class_id) 去重遍历：同一词性下若不同义项拥有不同变位类，
  // 每个变位类的屈折形都应纳入反向索引匹配池。
  const seenSenseKeys = new Set<string>();
  for (const sense of entry.senses) {
    if (!sense.pos_id) continue;
    const senseKey = `${sense.pos_id}::${sense.inflection_class_id ?? ""}`;
    if (seenSenseKeys.has(senseKey)) continue;
    seenSenseKeys.add(senseKey);
    const cells = generateParadigm(
      entry.con_word_romanized,
      sense.pos_id,
      grammar.inflection_rules,
      phono,
      {
        entryId: entry.entry_id,
        grammar,
        entry,
        senseId: sense.sense_id,
      },
    );
    for (const cell of cells) {
      const normalized = normalizeToken(cell.result);
      if (normalized) forms.add(normalized);
    }
  }

  return forms;
}

export function findWordConcordance(options: ConcordanceOptions): ConcordanceResult {
  const { entry, corpusTexts, grammar, phono, extraForms, limit = DEFAULT_LIMIT, senseId } = options;
  if (corpusTexts.length === 0) return { matches: [], total: 0 };

  const acceptedForms = buildAcceptedForms(entry, grammar, phono, extraForms);
  const baseForm = normalizeToken(entry.con_word_romanized);
  const fallbackGloss =
    entry.senses.map((sense) => sense.gloss).filter(Boolean).join("; ") || "";
  const singleSense = entry.senses.length === 1;

  let total = 0;
  const matches: ConcordanceHit[] = [];

  for (const text of corpusTexts) {
    for (const line of text.glossed_lines) {
      for (const token of line.tokens) {
        const surface = normalizeToken(token.surface_form);
        if (!surface) continue;

        const linkedToOther =
          Boolean(token.linked_entry_id) && token.linked_entry_id !== entry.entry_id;
        if (linkedToOther) continue;

        const linked = token.linked_entry_id === entry.entry_id;
        const stemMatch =
          Boolean(baseForm) &&
          (firstMorpheme(token.morpheme_break) === baseForm ||
            surface === baseForm);
        const surfaceMatch = acceptedForms.has(surface);

        if (!linked && !stemMatch && !surfaceMatch) continue;

        // 义项级筛选：显式绑定的义项必须命中；未绑 sense 的 token 仅单义项词条可用
        if (senseId) {
          const tokenSense = token.linked_sense_id;
          const senseOk = tokenSense
            ? tokenSense === senseId
            : singleSense && linked;
          if (!senseOk) continue;
        }

        total += 1;
        if (matches.length >= limit) continue;

        matches.push({
          textId: text.corpus_id,
          title: text.title || text.corpus_id,
          lineId: line.line_id,
          originalLine: line.original,
          freeTranslation: line.translation || text.free_translation || "",
          matchedTokenSurface: token.surface_form,
          gloss: token.gloss_labels || fallbackGloss,
        });
      }
    }
  }

  return { matches, total };
}

// ── Roadmap v3 / Pillar 6：删除词条/义项前的引用影响预检 ──────────────

/**
 * 统计删除某词条（或义项）会影响的语料引用：
 * 精准命中 token.linked_entry_id（指定 senseId 时再按义项过滤）。
 */
export function computeCorpusReferenceImpact(params: {
  corpusTexts: CorpusText[];
  entryId: string;
  senseId?: string;
}): { totalHits: number; verifiedHits: number; affectedCorpusTitles: string[] } {
  const { corpusTexts, entryId, senseId } = params;
  let totalHits = 0;
  let verifiedHits = 0;
  const titles = new Set<string>();

  for (const text of corpusTexts) {
    for (const line of text.glossed_lines) {
      for (const token of line.tokens) {
        if (token.linked_entry_id !== entryId) continue;
        if (senseId && token.linked_sense_id && token.linked_sense_id !== senseId) continue;
        totalHits += 1;
        if (token.status === "verified") verifiedHits += 1;
        if (text.title || text.corpus_id) titles.add(text.title || text.corpus_id);
      }
    }
  }

  return {
    totalHits,
    verifiedHits,
    affectedCorpusTitles: [...titles],
  };
}
