# Export & Import

**Navigate**: click `Export / Import` in the sidebar.

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

### Step-by-step: Publish-ready export pack

1. Export PDF for documentation readers.
2. Export Excel for data reviewers.
3. Export LLM Prompt for AI-assisted testing.
4. Keep CSV as a lightweight backup snapshot.

## LLM Prompt

Generate a Markdown file with a complete language description for AI assistants:

- Copy to clipboard
- Download as `.md`
- Includes 5 recommended prompt questions

:::tip
Paste the LLM Prompt into ChatGPT, Claude, or other AI conversations — the AI will be able to construct sentences, translate, and even write stories in your language.
:::

### Step-by-step: AI validation loop

1. Export LLM Prompt.
2. Ask AI to translate 10 basic sentences.
3. Compare AI outputs with your sandbox outputs.
4. Refine grammar/lexicon where mismatches are systematic.

## Import

- **CSV import**: Auto-detects format (PolyGlot / Vulgarlang / generic)
- Auto-maps columns (word / ipa / pos / gloss / definition)
- Auto-standardizes POS
- Preview before batch import

### Step-by-step: Safe CSV import

1. Choose CSV file.
2. Check detected schema (PolyGlot/Vulgarlang/generic).
3. Review column mapping preview.
4. Select conflict strategy.
5. Confirm import and run QC immediately.

## Advanced examples

### Example A: Team collaboration package

1. Share Excel with collaborators.
2. Share PDF with non-technical readers.
3. Re-import collaborator CSV edits.
4. Run QC + statistics after merge.

### Example B: Versioned backups

1. Export CSV weekly.
2. Export PDF monthly milestones.
3. Tag release in Git and archive exports together.
