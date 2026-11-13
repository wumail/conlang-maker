/**
 * crossLanguageWord.ts — 在非当前激活语言中新建词条
 *
 * 同源词矩阵需要在任意子语言的空单元格里补词，而 `lexiconStore` 只绑定
 * 当前激活语言。这里按目标语言自身的音系 / 语法配置生成真实 IPA 与词性：
 *  - 目标语言 ≠ 激活语言：直接走 `save_word` IPC（显式 projectPath +
 *    languagePath），写入后失效该语言的谱系缓存；
 *  - 目标语言 = 激活语言：走 `lexiconStore.upsertWord`，让当前词典视图与
 *    撤销栈同步更新，再落盘并失效谱系缓存。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  GrammarLoadResult,
  PartOfSpeech,
  PhonologyConfig,
  WordEntry,
} from "../types";
import { generateIPA } from "../core/engines/ipaGenerator";
import {
  getLineageLexicon,
  invalidateLineageLexicon,
  loadLineageLexicon,
} from "../store/lineageLexiconStore";
import { useLexiconStore } from "../store/lexiconStore";
import { useWorkspaceStore } from "../store/workspaceStore";

export interface CreateWordInLanguageOptions {
  projectPath: string;
  languagePath: string;
  languageId: string;
  romanized: string;
  conceptId: string;
  gloss?: string;
  /** 显式词性；缺省时取目标语言 GrammarConfig 的首个 `pos_id` */
  posId?: string;
  /** 目标语言的音系配置，用于即时生成真实 IPA */
  phonology?: PhonologyConfig | null;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 构造一个最小可用的词条；有音系配置时立即算出真实 IPA */
export function buildConceptWord(
  options: CreateWordInLanguageOptions,
): WordEntry {
  const now = new Date().toISOString();
  const phonemic =
    options.phonology && options.romanized.trim()
      ? generateIPA(options.romanized, options.phonology).phonemic
      : "";
  return {
    entry_id: newId(),
    language_id: options.languageId,
    con_word_romanized: options.romanized,
    phonetic_ipa: phonemic,
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

/** 读取目标语言的音系配置（优先命中谱系缓存，避免重复 IPC） */
async function resolvePhonology(
  projectPath: string,
  languagePath: string,
): Promise<PhonologyConfig | null> {
  const cached = getLineageLexicon(projectPath, languagePath);
  if (cached) return cached.phonoConfig;
  try {
    const snapshot = await loadLineageLexicon(projectPath, languagePath);
    return snapshot?.phonoConfig ?? null;
  } catch (err) {
    console.warn(`读取目标语言音系配置失败，暂不生成 IPA：${err}`);
    return null;
  }
}

/** 读取目标语言 GrammarConfig 的首个词性（绝不复用当前激活语言的词性） */
async function resolveTargetPosId(
  projectPath: string,
  languagePath: string,
): Promise<string | undefined> {
  try {
    const loaded = await invoke<GrammarLoadResult>("load_grammar_with_revision", {
      projectPath,
      languagePath,
    });
    return loaded.config.parts_of_speech[0]?.pos_id;
  } catch (err) {
    console.warn(`读取目标语言语法配置失败，词性回退为 noun：${err}`);
    return undefined;
  }
}

/** 在指定语言中写入新词条；成功后失效该语言的词库缓存 */
export async function createWordInLanguage(
  options: CreateWordInLanguageOptions,
): Promise<WordEntry> {
  const { projectPath, languagePath, languageId } = options;
  const [phonology, posId] = await Promise.all([
    resolvePhonology(projectPath, languagePath),
    options.posId
      ? Promise.resolve(options.posId)
      : resolveTargetPosId(projectPath, languagePath),
  ]);

  const word = buildConceptWord({ ...options, phonology, posId });
  const isActive = languageId === useWorkspaceStore.getState().activeLanguageId;

  if (isActive) {
    // 直接在激活语言的词库里增补，保持词典视图与撤销栈同步
    useLexiconStore.getState().upsertWord(word);
    await useLexiconStore.getState().flushSaves();
  } else {
    await invoke("save_word", {
      projectPath,
      languagePath,
      word,
      oldRomanized: null,
      expectedRevision: null,
      operationId: null,
    });
  }

  invalidateLineageLexicon(projectPath, languagePath);
  return word;
}

/** 从词性列表中挑选名词，缺省回退首个词性 */
export function pickNounPosId(partsOfSpeech: readonly PartOfSpeech[]): string {
  const noun = partsOfSpeech.find((pos) =>
    /^(noun|n)$/i.test(pos.pos_id) || /名词/.test(pos.name ?? ""),
  );
  return noun?.pos_id ?? partsOfSpeech[0]?.pos_id ?? "noun";
}
