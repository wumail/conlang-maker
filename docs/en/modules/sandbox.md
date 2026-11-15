# Translation Sandbox

An interactive sentence-building, morphological inflection, and syntax-reordering workbench for testing how your lexicon, grammar, and native script work together.

**Navigate**: click `Sandbox` in the top navigation bar.

## How It Works: Gloss Lookup → Morphology → Syntax

The Translation Sandbox takes **glosses / concepts** that exist in your language's lexicon (such as `dog` or `bite`), rather than transliterating arbitrary unlinked English text:

1. **Lexicon Lookup**: Resolves each gloss token against your current language's lexicon senses and bound concepts. Any gloss missing from your lexicon is explicitly flagged as `?word?` with `/?/` IPA so you immediately see vocabulary gaps to coin.
2. **Unified 6-Step Morphology**: Runs the exact same inflection pipeline as the Grammar module (irregular overrides → conjugation class → affix rules → cross-boundary `+` morphophonology → IPA).
3. **4-Tier Output**: Displays **Native Script** (`.conlang-script` shaped via your custom font), **Romanized Surface Form**, **Leipzig Morpheme Gloss**, and **IPA**, alongside derivation steps and alignment diagnostics.

## 1. Gloss-Tag Inflection Card

Enter tagged gloss strings in `gloss-TAG1-TAG2` format (e.g., `star-PL shine-PST`):

- Looks up each base gloss in the lexicon
- Applies inflection and morphophonological rules for the requested tags
- Outputs a complete interlinear breakdown with per-token derivation traces

## 2. Recursive Clause Builder

Build structured clauses to verify word order, phrase structure, and case alignment:

- **Arguments, Modifiers & Nested Clauses**: Specify Subject, Verb, Object, noun modifiers/determiners, adpositional phrases (PP), and **recursive embedded subclauses**.
- **Alignment-Aware Case Inference**:
  - **Nominative-Accusative (`nom_acc`)**: Assigns Nominative to `S`/`A` and Accusative to `P`.
  - **Ergative-Absolutive (`erg_abs`)**: Assigns Ergative to transitive `A` and Absolutive to intransitive `S` and patient `P`. If your grammar has not yet defined matching case values for `S`/`A`/`P`, an explicit warning banner tells you which arguments remain unmarked.
- **Automatic Reordering & Phrase Tree**: Linearizes constituents according to your configured base word order (`SVO`, `SOV`, `VSO`, etc.), modifier placement, and preposition/postposition type, rendering both numbered **Derivation Steps** and a visual **Phrase Tree**.

## 3. Quick Single-Form Checks

For rapid single-stem paradigm checks, use `Grammar -> Inflection Test` or open the Command Palette (`⌘K` / `Ctrl+K`) and type `=` for instant inline evaluation.
