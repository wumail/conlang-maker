# Grammar

8 sub-sections managing the full lifecycle of grammar rules.

**Navigate**: click `Grammar` in the sidebar.

## Syntax Configuration

- **Basic word order**: SVO / SOV / VSO / VOS / OVS / OSV
- **Modifier position**: Before head / after head
- **Adposition type**: Preposition / postposition

### Step-by-step: Set a minimal syntax profile

1. Open `Grammar -> Syntax`.
2. Choose a base word order (for example `SOV`).
3. Set modifier position (`before head` or `after head`).
4. Set adposition type (`preposition` or `postposition`).
5. Save and switch to `Sandbox -> Syntax mode` to verify ordering behavior.

## Parts of Speech

Customize POS to define your language's word classes:

- Name, abbreviation (for glossing)
- Word-form pattern (regex)
- Whether gloss/pronunciation is required

Defaults: Noun, Verb, Adjective, Adverb, Pronoun, Adposition, Conjunction, Interjection.

### Step-by-step: Add a custom POS

1. Open `Grammar -> POS`.
2. Click `Add POS`.
3. Fill `Name` and `Abbr` (used in gloss labels).
4. Optionally add a regex word pattern.
5. Set whether definition/pronunciation is required.

## Inflectional Dimensions

| Dimension | Example Values |
|-----------|---------------|
| Number | Singular SG / Plural PL |
| Case | Nominative NOM / Accusative ACC / Genitive GEN / Dative DAT |
| Tense | Past PAST / Present PRES / Future FUT |
| Person | 1st 1 / 2nd 2 / 3rd 3 |

Each dimension can be associated with specific POS (e.g., Case applies only to nouns and pronouns).

### Step-by-step: Build two core dimensions

1. Open `Grammar -> Dimensions`.
2. Add `Number` with values `SG`, `PL`.
3. Add `Tense` with values `PRES`, `PAST`.
4. Bind `Number` to nouns and `Tense` to verbs.
5. Save and continue to inflection rules.

## Inflection Rules

6 morphological operation types:

| Type | Description | Example |
|------|------------|---------|
| Prefix | Added before | un- + happy |
| Suffix | Added after | cat + -s |
| Infix | Inserted within | After the Nth phoneme |
| Circumfix | Added to both ends | ge- ... -t |
| Reduplication | Full/partial repeat | Full or first N phonemes |
| Ablaut | Vowel alternation | sing → sang |

**Conditional logic**: Each rule supports IF/ELSE branching based on word-final/initial phoneme class or regex match.

### Step-by-step: Add production-ready inflection rules

1. Open `Grammar -> Inflection`.
2. Add `PL` suffix rule with `affix = en`.
3. Add `PAST` suffix rule with `affix = ka`.
4. (Optional) add a conditional variant for vowel-final stems.
5. Use `Grammar -> Inflection Test` to validate outputs.

### SCA integration toggle (advanced)

Each inflection rule has an `SCA` toggle (`Allow SCA edits`):

- OFF (default): the rule is protected from SCA batch rewrite.
- ON: the rule is eligible for SCA rewrite (affix/infix/circumfix/ablaut fields as applicable).

Recommended rollout:

1. Keep all toggles OFF.
2. Enable only high-confidence historical rules.
3. Run SCA batch preview and review changes.
4. Expand scope gradually.

## Inflection Matrix

Grid view of all POS × dimension values, allowing quick coverage checks.

### Step-by-step: Coverage audit

1. Open `Grammar -> Matrix`.
2. Scan for empty intersections (POS × value).
3. Add missing rules and re-check matrix until no critical gaps remain.

## Inflection Test

Input a test word + select POS → instantly see all applicable inflection rules applied with detailed logs.

### Step-by-step: Regression test after rule edits

1. Prepare 5-10 representative stems.
2. Test each stem in the panel after rule changes.
3. Confirm expected forms for all major dimensions.
4. If any form regresses, adjust rule ordering or regex constraints.

## Derivation Rules

- **POS conversion**: Source → target POS (e.g., verb→noun: `-er` for agent)
- **Reuses morphology engine**: All 6 operation types available
- **Semantic notes**: Annotate semantic shift
- **Batch preview**: Preview derivations for all matching lexicon entries
- **Selective import**: Select all / deselect / per-row checkbox before import
- **One-click import**: Import selected derived words into the lexicon

### Step-by-step: Derive verbs into agent nouns

1. Open `Grammar -> Derivation`.
2. Add a rule: source `Verb`, target `Noun`, type `Suffix`, affix `-er`.
3. Click `Preview` to generate batch candidates.
4. Deselect noisy candidates.
5. Click `Import` to write selected entries to lexicon.

### SCA integration toggle (advanced)

Each derivation rule also supports `Allow SCA edits`:

- OFF (default): derivation rule surface remains unchanged by SCA.
- ON: derivation affix structures can evolve under SCA batch apply.

## Grammar Manual

Write readable reference documentation in Markdown chapters. Embed paradigm tables with `{{paradigm:pos_id:test_word}}`. Drag to reorder chapters.

### Step-by-step: Create a publishable grammar chapter

1. Open `Grammar -> Manual`.
2. Add chapter `Noun Morphology`.
3. Write rules in Markdown.
4. Insert a paradigm marker with a test stem.
5. Reorder chapters for final reading flow.

## Advanced examples

### Example A: Conditional plural allomorphy

- Rule 1: if stem ends with vowel, plural suffix = `-n`
- Rule 2: else plural suffix = `-en`

Validation steps:

1. Test `kala` -> `kala-n`.
2. Test `mart` -> `mart-en`.
3. Confirm matrix still covers all noun-number combinations.

### Example B: Safe historical grammar evolution

1. Enable `Allow SCA edits` only on two noun suffix rules.
2. Run SCA batch preview.
3. Check scope and field columns.
4. Apply changes and re-run inflection tests.
