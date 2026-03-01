/**
 * typologyAnalyzer.ts — 类型学指数自动推算
 *
 * 根据词库和语法配置自动估算：
 * - synthesis_index: 综合度（平均每词词素数）
 * - fusion_index: 融合度（每词缀承载的语法信息数）
 *
 * 这些值可以覆盖用户手动设定的值，或在 auto_estimated=true 时自动填充。
 */
import type { WordEntry, GrammarConfig } from '../types';

export interface TypologyEstimation {
  synthesis_index: number;
  fusion_index: number;
  word_count: number;
  rules_analyzed: number;
}

/**
 * 估算综合度指数（Synthesis Index）
 *
 * 算法：统计所有屈折规则应用后产生的平均词素数。
 * - 每个词根 = 1 词素
 * - 每条应用的屈折规则 = +1 词素（融合规则可能携带多维度但仍计为 1）
 * - synthesis_index = 词素总数 / 词条数
 *
 * 简化替代：使用规则密度近似
 * - 计算每个词性有多少活跃规则
 * - 对每个词条按词性统计适用规则数
 * - 取平均值 + 1（词根本身）
 */
function estimateSynthesisIndex(
  words: WordEntry[],
  grammarConfig: GrammarConfig
): number {
  if (words.length === 0) return 1.0;

  const activeRules = grammarConfig.inflection_rules.filter(r => !r.disabled);
  if (activeRules.length === 0) return 1.0;

  // 按词性统计每个词性有多少维度值组合
  const posRuleCounts = new Map<string, number>();
  for (const rule of activeRules) {
    posRuleCounts.set(rule.pos_id, (posRuleCounts.get(rule.pos_id) ?? 0) + 1);
  }

  // 统计每个词条适用的平均规则数
  let totalMorphemes = 0;
  let countedWords = 0;

  for (const word of words) {
    for (const sense of word.senses) {
      const ruleCount = posRuleCounts.get(sense.pos_id) ?? 0;
      if (ruleCount > 0) {
        // 对该词性的所有维度取中位数（每维度通常只选1个值）
        const dims = grammarConfig.inflection_dimensions.filter(d =>
          d.applies_to_pos.includes(sense.pos_id)
        );
        // 平均每个词形的词素数 ≈ 1（词根）+ 维度数（每维度一个词缀）
        const avgMorphemesPerForm = 1 + Math.min(dims.length, ruleCount);
        totalMorphemes += avgMorphemesPerForm;
        countedWords++;
      }
    }
  }

  if (countedWords === 0) return 1.0;
  return Math.min(5.0, Math.max(1.0, totalMorphemes / countedWords));
}

/**
 * 估算融合度指数（Fusion Index）
 *
 * 算法：每条规则的 dimension_values 中有多少个值？
 * - 黏着语：通常每规则 1 个维度值 → fusion ≈ 1.0
 * - 屈折语：常融合 2-3 个维度 → fusion ≈ 2.0-3.0
 *
 * fusion_index = 所有规则的维度值数平均
 */
function estimateFusionIndex(grammarConfig: GrammarConfig): number {
  const activeRules = grammarConfig.inflection_rules.filter(r => !r.disabled);
  if (activeRules.length === 0) return 1.0;

  let totalDimValues = 0;
  for (const rule of activeRules) {
    const dimCount = Object.keys(rule.dimension_values).length;
    totalDimValues += Math.max(1, dimCount);
  }

  return Math.min(3.0, Math.max(1.0, totalDimValues / activeRules.length));
}

/**
 * 综合推算类型学指数
 */
export function analyzeTypology(
  words: WordEntry[],
  grammarConfig: GrammarConfig
): TypologyEstimation {
  const activeRules = grammarConfig.inflection_rules.filter(r => !r.disabled);

  return {
    synthesis_index: estimateSynthesisIndex(words, grammarConfig),
    fusion_index: estimateFusionIndex(grammarConfig),
    word_count: words.length,
    rules_analyzed: activeRules.length,
  };
}
