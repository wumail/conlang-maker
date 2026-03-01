/**
 * IPA 模糊搜索
 * 基于音素区分特征计算加权编辑距离，支持按 IPA 语音相似度搜索词典
 */
import { PHONEME_FEATURES } from "../data/ipa_features";
import { tokenizePhonemes } from "./phonemeTokenizer";
import { WordEntry } from "../types";

/** 特征维度权重——发音位置差异、发音方式差异、清浊差异应有不同代价 */
const MANNER_FEATURES = new Set([
  "stop", "fricative", "nasal", "trill", "tap", "lateral",
  "approximant", "affricate",
]);
const PLACE_FEATURES = new Set([
  "bilabial", "labiodental", "dental", "alveolar", "postalveolar",
  "retroflex", "alveolopalatal", "palatal", "velar", "uvular",
  "pharyngeal", "glottal",
]);
const VOICING_FEATURES = new Set(["voiced", "voiceless"]);
const TYPE_FEATURES = new Set(["consonant", "vowel"]);

/**
 * 两个音素之间的特征距离 [0, 1]
 * 0 = 完全相同，1 = 完全不同
 */
export function phonemeDistance(a: string, b: string): number {
  if (a === b) return 0;
  const fa = PHONEME_FEATURES[a];
  const fb = PHONEME_FEATURES[b];
  // 未知音素退化为二元匹配
  if (!fa || !fb) return a === b ? 0 : 1;

  const setB = new Set(fb);

  // 类型不同（辅音 vs 元音）= 最大距离
  const typeA = fa.find((f) => TYPE_FEATURES.has(f));
  const typeB = fb.find((f) => TYPE_FEATURES.has(f));
  if (typeA !== typeB) return 1;

  let diff = 0;
  let total = 0;

  // 发音方式维度（权重 0.4）
  const mannerA = fa.filter((f) => MANNER_FEATURES.has(f));
  const mannerB = fb.filter((f) => MANNER_FEATURES.has(f));
  const mannerMatch = mannerA.some((f) => mannerB.includes(f));
  diff += mannerMatch ? 0 : 0.4;
  total += 0.4;

  // 发音位置维度（权重 0.35）
  const placeA = fa.filter((f) => PLACE_FEATURES.has(f));
  const placeB = fb.filter((f) => PLACE_FEATURES.has(f));
  const placeMatch = placeA.some((f) => placeB.includes(f));
  diff += placeMatch ? 0 : 0.35;
  total += 0.35;

  // 清浊维度（权重 0.15）
  const voiceA = fa.find((f) => VOICING_FEATURES.has(f));
  const voiceB = fb.find((f) => VOICING_FEATURES.has(f));
  diff += voiceA === voiceB ? 0 : 0.15;
  total += 0.15;

  // 其他特征公共差集（权重 0.1）
  const otherA = fa.filter(
    (f) => !TYPE_FEATURES.has(f) && !MANNER_FEATURES.has(f) && !PLACE_FEATURES.has(f) && !VOICING_FEATURES.has(f)
  );
  const otherB = fb.filter(
    (f) => !TYPE_FEATURES.has(f) && !MANNER_FEATURES.has(f) && !PLACE_FEATURES.has(f) && !VOICING_FEATURES.has(f)
  );
  const allOther = new Set([...otherA, ...otherB]);
  const commonOther = otherA.filter((f) => setB.has(f)).length;
  const otherOverlap = allOther.size > 0 ? commonOther / allOther.size : 1;
  diff += (1 - otherOverlap) * 0.1;
  total += 0.1;

  return Math.min(diff / total, 1);
}

/** 插入/删除代价 */
const GAP_COST = 0.6;

/**
 * 加权编辑距离（基于音素 token）
 * 替换代价 = phonemeDistance(a, b)，插入/删除代价 = GAP_COST
 */
export function weightedEditDistance(tokensA: string[], tokensB: string[]): number {
  const m = tokensA.length;
  const n = tokensB.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) dp[i][0] = i * GAP_COST;
  for (let j = 1; j <= n; j++) dp[0][j] = j * GAP_COST;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sub = dp[i - 1][j - 1] + phonemeDistance(tokensA[i - 1], tokensB[j - 1]);
      const del = dp[i - 1][j] + GAP_COST;
      const ins = dp[i][j - 1] + GAP_COST;
      dp[i][j] = Math.min(sub, del, ins);
    }
  }
  return dp[m][n];
}

/**
 * 归一化距离 [0, 1]
 */
function normalizedDistance(tokensA: string[], tokensB: string[]): number {
  const maxLen = Math.max(tokensA.length, tokensB.length);
  if (maxLen === 0) return 0;
  return weightedEditDistance(tokensA, tokensB) / (maxLen * GAP_COST);
}

export interface IPASearchResult {
  entry: WordEntry;
  distance: number;
}

/**
 * 对词典列表按 IPA 语音相似度搜索
 * @param query IPA 查询字符串
 * @param words 词典条目列表
 * @param inventory 音素总表（用于 tokenize）
 * @param threshold 最大归一化距离阈值（默认 0.6）
 */
export function ipaFuzzySearch(
  query: string,
  words: WordEntry[],
  inventory: string[],
  threshold = 0.6,
): IPASearchResult[] {
  if (!query.trim()) return [];
  const queryTokens = tokenizePhonemes(query.trim(), inventory);
  if (queryTokens.length === 0) return [];

  const results: IPASearchResult[] = [];
  for (const entry of words) {
    const ipa = entry.phonetic_ipa;
    if (!ipa) continue;
    const entryTokens = tokenizePhonemes(ipa, inventory);
    if (entryTokens.length === 0) continue;
    const dist = normalizedDistance(queryTokens, entryTokens);
    if (dist <= threshold) {
      results.push({ entry, distance: dist });
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  return results;
}
