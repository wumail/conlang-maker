# Phonology

Manage your language's sound system across 4 sub-pages: Inventory, Romanization, Phonotactics, and Allophony.

## Inventory

### Interactive IPA Charts

- **Consonant table**: 13 places of articulation × 13 manners — click to select/deselect
- **Vowel trapezoid**: Standard IPA vowel chart with tongue position visualization
- **Non-pulmonic consonants**: Implosives, ejectives, and clicks in a dedicated area
- **Audio playback**: Click any phoneme to play its standard pronunciation (329 built-in audio clips, fully offline)

### Preset System

12 real language-style presets — click to load a complete phoneme set + syllable structure:

| Preset | Characteristics |
|--------|----------------|
| Japanese | (C)V syllables, no codas |
| Arabic | Rich pharyngeal/uvular consonants |
| Slavic | Complex consonant clusters |
| Finnish | Vowel harmony |
| Hawaiian | Very few consonants, CV-dominant |
| Nahuatl | Rich in affricates |
| Mandarin | Aspiration contrast + tones |
| Hindi | Retroflex + aspiration contrast |
| Swahili | Pre-nasalized consonants |
| Latin | Classic Indo-European |
| Georgian | Ejectives |
| Elvish | Rich in liquids, soft |

### Inventory Warnings

Auto-detects imbalances: missing voicing contrasts, too few vowels/consonants, uneven place distribution.

## Romanization

- **Multiple mapping tables**: Create several tables (e.g., "Standard Spelling", "Academic Transcription"), set a default
- **Rule definition**: Each rule maps input → output phoneme, with optional context
- **Longest match**: Auto-sorts by input length for greedy matching
- **Phoneme table integration**: Click phonemes to insert into the editing field

## Phonotactics

| Feature | Description |
|---------|------------|
| Syllable templates | e.g., `(C)V(C)(C)`, uppercase = macro, parentheses = optional |
| Phoneme class macros | Custom macros like `C = [p, t, k, s]`, `V = [a, e, i, o, u]` |
| Blacklist | Regex patterns to reject illegal combinations |
| Vowel harmony | Split vowels into two groups, no mixing within a word |
| Tone system | Define tone categories (name + diacritic) |

## Allophony

- **Rules**: Target phoneme → replacement phoneme, with pre/post context
- **Priority**: Applied by priority descending, first match stops
- **Macro references**: Context can reference phoneme class macros

### Context Syntax

| Symbol | Meaning | Example |
|--------|---------|---------|
| `#` | Word boundary | Before `#` = word-initial, After `#` = word-final |
| `V`, `C`, etc. | Macro symbol | Expands to all phonemes in the class |
| Plain characters | Literal match | `l` matches literal l |
| Multi-char sequences | Concatenated | `lV` = l followed by any vowel |
| `_` or empty | Any character | No context restriction |

### Examples

| Before | Target | → | Replacement | After | Meaning |
|--------|--------|---|-------------|-------|---------|
| `#` | `e` | → | `i` | `lV` | Word-initial e before l+vowel → i |
| `V` | `t` | → | `d` | `V` | Intervocalic t → d |
| `V` | `k` | → | `x` | `#` | Word-final k after vowel → x |
| | `n` | → | `ŋ` | `k` | n before k → ŋ |
