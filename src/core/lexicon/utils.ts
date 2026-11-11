import { PhonologyConfig, WordEntry } from "../../types";
import { generateIPA } from "../engines/ipaGenerator";
import { nowIso } from "./ids";

export { nowIso };

/**
 * Checks whether a WordEntry is valid for persistence / sync, matching Rust `is_valid_word_entry`:
 * - `con_word_romanized.trim()` is non-empty and not `"new_word"`
 * - `senses` contains at least one sense with a non-empty `gloss.trim()`
 */
export function isValidWordEntry(word: WordEntry): boolean {
  const romanized = (word.con_word_romanized ?? "").trim();
  if (!romanized || romanized === "new_word") return false;
  if (!Array.isArray(word.senses)) return false;
  return word.senses.some((s) => (s?.gloss ?? "").trim().length > 0);
}

/**
 * Validates a (possibly partial) WordEntry and returns human-readable error messages.
 * Returns an empty array when valid.
 */
export function validateWordEntry(word: Partial<WordEntry>): string[] {
  const errors: string[] = [];

  if (typeof word.con_word_romanized !== "string") {
    errors.push("con_word_romanized is required and must be a string");
  } else {
    const trimmed = word.con_word_romanized.trim();
    if (trimmed.length === 0) {
      errors.push("con_word_romanized must not be empty");
    } else if (trimmed === "new_word") {
      errors.push('con_word_romanized must not be the placeholder "new_word"');
    }
  }

  if (!Array.isArray(word.senses) || word.senses.length === 0) {
    errors.push("senses must be a non-empty array");
  } else {
    let hasNonEmptyGloss = false;
    word.senses.forEach((sense, idx) => {
      if (!sense || typeof sense !== "object") {
        errors.push(`senses[${idx}] must be an object`);
        return;
      }
      if (typeof sense.gloss !== "string") {
        errors.push(`senses[${idx}].gloss must be a string`);
      } else if (sense.gloss.trim().length > 0) {
        hasNonEmptyGloss = true;
      }
      if (sense.definitions !== undefined && !Array.isArray(sense.definitions)) {
        errors.push(`senses[${idx}].definitions must be an array`);
      }
      if (sense.examples !== undefined && !Array.isArray(sense.examples)) {
        errors.push(`senses[${idx}].examples must be an array`);
      }
    });
    if (!hasNonEmptyGloss) {
      errors.push("at least one sense must have a non-empty gloss");
    }
  }

  return errors;
}

/**
 * Computes the lexicon bucket stem (without `.ndjson`) matching Rust `bucket_filename`:
 * takes the first Unicode codepoint, lowercases it and inspects its first codepoint;
 * ASCII `[a-z]` maps to `lexicon_<letter>`, everything else maps to `lexicon_others`.
 */
export function bucketKey(spelling: string): string {
  const firstCodepoint = [...spelling][0];
  const lowerFirst = firstCodepoint
    ? ([...firstCodepoint.toLowerCase()][0] ?? "_")
    : "_";
  if (/^[a-z]$/.test(lowerFirst)) {
    return `lexicon_${lowerFirst}`;
  }
  return "lexicon_others";
}

/** Full NDJSON bucket filename (`<bucketKey>.ndjson`). */
export function bucketFilename(spelling: string): string {
  return `${bucketKey(spelling)}.ndjson`;
}

/**
 * Computes a word's IPA string from phonology config unless `phonetic_override` is true.
 */
export function computeWordIpa(
  word: Pick<WordEntry, "con_word_romanized" | "phonetic_ipa" | "phonetic_override">,
  phonoConfig: PhonologyConfig,
): string {
  if (word.phonetic_override) {
    return word.phonetic_ipa;
  }
  return generateIPA(word.con_word_romanized, phonoConfig).phonemic;
}
