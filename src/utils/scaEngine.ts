import { SCARule, SCARuleSet, SCAStepLog, FeatureExpression, FeatureReplacement } from '../types';
import { PHONEME_FEATURES } from '../data/ipa_features';
import { tokenizePhonemes, joinPhonemes } from './phonemeTokenizer';

/**
 * Built-in macro definitions for SCA context matching.
 * V = vowels, C = consonants (populated from phoneme inventory)
 */
type MacroDefs = Record<string, string[]>;

// ── Feature matching helpers (Phase 3) ───────────────────

/** 获取所有已知音素列表（用于 tokenizer） */
function getAllKnownPhonemes(): string[] {
    return Object.keys(PHONEME_FEATURES);
}

// ── Feature reverse index for O(1) lookup ──────────────

/** 按特征检索所有具有该特征的音素 */
const FEATURE_TO_PHONEME_INDEX: Map<string, Set<string>> = new Map();

/** 构建特征→音素倒排索引（首次调用时懒加载） */
function buildFeatureIndex(): void {
    if (FEATURE_TO_PHONEME_INDEX.size > 0) return;
    for (const [phoneme, features] of Object.entries(PHONEME_FEATURES)) {
        for (const feat of features) {
            let set = FEATURE_TO_PHONEME_INDEX.get(feat);
            if (!set) {
                set = new Set();
                FEATURE_TO_PHONEME_INDEX.set(feat, set);
            }
            set.add(phoneme);
        }
    }
}

/** 解析 "[+voiced, -stop]" 字符串为 FeatureExpression */
export function parseFeatureExpression(expr: string): FeatureExpression {
    const result: FeatureExpression = { positive: [], negative: [] };
    if (!expr) return result;
    const cleaned = expr.replace(/^\[/, '').replace(/\]$/, '');
    const parts = cleaned.split(',').map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
        if (part.startsWith('+')) {
            result.positive.push(part.slice(1));
        } else if (part.startsWith('-')) {
            result.negative.push(part.slice(1));
        } else {
            // 无前缀默认为 positive
            result.positive.push(part);
        }
    }
    return result;
}

/** 检查音素是否匹配特征表达式 */
export function matchesFeatures(phoneme: string, expr: FeatureExpression): boolean {
    const features = PHONEME_FEATURES[phoneme];
    if (!features) return false;
    const featureSet = new Set(features);
    for (const p of expr.positive) {
        if (!featureSet.has(p)) return false;
    }
    for (const n of expr.negative) {
        if (featureSet.has(n)) return false;
    }
    return true;
}

/** 返回所有匹配特征表达式的音素（使用倒排索引加速） */
export function findMatchingPhonemes(expr: FeatureExpression): string[] {
    buildFeatureIndex();

    let candidates: Set<string> | null = null;

    // 交集：先取所有 positive 特征的交集
    for (const feat of expr.positive) {
        const set = FEATURE_TO_PHONEME_INDEX.get(feat);
        if (!set) return []; // 不存在的特征，无匹配
        if (candidates === null) {
            candidates = new Set(set);
        } else {
            for (const p of candidates) {
                if (!set.has(p)) candidates.delete(p);
            }
        }
    }

    // 如果无 positive 约束，候选为全部音素
    if (candidates === null) {
        candidates = new Set(Object.keys(PHONEME_FEATURES));
    }

    // 排除：去除有 negative 特征的音素
    for (const feat of expr.negative) {
        const set = FEATURE_TO_PHONEME_INDEX.get(feat);
        if (set) {
            for (const p of set) {
                candidates.delete(p);
            }
        }
    }

    return [...candidates];
}

/**
 * 给定一组特征，在 IPA 表中找最接近的音素
 * 使用 Jaccard 相似度选最佳匹配
 */
