/**
 * 音素区分特征标注 (Distinctive Features)
 * Phase 1 静态内置；Phase 2/3 供 SCA 特征级匹配使用
 */
export const PHONEME_FEATURES: Record<string, string[]> = {
  // ── 塞音 ──
  "p": ["consonant", "stop", "bilabial", "voiceless"],
  "b": ["consonant", "stop", "bilabial", "voiced"],
  "t": ["consonant", "stop", "alveolar", "voiceless"],
  "d": ["consonant", "stop", "alveolar", "voiced"],
  "ʈ": ["consonant", "stop", "retroflex", "voiceless"],
  "ɖ": ["consonant", "stop", "retroflex", "voiced"],
  "c": ["consonant", "stop", "palatal", "voiceless"],
  "ɟ": ["consonant", "stop", "palatal", "voiced"],
  "k": ["consonant", "stop", "velar", "voiceless"],
  "ɡ": ["consonant", "stop", "velar", "voiced"],
  "g": ["consonant", "stop", "velar", "voiced"],
  "q": ["consonant", "stop", "uvular", "voiceless"],
  "ɢ": ["consonant", "stop", "uvular", "voiced"],
  "ʔ": ["consonant", "stop", "glottal", "voiceless"],

  // ── 鼻音 ──
  "m": ["consonant", "nasal", "bilabial", "voiced"],
  "ɱ": ["consonant", "nasal", "labiodental", "voiced"],
  "n": ["consonant", "nasal", "alveolar", "voiced"],
  "ɳ": ["consonant", "nasal", "retroflex", "voiced"],
  "ɲ": ["consonant", "nasal", "palatal", "voiced"],
  "ŋ": ["consonant", "nasal", "velar", "voiced"],
  "ɴ": ["consonant", "nasal", "uvular", "voiced"],

  // ── 颤音 ──
  "r": ["consonant", "trill", "alveolar", "voiced"],
  "ʀ": ["consonant", "trill", "uvular", "voiced"],
  "ʙ": ["consonant", "trill", "bilabial", "voiced"],

  // ── 闪音 ──
  "ɾ": ["consonant", "tap", "alveolar", "voiced"],
  "ɽ": ["consonant", "tap", "retroflex", "voiced"],

  // ── 擦音 ──
  "ɸ": ["consonant", "fricative", "bilabial", "voiceless"],
  "β": ["consonant", "fricative", "bilabial", "voiced"],
  "f": ["consonant", "fricative", "labiodental", "voiceless"],
  "v": ["consonant", "fricative", "labiodental", "voiced"],
  "θ": ["consonant", "fricative", "dental", "voiceless"],
  "ð": ["consonant", "fricative", "dental", "voiced"],
  "s": ["consonant", "fricative", "alveolar", "voiceless"],
  "z": ["consonant", "fricative", "alveolar", "voiced"],
  "ʃ": ["consonant", "fricative", "postalveolar", "voiceless"],
  "ʒ": ["consonant", "fricative", "postalveolar", "voiced"],
  "ʂ": ["consonant", "fricative", "retroflex", "voiceless"],
  "ʐ": ["consonant", "fricative", "retroflex", "voiced"],
  "ɕ": ["consonant", "fricative", "alveolopalatal", "voiceless"],
  "ʑ": ["consonant", "fricative", "alveolopalatal", "voiced"],
  "ç": ["consonant", "fricative", "palatal", "voiceless"],
  "ʝ": ["consonant", "fricative", "palatal", "voiced"],
  "x": ["consonant", "fricative", "velar", "voiceless"],
  "ɣ": ["consonant", "fricative", "velar", "voiced"],
  "χ": ["consonant", "fricative", "uvular", "voiceless"],
  "ʁ": ["consonant", "fricative", "uvular", "voiced"],
  "ħ": ["consonant", "fricative", "pharyngeal", "voiceless"],
  "ʕ": ["consonant", "fricative", "pharyngeal", "voiced"],
  "h": ["consonant", "fricative", "glottal", "voiceless"],
  "ɦ": ["consonant", "fricative", "glottal", "voiced"],

  // ── 近音 ──
  "ʋ": ["consonant", "approximant", "labiodental", "voiced"],
  "ɹ": ["consonant", "approximant", "alveolar", "voiced"],
  "ɻ": ["consonant", "approximant", "retroflex", "voiced"],
  "j": ["consonant", "approximant", "palatal", "voiced"],
  "ɰ": ["consonant", "approximant", "velar", "voiced"],
  "w": ["consonant", "approximant", "labiovelar", "voiced"],

  // ── 边音 ──
  "l": ["consonant", "lateral", "alveolar", "voiced"],
  "ɭ": ["consonant", "lateral", "retroflex", "voiced"],
  "ʎ": ["consonant", "lateral", "palatal", "voiced"],
  "ʟ": ["consonant", "lateral", "velar", "voiced"],

  // ── 边擦音 ──
  "ɬ": ["consonant", "lateral_fricative", "alveolar", "voiceless"],
  "ɮ": ["consonant", "lateral_fricative", "alveolar", "voiced"],

  // ── 塞擦音 ──
  "ts": ["consonant", "affricate", "alveolar", "voiceless"],
  "dz": ["consonant", "affricate", "alveolar", "voiced"],
  "tʃ": ["consonant", "affricate", "postalveolar", "voiceless"],
  "dʒ": ["consonant", "affricate", "postalveolar", "voiced"],
  "tɕ": ["consonant", "affricate", "alveolopalatal", "voiceless"],
  "dʑ": ["consonant", "affricate", "alveolopalatal", "voiced"],

  // ── 元音 ──
  "i": ["vowel", "close", "front", "unrounded"],
  "y": ["vowel", "close", "front", "rounded"],
  "ɨ": ["vowel", "close", "central", "unrounded"],
  "ʉ": ["vowel", "close", "central", "rounded"],
  "ɯ": ["vowel", "close", "back", "unrounded"],
  "u": ["vowel", "close", "back", "rounded"],
  "ɪ": ["vowel", "near_close", "front", "unrounded"],
  "ʏ": ["vowel", "near_close", "front", "rounded"],
  "ʊ": ["vowel", "near_close", "back", "rounded"],
  "e": ["vowel", "close_mid", "front", "unrounded"],
  "ø": ["vowel", "close_mid", "front", "rounded"],
  "ɘ": ["vowel", "close_mid", "central", "unrounded"],
  "ɵ": ["vowel", "close_mid", "central", "rounded"],
  "ɤ": ["vowel", "close_mid", "back", "unrounded"],
  "o": ["vowel", "close_mid", "back", "rounded"],
  "ə": ["vowel", "mid", "central", "unrounded"],
  "ɛ": ["vowel", "open_mid", "front", "unrounded"],
  "œ": ["vowel", "open_mid", "front", "rounded"],
  "ɜ": ["vowel", "open_mid", "central", "unrounded"],
  "ɞ": ["vowel", "open_mid", "central", "rounded"],
  "ʌ": ["vowel", "open_mid", "back", "unrounded"],
  "ɔ": ["vowel", "open_mid", "back", "rounded"],
  "æ": ["vowel", "near_open", "front", "unrounded"],
  "ɐ": ["vowel", "near_open", "central", "unrounded"],
  "a": ["vowel", "open", "front", "unrounded"],
  "ɶ": ["vowel", "open", "front", "rounded"],
  "ä": ["vowel", "open", "central", "unrounded"],
  "ɑ": ["vowel", "open", "back", "unrounded"],
  "ɒ": ["vowel", "open", "back", "rounded"],
};

