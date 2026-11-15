# Lexicon

The core module, with a sidebar + editor panel split-view for managing all word entries.

**Navigate**: click `Lexicon` in the sidebar.

## Entry Management

| Action | Description |
|--------|------------|
| Add entry | Click the `+` button in the sidebar |
| Edit entry | Real-time editing in the right panel, auto-saves with debounce |
| Delete entry | Delete button at the top of the editor, requires confirmation |
| Search | Filter by romanization, gloss, definition, usage note, tag, or bound concept gloss |
| IPA fuzzy search | Toggle IPA search mode, results sorted by phonetic similarity |
| Advanced & Quick filters | Combine POS, all 7 origin types, tags, lifecycle flags, and 5 built-in quick filters (`No concept bound`, `Missing examples`, `TBD gloss`, `Borrowed, needs review`, `Deprecated`) |
| Table View Modal | Click the table icon right next to the `Lexicon` header to open a virtualized `Word × Sense` spreadsheet modal with column toggles, keyboard navigation (`Enter / ↑ / ↓`), row-level locate-in-detail, and TSV/CSV paste import preview |
| Sense-scoped batch edit | Choose whether batch edits apply to `All senses`, `Only empty target fields`, or `First sense only`, with a hidden-selection warning banner and before/after diff preview |

## Lifecycle Labels

Entries support three lifecycle labels:

- **Added**: Entry exists in the current language but not in its parent language
- **Deprecated**: Entry is marked deprecated in the current language
- **Changed**: Entry form/pronunciation differs from its parent-language counterpart

You can filter by lifecycle status in Advanced Search, and the same labels are shown below IPA in the editor panel.

:::tip
If an entry is marked as **Deprecated**, that status takes precedence and it will not simultaneously show **Changed**.
:::

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
- **Core Concept (`concept_id`)** — bind to any of the 158 built-in CLDF/Concepticon concepts (covering Swadesh-100 and Leipzig-Jakarta-100) or project custom concepts for cross-family cognate alignment
- **Sense-level Inflection Class Override** — override the word's conjugation class for a specific sense
- **Usage Note** — register, collocation, or pragmatic notes
- **Definition & Examples** — full multi-line definitions and usage sentences

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

## Structured Etymology & Clickable Lineage Chain

Etymology distinguishes 7 origin types (`A priori`, `A posteriori`, `Evolved`, `Borrowed`, `Derived`, `Multi-part compound`, and `Mixed`):

- **DAG Multi-Morpheme Components**: Record ordered root/affix components from the lexicon for derived and compound entries, with automatic stale-IPA detection when component forms change.
- **Semantic Change Classification**: Track sound changes separately from semantic shifts (`unchanged`, `narrowing`, `broadening`, `shift`, `metaphor`, `added_sense`, `replaced_sense`).
- **Borrowing Source Snapshots**: Preserve the donor form, gloss, sense ID, and language/family name at the moment of borrowing (including cross-project loans), even if the donor entry is later edited or removed.
- **Clickable Etymology Chain & Inline Cards**: Expand the lineage chain to inspect and jump to ancestor/donor/component entries across languages (broken references are flagged with one-click cleanup). The detail pane also embeds **Word Family**, **Inflection Paradigm**, and **Corpus Concordance** backlink cards.

## Quality Check

10 automated check rules powered by dynamic-programming maximal-onset syllabification:

| Rule | Severity | Description |
|------|----------|------------|
| Missing POS | 🔴 Error | Sense has no POS set |
| Unmapped spelling | 🟡 Warning | Spelling contains characters not in the romanization table |
| Empty IPA | 🟡 Warning | Entry has no IPA |
| Pattern mismatch | 🟡 Warning | Word form doesn't match POS regex pattern |
| Missing required field | 🔴 Error | Missing POS-required fields |
| Duplicate form | 🟡 Warning | Duplicate romanization in lexicon |
| Syllable structure violation | 🟡 Warning | IPA cannot be parsed into valid syllables under current templates |
| Blacklist hit | 🔴 Error | Form or phoneme sequence matches a forbidden regex |
| Vowel harmony conflict | 🟡 Warning | Mixes vowels from incompatible harmony groups |
| Homophone collision / Stale compound | 🟡 Warning | Distinct entries share identical phonemic IPA, or a compound's component IPA changed |

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
