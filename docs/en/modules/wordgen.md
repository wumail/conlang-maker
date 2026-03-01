# Word Generator

Generate candidate words randomly based on your phonotactic rules.

## Workflow

1. Set **count** (50–100 recommended) and **syllable range** (1–3)
2. Click **"Generate"**
3. Browse candidates — each shows auto-generated IPA
4. Delete unwanted words, assign POS to the rest
5. Select desired words → click **"Import to Lexicon"**

## Parameters

| Feature | Description |
|---------|------------|
| Generation params | Count (1–200), min/max syllable count |
| Syllable structure | Auto-reads from phonotactics settings |
| Blacklist filtering | Rejects words violating phonotactic rules |
| IPA preview | Auto-computes IPA for each candidate |
| Candidate table | Select all/individual, edit POS, delete |
| Import to lexicon | One-click import of selected candidates |

## Advanced Features

### Swadesh 100

Maps generated words to the Swadesh basic vocabulary list (water, fire, sun, person…), quickly building core vocabulary.

### Decay Coefficient

Slider (0.0–3.0) controlling distribution weights for each phoneme class, shaping the generated words to match your desired language style.

### Rewrite Rules

Post-processing regex replacements, useful for adding long vowel markers (e.g., `aa → ā`).
