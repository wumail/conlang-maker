import { RomanizationMap, AllophonyRule, PhonologyConfig } from '../types';

/**
 * Convert romanized text to phoneme string using the given romanization map.
 * Rules are sorted by input length (longest first) for greedy matching.
 * Context-sensitive rules are checked but simple string prefix matching is used
 * (Phase 1 simplification — full regex context will come in Phase 2).
 */
export const romanizationToPhonemes = (
  romanized: string,
  map: RomanizationMap
): string => {
  if (!map || map.rules.length === 0) return romanized;

  // Sort rules by input length descending for greedy match
  const sorted = [...map.rules].sort((a, b) => b.input.length - a.input.length);

  let result = '';
  let i = 0;
  const lower = romanized.toLowerCase();

  while (i < lower.length) {
    let matched = false;
    for (const rule of sorted) {
      if (!rule.input) continue;
      if (lower.startsWith(rule.input, i)) {
        // Context check (simple: _ means "any", empty also means "any")
        const beforeOk =
          !rule.context_before || rule.context_before === '_' ||
          (i > 0 && lower[i - 1] === rule.context_before);
        const afterOk =
          !rule.context_after || rule.context_after === '_' ||
          (i + rule.input.length < lower.length &&
            lower[i + rule.input.length] === rule.context_after);

        if (beforeOk && afterOk) {
          result += rule.output_phoneme;
          i += rule.input.length;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      // Pass through character as-is (identity mapping)
      result += lower[i];
      i++;
    }
  }
  return result;
};

/**
 * Expand a macro symbol to a regex character class.
 */
const expandMacro = (symbol: string, macros: Record<string, string[]>): string => {
  if (!symbol || symbol === '_') return '.';
  return macros[symbol] ? `[${macros[symbol].join('')}]` : symbol;
};

/**
 * Apply a single allophony rule to the phoneme string.
 * Uses capture groups instead of lookbehind/lookahead for compatibility.
 */
const applyRule = (
  phonemes: string,
  rule: AllophonyRule,
  macros: Record<string, string[]>
): string => {
  const before = expandMacro(rule.context_before, macros);
  const after = expandMacro(rule.context_after, macros);
  try {
    const pattern = new RegExp(`(${before})(${rule.target})(${after})`, 'g');
    return phonemes.replace(pattern, `$1${rule.replacement}$3`);
  } catch {
    // Invalid regex — skip rule silently
    return phonemes;
  }
};

/**
 * Apply all allophony rules sorted by priority (higher priority first).
 */
export const applyAllophony = (
  phonemes: string,
  rules: AllophonyRule[],
  macros: Record<string, string[]>
): string => {
  const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return sorted.reduce((current, rule) => applyRule(current, rule, macros), phonemes);
};

/**
 * Full IPA generation pipeline:
 * romanized text → phonemes (via romanization map) → allophony → IPA string
 *
 * Returns the IPA string wrapped in slashes: /.../ for phonemic, [...] for surface.
 */
export const generateIPA = (
  romanized: string,
  config: PhonologyConfig
): { phonemic: string; surface: string } => {
  // Find the default romanization map, fallback to first
  const defaultMap =
    config.romanization_maps.find(m => m.is_default) ??
    config.romanization_maps[0];

  if (!defaultMap || !romanized.trim()) {
    return { phonemic: '', surface: '' };
  }

  const phonemes = romanizationToPhonemes(romanized, defaultMap);
  const surface = applyAllophony(
    phonemes,
    config.allophony_rules,
    config.phonotactics.macros
  );

  return {
    phonemic: `/${phonemes}/`,
    surface: phonemes !== surface ? `[${surface}]` : '',
  };
};
