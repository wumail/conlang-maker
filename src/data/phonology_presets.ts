/**
 * 音系风格预设 — 约 12 种现实语言音系风格
 * 每个预设包含推荐音素集合与音节结构参数
 */
export interface PhonologyPreset {
  id: string;
  nameKey: string;        // i18n 翻译 key
  descriptionKey: string; // i18n 翻译 key
  consonants: string[];
  vowels: string[];
  syllable_structure: string;
}

export const PHONOLOGY_PRESETS: PhonologyPreset[] = [
  {
    id: "japanese",
    nameKey: "phonology.presets.preset_japanese",
    descriptionKey: "phonology.presets.desc_japanese",
    consonants: ["p", "b", "t", "d", "k", "ɡ", "m", "n", "s", "z", "h", "ɾ", "w", "j"],
    vowels: ["a", "e", "i", "o", "u"],
    syllable_structure: "(C)V",
  },
  {
    id: "arabic",
    nameKey: "phonology.presets.preset_arabic",
    descriptionKey: "phonology.presets.desc_arabic",
    consonants: ["b", "t", "d", "k", "q", "m", "n", "s", "z", "f", "h", "ħ", "ʕ", "x", "ɣ", "ʔ", "r", "l", "w", "j"],
    vowels: ["a", "i", "u"],
    syllable_structure: "(C)(C)V(C)(C)",
  },
  {
    id: "slavic",
    nameKey: "phonology.presets.preset_slavic",
    descriptionKey: "phonology.presets.desc_slavic",
    consonants: ["p", "b", "t", "d", "k", "ɡ", "m", "n", "s", "z", "ʃ", "ʒ", "f", "v", "x", "r", "l", "j", "ts", "tʃ"],
    vowels: ["a", "e", "i", "o", "u", "ɨ"],
    syllable_structure: "(C)(C)(C)V(C)(C)",
  },
  {
    id: "finnic",
    nameKey: "phonology.presets.preset_finnic",
    descriptionKey: "phonology.presets.desc_finnic",
    consonants: ["p", "t", "k", "m", "n", "s", "h", "r", "l", "v", "j"],
    vowels: ["a", "e", "i", "o", "u", "æ", "ø", "y"],
    syllable_structure: "(C)V(V)(C)",
  },
  {
    id: "hawaiian",
    nameKey: "phonology.presets.preset_hawaiian",
    descriptionKey: "phonology.presets.desc_hawaiian",
    consonants: ["p", "k", "m", "n", "h", "l", "w", "ʔ"],
    vowels: ["a", "e", "i", "o", "u"],
    syllable_structure: "(C)V",
  },
  {
    id: "nahuatl",
    nameKey: "phonology.presets.preset_nahuatl",
    descriptionKey: "phonology.presets.desc_nahuatl",
    consonants: ["p", "t", "k", "kʷ", "m", "n", "s", "ʃ", "tɬ", "ts", "tʃ", "l", "w", "j", "ʔ"],
    vowels: ["a", "e", "i", "o"],
    syllable_structure: "(C)V(C)",
  },
  {
    id: "mandarin",
    nameKey: "phonology.presets.preset_mandarin",
    descriptionKey: "phonology.presets.desc_mandarin",
    consonants: ["p", "pʰ", "t", "tʰ", "k", "kʰ", "m", "n", "ŋ", "f", "s", "ʂ", "ɕ", "x", "ts", "tsʰ", "tʂ", "tʂʰ", "tɕ", "tɕʰ", "ɻ", "l"],
    vowels: ["a", "e", "i", "o", "u", "y", "ə"],
    syllable_structure: "(C)V(V)(C)",
  },
  {
    id: "hindi",
    nameKey: "phonology.presets.preset_hindi",
    descriptionKey: "phonology.presets.desc_hindi",
    consonants: ["p", "pʰ", "b", "bʰ", "t", "tʰ", "d", "dʰ", "ʈ", "ʈʰ", "ɖ", "ɖʰ", "k", "kʰ", "ɡ", "ɡʰ", "m", "n", "ɳ", "ŋ", "s", "ʃ", "h", "r", "l", "j", "w", "tʃ", "tʃʰ", "dʒ", "dʒʰ"],
    vowels: ["a", "aː", "e", "eː", "i", "iː", "o", "oː", "u", "uː", "ə"],
    syllable_structure: "(C)(C)V(C)(C)",
  },
  {
    id: "swahili",
    nameKey: "phonology.presets.preset_swahili",
    descriptionKey: "phonology.presets.desc_swahili",
    consonants: ["p", "b", "t", "d", "k", "ɡ", "m", "n", "ɲ", "ŋ", "f", "v", "s", "z", "ʃ", "h", "tʃ", "dʒ", "r", "l", "w", "j"],
    vowels: ["a", "e", "i", "o", "u"],
    syllable_structure: "(C)V",
  },
  {
    id: "latin",
    nameKey: "phonology.presets.preset_latin",
    descriptionKey: "phonology.presets.desc_latin",
    consonants: ["p", "b", "t", "d", "k", "ɡ", "kʷ", "ɡʷ", "m", "n", "f", "s", "h", "r", "l", "w", "j"],
    vowels: ["a", "aː", "e", "eː", "i", "iː", "o", "oː", "u", "uː"],
    syllable_structure: "(C)(C)V(C)(C)",
  },
  {
    id: "georgian",
    nameKey: "phonology.presets.preset_georgian",
    descriptionKey: "phonology.presets.desc_georgian",
    consonants: ["p", "pʼ", "b", "t", "tʼ", "d", "k", "kʼ", "ɡ", "q", "qʼ", "m", "n", "s", "z", "ʃ", "ʒ", "x", "ɣ", "h", "ts", "tsʼ", "dz", "tʃ", "tʃʼ", "dʒ", "r", "l", "v", "j", "w"],
    vowels: ["a", "e", "i", "o", "u"],
    syllable_structure: "(C)(C)(C)V(C)(C)",
  },
  {
    id: "tolkien_elvish",
    nameKey: "phonology.presets.preset_elvish",
    descriptionKey: "phonology.presets.desc_elvish",
    consonants: ["p", "b", "t", "d", "k", "ɡ", "m", "n", "ŋ", "f", "v", "θ", "s", "h", "r", "l", "ʎ", "w", "j"],
    vowels: ["a", "e", "i", "o", "u", "aː", "eː", "iː", "oː", "uː"],
    syllable_structure: "(C)(C)V(C)",
  },
];
