# Translation Sandbox

An interactive translation and annotation workbench with two modes.

**Navigate**: click `Translation Sandbox` in the sidebar.

## Gloss-Tag Inflection Mode

Input text in `gloss-TAG1-TAG2` format (e.g., `star-PL shine-PAST in void`):

1. Looks up each gloss in the lexicon
2. Auto-applies inflection rules by tag
3. Generates IPA
4. Outputs an interlinear table (conlang form / gloss tags / IPA)

### Step-by-step

1. Enter a tagged string like `star-PL shine-PAST`.
2. Run translation.
3. Inspect generated forms and tags.
4. If output is wrong, adjust lexicon gloss or grammar rules.

## Syntax Reordering Mode

1. Add tokens with syntactic roles (S / V / O / Mod / Adp / Other)
2. Auto-reorders by your grammar's word order setting
3. Auto-infers inflection tags (e.g., S → NOM, O → ACC)
4. Applies inflection and outputs the interlinear table

### Step-by-step

1. Add tokens with roles (S/V/O/Mod).
2. Run reorder.
3. Check whether word order matches syntax settings.
4. Verify case/tense tags are inferred correctly.

## Word Form Helper

Input a test word + select POS + select dimension values → instant preview of inflected form and IPA.

### Advanced example: regression check after grammar edit

1. Prepare 10 frequently used stems.
2. Run Word Form Helper for each stem.
3. Compare with previous expected forms.
4. Fix rule ordering if regressions appear.
