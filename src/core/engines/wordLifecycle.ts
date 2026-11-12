import { WordEntry, WordEvolution, PhonologyConfig } from "../../types";
import { generateIPA } from "./ipaGenerator";

export interface WordChangeDetails {
  segments: boolean;
  prosody: boolean;
  meaning: boolean;
  technical: boolean;
}

export interface WordLifecycleFlags {
  isNew: boolean;
  isDeprecated: boolean;
  isChanged: boolean;
  changes?: WordChangeDetails;
}

function pronunciationParts(ipa: string): { segments: string; prosody: string } {
  const clean = ipa.trim().replace(/^[/\[]+|[/\]]+$/g, "").normalize("NFC");
  const annotations: { symbol: string; position: number }[] = [];
  let segments = "";
  for (const symbol of clean) {
    if (["ˈ", "ˌ", ".", "·"].includes(symbol)) {
      annotations.push({ symbol, position: Array.from(segments).length });
    } else {
      segments += symbol;
    }
  }
  return {
    segments: segments.replace(/\s+/g, " "),
    prosody: JSON.stringify(annotations),
  };
}

function effectivePronunciation(word: WordEntry, config?: PhonologyConfig | null): string {
  if (word.phonetic_override || !config) return word.phonetic_ipa;
  const generated = generateIPA(word.con_word_romanized, config);
  return generated.surface || generated.phonemic;
}

/** Display dimensions stay separate from the stable synchronization digests. */
export function getWordChangeDetails(
  word: WordEntry,
  parent: WordEntry,
  config?: PhonologyConfig | null,
  parentConfig?: PhonologyConfig | null,
): WordChangeDetails {
  const current = pronunciationParts(effectivePronunciation(word, config));
  const previous = pronunciationParts(effectivePronunciation(parent, parentConfig));
  const semanticSenses = (entry: WordEntry) => entry.senses.map(({ sense_id: _senseId, ...sense }) => sense);
  const meaning =
    JSON.stringify(semanticSenses(word)) !== JSON.stringify(semanticSenses(parent)) ||
    word.etymology.semantic_shift_note !== parent.etymology.semantic_shift_note;
  return {
    segments: current.segments !== previous.segments,
    prosody: current.prosody !== previous.prosody,
    meaning,
    technical: word.phonetic_override !== parent.phonetic_override ||
      (!meaning && JSON.stringify(word.senses) !== JSON.stringify(parent.senses)),
  };
}

/** Resolve direct inheritance while accepting older clones with stable IDs. */
export function getInheritedParentEntryId(
  word: WordEntry,
  parentLanguageId: string,
): string | null {
  const source = word.etymology;
  if (source.origin_type === "evolved") {
    if (source.source_language_id && source.source_language_id !== parentLanguageId) {
      return null;
    }
    return source.parent_entry_id ?? word.entry_id;
  }
  if (
    source.origin_type === "a_priori" &&
    !source.parent_entry_id &&
    !source.source_language_id
  ) {
    return word.entry_id;
  }
  return null;
}

const DEFAULT_EVOLUTION: WordEvolution = {
  is_deprecated: false,
  deprecated_since_language_id: null,
  parent_snapshot_hash: null,
  last_synced_word_hash: null,
};

export function getWordEvolution(word: WordEntry): WordEvolution {
  return {
    is_deprecated:
      word.evolution?.is_deprecated ?? DEFAULT_EVOLUTION.is_deprecated,
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
  return (
    buildComparablePayload(currentWord) !== buildComparablePayload(parentWord)
  );
}
