import type {
  FontInputConfig,
  GrammarConfig,
  PhonologyConfig,
  WordEntry,
} from "../../types";
import { generateIPA } from "./ipaGenerator";
import { applyInflectionTypologyAware } from "./morphologyEngine";
import { getInheritedParentEntryId } from "./wordLifecycle";

export interface FontInputIndex {
  byEntryId: Record<string, string>;
  byText: Record<string, string>;
}

export interface FontInputSource {
  languageId: string;
  words: WordEntry[];
  phonology: PhonologyConfig;
  grammar: GrammarConfig;
}

export const EMPTY_FONT_INPUT_INDEX: FontInputIndex = {
  byEntryId: Object.create(null),
  byText: Object.create(null),
};

function textKey(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

/** Preserve phoneme boundaries before a font interprets its multigraphs. */
export function phonemesToFontInput(
  ipa: string,
  config: FontInputConfig,
  source = false,
): string {
  const input = ipa.trim().replace(/^[/\[]+|[/\]]+$/g, "").normalize("NFC");
  const substitutions = source ? (config.source_substitutions ?? {}) : {};
  const phonemes = [...new Set([...Object.keys(config.phonemes), ...Object.keys(substitutions)])]
    .sort((a, b) => b.length - a.length);
  const vowels = new Set(config.vowels);
  let output = "";
  let previous: { text: string; vowel: boolean } | null = null;
  let offset = 0;

  while (offset < input.length) {
    const character = String.fromCodePoint(input.codePointAt(offset)!);
    if (["ˈ", "ˌ", ".", "·"].includes(character)) {
      offset += character.length;
      continue;
    }
    const phoneme = phonemes.find((key) => input.startsWith(key, offset));
    if (!phoneme) {
      output += character;
      previous = null;
      offset += character.length;
      continue;
    }
    const replacement = substitutions[phoneme];
    const text = config.phonemes[replacement ?? phoneme] ?? replacement ?? phoneme;
    const vowel = vowels.has(replacement ?? phoneme);
    const joinsMultigraph = previous && !previous.vowel && !vowel &&
      config.multigraphs.includes(previous.text + text);
    if ((previous?.vowel && vowel) || joinsMultigraph) {
      output += config.separator;
    }
    output += text;
    previous = { text, vowel };
    offset += phoneme.length;
  }
  return output;
}

function wordIpa(word: WordEntry, config: PhonologyConfig): string {
  if (word.phonetic_override) return word.phonetic_ipa;
  const generated = generateIPA(word.con_word_romanized, config);
  return generated.surface || generated.phonemic;
}

/** One shared index serves dictionary entries, complete inflection forms and corpus text. */
export function buildFontInputIndex(
  words: WordEntry[],
  grammar: GrammarConfig,
  config: PhonologyConfig,
  source?: FontInputSource,
): FontInputIndex {
  const settings = config.font_input;
  if (!settings) return EMPTY_FONT_INPUT_INDEX;
  const byEntryId: Record<string, string> = Object.create(null);
  const candidates = new Map<string, Set<string>>();
  const wordsById = new Map(words.map((word) => [word.entry_id, word]));
  const sourceWords = new Map(source?.words.map((word) => [word.entry_id, word]));
  const record = (text: string, input: string) => {
    const key = textKey(text);
    const values = candidates.get(key) ?? new Set<string>();
    values.add(input);
    candidates.set(key, values);
  };
  const inheritedWord = (word: WordEntry): WordEntry | undefined => {
    if (!source || !settings.use_parent_phonemes) return undefined;
    const parentId = getInheritedParentEntryId(word, source.languageId);
    return parentId ? sourceWords.get(parentId) : undefined;
  };

  for (const word of words) {
    const parent = inheritedWord(word);
    const ipa = parent && source ? wordIpa(parent, source.phonology) : wordIpa(word, config);
    const input = phonemesToFontInput(ipa, settings, Boolean(parent));
    byEntryId[word.entry_id] = input;
    record(word.con_word_romanized, input);
  }
  for (const form of grammar.irregular_overrides) {
    const word = wordsById.get(form.entry_id);
    if (!word) continue;
    const parent = inheritedWord(word);
    let ipa: string;
    if (parent && source) {
      const dimensions = source.grammar.inflection_dimensions.filter(
        (dimension) => form.dimension_values[dimension.dim_id],
      );
      const matchingSense = parent.senses.find((sense) => dimensions.every(
        (dimension) => dimension.applies_to_pos.includes(sense.pos_id),
      ));
      const posId = matchingSense?.pos_id ?? parent.senses[0]?.pos_id ?? "";
      const generated = applyInflectionTypologyAware(
        parent.con_word_romanized,
        parent.entry_id,
        posId,
        form.dimension_values,
        source.grammar,
        source.phonology,
      );
      const pronunciation = generateIPA(generated.result, source.phonology, {
        stem_start: generated.stem_start,
      });
      ipa = pronunciation.surface || pronunciation.phonemic;
    } else {
      const generated = generateIPA(form.surface_form, config, { stem_start: form.stem_start });
      ipa = generated.surface || generated.phonemic;
    }
    record(form.surface_form, phonemesToFontInput(ipa, settings, Boolean(parent)));
  }
  const byText: Record<string, string> = Object.create(null);
  for (const [text, values] of candidates) {
    if (values.size === 1) byText[text] = values.values().next().value!;
  }
  return { byEntryId, byText };
}

export function textToFontInput(
  text: string,
  config: PhonologyConfig,
  index: FontInputIndex = EMPTY_FONT_INPUT_INDEX,
  entryId?: string,
  ipa?: string,
): string {
  const settings = config.font_input;
  if (!settings) return text;
  if (entryId && index.byEntryId[entryId] && !ipa) return index.byEntryId[entryId];
  const exact = index.byText[textKey(text)];
  if (exact !== undefined) return exact;
  if (ipa) return phonemesToFontInput(ipa, settings);
  return text.replace(/[\p{L}\p{M}]+(?:[·|'’-][\p{L}\p{M}]+)*/gu, (word) => {
    const known = index.byText[textKey(word)];
    if (known !== undefined) return known;
    const generated = generateIPA(textKey(word), config);
    return phonemesToFontInput(generated.surface || generated.phonemic, settings);
  });
}