function resolvePhonemeByFeatures(targetFeatures: Set<string>): string | null {
    let bestMatch: string | null = null;
    let bestScore = -1;
    for (const [phoneme, features] of Object.entries(PHONEME_FEATURES)) {
        const pSet = new Set(features);
        // Jaccard similarity
        let intersection = 0;
        for (const f of targetFeatures) {
            if (pSet.has(f)) intersection++;
        }
        const union = new Set([...targetFeatures, ...pSet]).size;
        const score = union > 0 ? intersection / union : 0;
        if (score > bestScore) {
            bestScore = score;
            bestMatch = phoneme;
        }
    }
    return bestMatch;
}

/** 对音素应用特征替换，返回结果音素 */
export function applyFeatureReplacement(phoneme: string, repl: FeatureReplacement): string {
    const features = PHONEME_FEATURES[phoneme];
    if (!features) return phoneme;

    const current = new Set(features);
    for (const f of repl.remove_features) {
        current.delete(f);
    }
    for (const f of repl.set_features) {
        current.add(f);
    }
    return resolvePhonemeByFeatures(current) || phoneme;
}

/**
 * 特征模式下应用单条 SCA 规则
 */
function applyFeatureRule(
    word: string,
    rule: SCARule,
    _macros: MacroDefs,
    inventoryPhonemes: string[],
): { result: string; changed: boolean; featureDetails: string[] } {
    if (!rule.target_features || !rule.replacement_features) {
        return { result: word, changed: false, featureDetails: [] };
    }

    const knownPhonemes = inventoryPhonemes.length > 0 ? inventoryPhonemes : getAllKnownPhonemes();
    const tokens = tokenizePhonemes(word, knownPhonemes);
    let changed = false;
    const resultTokens = [...tokens];
    const featureDetails: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
        // 检查 target
        if (!matchesFeatures(tokens[i], rule.target_features)) continue;

        // 检查 context_before
        if (rule.context_before_features) {
            if (rule.context_before_features.positive.length > 0 || rule.context_before_features.negative.length > 0) {
                if (i === 0) continue; // 无前文
                if (!matchesFeatures(tokens[i - 1], rule.context_before_features)) continue;
            }
        }

        // 检查 context_after
        if (rule.context_after_features) {
            if (rule.context_after_features.positive.length > 0 || rule.context_after_features.negative.length > 0) {
                if (i === tokens.length - 1) continue; // 无后文
                if (!matchesFeatures(tokens[i + 1], rule.context_after_features)) continue;
            }
        }

        // 检查 exceptions
        if (rule.exceptions && rule.exceptions.some((ex) => word.includes(ex))) {
            continue;
        }

        // 应用替换
        const newPhoneme = applyFeatureReplacement(tokens[i], rule.replacement_features);
        if (newPhoneme !== tokens[i]) {
            const setStr = rule.replacement_features.set_features.map(f => `+${f}`).join(',');
            const rmStr = rule.replacement_features.remove_features.map(f => `-${f}`).join(',');
            const featsApplied = [setStr, rmStr].filter(Boolean).join(', ');
            featureDetails.push(`${tokens[i]}→${newPhoneme} [${featsApplied}]`);
            resultTokens[i] = newPhoneme;
            changed = true;
        }
    }

    return { result: joinPhonemes(resultTokens), changed, featureDetails };
}

/**
 * Expand a context pattern string using macros.
 * e.g., "V" → "(a|e|i|o|u)" when V maps to those vowels.
 */
