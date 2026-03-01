/**
 * Word Generator — generates candidate words from phonotactic constraints.
 *
 * Input: phoneme inventory, syllable structure macros, blacklist patterns.
 * Output: random words that satisfy the phonotactic rules.
 */

import { PhonologyConfig } from '../types';
import type { MorphologicalTypology } from '../types';

// ── 改写规则 + Dropoff ───────────────────────────────────

export interface RewriteRule {
  pattern: string;      // 正则模式
  replacement: string;  // 替换字符串
}

export interface DropoffMap {
  [macroKey: string]: number; // macro key → dropoff 系数 (0.0~3.0)，默认 1.0
}

// A very short Swadesh-100 concept list for optional pairing
export const SWADESH_100: string[] = [
  'I', 'you', 'we', 'this', 'that', 'who', 'what', 'not', 'all', 'many',
  'one', 'two', 'big', 'long', 'small', 'woman', 'man', 'person', 'fish', 'bird',
  'dog', 'louse', 'tree', 'seed', 'leaf', 'root', 'bark', 'skin', 'flesh', 'blood',
  'bone', 'grease', 'egg', 'horn', 'tail', 'feather', 'hair', 'head', 'ear', 'eye',
  'nose', 'mouth', 'tooth', 'tongue', 'claw', 'foot', 'knee', 'hand', 'belly', 'neck',
  'breast', 'heart', 'liver', 'drink', 'eat', 'bite', 'see', 'hear', 'know', 'sleep',
  'die', 'kill', 'swim', 'fly', 'walk', 'come', 'lie', 'sit', 'stand', 'give',
  'say', 'sun', 'moon', 'star', 'water', 'rain', 'stone', 'sand', 'earth', 'cloud',
  'smoke', 'fire', 'ash', 'burn', 'path', 'mountain', 'red', 'green', 'yellow', 'white',
  'black', 'night', 'hot', 'cold', 'full', 'new', 'good', 'round', 'dry', 'name',
];

/**
 * Parse a syllable structure template like "CVC" into an array of macro keys.
 * Each character is treated as a macro reference. Multi-char macros can be
 * delimited by brackets, e.g. "(CC)V(CC)".
 */
export function parseSyllableStructure(template: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < template.length) {
    if (template[i] === '(') {
      const close = template.indexOf(')', i);
      if (close === -1) {
        result.push(template[i]);
        i++;
      } else {
        result.push(template.slice(i + 1, close));
        i = close + 1;
      }
    } else {
      result.push(template[i]);
      i++;
    }
  }
  return result;
}

/**
 * Expand optional segments. In a template like "C?VC?", the ? means the
 * preceding macro is optional. We handle this by generating syllable variants.
 */
export function expandOptional(template: string): string[] {
  // Find all ? markers
  const optPositions: number[] = [];
  for (let i = 0; i < template.length; i++) {
    if (template[i] === '?') optPositions.push(i);
  }
  if (optPositions.length === 0) return [template];

  // Generate all combinations of including/excluding optional elements
  // Generate all combinations of including/excluding optional elements
  // For simplicity, just generate the template with and without each optional char
  const variants: string[] = [];
  const n = optPositions.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    let result = '';
    let optIdx = 0;
    for (let i = 0; i < template.length; i++) {
      if (template[i] === '?') {
        optIdx++;
        continue;
      }
      if (i + 1 < template.length && template[i + 1] === '?') {
        if (mask & (1 << optIdx)) {
          result += template[i];
        }
        // optIdx will be incremented when we encounter '?'
      } else {
        result += template[i];
      }
    }
    variants.push(result);
  }
  // Deduplicate
  return [...new Set(variants)];
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 带 dropoff 的加权随机选择
 * dropoff = 1.0 时均匀分布；>1 时偏向列表前端；<1 时偏向后端
 */
function pickWeighted<T>(arr: T[], dropoff: number): T {
  if (dropoff <= 0 || dropoff === 1.0 || arr.length <= 1) return pickRandom(arr);
  // 生成权重：w[i] = (n - i) ^ dropoff
  const n = arr.length;
  const weights: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.pow(n - i, dropoff);
    weights.push(w);
    sum += w;
  }
  const r = Math.random() * sum;
  let cumulative = 0;
  for (let i = 0; i < n; i++) {
    cumulative += weights[i];
    if (r <= cumulative) return arr[i];
  }
  return arr[n - 1];
}

