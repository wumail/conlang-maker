export const PLACES = [
  "Bilabial", "Labiodental", "Linguolabial", "Dental", "Alveolar", "Postalveolar",
  "Retroflex", "(Alveolo-)palatal", "Velar", "Uvular", "Pharyngeal/epiglottal", "Glottal"
];

export const CONSONANT_DATA = [
  {
    manner: "Nasal",
    row: [["m̥", "m"], ["ɱ̊", "ɱ"], ["", "n̼"], ["n̪̊", "n̪"], ["n̥", "n"], ["n̠̊", "n̠"], ["ɳ̊", "ɳ"], ["ɲ̊", "ɲ"], ["ŋ̊", "ŋ"], ["ɴ̥", "ɴ"], null, null]
  },
  {
    manner: "Plosive",
    row: [["p", "b"], ["p̪", "b̪"], ["t̼", "d̼"], ["t̪", "d̪"], ["t", "d"], [], ["ʈ", "ɖ"], ["c", "ɟ"], ["k", "ɡ"], ["q", "ɢ"], ["ʡ", ""], ["ʔ", ""]]
  },
  {
    manner: "Sibilant affricate",
    row: [null, null, null, ["t̪s̪", "d̪z̪"], ["ts", "dz"], ["t̠ʃ", "d̠ʒ"], ["tʂ", "dʐ"], ["tɕ", "dʑ"], null, null, null, null]
  },
  {
    manner: "Non-sibilant affricate",
    row: [["pɸ", "bβ"], ["p̪f", "b̪v"], [], ["t̪θ", "d̪ð"], ["tɹ̝̊", "dɹ̝"], ["t̠ɹ̠̊˔", "d̠ɹ̠˔"], [], ["cç", "ɟʝ"], ["kx", "ɡɣ"], ["qχ", "ɢʁ"], ["ʡʜ", "ʡʢ"], ["ʔh", ""]]
  },
  {
    manner: "Sibilant fricative",
    row: [null, null, null, ["s̪", "z̪"], ["s", "z"], ["ʃ", "ʒ"], ["ʂ", "ʐ"], ["ɕ", "ʑ"], null, null, null, null]
  },
  {
    manner: "Non-sibilant fricative",
    row: [["ɸ", "β"], ["f", "v"], ["θ̼", "ð̼"], ["θ", "ð"], ["θ̠", "ð̠"], ["ɹ̠̊˔", "ɹ̠˔"], ["ɻ̊˔", "ɻ˔"], ["ç", "ʝ"], ["x", "ɣ"], ["χ", "ʁ"], ["ħ", "ʕ"], ["h", "ɦ"]]
  },
  {
    manner: "Approximant",
    row: [["", "β̞"], ["", "ʋ"], [], ["", "ð̞"], ["", "ɹ"], ["", "ɹ̠"], ["", "ɻ"], ["", "j"], ["", "ɰ"], [], [], ["", "˷"]]
  },
  {
    manner: "Tap/flap",
    row: [["", "ⱱ̟"], ["", "ⱱ"], [], [], ["ɾ̥", "ɾ"], [], ["ɽ̊", "ɽ"], [], null, ["", "ɢ̆"], ["", "ʡ̮"], null]
  },
  {
    manner: "Trill",
    row: [["ʙ̥", "ʙ"], [], [], [], ["r̥", "r"], ["", "r̠"], ["ɽ̊r̥", "ɽr"], [], null, ["ʀ̥", "ʀ"], ["ʜ", "ʢ"], null]
  },
  {
    manner: "Lateral affricate",
    row: [null, null, [], [], ["tɬ", "dɮ"], [], ["tꞎ", "d𝼅"], ["c𝼆", "ɟʎ̝"], ["k𝼄", "ɡʟ̝"], [], null, null]
  },
  {
    manner: "Lateral fricative",
    row: [null, null, [], ["ɬ̪", ""], ["ɬ", "ɮ"], [], ["ꞎ", "𝼅"], ["𝼆", "ʎ̝"], ["𝼄", "ʟ̝"], [], null, null]
  },
  {
    manner: "Lateral approximant",
    row: [null, null, [], ["", "l̪"], ["l̥", "l"], ["", "l̠"], ["ɭ̊", "ɭ"], ["ʎ̥", "ʎ"], ["ʟ̥", "ʟ"], ["", "ʟ̠"], null, null]
  },
  {
    manner: "Lateral tap/flap",
    row: [null, null, [], [], ["ɺ̥", "ɺ"], [], ["𝼈̊", "𝼈"], ["", "ʎ̮"], ["", "ʟ̆"], [], null, null]
  }
];

