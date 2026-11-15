# Build a Conlang from Scratch

> This guide walks you through the end-to-end workflow of creating a complete constructed language — and evolving an entire language family — from zero.

:::tip
Language creation is iterative: feel free to jump between modules anytime. When you create a new project, the **Onboarding Start Modal** also offers three guided entry paths (Start from a Preset, Coin Core Concepts, or Blank Canvas).
:::

## Before You Start

### Workspace & Proto Language

Conlang Maker is a local-first desktop app. Creating a new family project initializes a **Proto Language** from which any number of daughter languages and dialects can branch.

### Navigation & Global Shortcuts

- **Compact Language Switcher (top-left)**: Click the active language name to switch across family branches; per-language view memory preserves your place in Lexicon and Corpus.
- **Top Navigation Bar**: `Phonology` · `Writing` · `Lexicon` · `Word Gen` · `Grammar` · `Corpus` · `Sandbox` · `Family Tree` · `Sound Changes` · `Export / Import`
- **Command Palette (`⌘K` / `Ctrl+K`)**:
  - Type keywords to jump to words, grammar rules, or pages
  - Prefix with `>` to trigger actions (switch language, open Cognate Matrix, run QA)
  - Prefix with `=` to evaluate IPA, sound changes, or inflections inline
- **Global Undo / Redo (`⌘Z` / `⇧⌘Z`)**: Safely undo single edits and multi-module batch operations alike
- **⚡ Quick Entry & Save Status Pill (top-right)**: Rapidly coin words with `Enter` while live persistence status stays visible

## Step 1: Build Your Sound System

**Navigate**: `Phonology` → `Inventory`

1. **Load a Preset (great for beginners)**: Browse 12 real-world stylistic presets (Hawaiian, Elvish, Slavic, Arabic, etc.).
2. **Customize Manually**: Toggle consonants in the IPA chart and vowels in the trapezoid, and click any symbol to hear its reference pronunciation.

## Step 2: Design Orthography & Allophony

**Navigate**: `Phonology` → `Romanization` / `Phonotactics` / `Allophony`

1. Map spellings to IPA phonemes (e.g., `sh → ʃ`) and review **Orthography Health Checks** for conflicts, shadowed rules, or rewritten-but-unreachable phonemes.
2. Define phoneme macros (`C`, `V`), syllable templates (`(C)V(C)`), blacklists, and vowel harmony.
3. Optionally add contextual **Allophony** rules to distinguish phonemic `/…/` from surface `[…]` realizations.

## Step 3 (Optional): Set Up Your Native Script

**Navigate**: `Writing`

1. Import a custom `.ttf` or `.otf` font (automatically inherited by daughter languages unless overridden).
2. Annotate glyphs, test real OpenType shaping (`liga`, `calt`, `mark`) via HarfBuzz Wasm, and run geometry audits.
3. Once imported, Lexicon, Corpus, Sandbox, and exported HTML Reference Grammar Books render your native script everywhere.

## Step 4: Coin & Organize the Lexicon

**Navigate**: `Word Gen` → `Lexicon`

1. Batch-generate phonotactically valid roots in **Word Gen** and map them to **Swadesh 100 / Leipzig-Jakarta** core concepts.
2. Refine entries in **Lexicon**, or click the **Table View** button next to the Lexicon header to batch-edit, paste TSV rows, and bind per-sense `concept_id` anchors.
3. Link morpheme components on derived/compound words to inspect **interactive etymology chains** and word-family DAGs, and run the 11-rule **Quality Check**.

## Step 5: Build Grammar & Morphophonology

**Navigate**: `Grammar`

1. **Typology & Syntax**: Choose morphological type (isolating / agglutinative / fusional / polysynthetic), alignment (`nom_acc` or `erg_abs`), base word order (`SVO`, `SOV`, `VSO`, etc.), and conjugation classes.
2. **Inflection**: Define dimensions (with obligatory flags), 6 morphological rule types, and **Irregular Overrides**.
3. **Morphophonology**: Add cross-boundary (`+`) rules (such as `ev+lar → evler`) and test them in the live bottom bar.
4. **Paradigm Matrix & Trace**: Audit full paradigms and step-by-step derivation traces.

## Step 6: Validate in Sandbox & Corpus

**Navigate**: `Sandbox` / `Corpus`

1. **Translation Sandbox**: Test `gloss-TAG` strings or build nested clauses in the **Recursive Clause Builder** to verify word order, alignment case assignment, and native script shaping.
2. **Corpus**: Write passages and translations, run **non-destructive Auto-Gloss** (`fill_empty` default protects `edited`/`verified` tokens and line translations), select candidate parses with number keys `1`–`9`, and coin missing words inline via the **`QuickLex` drawer**.

## Step 7: Evolve a Language Family

**Navigate**: `Family Tree` / `Sound Changes`

1. Derive daughter languages in **Family Tree**.
2. Author diachronic sound shifts in **Sound Changes** using the bidirectional single-line DSL and apply them via the virtualized batch diff preview.
3. Borrow words across branches or external projects (preserving historical donor snapshots) and run Pull Sync.
4. Click **Cognate Matrix** on the Family Tree header to inspect cross-family cognate sets, borrowings, lexical gaps, and innovations.

## Step 8: Publish & Collaborate with AI

**Navigate**: `Export / Import` / `MCP Settings`

- Export self-contained **HTML / Typst Reference Grammar Books**, **Excel**, **Hunspell `.dic` + `.aff`**, **LLM Prompts**, or **Workspace Bundles**.
- Connect **Cursor**, **Claude Code**, or **Claude Desktop** to the built-in **MCP Server** (84 semantic tools) for CAS-safe lexicon auditing, sound-change simulation, and family-wide workflows.
