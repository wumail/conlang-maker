import { WordEntry, WordEvolution } from "../types";

export interface WordLifecycleFlags {
  isNew: boolean;
  isDeprecated: boolean;
  isChanged: boolean;
}

const DEFAULT_EVOLUTION: WordEvolution = {
  is_deprecated: false,
  deprecated_since_language_id: null,
  parent_snapshot_hash: null,
  last_synced_word_hash: null,
};

export function getWordEvolution(word: WordEntry): WordEvolution {
  return {
    is_deprecated: word.evolution?.is_deprecated ?? DEFAULT_EVOLUTION.is_deprecated,
    deprecated_since_language_id:
      word.evolution?.deprecated_since_language_id ??
      DEFAULT_EVOLUTION.deprecated_since_language_id,
    parent_snapshot_hash:
      word.evolution?.parent_snapshot_hash ??
      DEFAULT_EVOLUTION.parent_snapshot_hash,
    last_synced_word_hash:
      word.evolution?.last_synced_word_hash ??
      DEFAULT_EVOLUTION.last_synced_word_hash,
  };
}

function buildComparablePayload(word: WordEntry): string {
  return JSON.stringify({
    con_word_romanized: word.con_word_romanized,
    phonetic_ipa: word.phonetic_override ? word.phonetic_ipa : "",
    phonetic_override: word.phonetic_override,
    senses: word.senses,
    semantic_shift_note: word.etymology.semantic_shift_note,
  });
}

function buildSyncPayload(word: WordEntry): string {
  return JSON.stringify({
    con_word_romanized: word.con_word_romanized,
    phonetic_override: word.phonetic_override,
    phonetic_ipa: word.phonetic_override ? word.phonetic_ipa : "",
  });
}

function djb2Hash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

export function getWordComparableDigest(word: WordEntry): string {
  return djb2Hash(buildComparablePayload(word));
}

export function getWordSyncDigest(word: WordEntry): string {
  return djb2Hash(buildSyncPayload(word));
}

export function hasWordChangedFromParent(
  currentWord: WordEntry,
  parentWord: WordEntry,
): boolean {
  return buildComparablePayload(currentWord) !== buildComparablePayload(parentWord);
}
