# Family Tree

Manage language genealogy relationships, deriving child languages from a proto-language.

## Topology Visualization

Tree structure displaying all languages, highlighting the active language. Click a node to switch.

## Language Derivation

Create a child language from a parent, fully copying all data (phonology, grammar, lexicon, SCA, corpus) as an independent copy for modification.

### Steps

1. Select the parent language in the family tree
2. Click **"Derive"**
3. Enter the child language name
4. The system fully copies all parent data

## Pull Sync

Checks for entries in the parent language that don't yet exist in the child:

- **Pull and apply sound changes**: New words are automatically processed through SCA rule sets, marked as "Evolved" origin
- Full etymology chain preserved (parent_entry_id + applied_sound_changes)

## Borrowing

Borrow vocabulary from any other language:

1. Click **"Borrow"**
2. Select the source language
3. Browse/search the source lexicon
4. Select words to borrow, auto-marked as "Borrowed" origin

## Multi-Language Workspace

- **Language switcher**: Click the language name (top-left) to enter the family tree
- **Independent data**: Each language has its own phonology, grammar, lexicon, SCA, and corpus
- **Genealogy**: Languages linked via parent_id
