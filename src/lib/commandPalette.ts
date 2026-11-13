/**
 * commandPalette.ts — 全局命令面板的纯检索逻辑
 *
 * 与 UI 解耦：输入「查询串 + 当前语言词表 + 已缓存语系词表」，
 * 输出按相关度排序的命中项，供 `CommandPalette` 渲染与键盘选择。
 */
import type { WordEntry } from "../types";

export interface CommandWordHit {
  entryId: string;
  languageId: string;
  languageName: string;
  romanized: string;
  ipa: string;
  gloss: string;
  tags: string[];
  /** 是否命中当前活跃语言（用于排序与徽章） */
  isActiveLanguage: boolean;
}

export interface WordSearchGroup {
  languageId: string;
  languageName: string;
  words: WordEntry[];
}

export interface WordSearchInput {
  query: string;
  activeLanguageId: string;
  activeWords: WordEntry[];
  cachedGroups: WordSearchGroup[];
  /** 返回条数上限，默认 20 */
  limit?: number;
}

const DEFAULT_LIMIT = 20;

function normalize(text: string): string {
  return text.normalize("NFC").toLowerCase().trim();
}

function stripIpa(text: string): string {
  return normalize(text).replace(/[/[\]]/g, "");
}

function entryGloss(entry: WordEntry): string {
  return entry.senses
    .map((sense) => sense.gloss)
    .filter(Boolean)
    .join("; ");
}

function matchRank(entry: WordEntry, query: string): number {
  const romanized = normalize(entry.con_word_romanized);
  const ipa = stripIpa(entry.phonetic_ipa ?? "");
  const gloss = normalize(entryGloss(entry));
  const tags = (entry.metadata?.tags ?? []).map(normalize);

  if (romanized.startsWith(query)) return 0;
  if (romanized.includes(query)) return 1;
  if (ipa.includes(query)) return 2;
  if (gloss.includes(query)) return 3;
  if (tags.some((tag) => tag.includes(query))) return 4;
  return -1;
}

function toHit(
  entry: WordEntry,
  languageId: string,
  languageName: string,
  isActiveLanguage: boolean,
): CommandWordHit {
  return {
    entryId: entry.entry_id,
    languageId,
    languageName,
    romanized: entry.con_word_romanized,
    ipa: entry.phonetic_ipa ?? "",
    gloss: entryGloss(entry),
    tags: entry.metadata?.tags ?? [],
    isActiveLanguage,
  };
}

/** 跨语言词条检索：前缀 > 子串 > IPA > 释义 > 标签，当前语言优先 */
export function searchWords(input: WordSearchInput): CommandWordHit[] {
  const query = normalize(input.query);
  if (!query) return [];
  const limit = input.limit ?? DEFAULT_LIMIT;

  const scored: { hit: CommandWordHit; rank: number; order: number }[] = [];
  let order = 0;

  const collect = (
    words: WordEntry[],
    languageId: string,
    languageName: string,
    isActiveLanguage: boolean,
  ): void => {
    for (const word of words) {
      const rank = matchRank(word, query);
      if (rank < 0) continue;
      scored.push({
        hit: toHit(word, languageId, languageName, isActiveLanguage),
        rank,
        order: order++,
      });
    }
  };

  const activeName =
    input.cachedGroups.find((group) => group.languageId === input.activeLanguageId)
      ?.languageName ?? input.activeLanguageId;
  collect(input.activeWords, input.activeLanguageId, activeName, true);
  for (const group of input.cachedGroups) {
    if (group.languageId === input.activeLanguageId) continue;
    collect(group.words, group.languageId, group.languageName, false);
  }

  scored.sort((a, b) => {
    if (a.hit.isActiveLanguage !== b.hit.isActiveLanguage) {
      return a.hit.isActiveLanguage ? -1 : 1;
    }
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.order - b.order;
  });

  return scored.slice(0, limit).map((item) => item.hit);
}

export type PaletteMode = "search" | "actions" | "calc";

/** 解析前缀模式：`>` 动作、`=` 即时演算，其余为检索 */
export function parsePaletteMode(raw: string): { mode: PaletteMode; body: string } {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith(">")) return { mode: "actions", body: trimmed.slice(1).trim() };
  if (trimmed.startsWith("=")) return { mode: "calc", body: trimmed.slice(1).trim() };
  return { mode: "search", body: raw };
}

/** `>` 模式下可直接跳转的页面（path + i18n 标签键） */
export const PALETTE_ROUTES: readonly { path: string; labelKey: string }[] = [
  { path: "/lexicon", labelKey: "nav.lexicon" },
  { path: "/phonology", labelKey: "nav.phonology" },
  { path: "/writing", labelKey: "nav.writing" },
  { path: "/grammar", labelKey: "nav.grammar" },
  { path: "/sandbox", labelKey: "nav.sandbox" },
  { path: "/sca", labelKey: "nav.sca" },
  { path: "/corpus", labelKey: "nav.corpus" },
  { path: "/tree", labelKey: "nav.tree" },
  { path: "/export", labelKey: "nav.export" },
] as const;
