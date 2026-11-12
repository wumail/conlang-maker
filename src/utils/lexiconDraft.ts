import type { WordEntry } from "../types";
import { DEFAULT_LANGUAGE_ID } from "../constants";

/**
 * 判定「尚未成形的草稿词条」：拼写仍为占位符 `new_word`，或拼写与释义同时为空。
 * 用于切换/离开词典页时清理幽灵条目。
 */
export function isDraftWord(word: WordEntry): boolean {
  const romanized = word.con_word_romanized.trim();
  const hasMeaning = word.senses.some((sense) => sense.gloss.trim().length > 0);
  return romanized === "new_word" || (romanized === "" && !hasMeaning);
}

/** 构造一条全新的草稿词条（默认名词词性占位） */
export function createDraftWord(placeholderGloss: string, posId = "pos_noun"): WordEntry {
  const now = new Date().toISOString();
  return {
    entry_id: crypto.randomUUID(),
    language_id: DEFAULT_LANGUAGE_ID,
    con_word_romanized: "new_word",
    phonetic_ipa: "",
    phonetic_override: false,
    senses: [
      {
        sense_id: crypto.randomUUID(),
        pos_id: posId,
        gloss: placeholderGloss,
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
    metadata: { tags: [], created_at: now, updated_at: now },
    evolution: { is_deprecated: false, deprecated_since_language_id: null },
  };
}
