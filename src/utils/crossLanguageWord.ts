/**
 * crossLanguageWord.ts — 在非当前激活语言中新建词条
 *
 * 同源词矩阵需要在任意子语言的空单元格里补词，而 `lexiconStore` 只绑定
 * 当前激活语言。这里直接走 `save_word` IPC（携带显式 projectPath +
 * languagePath），写入后失效对应语言的谱系缓存。
 */
import { invoke } from "@tauri-apps/api/core";
import type { PartOfSpeech, WordEntry } from "../types";
import { invalidateLineageLexicon } from "../store/lineageLexiconStore";

export interface CreateWordInLanguageOptions {
  projectPath: string;
  languagePath: string;
  languageId: string;
  romanized: string;
  conceptId: string;
  gloss?: string;
  posId?: string;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 构造一个最小可用的词条（不生成 IPA，留待词典页即时补算） */
export function buildConceptWord(
  options: CreateWordInLanguageOptions,
): WordEntry {
  const now = new Date().toISOString();
  return {
    entry_id: newId(),
    language_id: options.languageId,
    con_word_romanized: options.romanized,
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      {
        sense_id: newId(),
        pos_id: options.posId ?? "noun",
        gloss: options.gloss ?? options.romanized,
        definitions: [],
        examples: [],
        concept_id: options.conceptId,
      },
    ],
    etymology: {
      origin_type: "a_priori",
      source_language_id: null,
      parent_entry_id: null,
      applied_sound_changes: [],
      semantic_shift_note: "",
    },
    metadata: { tags: [], created_at: now, updated_at: now },
  };
}

/** 在指定语言中写入新词条；成功后失效该语言的词库缓存 */
export async function createWordInLanguage(
  options: CreateWordInLanguageOptions,
): Promise<WordEntry> {
  const word = buildConceptWord(options);
  await invoke("save_word", {
    projectPath: options.projectPath,
    languagePath: options.languagePath,
    word,
    oldRomanized: null,
    expectedRevision: null,
    operationId: null,
  });
  invalidateLineageLexicon(options.projectPath, options.languagePath);
  return word;
}

/** 从词性列表中挑选名词，缺省回退首个词性 */
export function pickNounPosId(partsOfSpeech: readonly PartOfSpeech[]): string {
  const noun = partsOfSpeech.find((pos) =>
    /^(noun|n)$/i.test(pos.pos_id) || /名词/.test(pos.name ?? ""),
  );
  return noun?.pos_id ?? partsOfSpeech[0]?.pos_id ?? "noun";
}