/**
 * 应用改写规则列表
 */
function applyRewriteRules(word: string, rules: RewriteRule[]): string {
  let result = word;
  for (const rule of rules) {
    try {
      result = result.replace(new RegExp(rule.pattern, 'g'), rule.replacement);
    } catch {
      // 无效正则，跳过
    }
  }
  return result;
}

/**
 * Generate a single syllable from macros and inventory.
 */
function generateSyllable(
  structure: string,
  macros: Record<string, string[]>,
  consonants: string[],
  vowels: string[],
  dropoffs?: DropoffMap
): string {
  const keys = parseSyllableStructure(structure);
  let result = '';
  for (const key of keys) {
    const d = dropoffs?.[key] ?? 1.0;
    if (macros[key] && macros[key].length > 0) {
      result += pickWeighted(macros[key], d);
    } else if (key === 'C' || key === 'c') {
      if (consonants.length > 0) result += pickWeighted(consonants, d);
    } else if (key === 'V' || key === 'v') {
      if (vowels.length > 0) result += pickWeighted(vowels, d);
    } else {
      result += key;
    }
  }
  return result;
}

/**
 * Check if a word matches any blacklist pattern.
 */
function matchesBlacklist(word: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    try {
      if (new RegExp(pat).test(word)) return true;
    } catch {
      // ignore invalid regex
    }
  }
  return false;
}

export interface GenerateOptions {
  count: number;
  minSyllables: number;
  maxSyllables: number;
  rewriteRules?: RewriteRule[];
  dropoffs?: DropoffMap;
}

/**
 * Generate a batch of words.
 */
export function generateWords(
  config: PhonologyConfig,
  options: GenerateOptions
): string[] {
  const { consonants, vowels } = config.phoneme_inventory;
  const macros = config.phonotactics.macros;
  const baseStructure = config.phonotactics.syllable_structure || 'CV';
  const blacklist = config.phonotactics.blacklist_patterns || [];

  const structures = expandOptional(baseStructure);
  const results: string[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  const maxAttempts = options.count * 20;

  const rewriteRules = options.rewriteRules || [];
  const dropoffs = options.dropoffs;

  while (results.length < options.count && attempts < maxAttempts) {
    attempts++;
    const syllableCount = options.minSyllables + Math.floor(Math.random() * (options.maxSyllables - options.minSyllables + 1));
    let word = '';
    for (let s = 0; s < syllableCount; s++) {
      const struct = pickRandom(structures);
      word += generateSyllable(struct, macros, consonants, vowels, dropoffs);
    }
    // 应用改写规则
    if (rewriteRules.length > 0) {
      word = applyRewriteRules(word, rewriteRules);
    }
    if (!word || seen.has(word)) continue;
    if (matchesBlacklist(word, blacklist)) continue;
    seen.add(word);
    results.push(word);
  }

  return results;
}

/**
 * 根据语言类型学推算默认生成参数
 *
 * - isolating: 1~2 音节，均匀 dropoff
 * - agglutinative: 2~4 音节，偏向前端 dropoff（模拟和谐倾向）
 * - fusional: 2~3 音节，中等 dropoff
 * - polysynthetic: 3~5 音节，低 dropoff
 */
export function deriveGeneratorConfigByTypology(
  morphType: MorphologicalTypology
): { minSyllables: number; maxSyllables: number; defaultDropoff: number } {
  switch (morphType) {
    case 'isolating':
      return { minSyllables: 1, maxSyllables: 2, defaultDropoff: 1.0 };
    case 'agglutinative':
      return { minSyllables: 2, maxSyllables: 4, defaultDropoff: 1.5 };
    case 'fusional':
      return { minSyllables: 2, maxSyllables: 3, defaultDropoff: 1.2 };
    case 'polysynthetic':
      return { minSyllables: 3, maxSyllables: 5, defaultDropoff: 0.8 };
    default:
      return { minSyllables: 1, maxSyllables: 3, defaultDropoff: 1.0 };
  }
}
