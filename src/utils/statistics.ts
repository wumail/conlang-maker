/**
 * statistics.ts — Sprint 5 语言统计计算模块
 *
 * 包含：POS 分布、音素频率、字符频率、二元组合、音节分布、正字法速查表
 */
import type { WordEntry, PhonologyConfig, GrammarConfig } from '../types';

export interface PosDistribution {
    posId: string;
    posName: string;
    count: number;
}

export interface FrequencyItem {
    char: string;
    count: number;
    percentage: number;
}

export interface BigramItem {
    bigram: string;
    count: number;
}

export interface SyllableDistribution {
    syllableCount: number;
    wordCount: number;
    percentage: number;
}

export interface RomanizationLookup {
    input: string;
    phoneme: string;
    mapName: string;
}

export interface StatisticsReport {
    totalWords: number;
    posDistribution: PosDistribution[];
    phonemeFrequency: FrequencyItem[];
    charFrequency: FrequencyItem[];
    bigramFrequency: BigramItem[];
    syllableDistribution: SyllableDistribution[];
    romanizationLookup: RomanizationLookup[];
}

/**
 * 估算音节数：统计元音簇数量（简化实现）
 */
function estimateSyllableCount(word: string, vowels: Set<string>): number {
    let count = 0;
    let inVowel = false;
    for (const ch of word) {
        if (vowels.has(ch)) {
            if (!inVowel) { count++; inVowel = true; }
        } else {
            inVowel = false;
        }
    }
    return Math.max(1, count);
}

export function computeStatistics(
    words: WordEntry[],
    phonoConfig: PhonologyConfig,
    grammarConfig: GrammarConfig
): StatisticsReport {
    const posCounter = new Map<string, number>();
    const phonemeCounter = new Map<string, number>();
    const charCounter = new Map<string, number>();
    const bigramCounter = new Map<string, number>();
    const syllableCounter = new Map<number, number>();

    let totalPhonemes = 0;
    let totalChars = 0;

    const vowelSet = new Set(phonoConfig.phoneme_inventory.vowels);

    for (const w of words) {
        // POS distribution
        for (const s of w.senses) {
            posCounter.set(s.pos_id, (posCounter.get(s.pos_id) ?? 0) + 1);
        }

        // IPA phoneme frequency
        const ipa = (w.phonetic_ipa ?? '').replace(/[\/\[\]]/g, '');
        for (const ch of ipa) {
            if (ch.trim()) {
                phonemeCounter.set(ch, (phonemeCounter.get(ch) ?? 0) + 1);
                totalPhonemes++;
            }
        }

        // Character frequency (romanized)
        const romanized = w.con_word_romanized;
        for (const ch of romanized) {
            if (ch.trim()) {
                charCounter.set(ch, (charCounter.get(ch) ?? 0) + 1);
                totalChars++;
            }
        }

        // Bigram frequency
        for (let i = 0; i < romanized.length - 1; i++) {
            const bi = romanized.slice(i, i + 2);
            if (bi.trim().length === 2) {
                bigramCounter.set(bi, (bigramCounter.get(bi) ?? 0) + 1);
            }
        }

        // Syllable count
        const sylCount = estimateSyllableCount(romanized, vowelSet);
        syllableCounter.set(sylCount, (syllableCounter.get(sylCount) ?? 0) + 1);
    }

    // POS distribution
    const posDistribution: PosDistribution[] = [];
    for (const [posId, count] of posCounter) {
        const pos = grammarConfig.parts_of_speech.find(p => p.pos_id === posId);
        posDistribution.push({ posId, posName: pos?.name ?? posId, count });
    }
    posDistribution.sort((a, b) => b.count - a.count);

    // Frequency lists
    const toFreqList = (counter: Map<string, number>, total: number): FrequencyItem[] =>
        [...counter.entries()]
            .map(([char, count]) => ({ char, count, percentage: total > 0 ? (count / total) * 100 : 0 }))
            .sort((a, b) => b.count - a.count);

    const bigramFrequency: BigramItem[] = [...bigramCounter.entries()]
        .map(([bigram, count]) => ({ bigram, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50);

    // Syllable distribution
    const syllableDistribution: SyllableDistribution[] = [...syllableCounter.entries()]
        .map(([syllableCount, wordCount]) => ({
            syllableCount,
            wordCount,
            percentage: words.length > 0 ? (wordCount / words.length) * 100 : 0,
        }))
        .sort((a, b) => a.syllableCount - b.syllableCount);

    // Romanization lookup table
    const romanizationLookup: RomanizationLookup[] = [];
    for (const map of phonoConfig.romanization_maps) {
        for (const rule of map.rules) {
            romanizationLookup.push({ input: rule.input, phoneme: rule.output_phoneme, mapName: map.name });
        }
    }
    romanizationLookup.sort((a, b) => a.input.localeCompare(b.input));

    return {
        totalWords: words.length,
        posDistribution,
        phonemeFrequency: toFreqList(phonemeCounter, totalPhonemes),
        charFrequency: toFreqList(charCounter, totalChars),
        bigramFrequency,
        syllableDistribution,
        romanizationLookup,
    };
}