function expandContextPattern(pattern: string, macros: MacroDefs): string {
    if (!pattern || pattern === '#') return pattern;
    let result = pattern;
    for (const [key, values] of Object.entries(macros)) {
        if (values.length > 0) {
            // Sort by length descending to avoid partial matches
            const sorted = [...values].sort((a, b) => b.length - a.length);
            const alternatives = sorted.map(escapeRegex).join('|');
            result = result.split(key).join(`(?:${alternatives})`);
        }
    }
    return result;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply a single SCA rule to a word.
 * Routes to feature mode or character mode based on rule.feature_mode.
 */
function applySingleRule(
    word: string,
    rule: SCARule,
    macros: MacroDefs,
    inventoryPhonemes: string[] = [],
): { result: string; changed: boolean; featureDetails?: string[] } {
    if (rule.feature_mode) {
        return applyFeatureRule(word, rule, macros, inventoryPhonemes);
    }

    // ── Character mode (Phase 2 original) ──
    const targets = rule.target.split(/\s+/).filter(Boolean);
    const replacements = rule.replacement.split(/\s+/).filter(Boolean);

    if (targets.length === 0) return { result: word, changed: false };

    // If fewer replacements than targets, repeat the last replacement
    while (replacements.length < targets.length) {
        replacements.push(replacements[replacements.length - 1] || '');
    }

    let result = word;
    let changed = false;

    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const replacement = replacements[i];

        // Check exceptions
        if (rule.exceptions && rule.exceptions.some((ex) => result.includes(ex))) {
            continue;
        }

        // Build regex with context
        const beforeCtx = expandContextPattern(rule.context_before, macros);
        const afterCtx = expandContextPattern(rule.context_after, macros);
        const escapedTarget = escapeRegex(target);

        let pattern: string;
        if (beforeCtx === '#' && afterCtx === '#') {
            // Word boundary markers — exact match
            pattern = `^${escapedTarget}$`;
        } else if (beforeCtx === '#') {
            // Word-initial
            pattern = afterCtx
                ? `^${escapedTarget}(?=${afterCtx})`
                : `^${escapedTarget}`;
        } else if (afterCtx === '#') {
            // Word-final
            pattern = beforeCtx
                ? `(?<=${beforeCtx})${escapedTarget}$`
                : `${escapedTarget}$`;
        } else {
            // General context
            const before = beforeCtx ? `(?<=${beforeCtx})` : '';
            const after = afterCtx ? `(?=${afterCtx})` : '';
            pattern = `${before}${escapedTarget}${after}`;
        }

        try {
            const regex = new RegExp(pattern, 'g');
            const newResult = result.replace(regex, replacement);
            if (newResult !== result) {
                changed = true;
                result = newResult;
            }
        } catch {
            // Invalid regex — skip this target/replacement pair
            console.warn(`SCA: Invalid regex pattern "${pattern}" for rule "${rule.rule_id}"`);
        }
    }

    return { result, changed };
}

/**
 * Apply all SCA rule sets to a word in order.
 * Returns the final result and a step-by-step changelog.
 */
export function applySoundChanges(
    word: string,
    ruleSets: SCARuleSet[],
    macros: MacroDefs,
    inventoryPhonemes: string[] = [],
): { result: string; changelog: SCAStepLog[] } {
    const changelog: SCAStepLog[] = [];
    let current = word;

    // Sort rule sets by order
    const sorted = [...ruleSets].sort((a, b) => a.order - b.order);

    for (const ruleSet of sorted) {
        for (const rule of ruleSet.rules) {
            const before = current;
            const { result, changed, featureDetails } = applySingleRule(current, rule, macros, inventoryPhonemes);
            if (changed) {
                changelog.push({
                    rule_id: rule.rule_id,
                    description: rule.description || (rule.feature_mode
                        ? `[feature] → [feature]`
                        : `${rule.target} → ${rule.replacement}`),
                    before,
                    after: result,
                    feature_detail: featureDetails && featureDetails.length > 0
                        ? featureDetails.join('; ')
                        : undefined,
                });
                current = result;
            }
        }
    }

    return { result: current, changelog };
}

/**
 * Build default macros from a phoneme inventory.
 */
export function buildMacrosFromInventory(
    consonants: string[],
    vowels: string[],
    extraMacros?: Record<string, string[]>,
): MacroDefs {
    const macros: MacroDefs = {
        V: vowels,
        C: consonants,
        ...extraMacros,
    };
    return macros;
}

/**
 * Apply sound changes to a batch of words.
 */
export function batchApplySoundChanges(
    words: string[],
    ruleSets: SCARuleSet[],
    macros: MacroDefs,
    inventoryPhonemes: string[] = [],
): { word: string; result: string; changelog: SCAStepLog[] }[] {
    return words.map((word) => {
        const { result, changelog } = applySoundChanges(word, ruleSets, macros, inventoryPhonemes);
        return { word, result, changelog };
    });
}
