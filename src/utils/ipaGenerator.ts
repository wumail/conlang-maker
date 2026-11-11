import { RomanizationMap, RomanizationRule, AllophonyRule, PhonologyConfig } from '../types';

const WORD_CHAR_RE = /[\p{L}\p{M}\p{N}]/u;

interface CompiledRomanizationRule {
  rule: RomanizationRule;
  foldedInput: string;
  charCount: number;
  beforeBoundary: boolean;
  beforeFolded: string;
  beforeCharCount: number;
  afterBoundary: boolean;
  afterFolded: string;
  afterCharCount: number;
  contextSpecificity: number;
}

function compileRules(rules: RomanizationRule[]): CompiledRomanizationRule[] {
  const compiled: CompiledRomanizationRule[] = [];
  for (const rule of rules) {
    const rawInput = rule.input.normalize('NFC');
    if (!rawInput) continue;

    const rawBefore = (rule.context_before ?? '').trim().normalize('NFC');
    const normBefore = rawBefore === '_' ? '' : rawBefore;
    const beforeBoundary = normBefore.startsWith('#');
    const beforeLiteral = beforeBoundary ? normBefore.slice(1) : normBefore;

    const rawAfter = (rule.context_after ?? '').trim().normalize('NFC');
    const normAfter = rawAfter === '_' ? '' : rawAfter;
    const afterBoundary = normAfter.endsWith('#');
    const afterLiteral = afterBoundary ? normAfter.slice(0, -1) : normAfter;

    const beforeCharCount = Array.from(beforeLiteral).length;
    const afterCharCount = Array.from(afterLiteral).length;
    const contextSpecificity =
      beforeCharCount + afterCharCount + (beforeBoundary ? 1 : 0) + (afterBoundary ? 1 : 0);

    compiled.push({
      rule,
      foldedInput: rawInput.toLowerCase(),
      charCount: Array.from(rawInput).length,
      beforeBoundary,
      beforeFolded: beforeLiteral.toLowerCase(),
      beforeCharCount,
      afterBoundary,
      afterFolded: afterLiteral.toLowerCase(),
      afterCharCount,
      contextSpecificity,
    });
  }

  compiled.sort(
    (a, b) => b.charCount - a.charCount || b.contextSpecificity - a.contextSpecificity,
  );
  return compiled;
}

function matchesBefore(
  chars: string[],
  pos: number,
  entry: CompiledRomanizationRule,
): boolean {
  if (entry.beforeCharCount > 0) {
    if (pos < entry.beforeCharCount) return false;
    const slice = chars.slice(pos - entry.beforeCharCount, pos).join('').toLowerCase();
    if (slice !== entry.beforeFolded) return false;
  }
  if (entry.beforeBoundary) {
    const boundaryIdx = pos - entry.beforeCharCount;
    if (boundaryIdx > 0 && WORD_CHAR_RE.test(chars[boundaryIdx - 1])) {
      return false;
    }
  }
  return true;
}

function matchesAfter(
  chars: string[],
  end: number,
  entry: CompiledRomanizationRule,
): boolean {
  if (entry.afterCharCount > 0) {
    if (end + entry.afterCharCount > chars.length) return false;
    const slice = chars.slice(end, end + entry.afterCharCount).join('').toLowerCase();
    if (slice !== entry.afterFolded) return false;
  }
  if (entry.afterBoundary) {
    const boundaryIdx = end + entry.afterCharCount;
    if (boundaryIdx < chars.length && WORD_CHAR_RE.test(chars[boundaryIdx])) {
      return false;
    }
  }
  return true;
}

/**
 * Convert romanized text to phoneme string using the given romanization map.
 * Greedy longest-input matching (with context specificity tie-breaking and `#` word boundaries).
 */
export const romanizationToPhonemes = (
  romanized: string,
  map: RomanizationMap,
): string => {
  if (!romanized) return '';
  const source = romanized.normalize('NFC');
  if (!map || map.rules.length === 0) return source;

  const compiled = compileRules(map.rules);
  if (compiled.length === 0) return source;

  const chars = Array.from(source);
  const out: string[] = [];
  let pos = 0;

  while (pos < chars.length) {
    let matched = false;
    for (const entry of compiled) {
      const end = pos + entry.charCount;
      if (end > chars.length) continue;
      const candidate = chars.slice(pos, end).join('').toLowerCase();
      if (candidate !== entry.foldedInput) continue;
      if (!matchesBefore(chars, pos, entry) || !matchesAfter(chars, end, entry)) continue;

      out.push(entry.rule.output_phoneme.normalize('NFC'));
      pos = end;
      matched = true;
      break;
    }
    if (!matched) {
      out.push(chars[pos].toLowerCase());
      pos += 1;
    }
  }

  return out.join('');
};

/**
 * Expand a context pattern string into a regex fragment.
 * Supports:
 *   - `#` → word boundary (^ for before, $ for after)
 *   - Single-letter macro symbols (e.g. `V` → `(?:a|e|i|o|u)`)
 *   - Multi-character sequences (e.g. `lV` → `l(?:a|e|i|o|u)`)
 *   - `_` or empty → empty string
 */
const expandContext = (
  pattern: string,
  macros: Record<string, string[]>,
  position: 'before' | 'after'
): string => {
  if (!pattern || pattern === '_') return '';
  if (pattern === '#') return position === 'before' ? '^' : '$';

  let result = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '#') {
      result += position === 'before' ? '^' : '$';
      i++;
    } else if (macros[ch] && macros[ch].length > 0) {
      const sorted = [...macros[ch]].sort((a, b) => b.length - a.length);
      const alt = sorted.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      result += `(?:${alt})`;
      i++;
    } else {
      // Literal character — escape regex special chars
      result += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return result;
};

/**
 * Apply a single allophony rule to the phoneme string.
 * Rewritten to avoid Regex Lookbehind (?<=...) which is unsupported in Safari < 16.4.
 * Uses a capturing group for the 'before' context and a lookahead for the 'after' context.
 */
const applyRule = (
  phonemes: string,
  rule: AllophonyRule,
  macros: Record<string, string[]>
): string => {
  const beforeRaw = expandContext(rule.context_before, macros, 'before');
  const afterRaw = expandContext(rule.context_after, macros, 'after');
  const escapedTarget = rule.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  try {
    const beforeGroup = beforeRaw ? `(${beforeRaw})` : '()';
    const afterLookahead = afterRaw ? `(?=${afterRaw})` : '';
    const pattern = `${beforeGroup}(${escapedTarget})${afterLookahead}`;

    const regex = new RegExp(pattern, 'g');
    return phonemes.replace(regex, `$1${rule.replacement}`);
  } catch {
    console.warn(`[Allophony] Invalid regex for rule "${rule.rule_id}": target="${rule.target}"`);
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