/**
 * 自然配对关系：清/浊对立
 * 选中一个音素后提示其配对音
 */
export const NATURAL_PAIRS: Record<string, string> = {
  "p": "b", "b": "p",
  "t": "d", "d": "t",
  "k": "ɡ", "ɡ": "k", "g": "k",
  "q": "ɢ", "ɢ": "q",
  "c": "ɟ", "ɟ": "c",
  "ʈ": "ɖ", "ɖ": "ʈ",
  "f": "v", "v": "f",
  "s": "z", "z": "s",
  "ʃ": "ʒ", "ʒ": "ʃ",
  "ʂ": "ʐ", "ʐ": "ʂ",
  "ɕ": "ʑ", "ʑ": "ɕ",
  "θ": "ð", "ð": "θ",
  "ç": "ʝ", "ʝ": "ç",
  "x": "ɣ", "ɣ": "x",
  "χ": "ʁ", "ʁ": "χ",
  "ħ": "ʕ", "ʕ": "ħ",
  "h": "ɦ", "ɦ": "h",
  "ɸ": "β", "β": "ɸ",
  "ɬ": "ɮ", "ɮ": "ɬ",
};

export interface ImbalanceWarning {
  key: string;
  values?: Record<string, string | number>;
}

/**
 * 获取不平衡警告列表，返回结构化数据供 i18n 翻译
 */
export const getImbalanceWarnings = (
  selectedConsonants: string[],
  selectedVowels: string[] = []
): ImbalanceWarning[] => {
  const consSet = new Set(selectedConsonants);
  const warnings: ImbalanceWarning[] = [];
  const checked = new Set<string>();

  // 缺少清浊对
  for (const phoneme of selectedConsonants) {
    const pair = NATURAL_PAIRS[phoneme];
    if (pair && !consSet.has(pair) && !checked.has(pair)) {
      warnings.push({ key: 'phonology.imbalance.missingPair', values: { phoneme, pair } });
      checked.add(phoneme);
    }
  }

  // 无辅音
  if (selectedConsonants.length === 0) {
    warnings.push({ key: 'phonology.imbalance.noConsonants' });
  } else if (selectedConsonants.length < 6) {
    warnings.push({ key: 'phonology.imbalance.fewConsonants', values: { count: selectedConsonants.length } });
  }

  // 无元音 / 元音过少
  if (selectedVowels.length === 0) {
    warnings.push({ key: 'phonology.imbalance.noVowels' });
  } else if (selectedVowels.length < 3) {
    warnings.push({ key: 'phonology.imbalance.fewVowels', values: { count: selectedVowels.length } });
  }

  return warnings;
};
