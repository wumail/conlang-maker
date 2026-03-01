/**
 * morphologyEngine.ts — Phase 2 完整形态应用引擎
 *
 * 支持 6 种形态类型：prefix, suffix, infix, circumfix, reduplication, ablaut
 * 以及条件词缀（IF/ELSE 逻辑）
 *
 * Phase 3 类型学扩展：
 * - 孤立语：仅在明确设定规则时应用，通常返回原形
 * - 黏着语：按 affix_slot 顺序逐槽位叠加词缀
 * - 屈折语：优先检查 IrregularOverride，其次按 ConjugationClass 分组应用
 */
import type {
    InflectionRule,
    PhonemeInventory,
    PhonologyConfig,
    ConditionClause,
    MorphologyType,
    GrammarConfig,
    IrregularOverride,
} from '../types';

// ── 类型定义 ─────────────────────────────────────────────

export interface InflectionResult {
    result: string;
    applied: boolean;
    log: string;
}

// ── 辅助函数 ─────────────────────────────────────────────

function endsWithPhonemeClass(
    word: string,
    cls: 'vowel' | 'consonant',
    inventory: PhonemeInventory
): boolean {
    if (!word) return false;
    const pool = cls === 'vowel' ? inventory.vowels : inventory.consonants;
    // 从长到短匹配（支持多字符音素如 "tʃ"）
    const sorted = [...pool].sort((a, b) => b.length - a.length);
    return sorted.some(p => word.endsWith(p));
}

function startsWithPhonemeClass(
    word: string,
    cls: 'vowel' | 'consonant',
    inventory: PhonemeInventory
): boolean {
    if (!word) return false;
    const pool = cls === 'vowel' ? inventory.vowels : inventory.consonants;
    const sorted = [...pool].sort((a, b) => b.length - a.length);
    return sorted.some(p => word.startsWith(p));
}

function resolveCondition(
    word: string,
    condition: ConditionClause,
    inventory: PhonemeInventory
): { affix: string; matched: boolean; log: string } {
    let matched = false;
    let log = '';

    switch (condition.type) {
        case 'ends_with_phoneme_class':
            matched = endsWithPhonemeClass(word, condition.class ?? 'vowel', inventory);
            log = `ends_with ${condition.class}: ${matched}`;
            break;
        case 'starts_with_phoneme_class':
            matched = startsWithPhonemeClass(word, condition.class ?? 'vowel', inventory);
            log = `starts_with ${condition.class}: ${matched}`;
            break;
        case 'matches_regex':
            try {
                matched = new RegExp(condition.regex ?? '').test(word);
                log = `regex /${condition.regex}/: ${matched}`;
            } catch {
                log = `invalid regex: ${condition.regex}`;
                matched = false;
            }
            break;
    }

    return {
        affix: matched ? condition.then_affix : condition.else_affix,
        matched,
        log: `condition(${log}) → "${matched ? condition.then_affix : condition.else_affix}"`,
    };
}

// ── 各形态类型实现 ───────────────────────────────────────

function applyPrefix(word: string, affix: string): string {
    return affix + word;
}

function applySuffix(word: string, affix: string): string {
    return word + affix;
}

function applyInfix(word: string, positionRegex: string, morpheme: string): { result: string; log: string } {
    try {
        const regex = new RegExp(positionRegex);
        const match = regex.exec(word);
        if (match && match.index !== undefined) {
            const insertPos = match.index + match[0].length;
            const result = word.slice(0, insertPos) + morpheme + word.slice(insertPos);
            return { result, log: `infix "${morpheme}" at pos ${insertPos}` };
        }
        return { result: word + morpheme, log: `infix regex no match, appended` };
    } catch {
        return { result: word, log: `invalid infix regex: ${positionRegex}` };
    }
}

function applyCircumfix(word: string, prefixPart: string, suffixPart: string): string {
    return prefixPart + word + suffixPart;
}

function applyReduplication(word: string, mode: 'full' | 'partial_onset' | 'partial_coda', inventory: PhonemeInventory): { result: string; log: string } {
    if (mode === 'full') {
        return { result: word + word, log: 'full reduplication' };
    }

    // 音节切分简化实现：找到第一个元音簇边界
    const vowels = new Set(inventory.vowels);

    if (mode === 'partial_onset') {
        // 首音节：从开头到第一个元音（含）之后的辅音之前
        let endIdx = 0;
        let foundVowel = false;
        for (let i = 0; i < word.length; i++) {
            if (vowels.has(word[i])) {
                foundVowel = true;
                endIdx = i + 1;
            } else if (foundVowel) {
                break;
            }
        }
        if (endIdx === 0) endIdx = Math.min(2, word.length);
        const onset = word.slice(0, endIdx);
        return { result: onset + word, log: `partial onset "${onset}" + word` };
    }

    // partial_coda: 尾音节
    let startIdx = word.length;
    let foundVowel = false;
    for (let i = word.length - 1; i >= 0; i--) {
        if (vowels.has(word[i])) {
            foundVowel = true;
            startIdx = i;
        } else if (foundVowel) {
            startIdx = i + 1;
            break;
        }
    }
    if (startIdx >= word.length) startIdx = Math.max(0, word.length - 2);
    const coda = word.slice(startIdx);
    return { result: word + coda, log: `word + partial coda "${coda}"` };
}

