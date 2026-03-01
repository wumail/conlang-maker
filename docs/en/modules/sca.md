# Sound Change Applier (SCA)

Define and preview diachronic sound change rules to simulate historical language evolution.

## Character Mode

Define rules by specifying target and replacement characters:

| Field | Description | Example |
|-------|------------|---------|
| Target | Phonemes/characters to replace (space-separated) | `p t k` |
| Replacement | Replace with | `b d g` |
| Pre-context | Must match before the target | `V` (vowel macro) |
| Post-context | Must match after the target | `V` |
| Exceptions | Words to skip | — |

Macros expand automatically: `V` → vowel list, `C` → consonant list.

### Example

"Voicing of voiceless stops between vowels":
- Target: `p t k`
- Replacement: `b d g`
- Pre-context: `V`
- Post-context: `V`

## Feature Mode

Define more precise rules based on phonetic features:

- **Target features**: Use `+`/`-` to specify (e.g., `[+voiced, -stop]`)
- **Replacement features**: Specify features to set/remove
- **Phoneme matching**: Real-time display of all phonemes matching the specified features
- **Jaccard similarity**: Auto-finds the closest IPA phoneme after feature replacement
- **Feature inverted index**: O(1) query acceleration

## Preview

- **Single word test**: Input a word → see sound change result + step-by-step log
- **Batch preview**: Preview results for all lexicon entries (first 100)
- **Apply to lexicon**: One-click write-back of results to all affected entries
