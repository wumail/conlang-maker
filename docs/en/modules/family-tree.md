# Family Tree

Manage language genealogy relationships, deriving child languages from a proto-language.

**Navigate**: click `Family Tree` in the sidebar.

## Topology Visualization

Tree structure displaying all languages, highlighting the active language. Click a node to switch.

## Language Derivation

Create a child language from a parent, fully copying all data (phonology, grammar, lexicon, SCA, corpus) as an independent copy for modification.

### Steps

1. Select the parent language in the family tree
2. Click **"Derive"**
3. Enter the child language name
4. The system fully copies all parent data

### Step-by-step: Create a clean daughter branch

1. Freeze parent language baseline (lexicon + grammar).
2. Derive daughter language from that parent.
3. Rename the daughter language clearly (for example `Daughter A`).
4. Switch to daughter and add independent SCA rules.
5. Keep parent unchanged for historical reference.

## Pull Sync

Checks for entries in the parent language that don't yet exist in the child:

- **Pull and apply sound changes**: New words are automatically processed through SCA rule sets, marked as "Evolved" origin
- Full etymology chain preserved (parent_entry_id + applied_sound_changes)

### Step-by-step: Continuous sync from parent

1. Add new words in parent language.
2. Switch to child language.
3. Open `Family Tree -> Pull Sync`.
4. Click `Check Updates`.
5. Review new item count.
6. Click `Pull & Apply Sound Changes`.

## Borrowing

Borrow vocabulary from any other language:

1. Click **"Borrow"**
2. Select the source language
3. Browse/search the source lexicon
4. Select words to borrow, auto-marked as "Borrowed" origin

### Step-by-step: Borrow with control

1. Open borrowing panel in the target language.
2. Select source language.
3. Search by spelling/gloss.
4. Select target entries (single or multi).
5. Confirm import and verify etymology marker.

## Multi-Language Workspace

- **Language switcher**: Click the language name (top-left) to enter the family tree
- **Independent data**: Each language has its own phonology, grammar, lexicon, SCA, and corpus
- **Genealogy**: Languages linked via parent_id

## Advanced examples

### Example A: Parent-child divergence

1. Keep shared core vocabulary in parent.
2. In child, apply SCA and add local derivation rules.
3. Use pull sync periodically for newly added parent roots.
4. Re-run corpus checks to keep child texts consistent.

### Example B: Borrowing chain with provenance

1. Borrow a cultural term from sibling language.
2. Keep inherited forms through pull sync from parent.
3. Compare etymology markers (`evolved` vs `borrowed`) in lexicon.