function applyAblaut(word: string, targetVowel: string, replacementVowel: string): { result: string; log: string } {
    if (!word.includes(targetVowel)) {
        return { result: word, log: `ablaut: "${targetVowel}" not found` };
    }
    const result = word.replace(targetVowel, replacementVowel);
    return { result, log: `ablaut: "${targetVowel}" → "${replacementVowel}"` };
}

// ── 主引擎函数 ───────────────────────────────────────────

export function applyInflection(
    word: string,
    rule: InflectionRule,
    phonoConfig: PhonologyConfig
): InflectionResult {
    const inventory = phonoConfig.phoneme_inventory;

    // 1. 检查 match_regex
    if (rule.match_regex && rule.match_regex !== '.*') {
        try {
            if (!new RegExp(rule.match_regex).test(word)) {
                return { result: word, applied: false, log: `regex /${rule.match_regex}/ did not match` };
            }
        } catch {
            return { result: word, applied: false, log: `invalid regex: ${rule.match_regex}` };
        }
    }

    // 2. 解析条件逻辑
    let effectiveAffix = rule.affix;
    let conditionLog = '';
    if (rule.condition) {
        const condResult = resolveCondition(word, rule.condition, inventory);
        effectiveAffix = condResult.affix;
        conditionLog = condResult.log;
    }

    // 3. 按 type 分支应用
    let result = word;
    let typeLog = '';

    const ruleType: MorphologyType = rule.type;

    switch (ruleType) {
        case 'prefix':
            result = applyPrefix(word, effectiveAffix);
            typeLog = `prefix "${effectiveAffix}"`;
            break;

        case 'suffix':
            result = applySuffix(word, effectiveAffix);
            typeLog = `suffix "${effectiveAffix}"`;
            break;

        case 'infix': {
            const cfg = rule.infix_config;
            if (cfg) {
                const infResult = applyInfix(word, cfg.position_regex, cfg.morpheme);
                result = infResult.result;
                typeLog = infResult.log;
            } else {
                typeLog = 'infix: missing config';
            }
            break;
        }

        case 'circumfix': {
            const cfg = rule.circumfix_config;
            if (cfg) {
                result = applyCircumfix(word, cfg.prefix_part, cfg.suffix_part);
                typeLog = `circumfix "${cfg.prefix_part}-...-${cfg.suffix_part}"`;
            } else {
                typeLog = 'circumfix: missing config';
            }
            break;
        }

        case 'reduplication': {
            const cfg = rule.reduplication_config;
            const mode = cfg?.mode ?? 'full';
            const redResult = applyReduplication(word, mode, inventory);
            result = redResult.result;
            typeLog = redResult.log;
            break;
        }

        case 'ablaut': {
            const cfg = rule.ablaut_config;
            if (cfg) {
                const abResult = applyAblaut(word, cfg.target_vowel, cfg.replacement_vowel);
                result = abResult.result;
                typeLog = abResult.log;
            } else {
                typeLog = 'ablaut: missing config';
            }
            break;
        }
    }

    const logParts = [typeLog];
    if (conditionLog) logParts.unshift(conditionLog);
    return { result, applied: true, log: logParts.join(' | ') };
}

/**
 * 对单个词根生成所有维度组合的屈折形式范式表
 */
export function generateParadigm(
    word: string,
    posId: string,
    rules: InflectionRule[],
    phonoConfig: PhonologyConfig
): { dimensionValues: Record<string, string>; tag: string; result: string; log: string }[] {
    const posRules = rules.filter(r => r.pos_id === posId && !r.disabled);
    return posRules.map(rule => {
        const { result, log } = applyInflection(word, rule, phonoConfig);
        return {
            dimensionValues: rule.dimension_values,
            tag: rule.tag,
            result,
            log,
        };
    });
}

// ── 类型学感知引擎 ───────────────────────────────────────

/**
 * 检查不规则覆盖是否匹配
 */
function findIrregularOverride(
    entryId: string,
    dimensionValues: Record<string, string>,
    overrides: IrregularOverride[]
): IrregularOverride | undefined {
    return overrides.find(ov =>
        ov.entry_id === entryId &&
        Object.entries(ov.dimension_values).every(([k, v]) => dimensionValues[k] === v)
    );
}

