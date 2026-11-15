# Family Tree

Manage language genealogy relationships, deriving child languages from a proto-language.

**Navigate**: click `Family Tree` in the sidebar.

## Topology Visualization

Tree structure displaying all languages, highlighting the active language. Click a node to switch.

## Language Derivation

Create a child language from a parent, copying phonology, grammar, lexicon, and corpus data into an independent branch.

- Child entries keep the same `entry_id` as parent entries for deterministic parent-child alignment
- Child SCA rules are initialized empty so each branch can define its own historical changes
- After derivation, the app automatically switches to the newly created child language

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

Pull Sync compares inherited entries between parent and child and builds **add** / **update** candidates:

- **Add**: inherited entry exists in parent but not in child
- **Update**: inherited entry changed on one side and can be merged safely
- **Conflict**: both parent and child changed; child version is kept (no auto-overwrite)

When clicking **Pull & Apply Sound Changes**, candidates are transformed with the child language SCA rule sets and written back with etymology links (`parent_entry_id` + `applied_sound_changes`).

:::tip
Sense-level differences (gloss/definitions/examples) do **not** trigger Pull Sync updates. Semantics are treated as child-language evolvable content.
:::

### Legacy Data Migration

If old projects miss inherited-link fields (`parent_entry_id`, `source_language_id`, etc.), use:

- **Preview Migration (dry-run)**: scan and preview fixes without file writes
- **Migrate Legacy Entries**: apply and persist the fixes

### Step-by-step: Continuous sync from parent

1. Add new words in parent language.
2. Switch to child language.
3. Open `Family Tree -> Pull Sync`.
4. Click `Check Updates`.
5. Review new item count.
6. Click `Pull & Apply Sound Changes`.

## Borrowing & Cross-Project Loans

Borrow vocabulary from any language in the current family **or from another registered Conlang Maker project**:

1. Click **"Borrow"** in the Family Tree header
2. Select the donor via **Project → Language → Entry → Sense**
3. Import selected entries — each loan records stable provenance IDs plus an immutable **Borrowing Source Snapshot** (donor form, gloss, language, and family name at the time of borrowing)

## Diachronic Grammar Affix Sync

Alongside lexicon Pull Sync, daughter languages can pull and evolve inflection/derivation affixes from their parent language through local SCA rules, complete with automatic **homophone neutralization warnings** when sound changes cause distinct grammatical endings to merge.

## Cross-Family Cognate Matrix

Click **"Cognate Matrix"** in the Family Tree header to open the cross-language comparison modal:

- **Concept-centric grid**: Compare 158 CLDF/Concepticon core concepts plus custom concepts across every language in the family, color-coding shared cognate sets vs. borrowings and independent innovations.
- **Targeted filters**: Filter by semantic field, filled-only rows, borrowing replacements, form changes, multi-candidate cells (`+1`), or broken chains without layout shift.
- **Candidate drawer & lexical gaps**: Click any cell to inspect all candidate senses, pin a primary representative, bind an existing word, create a new word in place, or record structured lexical gap statuses (`unrecorded`, `tbd`, `periphrastic`, `confirmed_absent`).

## Multi-Language Workspace & View Memory

- **Compact top-bar language switcher**: Click the active language name in the top bar to switch languages directly; Conlang Maker remembers your active word and corpus per language and restores them when switching back
- **Language trash & restore**: Deleting a leaf language moves it into `.conlang-maker/trash/` inside an atomic transaction for safe recovery

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
