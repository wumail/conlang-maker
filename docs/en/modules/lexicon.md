# Lexicon

The core module, with a sidebar + editor panel split-view for managing all word entries.

**Navigate**: click `Lexicon` in the sidebar.

## Entry Management

| Action | Description |
|--------|------------|
| Add entry | Click the `+` button in the sidebar |
| Edit entry | Real-time editing in the right panel, auto-saves with debounce |
| Delete entry | Delete button at the top of the editor, requires confirmation |
| Search | Filter by romanization or gloss text |
| IPA fuzzy search | Toggle IPA search mode, results sorted by phonetic similarity |
| Tags | Free-form comma-separated tag system |

### Step-by-step: Create one high-quality entry

1. Click `+` to add a new entry.
2. Fill spelling (romanization).
3. Add first sense with POS + gloss.
4. Add at least one definition/example.
5. Add tags and etymology metadata.

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

### Step-by-step: Diagnose wrong IPA

1. Keep entry in auto mode (unlocked).
2. Verify romanization mapping rules.
3. Verify allophony rules and priorities.
4. Re-open entry and confirm regenerated IPA.

## Quick Entry

Click the ⚡ button (top-right) for a popup: word → gloss → POS → **Enter** to save → auto-clears for the next entry.

### Best use case

Use Quick Entry when collecting many roots during brainstorming sessions.

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

### Step-by-step: QC cleanup pass

1. Run QC on full lexicon.
2. Fix all error-level issues first.
3. Review warning-level issues by frequency.
4. Re-run QC until blockers are zero.

## Statistics

- **Total entries** — large prominent number
- **POS distribution** — horizontal bar chart
- **Phoneme frequency** — bar chart, top 30 IPA phonemes
- **Character frequency** — bar chart, top 30 romanization characters
- **Bigrams** — heatmap, top 40 two-phoneme combinations
- **Syllable distribution** — bar chart by syllable count
- **Orthography table** — complete romanization → IPA mapping

## Advanced examples

### Example A: Build a 50-word core list

1. Add entries via Quick Entry.
2. Assign POS and gloss consistently.
3. Tag all as `core`.
4. Run QC and fix missing POS issues.

### Example B: Compare phonotactic drift

1. Export stats snapshot before major changes.
2. Update phonology/romanization rules.
3. Compare top phoneme and bigram distributions after update.
