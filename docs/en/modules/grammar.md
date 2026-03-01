# Grammar

8 sub-sections managing the full lifecycle of grammar rules.

## Syntax Configuration

- **Basic word order**: SVO / SOV / VSO / VOS / OVS / OSV
- **Modifier position**: Before head / after head
- **Adposition type**: Preposition / postposition

## Parts of Speech

Customize POS to define your language's word classes:

- Name, abbreviation (for glossing)
- Word-form pattern (regex)
- Whether gloss/pronunciation is required

Defaults: Noun, Verb, Adjective, Adverb, Pronoun, Adposition, Conjunction, Interjection.

## Inflectional Dimensions

| Dimension | Example Values |
|-----------|---------------|
| Number | Singular SG / Plural PL |
| Case | Nominative NOM / Accusative ACC / Genitive GEN / Dative DAT |
| Tense | Past PAST / Present PRES / Future FUT |
| Person | 1st 1 / 2nd 2 / 3rd 3 |

Each dimension can be associated with specific POS (e.g., Case applies only to nouns and pronouns).

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

## Inflection Matrix

Grid view of all POS × dimension values, allowing quick coverage checks.

## Inflection Test

Input a test word + select POS → instantly see all applicable inflection rules applied with detailed logs.

## Derivation Rules

- **POS conversion**: Source → target POS (e.g., verb→noun: `-er` for agent)
- **Reuses morphology engine**: All 6 operation types available
- **Semantic notes**: Annotate semantic shift
- **Batch preview**: Preview derivations for all matching lexicon entries
- **One-click import**: Import generated derived words into the lexicon

## Grammar Manual

Write readable reference documentation in Markdown chapters. Embed paradigm tables with `{{paradigm:pos_id:test_word}}`. Drag to reorder chapters.
