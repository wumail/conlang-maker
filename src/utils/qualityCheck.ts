/**
 * qualityCheck.ts — Sprint 5 词典质检引擎
 */
import type { WordEntry, PhonologyConfig, GrammarConfig } from '../types';

export interface QCIssue {
    entry_id: string;
    word: string;
    rule: string;
    severity: 'error' | 'warning';
    message: string;
}

type QCRuleKey = 'missingPos' | 'unmappedSpelling' | 'emptyIpa' | 'patternMismatch' | 'missingRequired' | 'duplicateWord';

export function runQualityCheck(
    words: WordEntry[],
    phonoConfig: PhonologyConfig,
    grammarConfig: GrammarConfig,
    disabledRules: QCRuleKey[]
): QCIssue[] {
    const issues: QCIssue[] = [];
    const disabled = new Set(disabledRules);
    const partsOfSpeech = grammarConfig.parts_of_speech;

    // Build romanization coverage set
    const romanChars = new Set<string>();
    for (const map of phonoConfig.romanization_maps) {
        for (const rule of map.rules) {
            for (const ch of rule.input) romanChars.add(ch);
        }
    }

    // Build word frequency map for duplicates
    const wordFreq = new Map<string, string[]>();
    for (const w of words) {
        const key = w.con_word_romanized.toLowerCase().trim();
        if (!wordFreq.has(key)) wordFreq.set(key, []);
        wordFreq.get(key)!.push(w.entry_id);
    }

    for (const w of words) {
        // Rule 1: Missing POS
        if (!disabled.has('missingPos')) {
            const hasPosEmpty = w.senses.some(s => !s.pos_id);
            if (hasPosEmpty || w.senses.length === 0) {
                issues.push({
                    entry_id: w.entry_id,
                    word: w.con_word_romanized,
                    rule: 'missingPos',
                    severity: 'error',
                    message: 'At least one sense missing part of speech',
                });
            }
        }

        // Rule 2: Unmapped spelling characters
        if (!disabled.has('unmappedSpelling') && romanChars.size > 0) {
            const chars = [...w.con_word_romanized];
            const unmapped = chars.filter(c => c.trim() && !romanChars.has(c));
            if (unmapped.length > 0) {
                issues.push({
                    entry_id: w.entry_id,
                    word: w.con_word_romanized,
                    rule: 'unmappedSpelling',
                    severity: 'warning',
                    message: `Unmapped: ${[...new Set(unmapped)].join(', ')}`,
                });
            }
        }

        // Rule 3: Empty IPA
        if (!disabled.has('emptyIpa') && !w.phonetic_ipa) {
            issues.push({
                entry_id: w.entry_id,
                word: w.con_word_romanized,
                rule: 'emptyIpa',
                severity: 'warning',
                message: 'IPA is empty',
            });
        }

        // Rule 4: Word pattern mismatch
        if (!disabled.has('patternMismatch')) {
            for (const s of w.senses) {
                const pos = partsOfSpeech.find(p => p.pos_id === s.pos_id);
                if (pos?.word_pattern) {
                    try {
                        if (!new RegExp(pos.word_pattern).test(w.con_word_romanized)) {
                            issues.push({
                                entry_id: w.entry_id,
                                word: w.con_word_romanized,
                                rule: 'patternMismatch',
                                severity: 'warning',
                                message: `Does not match ${pos.name} pattern /${pos.word_pattern}/`,
                            });
                        }
                    } catch { /* invalid regex, skip */ }
                }
            }
        }

        // Rule 5: Missing required fields
        if (!disabled.has('missingRequired')) {
            for (const s of w.senses) {
                const pos = partsOfSpeech.find(p => p.pos_id === s.pos_id);
                if (pos?.requires_definition && s.definitions.filter(d => d.trim()).length === 0) {
                    issues.push({
                        entry_id: w.entry_id,
                        word: w.con_word_romanized,
                        rule: 'missingRequired',
                        severity: 'error',
                        message: `${pos.name} requires definition`,
                    });
                }
            }
        }

        // Rule 6: Duplicate word
        if (!disabled.has('duplicateWord')) {
            const key = w.con_word_romanized.toLowerCase().trim();
            const ids = wordFreq.get(key);
            if (ids && ids.length > 1 && ids[0] === w.entry_id) {
                issues.push({
                    entry_id: w.entry_id,
                    word: w.con_word_romanized,
                    rule: 'duplicateWord',
                    severity: 'warning',
                    message: `Duplicate form (${ids.length} entries)`,
                });
            }
        }
    }

    return issues;
}
