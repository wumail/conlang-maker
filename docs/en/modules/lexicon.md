# Lexicon

The core module, with a sidebar + editor panel split-view for managing all word entries.

## Entry Management

| Action | Description |
|--------|------------|
| Add entry | Click the `+` button in the sidebar |
| Edit entry | Real-time editing in the right panel, auto-saves with debounce |
| Delete entry | Delete button at the top of the editor, requires confirmation |
| Search | Filter by romanization or gloss text |
| IPA fuzzy search | Toggle IPA search mode, results sorted by phonetic similarity |
| Tags | Free-form comma-separated tag system |

## Senses

Each entry supports multiple senses, each containing:

- **POS** — selected from the grammar module's POS list
- **Gloss** — short translation for interlinear annotation
- **Definition** — full multi-line definition
- **Examples** — multi-line usage examples

## Auto IPA Generation

- Auto-generates IPA from romanization via mapping table → allophony rules
- Lock to manual mode (🔒) for custom IPA
- Unlock (🔓) to restore auto-generation

## Quick Entry

Click the ⚡ button (top-right) for a popup: word → gloss → POS → **Enter** to save → auto-clears for the next entry.

## Quality Check

6 automated check rules:

| Rule | Severity | Description |
|------|----------|------------|
| Missing POS | 🔴 Error | Sense has no POS set |
| Unmapped spelling | 🟡 Warning | Spelling contains characters not in the romanization table |
| Empty IPA | 🟡 Warning | Entry has no IPA |
| Pattern mismatch | 🟡 Warning | Word form doesn't match POS regex pattern |
| Missing required field | 🔴 Error | Missing POS-required fields |
| Duplicate form | 🟡 Warning | Duplicate romanization in lexicon |

## Statistics

- **Total entries** — large prominent number
- **POS distribution** — horizontal bar chart
- **Phoneme frequency** — bar chart, top 30 IPA phonemes
- **Character frequency** — bar chart, top 30 romanization characters
- **Bigrams** — heatmap, top 40 two-phoneme combinations
- **Syllable distribution** — bar chart by syllable count
- **Orthography table** — complete romanization → IPA mapping
