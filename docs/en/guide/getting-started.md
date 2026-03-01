# Build a Conlang from Scratch

> This guide walks you through the complete workflow of creating a fully functional constructed language from zero.

:::tip
Language creation is an iterative process. You don't need to follow this guide strictly in order — feel free to jump between modules at any time. But if you're a beginner, following the steps below will be the smoothest path.
:::

## Before You Start

### Launch the App

Conlang Maker is a desktop application. On first launch, you'll need to create a language family project, and the app will automatically generate a **Proto Language** from which all subsequent languages can be derived.

### Interface Overview

- **Top navigation bar**: All module entries
- **⚡ button (top-right)**: Quick entry popup, always available
- **Language name (top-left)**: Current active language, click to enter the family tree

## Step 1: Build Your Sound System

**Navigate**: `Phonology` → `Inventory`

### Using Presets (Recommended for Beginners)

1. Click the **"Presets"** button
2. Browse 12 real language-style presets:
   - Soft & flowing → **Hawaiian** or **Elvish**
   - Strong & sharp → **Georgian** or **Slavic**
   - Exotic → **Arabic** or **Nahuatl**
3. Click a preset name to load it

### Manual Selection

1. Click consonants in the IPA consonant table (highlighted = selected)
2. Click vowels in the vowel trapezoid
3. Click to play the audio for each phoneme

### Tips

- **Consonants**: 15–25 is a common range
- **Vowels**: 5–7 is most common (a, e, i, o, u is the classic five-vowel system)
- **Symmetry**: If you have /p/, you usually should also have /b/

## Step 2: Design Your Orthography

**Navigate**: `Phonology` → `Romanization`

1. Click **"Add Mapping Table"** → enter a name (e.g., "Standard Spelling")
2. Click **"Add Mapping"** to define spellings for each phoneme

:::tip
After defining mappings, entering a spelling in the dictionary will **automatically generate IPA**.
:::

## Step 3: Configure Syllable Structure

**Navigate**: `Phonology` → `Phonotactics`

### Define Phoneme Class Macros

- `C` = all consonants
- `V` = all vowels
- `N` = nasals

### Define Syllable Templates

- `CV` — simplest, like Japanese: ka, mi, su
- `(C)V` — optional onset
- `(C)V(C)` — optional coda
- `(C)(C)V(C)(C)` — complex clusters

## Step 4: Generate Initial Vocabulary

**Navigate**: `Word Generator`

1. Set **count** (50–100 recommended) and **syllable range** (1–3)
2. Click **"Generate"**
3. Review candidates, delete unwanted ones, assign POS
4. Select desired words → click **"Import to Lexicon"**

## Step 5: Polish the Lexicon

**Navigate**: `Lexicon`

Edit entries in the split-panel editor: romanization, senses (POS, gloss, definitions, examples), etymology, and tags.

### Quick Entry

Click the ⚡ button anytime: word → gloss → POS → **Enter** to save → auto-clears for the next word.

## Step 6: Build Grammar

**Navigate**: `Grammar`

- Set **word order** (SVO / SOV / VSO etc.)
- Configure **modifier position** and **adposition type**
- Define **inflectional dimensions** (Number, Case, Tense, Person)

## Step 7: Define Inflection & Derivation

Create morphological rules: suffixes (`-en` for plural), prefixes (`na-` for negation), conditional rules, and more.

Test inflection with the **Inflection Test** tool. Define derivation rules for word-class conversion (verb→noun: `-er`).

## Step 8: Test in the Sandbox

**Navigate**: `Translation Sandbox`

- **Gloss mode**: Input `star-PL shine-PAST in void` → auto-lookup, auto-inflect, generate interlinear table
- **Syntax mode**: Add tokens with roles (S/V/O) → auto-reorder by word order setting

## Step 9: Quality Check & Statistics

- **QC**: Run automated checks for missing POS, unmapped spellings, empty IPA, duplicates
- **Statistics**: View word count, POS distribution, phoneme frequency, syllable distribution

## Step 10: Write a Grammar Manual

**Navigate**: `Grammar` → `Grammar Manual`

Write Markdown chapters. Embed paradigm tables with `{{paradigm:noun:kata}}`.

## Step 11: Write Corpus Texts

**Navigate**: `Corpus`

Write texts in your language with Leipzig-standard interlinear glossing. Use **"Auto-gloss"** to match words from the lexicon.

## Step 12: Derive Child Languages

**Navigate**: `Family Tree`

1. Select parent → **"Derive"** → enter name
2. Define sound change rules in the child language's SCA
3. **"Pull"** new words from parent, auto-processed through sound changes

## Step 13: Export & Share

**Navigate**: `Export`

| Goal | Format |
|------|--------|
| Print a reference book | **PDF** |
| Analyze data | **Excel** |
| Spell-check | **Hunspell** |
| Backup / other tools | **CSV** |
| Let AI learn your language | **LLM Prompt** |

---

## Creative Templates

### A. Simple Language
Preset: Hawaiian · Syllable `(C)V` · 5 vowels, 8 consonants · SVO

### B. Complex Language
Preset: Slavic · Syllable `(C)(C)V(C)(C)` · 8 vowels, 25+ consonants · SOV

### C. Harmonious Language
Preset: Finnish · Syllable `(C)V(C)` · 8 vowels, 15 consonants · SOV · Vowel harmony
