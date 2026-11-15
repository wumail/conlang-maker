# Grammar

7 workspaces (**Typology**, **Syntax**, **Parts of Speech**, **Inflection**, **Morphophonology**, **Derivation**, and **Reference Manual**) managing the full lifecycle of grammar from typological profile to step-by-step morphological derivation.

**Navigate**: click `Grammar` in the top navigation bar.

## Typology & Conjugation Classes

Configure your language's morphological architecture and inflectional class routing:

- **Morphological Type**: Isolating / Agglutinative (ordered affix slots) / Fusional (multi-feature portmanteau rules & conjugation classes) / Polysynthetic
- **Morphosyntactic Alignment**: Nominative-Accusative (`nom_acc`) or Ergative-Absolutive (`erg_abs`), wired directly into the Translation Sandbox clause builder
- **Conjugation / Declension Classes**: Define multiple inflectional classes per POS (e.g., Class I `-ar` verbs vs. Class II `-ir` verbs) with stem pattern hints or explicit per-entry bindings. Rule selection strictly respects class membership so reordering rules of another class never alters outputs

## Syntax Configuration

- **Basic word order**: SVO / SOV / VSO / VOS / OVS / OSV
- **Modifier position**: Before head / after head
- **Adposition type**: Preposition / postposition

## Parts of Speech

Customize word classes for your language:

- Name and Leipzig gloss abbreviation
- Word-form regex pattern
- Whether definition or pronunciation is required during lexicon QA

Defaults: Noun, Verb, Adjective, Adverb, Pronoun, Adposition, Conjunction, Interjection.

## Inflection System

### Inflectional Dimensions

Define grammatical dimensions, their values, and whether each dimension is **obligatory** for a given POS:

| Dimension | Example Values |
|-----------|---------------|
| Number | Singular `SG` / Plural `PL` |
| Case | Nominative `NOM` / Accusative `ACC` / Genitive `GEN` / Dative `DAT` |
| Tense | Past `PST` / Present `PRS` / Future `FUT` |
| Person | 1st `1` / 2nd `2` / 3rd `3` |

When an inflection request omits an obligatory dimension (for instance, requesting `PST` on a finite verb without `Person` or `Number`), the engine surfaces explicit missing-feature diagnostics.

### Inflection Rules & Unified 6-Step Pipeline

6 morphological operation types are supported, each with optional IF/ELSE phonological/regex conditioning:

| Type | Description | Example |
|------|------------|---------|
| Prefix | Added before stem | `un- + happy` |
| Suffix | Added after stem | `cat + -s` |
| Infix | Inserted inside stem | After the Nth phoneme |
| Circumfix | Wraps stem on both sides | `ge- ... -t` |
| Reduplication | Full or partial copy | Full or first N phonemes |
| Ablaut | Stem vowel alternation | `sing → sang` |

Every module in Conlang Maker (**Paradigm Matrix**, **Translation Sandbox**, **Corpus Auto-Gloss**, and **Hunspell `.dic/.aff` Export**) shares the exact same **6-step morphological pipeline**:

1. **Irregular Overrides**: Checks entry-specific suppletive/irregular overrides first, preferring the override with the highest feature specificity.
2. **Conjugation Class Filtering**: Restricts candidate rules to the word's assigned conjugation class (or class-neutral rules).
3. **Condition, Slot & Priority Resolution**: Evaluates phonological conditions, slot ordering, feature coverage, and explicit priority — surfacing rule-conflict warnings if multiple rules tie.
4. **Morpheme Concatenation**: Assembles stems and affixes with explicit `+` morpheme boundaries (e.g., `ev+lar`).
5. **Morphophonology**: Applies ordered cross-boundary (`+`) phonological rules (assimilation, epenthesis, deletion, vowel harmony) and strips `+`.
6. **Surface Phonetics**: Runs romanization-to-IPA and allophony rules to produce `/…/` and `[…]` IPA.

### Irregular Overrides

Bind suppletive or irregular surface forms directly to a lexicon entry and feature bundle (e.g., `be + 1.SG.PST → was`). When multiple overrides match subsets of a feature request, the most specific bundle automatically wins.

### Paradigm Matrix & Derivation Trace

- **Inflection Matrix**: Inspect full POS × dimension paradigms in a grid to spot empty cells or overlapping rules.
- **Step-by-Step Derivation Trace (`InflectionTracePanel`)**: Test any lexicon entry or custom stem and expand the trace to inspect rule selection, `+`-bounded intermediate forms, morphophonological rewrites, final IPA, and missing obligatory feature warnings.

### SCA Toggle & Parent Affix Sync

- Each inflection rule has an `Allow SCA edits` toggle so diachronic sound changes only rewrite historically inherited affixes.
- Daughter languages can also run **Grammar Pull Sync** (`gram_pull_sync`) to evolve parent affixes and irregular overrides through child sound changes while flagging **syncretism** collisions.

## Morphophonology

Manage phonological alternations triggered across morpheme boundaries (`+`):

- **Execution order**: Runs in ascending priority order immediately after affix concatenation; if empty, affixes concatenate verbatim.
- **Bidirectional Single-Line DSL & Form Editor**: Write rules such as `n -> m / _ + p` using `V` (vowels), `C` (consonants), `#` (word boundary), and `+` (morpheme boundary).
- **Live Test Bar**: Enter any `+`-segmented string (e.g., `ev+lar`) at the bottom of the panel to preview instant boundary rewrites (`ev+lar → evler`) and reset anytime.

## Derivation Rules

Define word-formation rules that derive new lexicon entries:

- **POS conversion**: Source → target POS (e.g., `Verb → Noun` agentive `-er`)
- **Shared morphology & morphophonology**: Uses all 6 operation types plus cross-boundary `+` morphophonological rules
- **Batch preview & provenance**: Preview candidates across the lexicon and import selected words with structured derivation provenance and morpheme component links

## Reference Manual

Author publishable grammar documentation in re-orderable Markdown chapters. Embed live paradigm tables anywhere with `{{paradigm:pos_id:test_word}}` — included automatically when exporting a Reference Grammar Book.
