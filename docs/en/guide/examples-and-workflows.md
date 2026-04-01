# Feature Examples and Integration Scenarios

This guide is intentionally practical and step-by-step.

It has two sections:

1. Feature examples: how to use each module directly
2. Integration scenarios: how modules work together in real workflows

---

## Part 1: Feature Examples

### 1. Phonology: Build a usable sound system in 10 minutes

Steps:

1. Open `Phonology -> Inventory`.
2. Load a preset close to your target style.
3. Add/remove 3-5 phonemes to make it unique.
4. Open `Romanization` and define key mappings.
5. Open `Phonotactics` and set `(C)V(C)`.

Result: lexicon entries can generate IPA reliably.

### 2. Lexicon: Build a 30-word core vocabulary

Steps:

1. Open `Lexicon`.
2. Use the ⚡ quick-entry popup for fast input.
3. For each entry, fill spelling + POS + gloss.
4. Tag core entries as `core`.
5. Run QC and fix all error-level findings.

Result: enough lexical coverage for auto-gloss and sandbox tests.

### 3. Word Generator: Expand vocabulary safely

Steps:

1. Open `Word Generator`.
2. Set count to 80 and syllable range to 1~3.
3. Generate candidates and remove noisy forms.
4. Assign POS to selected rows.
5. Import selected candidates to lexicon.

Result: fast and controlled vocabulary growth.

### 4. Grammar: Create a minimal inflection system

Steps:

1. Open `Grammar -> Dimensions`.
2. Add `Number` (SG/PL), `Tense` (PRES/PAST).
3. Open `Grammar -> Inflection`.
4. Add `PL -> -en`, `PAST -> -ka`.
5. Validate with `Inflection Test`.

Result: morphology is operational for sentence-level use.

### 5. Sandbox: Validate rule behavior quickly

Steps:

1. Open `Translation Sandbox`.
2. Enter `star-PL shine-PAST` in gloss mode.
3. Run conversion.
4. Verify conlang form, gloss line, IPA line.
5. If wrong, fix lexicon or grammar and re-run.

Result: tight edit-test loop.

### 6. SCA: Apply historical changes with control

Steps:

1. Open `Sound Changes`.
2. Create ruleset `Stage A`.
3. Add one rule and test on single words.
4. Switch to batch preview and inspect all pages.
5. Apply when results are acceptable.

Advanced step:

6. Enable `Allow SCA edits` on selected grammar rules.
7. Re-run batch preview and apply scoped grammar changes.

Result: controlled evolution of lexical and selected grammar forms.

### 7. Corpus: Auto-gloss and evolve text via diff

Steps:

1. Open `Corpus` and create a text.
2. Fill original text + free translation.
3. Click `Auto-gloss`.
4. Review report (total/auto/pending/unresolved).
5. Resolve pending suggestions.
6. Click `Preview & Apply SCA to Corpus`.
7. Deselect unwanted changes in diff table.
8. Apply selected changes.

Result: corpus updates are reviewable and traceable.

### 8. Family Tree: Derive and maintain daughter languages

Steps:

1. Open `Family Tree`.
2. Select parent and click `Derive`.
3. Name the daughter language.
4. In daughter language, configure SCA.
5. Use `Pull Sync` to import new parent words with evolution.

Result: stable genealogical workflow.

### 9. Export: Publish and collaborate

Steps:

1. Export PDF for readers.
2. Export Excel for collaborators.
3. Export LLM Prompt for AI-based testing.
4. Keep CSV snapshots for backup/import.

Result: complete sharing package.

---

## Part 2: Integration Scenarios

### Scenario A: Zero-to-usable language loop

Flow:

1. Phonology setup.
2. Word generation + lexicon import.
3. Grammar dimensions/rules.
4. Sandbox validation.
5. Corpus auto-gloss verification.

Why it works: each stage validates the previous one.

### Scenario B: Parent-to-daughter evolution pipeline

Flow:

1. Stabilize parent lexicon/grammar.
2. Derive daughter language.
3. Define daughter SCA rules.
4. Pull sync new parent words.
5. Optionally apply SCA to selected grammar rules.

Why it works: clear lineage with controlled divergence.

### Scenario C: Corpus-driven correction loop

Flow:

1. Run corpus auto-gloss.
2. Check pending/unresolved counts.
3. Fix lexicon and grammar weak points.
4. Re-run auto-gloss.
5. Compare report changes.

Why it works: corpus quality metrics reveal real system gaps.

### Scenario D: Safe corpus evolution with diff

Flow:

1. Validate SCA on single/batch preview.
2. Open corpus SCA diff preview.
3. Keep only intended changes selected.
4. Apply selected changes.
5. Let auto-gloss rerun and review output.

Why it works: review-before-apply prevents destructive bulk edits.

### Scenario E: Export-feedback-iterate cycle

Flow:

1. Export PDF/Excel/LLM Prompt.
2. Collect reader/collaborator/AI feedback.
3. Update lexicon/grammar/corpus accordingly.
4. Re-export next iteration.

Why it works: closes the loop between design and real usage.
