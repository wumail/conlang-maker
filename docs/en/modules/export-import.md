# Export & Import

Publish reference grammar books, multi-format lexicons, spell-check dictionaries, AI language briefs, and portable workspace bundles — all backed by native OS save dialogs.

**Navigate**: click `Export / Import` in the top navigation bar.

## Export Presets & Formats

| Format | Content | Use Case |
|--------|---------|----------|
| **Reference Grammar Book (`HTML` / Typst `.typ`)** | Cover, phonology & orthography, embedded `@font-face` custom script font, paradigms & conjugation classes, grammar chapters, **bidirectional dictionary (Conlang→Gloss & Gloss→Conlang with sense-specific corpus citations)**, and full Leipzig-glossed corpus anthology | Share a self-contained single-file HTML book, print to PDF, or typeset publication-grade layouts with Typst |
| **PDF** | Complete language reference | Quick printable reference document |
| **Excel (`.xlsx`)** | Multi-sheet workbook | Spreadsheet analysis (phoneme inventory, romanization tables, full lexicon) |
| **Hunspell (`.dic` + `.aff`)** | Spell-checker dictionary pair | Pick a `.dic` destination and Conlang Maker **automatically writes the companion `.aff` file** in the same folder using the unified 6-step morphology engine |
| **CSV** | UTF-8 BOM lexicon table | Lightweight tabular exchange (CJK and IPA safe) |
| **LLM Prompt (`.md`)** | AI language brief | Copy or save a complete Markdown reference + starter prompts for ChatGPT, Claude, or local LLMs |
| **Workspace Bundle** | Portable archive of `.conlang`, all family languages, and custom `.ttf`/`.otf` fonts | Full-family backups, cross-machine migration, and collaborator handoffs |

## Reference Grammar Book Builder

Open the **Reference Grammar Book** modal to customize included sections (phonology, writing system, morphology & manual chapters, bidirectional dictionary, and corpus texts):

- **Single-File HTML**: Automatically embeds your language's effective `.ttf`/`.otf` script font via `@font-face` so readers see authentic native script glyphs with zero font installation.
- **Typst Source (`.typ`)**: Exports clean Typst markup ready for academic typesetting.

## Import & Workspace Restore

- **CSV Import**: Auto-detects PolyGlot, Vulgarlang, and generic CSV schemas, previews every addition/conflict in the unified **Batch Diff Preview** modal, and imports atomically with undo support.
- **Workspace Bundle Restore**: Takes an automatic project-level snapshot first, then restores the bundle inside a single atomic transaction.