/**
 * 黏着语：按 affix_slot 顺序依次应用词缀
 *
 * 找到每个槽位对应的规则，按 position 排序（负数先，正数后），
 * 依次叠加到词根上。
 */
export function applyAgglutinativeChain(
    word: string,
    posId: string,
    dimensionValues: Record<string, string>,
    grammarConfig: GrammarConfig,
    phonoConfig: PhonologyConfig
): InflectionResult {
    const slots = [...grammarConfig.affix_slots].sort((a, b) => a.position - b.position);
    const rules = grammarConfig.inflection_rules.filter(r => r.pos_id === posId && !r.disabled);

    let current = word;
    const logs: string[] = [];
    let anyApplied = false;

    for (const slot of slots) {
        // 找到绑定到此槽位且匹配维度值的规则
        const slotRule = rules.find(r =>
            r.slot_id === slot.slot_id &&
            dimensionValues[slot.dimension_id] &&
            r.dimension_values[slot.dimension_id] === dimensionValues[slot.dimension_id]
        );

        if (!slotRule) {
            if (slot.is_obligatory) {
                logs.push(`slot[${slot.label || slot.slot_id}]: no rule (obligatory)`);
            }
            continue;
        }

        const { result, applied, log } = applyInflection(current, slotRule, phonoConfig);
        if (applied) {
            current = result;
            anyApplied = true;
            logs.push(`slot[${slot.label || slot.slot_id}]: ${log}`);
        }
    }

    return {
        result: current,
        applied: anyApplied,
        log: logs.length > 0 ? logs.join(' → ') : 'no slots matched',
    };
}

/**
 * 屈折语：优先不规则覆盖，其次按变位类查找
 */
export function applyFusionalInflection(
    word: string,
    entryId: string,
    posId: string,
    dimensionValues: Record<string, string>,
    grammarConfig: GrammarConfig,
    phonoConfig: PhonologyConfig
): InflectionResult {
    // 1. 检查不规则覆盖
    const irregular = findIrregularOverride(entryId, dimensionValues, grammarConfig.irregular_overrides);
    if (irregular) {
        return {
            result: irregular.surface_form,
            applied: true,
            log: `irregular override → "${irregular.surface_form}"`,
        };
    }

    // 2. 查找匹配的规则（可选按变位类过滤）
    const rules = grammarConfig.inflection_rules.filter(r =>
        r.pos_id === posId && !r.disabled
    );

    // 尝试精确匹配维度值
    const exactRule = rules.find(r =>
        Object.entries(dimensionValues).every(([k, v]) => r.dimension_values[k] === v)
    );

    if (exactRule) {
        const result = applyInflection(word, exactRule, phonoConfig);
        return { ...result, log: `fusional: ${result.log}` };
    }

    return { result: word, applied: false, log: 'fusional: no matching rule' };
}

/**
 * 类型学感知的屈折应用入口
 *
 * 根据 grammarConfig.typology.morphological_type 分发到不同的处理路径。
 */
export function applyInflectionTypologyAware(
    word: string,
    entryId: string,
    posId: string,
    dimensionValues: Record<string, string>,
    grammarConfig: GrammarConfig,
    phonoConfig: PhonologyConfig
): InflectionResult {
    const morphType = grammarConfig.typology.morphological_type;

    switch (morphType) {
        case 'isolating':
            // 孤立语：仅在有明确规则时应用（规则是可选的）
            {
                const rules = grammarConfig.inflection_rules.filter(r =>
                    r.pos_id === posId && !r.disabled
                );
                const rule = rules.find(r =>
                    Object.entries(dimensionValues).every(([k, v]) => r.dimension_values[k] === v)
                );
                if (rule) {
                    return applyInflection(word, rule, phonoConfig);
                }
                return { result: word, applied: false, log: 'isolating: no inflection (expected)' };
            }

        case 'agglutinative':
            return applyAgglutinativeChain(word, posId, dimensionValues, grammarConfig, phonoConfig);

        case 'fusional':
            return applyFusionalInflection(word, entryId, posId, dimensionValues, grammarConfig, phonoConfig);

        case 'polysynthetic':
            // 多式综合语：类似黏着语但支持更多槽位链接
            return applyAgglutinativeChain(word, posId, dimensionValues, grammarConfig, phonoConfig);

        default:
            // 回退到标准行为
            {
                const rule = grammarConfig.inflection_rules.find(r =>
                    r.pos_id === posId && !r.disabled &&
                    Object.entries(dimensionValues).every(([k, v]) => r.dimension_values[k] === v)
                );
                if (rule) {
                    return applyInflection(word, rule, phonoConfig);
                }
                return { result: word, applied: false, log: 'no matching rule' };
            }
    }
}
