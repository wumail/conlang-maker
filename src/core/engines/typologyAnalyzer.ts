/**
 * typologyAnalyzer.ts — 类型学指数自动推算
 *
 * 根据词库和语法配置自动估算：
 * - synthesis_index: 综合度（平均每词词素数）
 * - fusion_index: 融合度（每词缀承载的语法信息数）
 */
import type { WordEntry, GrammarConfig } from "../../types";

export interface TypologyEstimation {
  synthesis_index: number;
  fusion_index: number;
  word_count: number;
  rules_analyzed: number;
}

function estimateSynthesisIndex(
  words: WordEntry[],
  grammarConfig: GrammarConfig,
): number {
  if (words.length === 0) return 1.0;

  const activeRules = grammarConfig.inflection_rules.filter((r) => !r.disabled);
  if (activeRules.length === 0) return 1.0;

  const posRuleCounts = new Map<string, number>();
  for (const rule of activeRules) {
    posRuleCounts.set(rule.pos_id, (posRuleCounts.get(rule.pos_id) ?? 0) + 1);
  }

  let totalMorphemes = 0;
  let countedWords = 0;

  for (const word of words) {
    for (const sense of word.senses) {
      const ruleCount = posRuleCounts.get(sense.pos_id) ?? 0;
      if (ruleCount > 0) {
        const dims = grammarConfig.inflection_dimensions.filter((d) =>
          d.applies_to_pos.includes(sense.pos_id),
        );
        const avgMorphemesPerForm = 1 + Math.min(dims.length, ruleCount);
        totalMorphemes += avgMorphemesPerForm;
        countedWords++;
      }
    }
  }

  if (countedWords === 0) return 1.0;
  return Math.min(5.0, Math.max(1.0, totalMorphemes / countedWords));
}

function estimateFusionIndex(grammarConfig: GrammarConfig): number {
  const activeRules = grammarConfig.inflection_rules.filter((r) => !r.disabled);
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
  grammarConfig: GrammarConfig,
): TypologyEstimation {
  const activeRules = grammarConfig.inflection_rules.filter((r) => !r.disabled);

  return {
    synthesis_index: estimateSynthesisIndex(words, grammarConfig),
    fusion_index: estimateFusionIndex(grammarConfig),
    word_count: words.length,
    rules_analyzed: activeRules.length,
  };
}
