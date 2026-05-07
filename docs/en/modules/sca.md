# Sound Change Applier (SCA)

Define and preview diachronic sound change rules to simulate historical language evolution.

**Navigate**: click `Sound Changes` in the sidebar.

## Character Mode

Define rules by specifying target and replacement characters:

| Field | Description | Example |
|-------|------------|---------|
| Target | Phonemes/characters to replace (space-separated) | `p t k` |
| Replacement | Replace with | `b d g` |
| Pre-context | Must match before the target | `V` (vowel macro) |
| Post-context | Must match after the target | `V` |
| Exceptions | Words to skip | — |

Macros expand automatically: `V` → vowel list, `C` → consonant list.

### Boundary markers

- `#`: word boundary (compatible form)
- `^`: word-initial boundary alias
- `$`: word-final boundary alias

Use them to express strictly word-initial/word-final changes.

### Example

"Voicing of voiceless stops between vowels":
- Target: `p t k`
- Replacement: `b d g`
- Pre-context: `V`
- Post-context: `V`

## Feature Mode

Define more precise rules based on phonetic features:

- **Target features**: Use `+`/`-` to specify (e.g., `[+voiced, -stop]`)
- **Replacement features**: Specify features to set/remove
- **Phoneme matching**: Real-time display of all phonemes matching the specified features
- **Jaccard similarity**: Auto-finds the closest IPA phoneme after feature replacement
- **Feature inverted index**: O(1) query acceleration

Feature mode also supports boundary-aware constraints for edge-specific rules.

## Ruleset Import and Export (New in 1.0.7)

SCA rulesets can now be moved around as plain text, making it easier to reuse historical change pipelines across languages and language families.

### Import a ruleset

- Click `Import Rule Set` in the ruleset panel
- Paste the external ruleset text into the dialog
- Optionally provide a new ruleset name; if left empty, a default name is used
- Click `Parse & Import` to validate each line and create a new ruleset

Supported formats:

- Arrow syntax: `p t k -> b d g / V _ V`
- Pipe-delimited syntax: `target | replacement | before | after`
- With description: `description | target | replacement | before | after | exceptions`
- Feature-mode syntax: `description | @feature | [target] | +set,-remove | [before] | [after] | exceptions`

If parsing fails, the UI reports the offending lines so they can be fixed and retried.

### Export a single ruleset

Each ruleset header now includes two quick actions:

- `Copy Rule Set`: serialize the current ruleset and copy it to the clipboard
- `Download Rule Set`: export the current ruleset as a `.txt` file

The exported text is round-trip compatible with the importer, so it can be shared directly or pasted back into the app later.

### Export all rulesets at once

- Click `Export All Rule Sets` in the ruleset panel
- The app bundles every current ruleset into a single text file
- The exported file includes a small header with the export title and ruleset count for easier archiving

Typical uses:

- Back up a full diachronic ruleset library for a family
- Move an entire sound change pipeline to another language
- Share an import-ready ruleset pack with collaborators

## Preview

- **Single word test**: Input a word → see sound change result + step-by-step log
- **Batch preview**: Changed-only table with pagination over all changed items
- **Apply to lexicon**: Write back changed lexicon forms
- **Apply to grammar rules**: Optional (per-rule toggle) for inflection/derivation fields

### Batch table columns

- `Scope`: Lexicon / Inflection / Derivation
- `Target`: entry or rule name
- `Field`: changed field (affix/infix/circumfix/ablaut etc.)
- `Original / Result`: before-after values

## Step-by-step workflows

### Workflow 1: Create and verify one ruleset

1. Add a new ruleset (for example `Early Shift`).
2. Add one character-mode rule: `p t k -> b d g` with context `V _ V`.
3. Run `Single Word` preview on 5 sample words.
4. Confirm changelog order and expected outputs.
5. Save and proceed to batch preview.

### Workflow 2: Safe batch apply to lexicon

1. Switch to `Batch Preview`.
2. Verify changed count and page through all changed rows.
3. Confirm no unintended high-frequency roots are affected.
4. Click `Apply` to update lexicon entries.

### Workflow 3: Apply to selected grammar rules (advanced)

1. In `Grammar`, enable `Allow SCA edits` only for target rules.
2. Return to `SCA -> Batch Preview`.
3. Filter mentally by `Scope` and `Field`.
4. Apply and then run `Grammar -> Inflection Test`.
5. If needed, disable toggles again.

## Advanced examples

### Example A: Word-final devoicing

Rule:

- target: `b d g`
- replacement: `p t k`
- after context: `$`

Validation:

1. `tab` -> `tap`
2. `dag` -> `dak`
3. Ensure medial `b d g` remain unchanged.

### Example B: Feature-based spirantization

Rule idea:

- target features: stop consonants in intervocalic position
- replacement features: remove stop, add fricative-like features

Validation:

1. Test on known `VTV` environments.
2. Inspect `feature detail` log for each replacement.
3. Confirm resulting IPA symbols are expected.
