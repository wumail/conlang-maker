/**
 * derivationEngine.ts — 派生词生成引擎
 *
 * 从 DerivationEditor 中提取的独立模块
 * 复用 morphologyEngine.applyInflection() 应用派生规则
 */
import type { WordEntry, DerivationRule, PhonologyConfig, InflectionRule } from '../types';
import { applyInflection } from './morphologyEngine';
import { generateIPA } from './ipaGenerator';

export interface DerivedWordPreview {
    source: WordEntry;
    derived: string;
    ipa: string;
}

/**
 * 将 DerivationRule 转换为 InflectionRule 以复用形态引擎
 */
function toInflectionRule(rule: DerivationRule): InflectionRule {
    return {
        rule_id: rule.rule_id,
        pos_id: rule.source_pos_id,
        dimension_values: {},
        type: rule.type,
        affix: rule.affix,
        tag: '',
        match_regex: '.*',
        disabled: false,
        condition: rule.condition,
        infix_config: rule.infix_config,
        circumfix_config: rule.circumfix_config,
    };
}

/**
 * 对源词列表批量应用派生规则，返回预览
 */
export function generateDerivedWords(
    sourceWords: WordEntry[],
    rule: DerivationRule,
    phonoConfig: PhonologyConfig
): DerivedWordPreview[] {
    const inflRule = toInflectionRule(rule);
    return sourceWords.map(w => {
        const { result } = applyInflection(w.con_word_romanized, inflRule, phonoConfig);
        const { phonemic } = generateIPA(result, phonoConfig);
        return { source: w, derived: result, ipa: phonemic };
    });
}
