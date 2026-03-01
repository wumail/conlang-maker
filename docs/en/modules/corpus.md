# Corpus

Manage conlang texts and Leipzig-standard interlinear glossing in a sidebar + editor panel layout.

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

### Steps

1. Click **"New"** → enter title and description
2. Write a passage in your language in **Raw Text**
3. Write the natural language translation in **Free Translation**
4. Click **"Auto-gloss"** — the app tries to match each word from the lexicon
5. Manually edit unmatched tokens

## Lexicon Integration

After linking a token to a lexicon entry, hovering shows entry details (POS, definition, IPA).
