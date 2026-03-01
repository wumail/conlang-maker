# Export & Import

## Export Formats

| Format | Content | Use Case |
|--------|---------|----------|
| **PDF** | Complete language reference | Print a beautiful reference book (cover, orthography, paradigms, grammar manual, lexicon) |
| **Excel** | Multi-sheet workbook | Analyze with Excel (phoneme table, romanization mappings, full lexicon) |
| **Hunspell (.dic/.aff)** | Spell-check dictionary | Enable spell-check in LibreOffice (base forms + all inflected forms) |
| **CSV** | Lexicon table | Backup or import into other tools (Unicode BOM, CJK-compatible) |
| **LLM Prompt (.md)** | AI dialogue prompt | Let AI learn your language (complete language description + 5 suggested prompts) |

### Steps

1. Select a format
2. Click the export button
3. Choose save location

## LLM Prompt

Generate a Markdown file with a complete language description for AI assistants:

- Copy to clipboard
- Download as `.md`
- Includes 5 recommended prompt questions

:::tip
Paste the LLM Prompt into ChatGPT, Claude, or other AI conversations — the AI will be able to construct sentences, translate, and even write stories in your language.
:::

## Import

- **CSV import**: Auto-detects format (PolyGlot / Vulgarlang / generic)
- Auto-maps columns (word / ipa / pos / gloss / definition)
- Auto-standardizes POS
- Preview before batch import
