# Corpus

Manage conlang texts and Leipzig-standard interlinear glossing in a sidebar + editor panel layout.

**Navigate**: click `Corpus` in the sidebar.

## Text Management

- Create/edit/delete corpus texts
- Metadata: title, description, tags, timestamps
- Raw text (in your conlang) and free translation

## Interlinear Glossing

Leipzig glossing standard annotations:

- **Auto-gloss**: Raw text → split by sentences → split by spaces → auto-match from lexicon
- **Manual editing**: Each token can be edited independently
  - Surface form
  - Morpheme break (use `-` to separate morphemes)
  - Gloss labels
  - Linked entry ID
  - IPA

## Auto-gloss engine (advanced)

The auto-gloss pipeline supports:

- exact lexicon match
- concatenative reverse parsing (multi-prefix + stem + multi-suffix)
- non-concatenative candidates (infix/circumfix/reduplication/ablaut)
- confidence-based auto-apply + pending review queue

### Per-corpus report persistence

Auto-gloss report is stored per corpus item:

- total tokens
- auto-applied
- pending review
- unresolved

Switching to another corpus no longer reuses a previous report.

### Steps

1. Click **"New"** → enter title and description
2. Write a passage in your language in **Raw Text**
3. Write the natural language translation in **Free Translation**
4. Click **"Auto-gloss"** — the app tries to match each word from the lexicon
5. Manually edit unmatched tokens

### Step-by-step: Review pending suggestions

1. Run `Auto-gloss`.
2. Open the pending suggestions panel.
3. Check confidence and trace columns.
4. Apply one-by-one or click `Apply All`.
5. Re-check unresolved token count in report.

## Apply SCA to corpus with diff (advanced)

Use `Preview & Apply SCA to Corpus` to evolve corpus text directly.

### What diff includes

- scope: original text / gloss-line original / token surface
- before -> after values
- context snippet
- checkbox selection (default all selected)

### Step-by-step: Safe corpus evolution

1. Click `Preview & Apply SCA to Corpus`.
2. Review the diff table.
3. Deselect changes you do not want.
4. Click `Apply Selected Changes`.
5. The system automatically runs auto-gloss again on updated corpus.

### Close behavior

Use the red circular close icon at the top-right corner of the panel to dismiss preview anytime.

## Lexicon Integration

After linking a token to a lexicon entry, hovering shows entry details (POS, definition, IPA).

## Advanced example: diachronic corpus pass

Scenario: you maintain a proto text and evolve it for a daughter language.

1. Prepare baseline corpus in parent language.
2. Configure SCA in daughter language.
3. Run corpus SCA diff preview and apply selected changes.
4. Let auto-gloss rerun automatically.
5. Resolve remaining low-confidence items.