export const NON_PULMONIC_DATA = [
  { category: "implosive", subcategory: "voiced", phonemes: ["ɓ", "ɗ", "ᶑ", "ʄ", "ɠ", "ʛ"] },
  { category: "implosive", subcategory: "voiceless", phonemes: ["ɓ̥", "ɗ̥", "ᶑ̊", "ʄ̊", "ɠ̊", "ʛ̥"] },
  { category: "ejective", subcategory: "stop", phonemes: ["pʼ", "tʼ", "ʈʼ", "cʼ", "kʼ", "qʼ"] },
  { category: "ejective", subcategory: "fricative", phonemes: ["fʼ", "sʼ", "ʂʼ", "ɕʼ", "xʼ", "χʼ", "ɸʼ", "θʼ", "ʃʼ"] },
  { category: "ejective", subcategory: "affricate", phonemes: ["t̪θʼ", "tsʼ", "tʂʼ", "t̠ʃʼ", "kxʼ", "qχʼ"] },
  { category: "ejective", subcategory: "lateral", phonemes: ["", "ɬʼ", "tɬʼ", "c𝼆ʼ", "k𝼄ʼ"] },
  { category: "click", subcategory: "voiceless", phonemes: ["kʘ", "kǀ", "kǃ", "kǁ", "k𝼊", "kǂ"] },];

export const CO_ARTICULATED_DATA = [
  { category: "plosive", subcategory: "", phonemes: ["t͡p", "k͡p", "ɡ͡b", "q͡p"] },
  { category: "nasal", subcategory: "", phonemes: ["ŋ͡m"] },
  { category: "fricativeApproximant", subcategory: "", phonemes: ["ʍ", "w", "ɥ", "ɧ", "ɫ"] },
  { category: "implosive", subcategory: "", phonemes: ["ɠ̊͜ɓ̥", "ɠ͡ɓ"] },
];

export const VOWELS_EXACT = [
  { phonemes: ["i", "y"], x: 0, y: 0 },
  { phonemes: ["ɨ", "ʉ"], x: 200, y: 0 },
  { phonemes: ["ɯ", "u"], x: 400, y: 0 },
  { phonemes: ["ɪ", "ʏ"], x: 100, y: 50 },
  { phonemes: ["", "ʊ"], x: 360, y: 50 },
  { phonemes: ["e", "ø"], x: 66, y: 100 },
  { phonemes: ["ɘ", "ɵ"], x: 233, y: 100 },
  { phonemes: ["ɤ", "o"], x: 400, y: 100 },
  { phonemes: ["e̞", "ø̞"], x: 100, y: 150 },
  { phonemes: ["ə", ""], x: 250, y: 150 },
  { phonemes: ["ɤ̞", "o̞"], x: 400, y: 150 },
  { phonemes: ["ɛ", "œ"], x: 133, y: 200 },
  { phonemes: ["ɜ", "ɞ"], x: 266, y: 200 },
  { phonemes: ["ʌ", "ɔ"], x: 400, y: 200 },
  { phonemes: ["æ", ""], x: 166, y: 250 },
  { phonemes: ["ɐ", ""], x: 283, y: 250 },
  { phonemes: ["a", "ɶ"], x: 200, y: 300 },
  { phonemes: ["ä", ""], x: 300, y: 300 },
  { phonemes: ["ɑ", "ɒ"], x: 400, y: 300 },
];
