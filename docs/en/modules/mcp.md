# MCP Server & AI Integration

Connect AI assistants directly to your Conlang Maker language families over the Model Context Protocol (MCP) for phonology analysis, lexicon management, diachronic evolution, and OpenType font coverage auditing.

**Navigate**: click `MCP Settings` (or `Settings -> MCP`) in the sidebar to copy client snippets, inspect the bundled binary path, and view recent MCP audit logs.

---

## 1. Overview — What MCP Enables

`conlang-mcp` is Conlang Maker's built-in local **Model Context Protocol (MCP)** server. Communicating with AI clients (**DSH**, **Claude Desktop**, **Cursor**, and other stdio-compatible MCP hosts) over standard input/output (`stdio`), it exposes both your **workspace data** and Conlang Maker's **linguistic computation engines** as structured semantic tools, resources, and guided prompts.

### Key Capabilities

- **Headless Operation (No GUI Required)**: `conlang-mcp` reads and writes workspace files directly on disk. You can query lexicons, simulate sound changes, or audit font coverage from your AI assistant even when the Conlang Maker desktop app is closed.
- **100% Shared Calculation Engine (`src/core`)**: `conlang-mcp` runs the exact same TypeScript linguistic engines as the desktop GUI — including IPA generation and romanization tracing, phoneme tokenization, morphological inflection and paradigms, derivation, typology analysis, Pull Sync diffing, interlinear auto-glossing, and diachronic Sound Change Applier (SCA) simulation — plus **HarfBuzz (WebAssembly)** for real OpenType shaping and glyph coverage audits.
- **Semantic Addressing**: Instead of asking an AI to edit raw `.ndjson` buckets or JSON paths, tools operate on semantic entities: language families, genealogy trees, romanization maps, lexicon entries (`entry_id` aligned across parent and child languages), inflection rules, and scoped snapshots.
- **Safe Coexistence with a Running GUI**: You can keep Conlang Maker open while an AI agent works on the same project:
  - **Project Coordination Locks**: All consistent reads, writes, snapshots, and recoveries coordinate via `<project>/.conlang-maker/lock/` using host-verified, PID-bound, unique-nonce owner files.
  - **Compare-And-Swap (CAS) Revisions**: Every readable unit returns a content `revision` (16-char SHA-256 prefix) and `dependencies`. Mutations must supply `expected_revision` (or `expected_revisions`) and a client-generated idempotent `operation_id`.
  - **Atomic Multi-File Transactions**: Cross-bucket lexicon updates, corpus index + text writes, batch font replacements, and family tree changes execute inside `<project>/.conlang-maker/transactions/<operation_id>/` with write-ahead pre-images and automatic crash recovery.
  - **Live File-Watching**: When `conlang-mcp` commits a change, the open GUI detects the commit event, automatically refreshes clean stores (including inherited fonts and ancestor glyph annotations), or shows a conflict resolution prompt if you have unsaved edits on the same item.
- **Controlled Output & Local Privacy**: List tools paginate (`limit` default `50`, max `500`, `cursor`), support dotted `fields` projection and `format: "summary" | "full"`, and cap single responses (~25k tokens / 100k chars) with explicit `truncated: true` notices rather than silent drops. `conlang-mcp` runs strictly locally with **zero network access or telemetry** and enforces workspace directory allowlists.

---

## 2. Setup & Client Configuration

### Locating the `conlang-mcp` Executable

Conlang Maker bundles `conlang-mcp` as a standalone native sidecar binary alongside the desktop application executable. To get the exact path on your machine, open Conlang Maker and go to **MCP Settings** — the page displays the resolved executable path and provides one-click copy buttons for **DSH**, **Claude Desktop**, and **Cursor**.

Typical platform locations:

| Environment | Executable / Command |
|-------------|----------------------|
| **macOS** | `/Applications/Conlang Maker.app/Contents/MacOS/conlang-mcp` *(or `/Applications/conlang-maker.app/Contents/MacOS/conlang-mcp`)* |
| **Windows** | `%LOCALAPPDATA%\Conlang Maker\conlang-mcp.exe` |
| **Linux** | `/usr/bin/conlang-mcp` *(or alongside your extracted package / AppImage binary)* |
| **Development (from source)** | `bun mcp/main.ts` *(run from the repository root)* |

:::tip
Always prefer copying the snippet directly from Conlang Maker's **MCP Settings** page so the exact installation path and your chosen permission mode are filled in automatically.
:::

### Client Configuration Snippets

#### DSH (`~/.config/dsh/config.json`)

```json
{
  "mcpServers": {
    "conlang": {
      "command": "/Applications/Conlang Maker.app/Contents/MacOS/conlang-mcp",
      "args": [
        "--mode",
        "write",
        "--toolsets",
        "core,audit,compute,write,evolution"
      ]
    }
  }
}
```

For local development against source code:

```json
{
  "mcpServers": {
    "conlang": {
      "command": "bun",
      "args": [
        "/path/to/conlang-maker/mcp/main.ts",
        "--mode",
        "write",
        "--toolsets",
        "all"
      ]
    }
  }
}
```

#### Claude Desktop (`claude_desktop_config.json`)

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "conlang": {
      "command": "/Applications/Conlang Maker.app/Contents/MacOS/conlang-mcp",
      "args": [
        "--mode",
        "read-only",
        "--toolsets",
        "core,audit,compute"
      ]
    }
  }
}
```

#### Cursor (`.cursor/mcp.json` or `~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "conlang": {
      "command": "/Applications/Conlang Maker.app/Contents/MacOS/conlang-mcp",
      "args": [
        "--mode",
        "write",
        "--toolsets",
        "core,audit,compute,write"
      ]
    }
  }
}
```

### CLI Flags & Environment Variables

Every startup option can be set via CLI flag or an equivalent `CONLANG_MCP_*` environment variable (CLI flags take precedence):

| CLI Flag | Environment Variable | Default | Description |
|----------|----------------------|---------|-------------|
| `--mode` | `CONLANG_MCP_MODE` | `read-only` | Permission tier: `read-only`, `write`, or `write+destructive`. |
| `--toolsets` | `CONLANG_MCP_TOOLSETS` | `core,audit,compute` | Comma-separated toolsets to expose: `core`, `audit`, `compute`, `write`, `evolution`, `admin`, or `all`. |
| `--family` | `CONLANG_MCP_FAMILY` | Active family in registry | Default language family (`family_id`, `.conlang` file path, or unambiguous family name) when `family` is omitted in tool calls. |
| `--registry` | `CONLANG_MCP_REGISTRY` | Platform app-data `registry.json` | Override path to `registry.json` (useful for isolated testing or custom profiles). |
| `--allow-root` | `CONLANG_MCP_ALLOW_ROOT` | All registered project directories | Comma/colon-separated directory allowlist restricting filesystem access (`..` traversal and out-of-bounds symlinks are rejected). |

### Per-Project Configuration (`.conlang-maker/mcp.json`)

You can store project-specific MCP and font audit settings in `<project>/.conlang-maker/mcp.json` so they travel with your workspace (and sync across machines):

```json
{
  "audit": {
    "languages": {
      "lang_proto": {
        "residual_glyph_pattern": "^roman\\."
      },
      "lang_coastal": {
        "residual_glyph_pattern": "^(roman|latin)\\.",
        "external_font_project": {
          "path": "/path/to/font-project",
          "variant": "coastal"
        }
      }
    }
  },
  "snapshots": {
    "batch_threshold": 20,
    "max_snapshots": 50
  }
}
```

- **`residual_glyph_pattern`**: Per-language regular expression matched against shaped glyph names during `font_audit_coverage` and `font_audit_family` (can be overridden per tool call).
- **`external_font_project`** *(optional)*: Associates an external font engineering directory (`encoding.json` / `manifest.json` / `.fea` files) so coverage reports include declared-but-unimplemented rules as actionable hints. `conlang-mcp` **never modifies** external font repositories.
- **`snapshots`**: Customizes automatic snapshot thresholds and completed-history retention (`max_snapshots`).

### Addressing Conventions

- **`family`** *(optional)*: Pass a `family_id` (8-char SHA-256 hash from `family_list`), an absolute `.conlang` path, or an unambiguous family name. When omitted, `conlang-mcp` uses `--family` or the active family in `registry.json`.
- **`language`**: Pass a `language_id` (e.g., `lang_proto`), unique language display name, or workspace-relative directory path.
- **Lexicon entries**: Addressed by `(language, entry_id)`. Because derived daughter languages keep the same `entry_id` as their parent language for cognate alignment, `entry_id` is unique within a single language, not globally across a family.
- **Romanization maps**: Addressed by `map_id`; omitting `map_id` automatically selects the language's default map (`is_default: true`).

---

## 3. Permission Modes & Safety Boundaries

### Permission Modes

`conlang-mcp` defaults to **`read-only`**. Write and destructive capabilities must be explicitly opted into at server startup:

| Mode | Allowed Operations | Transaction Recovery | Extra Confirmation |
|------|--------------------|----------------------|--------------------|
| `read-only` *(default)* | All read, search, inspection, linguistic computation, font audit, and `dry_run` preview operations. Acquires coordination locks for consistent reads. | Does **not** mutate files; returns `RECOVERY_REQUIRED` if an unfinished transaction is found. | — |
| `write` | Everything in `read-only` **plus** standard mutations (phonology, romanization, glyph annotations, lexicon upsert/delete/IPA regen, grammar, SCA, corpus save, font import/clear, language fork/update, Pull Sync, manual snapshots, exports). | Automatically completes or rolls back interrupted transactions inside the project lock before running. | Requires `expected_revision` + `operation_id`. |
| `write+destructive` | Everything in `write` **plus** destructive or topology/history-restoring operations: `language_delete`, `language_restore`, `corpus_delete`, `import_workspace_bundle`, and `snapshot_rollback`. | Full automatic journal recovery. | Destructive tools **also require `confirm: true`** in call arguments. |

:::warning Dual Gate for Destructive Tools
Enabling `--mode write+destructive` alone is not enough to trigger a rollback, bundle overwrite, or deletion — the tool call itself must explicitly pass `"confirm": true` (and `expected_revision` / `operation_id`). Otherwise `conlang-mcp` rejects the call with `DESTRUCTIVE_DISABLED` or `VALIDATION`.
:::

### Toolset Filtering (`--toolsets`)

Tools are grouped into modular toolsets so you can keep your AI assistant's context window lean and focused. For any write/destructive tool to be exposed, **both** its toolset and the required `--mode` must be enabled:

| Toolset | Enabled by Default | Focus Area |
|---------|--------------------|------------|
| `core` | Yes | Workspace discovery, language trees, reading phonology/romanization/lexicon/grammar/SCA/corpus/fonts, and listing snapshots/trash. |
| `audit` | Yes | Single-language and family-wide OpenType font coverage audits (`font_audit_coverage`, `font_audit_family`) and glyph shaping diagnostics. |
| `compute` | Yes | Linguistic computation & QA: `phono_to_ipa` (with trace), `phono_tokenize`, `romanization_analyze`, `lex_stats`, `lex_quality_check`, `wordgen_*`, `gram_inflect`, `gram_paradigm`, `gram_derive`, `gram_analyze_typology`, `sandbox_translate`, `sca_simulate`, `sca_parse_rules_text`, `sca_feature_query`. |
| `write` | No | Standard data editing across phonology, romanization, glyph annotations, fonts, lexicon, grammar, SCA, corpus, and manual snapshots. |
| `evolution` | No | Diachronic family workflows: `language_fork`, `language_update`, `lex_parent_diff`, `lex_pull_sync`, `lex_borrow`, `lexicon_migrate_inherited_links`. |
| `admin` | No | Registry management (`family_*`, `project_*`), workspace bundle/CSV/Hunspell/LLM exports & imports, language trash deletion/restore, and `snapshot_rollback` / `snapshot_diff`. |
| `all` | — | Shorthand enabling every toolset permitted by the active `--mode`. |

### Built-in Data Integrity Guardrails

- **Preview with `dry_run: true`**: Every batch or destructive write supports `dry_run: true`, computing exact item-level diffs, counts, recovery scope, and `base_revisions` on a consistent snapshot without touching disk.
- **Strict Validation (No Silent Drops)**: Unlike interactive GUI drafts where placeholder `new_word` or gloss-less entries are skipped on save, `lex_upsert` validates every item upfront and returns structured `VALIDATION` errors if any entry is invalid — refusing partial or silent data loss.
- **Idempotent Retries (`operation_id`)**: Retrying a write with the same `operation_id` and identical payload safely returns the persisted commit receipt without re-applying mutations; reusing an `operation_id` with different arguments fails with `VALIDATION`.
- **Unknown Field Preservation & Legacy Archival**: Both Rust and `conlang-mcp` preserve unknown extension fields on top-level objects, nested structures, and ID-keyed array items (including untouched sibling words in the same `.ndjson` bucket). When updating an older `phonology.json` that still contains deprecated legacy writing-engine fields (`writing_systems`, `font_encoding_profiles`, `writing_system_id`, `output_phonemes`, `phonemes_confirmed`, `writing_override`), `conlang-mcp` archives them intact to `<lang>/.conlang-maker/legacy/writing-<timestamp>-<operation_id>.json` (flagging any `phonemes_confirmed: false` rules under `needs_review`) before cleaning them up in the same transaction.

---

## 4. Tool, Resource & Prompt Catalog by Domain

`conlang-mcp` defines **76 tools** across 10 domains, **10 `conlang://` resource templates**, and **4 guided prompts**.

### 4.1 System & Language Family (14 Tools)

| Tool | Access | Toolset | Description |
|------|--------|---------|-------------|
| `server_info` | Read | `core` | Server version, active `--mode`, enabled toolsets, default family, and whether a running GUI instance is detected. |
| `family_list` | Read | `core` | List registered language families in `registry.json` with `family_id`, path, active flag, `registry_revision`, and `.conlang` integrity status. |
| `family_get_tree` | Read | `core` | Return the language genealogy tree with workspace `revision`, parent/child links, depth, word counts, own-font flag, and effective font owner. |
| `language_fork` | Write | `evolution` | Derive a child language from a parent (copies phonology, grammar, lexicon with shared `entry_id` marked `evolved`, and corpus; initializes empty SCA). |
| `language_update` | Write | `evolution` | Rename a language or change its `parent_id` (with cycle detection and a report on how font and glyph annotation inheritance will change). |
| `language_delete` | Destructive | `admin` | Move a leaf language (rejected if children exist) into `.conlang-maker/trash/<trash_id>/` inside a project transaction; returns `trash_id`. |
| `language_trash_list` | Read | `core` | List deleted languages in the project trash with `trash_id`, original `language_id`, `parent_id`, and path. |
| `language_restore` | Destructive | `admin` | Restore a trashed language directory and `.conlang` entry by `trash_id` (verifies parent existence, ID/path availability, and project revision; supports `dry_run`). |
| `family_register` | Write | `admin` | Register an existing `.conlang` project in `registry.json` under registry lock + CAS. |
| `family_unregister` | Write | `admin` | Remove a language family entry from `registry.json` (does not delete workspace files). |
| `family_set_active` | Write | `admin` | Set the default active language family in `registry.json`. |
| `project_create` | Write | `admin` | Create a brand-new Conlang Maker workspace directory and `.conlang` file, optionally registering it. |
| `project_copy` | Write | `admin` | Clone an existing workspace from a consistent source snapshot into a new target directory. |
| `lexicon_migrate_inherited_links` | Write | `evolution` | Repair missing `parent_entry_id` / `source_language_id` etymology links on legacy inherited entries (supports `dry_run`). |

### 4.2 Phonology & Romanization (11 Tools)

| Tool | Access | Toolset | Description |
|------|--------|---------|-------------|
| `phono_get` | Read | `core` | Read phonology sections (`inventory`, `romanization`, `phonotactics`, `tones`, `allophony`, `glyph_annotations`), returning both `local_config` and inherited `effective_config` with revisions. |
| `romanization_get` | Read | `core` | Read romanization maps enriched with per-rule Unicode analysis (`chars`, codepoints, `nfd`, `is_multichar`, `has_context`, `output_in_inventory`) and input character totals. |
| `romanization_analyze` | Read | `compute` | Run 6 romanization health checks: unreachable inventory phonemes, non-inventory outputs, conflicting rules, exact duplicates, shadowed rules, and case-coverage issues. |
| `phono_to_ipa` | Read | `compute` | Convert single or batch (≤ 500) spellings into phonemic `/…/` and surface `[…]` IPA, with optional segment-by-segment `trace` of matched rules, unmatched characters, and allophony steps. |
| `phono_tokenize` | Read | `compute` | Segment IPA strings into phoneme tokens according to the language's phoneme inventory. |
| `phono_update` | Write | `write` | Update `local_config` phonology sections (full replacement or JSON Merge Patch) with `expected_revision` and `dry_run` support. |
| `romanization_upsert_rules` | Write | `write` | Batch insert or update romanization rules in a map (with optional ordering and `regenerate_ipa: true` to attach a `lex_regenerate_ipa` dry-run preview). |
| `romanization_delete_rules` | Write | `write` | Batch delete rules by `rule_id` from a romanization map. |
| `romanization_map_upsert` | Write | `write` | Create, rename, set as single default (`is_default: true`), or delete a romanization mapping table. |
| `phono_presets_list` | Read | `core` | List built-in phonological style presets. |
| `phono_apply_preset` | Write | `write` | Apply a built-in phonological preset to a language (supports `dry_run`). |

### 4.3 Font & Writing System (11 Tools)

| Tool | Access | Toolset | Description |
|------|--------|---------|-------------|
| `font_list` | Read | `core` | List font status across every language in the family: `own`, `inherited`, or `none`, effective owner language, filename, and SHA-256 hash. |
| `font_inspect` | Read | `core` | Inspect a language's effective font: owner, inheritance status, family/version, glyph count, compressed `cmap` ranges, Unicode block stats, and `GSUB`/`GPOS` feature tags. |
| `font_shape` | Read | `audit` | Run HarfBuzz shaping on sample text (matching GUI `.conlang-script` defaults or custom OpenType features/normalization) to inspect `gid`, glyph names, clusters, codepoint spans, and `.notdef`. |
| `font_audit_coverage` | Read | `audit` | Comprehensive single-language font coverage & OpenType shaping audit across romanization, lexicon, corpus, and tones. |
| `font_audit_family` | Read | `audit` | Whole-family (or subtree) coverage matrix deduplicated by font SHA-256 hash, reporting per-language gaps, font owners, and `union_missing`. |
| `font_import` | Write | `write` | Validate (≤ 20 MB, TrueType/`OTTO` magic bytes, HarfBuzz loadable, non-empty `cmap`) and import a `.ttf`/`.otf` font into a language after snapshotting. |
| `font_import_batch` | Write | `write` | Atomically import fonts across multiple languages in one project transaction (`dry_run` compares old vs. new fonts and before/after coverage summaries). |
| `font_clear` | Write | `write` | Remove a language's own font file (reverting it to ancestor font inheritance) after creating a snapshot. |
| `glyph_annotations_upsert` | Write | `write` | Create or update local character reference annotations (`codepoint`, `label`, `kind`, `phonemes`), explicitly localizing edited inherited items. |
| `glyph_annotations_delete` | Write | `write` | Delete local character reference annotations by codepoint. |
| `glyph_annotations_sync_parent` | Write | `write` | Copy missing glyph annotations from the parent language into local configuration. |

### 4.4 Lexicon (11 Tools)

| Tool | Access | Toolset | Description |
|------|--------|---------|-------------|
| `lex_search` | Read | `core` | Search words by spelling/gloss/definition/example/tag (prefix, exact, substring, regex, or `mode: "ipa_fuzzy"`), with POS/origin/tag/parent-diff filters, sorting, pagination, and field projection. |
| `lex_get` | Read | `core` | Fetch full lexicon entries by `entry_id` list or exact spelling, optionally attaching parent-language cognates and diffs (`with_parent: true`). |
| `lex_stats` | Read | `compute` | Compute lexicon statistics: total entries, POS distribution, phoneme frequency, and syllable distribution. |
| `lex_quality_check` | Read | `compute` | Run configurable lexicon QA checks (missing POS, unmapped spelling characters, empty IPA, phonotactic violations, missing required fields, duplicate words). |
| `lex_upsert` | Write | `write` | Batch create or update entries (≤ 500): auto-generates IDs/timestamps, auto-computes IPA when `phonetic_override` is `false`, preserves bucket ordering and unknown fields, and validates all items atomically. |
| `lex_delete` | Write | `write` | Batch delete lexicon entries by `entry_id` after snapshotting. |
| `lex_regenerate_ipa` | Write | `write` | Recompute IPA for all non-override entries after romanization or allophony changes (`dry_run` lists every word whose IPA will change). |
| `lex_parent_diff` | Read | `evolution` | Preview Pull Sync candidates between parent and child language after applying child SCA rules (`add`, `update`, and `conflicts`). |
| `lex_pull_sync` | Write | `evolution` | Execute Pull Sync for all or selected `entry_id` items after snapshotting, recording `parent_entry_id` and `applied_sound_changes`. |
| `lex_borrow` | Write | `evolution` | Borrow entries from another language in the family (`origin_type: "borrowed"` with provenance links). |
| `lex_import_csv` | Write | `admin` | Preview (`dry_run` / schema detection) and batch import lexicon entries from CSV. |

### 4.5 Word Generation (2 Tools)

| Tool | Access | Toolset | Description |
|------|--------|---------|-------------|
| `wordgen_generate` | Read | `compute` | Generate phonotactically valid candidate words (configurable count, syllable range, structure templates, existing-word exclusion, typology hints). Save chosen words via `lex_upsert`. |
| `wordgen_swadesh_gaps` | Read | `compute` | Identify Swadesh-100 core concepts not yet covered in the language's lexicon. |

### 4.6 Grammar & Translation Sandbox (7 Tools)

| Tool | Access | Toolset | Description |
|------|--------|---------|-------------|
| `gram_get` | Read | `core` | Read grammar sections: `typology`, `syntax`, `pos`, `inflection` (dimensions, rules, affix slots, conjugation classes, irregular overrides), `derivation`, and `chapters`. |
| `gram_inflect` | Read | `compute` | Inflect a word (by spelling or `entry_id`) for given dimension values using typology-aware morphology, returning the surface form and matched rules. |
| `gram_paradigm` | Read | `compute` | Generate a complete inflection paradigm table for a word across selected grammatical dimensions. |
| `gram_derive` | Read | `compute` | Preview derived words produced by morphological derivation rules (commit selected forms via `lex_upsert`). |
| `gram_analyze_typology` | Read | `compute` | Analyze morphological and syntactic typology consistency across grammar rules. |
| `sandbox_translate` | Read | `compute` | Run the Translation Sandbox pipeline: convert glossed source tokens into inflected, syntax-reordered target-language sentences. |
| `gram_update` | Write | `write` | Update grammar configuration by section with `expected_revision` and `dry_run` support. |

### 4.7 Sound Change Applier — SCA (6 Tools)

| Tool | Access | Toolset | Description |
|------|--------|---------|-------------|
| `sca_get` | Read | `core` | Read diachronic sound change rulesets and rules (both character-mode and phonetic feature-mode). |
| `sca_simulate` | Read | `compute` | Simulate SCA rules on a custom word list or an entire language lexicon — supports passing unsaved **ad-hoc rulesets** and returns step-by-step changelogs. |
| `sca_parse_rules_text` | Read | `compute` | Parse plain-text SCA notation (arrow, pipe-delimited, or `@feature` syntax) into structured rules with line-by-line error reporting. |
| `sca_feature_query` | Read | `compute` | Resolve a phonetic feature expression (e.g., `[+voiced, -stop]`) into matching IPA phonemes. |
| `sca_update` | Write | `write` | Create, modify, reorder, or delete SCA rulesets and rules (accepts either structured JSON or plain-text rule syntax). |
| `sca_export_rules_text` | Read | `compute` | Serialize SCA rulesets into portable, round-trip-compatible plain text. |

### 4.8 Corpus (5 Tools)

| Tool | Access | Toolset | Description |
|------|--------|---------|-------------|
| `corpus_list` | Read | `core` | List corpus texts from `corpus_index.json` with metadata and revisions. |
| `corpus_get` | Read | `core` | Read a corpus text and its Leipzig interlinear gloss lines (paginated by line). |
| `corpus_save` | Write | `write` | Create or update a corpus text and synchronize `corpus_index.json` in a single atomic transaction. |
| `corpus_delete` | Destructive | `admin` | Delete a corpus text and update `corpus_index.json` after creating a snapshot (`confirm: true`). |
| `corpus_auto_gloss` | Read / Write | `compute` / `write` | Run morphological auto-glossing on corpus text; defaults to preview-only (`apply: false`) and writes only when `apply: true`. |

### 4.9 Import & Export (5 Tools)

| Tool | Access | Toolset | Description |
|------|--------|---------|-------------|
| `export_llm_brief` | Read | `admin` | Generate an LLM-ready Markdown reference brief for a language (selectable chapters; also exposed as a resource). |
| `export_workspace_bundle` | Write | `admin` | Export a complete workspace bundle (including fonts) to a target file path using atomic staging. |
| `export_csv` | Write | `admin` | Export a language's lexicon to a UTF-8 BOM CSV file. |
| `export_dic` | Write | `admin` | Export Hunspell spell-checker `.dic` and `.aff` files (base words + inflected forms). |
| `import_workspace_bundle` | Destructive | `admin` | Import a workspace bundle inside an atomic project transaction after taking a full project-level snapshot (`confirm: true`). |

### 4.10 Snapshots & Rollback (4 Tools)

| Tool | Access | Toolset | Description |
|------|--------|---------|-------------|
| `snapshot_list` | Read | `core` | List language-level or project-level snapshots (including archived histories of removed languages) with `scope`, `origin`, `level`, and `restored_from`. |
| `snapshot_create` | Write | `write` | Manually create a language-level (`lexicon`, `phonology`, `grammar`, `sca`, `corpus`, `font`) or project-level snapshot. |
| `snapshot_rollback` | Destructive | `admin` | Non-destructively roll back a language or project snapshot (`confirm: true`): snapshots current state first, restores target scope, and preserves all other snapshots. |
| `snapshot_diff` | Read | `admin` | Summarize file, entry, and topology differences between a snapshot and current workspace data. |

### 4.11 Built-in `conlang://` Resources (10 URIs)

Read-only resources provide stable context URIs that MCP clients can attach directly to conversations. Every resource also has an equivalent tool for tool-only clients:

| Resource URI Template | MIME Type | Returned Content |
|-----------------------|-----------|------------------|
| `conlang://families` | `application/json` | Registered language families (`family_list` equivalent). |
| `conlang://{family_id}/tree` | `application/json` | Language family genealogy tree and font inheritance summary. |
| `conlang://{family_id}/{language_id}/brief` | `text/markdown` | LLM-friendly Markdown language overview (ideal for pinning as long-term context). |
| `conlang://{family_id}/{language_id}/phonology` | `application/json` | Local and effective phonology configuration. |
| `conlang://{family_id}/{language_id}/romanization` | `application/json` | Romanization maps and rules with derived Unicode metadata. |
| `conlang://{family_id}/{language_id}/grammar` | `application/json` | Full grammar configuration (typology, POS, inflection, derivation). |
| `conlang://{family_id}/{language_id}/sca` | `application/json` | Diachronic sound change rulesets. |
| `conlang://{family_id}/{language_id}/font` | `application/json` | Effective font inspection report (`cmap`, glyph counts, `GSUB`/`GPOS` tags). |
| `conlang://{family_id}/{language_id}/lexicon/{entry_id}` | `application/json` | Complete single lexicon entry. |
| `conlang://{family_id}/{language_id}/corpus/{corpus_id}` | `application/json` | Single corpus text with interlinear glossing. |

### 4.12 Built-in Prompts (4 Workflows)

| Prompt Name | Arguments | Guided Workflow |
|-------------|-----------|-----------------|
| `audit_font_coverage` | `language` *(or `root`)* | Runs font coverage audit -> classifies `cmap` gaps, un-unified multi-char sequences, and residual glyphs -> outputs a concrete checklist of glyphs and OpenType `.fea` rules to add. |
| `review_romanization` | `language` | Runs `romanization_get` + `romanization_analyze` -> cross-checks against the phoneme inventory and lexicon -> suggests fixes for unreachable phonemes, shadowed rules, and ambiguities. |
| `design_sound_changes` | `parent`, `child` *(or `language`)* | Inspects parent/child phonology and current SCA rules -> iteratively tests candidate sound shifts via `sca_simulate` before saving. |
| `lexicon_cleanup` | `language` | Runs `lex_quality_check` -> groups issues -> previews batched fixes with `lex_upsert(..., dry_run: true)` -> applies confirmed updates safely. |

---

## 5. Complete Walkthrough — Font Coverage Audit

When building a custom script font (`.otf` / `.ttf`) for a conlang family — especially one that converts Latin romanization into native glyphs via OpenType ligatures (`liga`, `calt`, `ccmp`) — visual spot-checking in the GUI can easily miss rare digraphs, combining marks, or daughter branches accidentally inheriting an ancestor font.

Here is the end-to-end audit workflow powered by `conlang-mcp` and HarfBuzz Wasm.

### Step 1: Check Font Ownership & Inheritance (`font_list`)

Ask your AI assistant (or invoke the `audit_font_coverage` prompt) to start with `font_list` across your language family:

- Conlang Maker resolves fonts by walking up `parent_id` until it finds the first `font.otf` or `font.ttf`.
- `font_list` marks every language as:
  - **`own`** (`inherited: false`): The language directory has its own dedicated font file.
  - **`inherited`** (`inherited: true`, `owner: "<ancestor>"`): The language has no local font and falls back to an ancestor's font. This immediately catches daughter branches (e.g., regional dialects) that are still displaying the proto-language font instead of their own regional variant.
  - **`none`**: Neither the language nor any ancestor has a font (auditing this language returns `NO_FONT` with the full ancestor chain).
- It also reports each font's **SHA-256 hash**, making it obvious when multiple branches hold duplicate copies of the exact same binary.

### Step 2: Inspect Font Tables & OpenType Features (`font_inspect`)

Call `font_inspect` on the target language to verify what the font binary actually exposes:

- Font family name, version string, and total glyph count.
- Compressed `cmap` Unicode ranges and per-block counts.
- All compiled **`GSUB` and `GPOS` feature tags** (such as `ccmp`, `liga`, `calt`, `kern`, `mark`, `mkmk`, `ss01`).

### Step 3: Run Single-Language or Family Matrix Audits (`font_audit_coverage` / `font_audit_family`)

Run `font_audit_coverage` for one language or `font_audit_family` for the entire tree (which captures a single consistent workspace snapshot, reuses HarfBuzz analysis across identical font hashes via `by_font[]`, and builds `union_missing` across all branches).

`conlang-mcp` gathers character and sequence requirements from four configurable `sources` (`romanization`, `lexicon`, `corpus`, `tones` — ignoring macro placeholders like `V`, `C`, and `#` in rule contexts) and runs two layers of checks:

#### Layer A: Character-Level (`cmap`) Classification

Every required Unicode codepoint is checked against the font's `cmap`:

| Status | Meaning & Impact |
|--------|------------------|
| `covered` | The exact Unicode codepoint is present in `cmap`. |
| `missing` | Neither the codepoint nor its complete NFD decomposition exists in `cmap`. Words containing this character will render `.notdef` tofu boxes, and the report links every affected romanization `rule_id`, lexicon example, and corpus count. |
| `decomposed_only` | **Warning**: The precomposed character (e.g., `ā` `U+0101`) is absent from `cmap`, *but* all of its NFD base + combining codepoints (`a` `U+0061` + `◌̄` `U+0304`) exist. Rendering depends on text normalization (`NFC` vs. `NFD`) and `GPOS` mark attachment (`mark`), so adding a precomposed glyph or `ccmp` rule is recommended. |
| `case_missing` | Only one letter case (uppercase or lowercase) is missing from `cmap`, and that missing case is actually used in your romanization rules, lexicon, or corpus. |

#### Layer B: OpenType Shaping, Ligature & Contextual Checks (`shaping: true`)

Even when 100% of individual ASCII characters exist in `cmap`, a conlang script font can still render broken output if an OpenType substitution rule fails to fire. With `shaping: true` (using the same `GUI_DEFAULT_LAYOUT` direction, language tag, script segmentation, and features as `.conlang-script`), HarfBuzz shapes every multi-character romanization input, lexicon word, and corpus line:

| Shaping Finding | Meaning & How to Fix |
|-----------------|----------------------|
| `substituted_to_ligature` *(reported as `substituted`)* | Multi-character input (e.g., `ch -> tʃ`) shapes into a unified ligature or substituted glyph sequence (e.g., `c_h`) distinct from shaping `c` + `h` separately. Pure `GPOS` kerning/mark adjustments without glyph ID changes are reported separately as `positioning_only`. |
| `unsubstituted_sequence` *(reported as `sequence_not_unified`)* | Individual characters are in `cmap`, **but** shaping the multi-character sequence (e.g., digraph `sh`) produces the exact same glyph ID sequence as shaping `s` and `h` individually. Contextual rules are tested against real lexicon word contexts (isolated fallbacks are marked `standalone_only`). Fix by adding `sub s h by s_h;` in your `.fea` `liga`/`calt` lookup. |
| `residual_glyph_matched` | A shaped word or corpus line contains glyph names matching `residual_glyph_pattern` (for example, `^roman\.` matching `roman.x`). This catches placeholder Latin glyphs left behind when an input character was mapped in `cmap` for fallback editing but never converted into a native script glyph by `GSUB`. |
| `notdef_produced` | Shaping a real lexicon entry or corpus line produced glyph ID `0` (`.notdef`), pinpointing exact broken words (`words_with_notdef`). |
| `not_evaluated` | A specific check could not be run — for example, `residual` is marked `not_evaluated` when no `residual_glyph_pattern` is configured, or when a production `.ttf` stripped glyph names from its `post` / `CFF` table. Reasons are listed explicitly in `checks_not_evaluated`. |

### Step 4: Debug Specific Words & Rules (`font_shape` + `romanization_analyze`)

1. **Inspect exact glyph output with `font_shape`**: Pass tricky words (including contextual allographs or NFD diacritics) and optionally toggle OpenType features (e.g., `features: ["+ss01"]` or `normalization: "NFD"`) to inspect every output glyph's `gid`, `name`, `advance`/`offset`, `cluster`, and mapped source codepoint span.
2. **Cross-check orthography health with `romanization_analyze` (and `phono_to_ipa` with `trace: true`)**: Audit reports also flag `unmapped_spellings` — characters in your lexicon that no romanization rule matches at all. Running `romanization_analyze` tells you whether a gap comes from a typo in the lexicon, a rule shadowed by an earlier greedy rule, a case mismatch, or an inventory phoneme lacking a romanization rule.

### Step 5: Preview & Batch-Update Recompiled Fonts (`font_import_batch`)

Once you recompile your `.otf`/`.ttf` files:

1. Call `font_import_batch` with `dry_run: true` mapping each branch `language` to its new font path.
2. Review the preview report comparing **old font -> new font** and before/after coverage summaries across every branch.
3. Commit `font_import_batch` (`dry_run: false` with `expected_revisions` and `operation_id`) to snapshot the project and swap all branch fonts atomically (automatically cleaning up old `.ttf`/`.otf` extension variants if the format changed).

---

## 6. Snapshots, Language Trash & Rollback

Every write through `conlang-mcp` and the desktop GUI shares a unified snapshot, trash, and non-destructive rollback architecture.

### Automatic Snapshot Policy

Snapshots capture exact raw bytes and file/directory existence states *before* changes are applied:

- **Mandatory Automatic Triggers**:
  - Batch writes of **≥ 20 items** (e.g., `lex_upsert`, `lex_delete`, `romanization_upsert_rules`)
  - Any deletion (`lex_delete`, `corpus_delete`, `language_delete`)
  - Font updates (`font_import`, `font_import_batch`, `font_clear`)
  - Diachronic sync & bundle imports (`lex_pull_sync`, `import_workspace_bundle`)
  - Tree topology edits (`language_fork`, `language_update` reparenting)
- **Session First-Write Protection**: For small single-item edits, `conlang-mcp` automatically snapshots the target scope on the **first write per session, per language, per file**.
- **Automatic Scope Selection**:
  - **Language-level snapshots** (`<lang>/.oplog/snap_<id>/`): Scoped to `lexicon`, `phonology`, `grammar`, `sca`, `corpus`, or `font` for single-language edits.
  - **Project-level snapshots** (`<project>/.conlang-maker/snapshots/snap_<id>/`): Capture `.conlang` topology, original `LanguageEntry` records, and directory existence states for multi-language batches, reparenting, forks, deletions, restores, and bundle imports.

### Manual Snapshots, Diffs & Non-Destructive Rollback

- **Create a checkpoint anytime**: Call `snapshot_create` before an experimental AI refactoring session to create a named language-level or project-level restore point.
- **Inspect differences**: Call `snapshot_list` to browse snapshots (showing `origin: "mcp" | "gui"`, `scope`, `level`, and `restored_from`) and `snapshot_diff` to compare any snapshot against live disk state.
- **Non-destructive `snapshot_rollback`** *(requires `--mode write+destructive` and `confirm: true`)*:
  - Rolling back **never erases history**. Inside an atomic project transaction, `snapshot_rollback` first protects the current state, restores only the target `scope` (even restoring "no local font" if a font did not originally exist), records `restored_from`, and **keeps all other snapshots intact**.
  - Interleaved snapshots work independently: if you create `S1` (`lexicon`) and `S2` (`phonology`), rolling back `S1` restores the lexicon while preserving `S2` for future use.
  - **Archived Language History**: If rolling back a project snapshot removes a newly created language directory, its `.oplog` snapshots are automatically archived into `<project>/.conlang-maker/snapshots/archived_languages/<language_id>/` in the same transaction — remaining queryable and restorable via `family` + `language_id` + `snapshot_id`.

### Language Trash & Restore

Deleting a language with `language_delete` (`--mode write+destructive` + `confirm: true`):

1. Refuses deletion if the language still has child languages in `.conlang`.
2. Moves the entire language directory into `<project>/.conlang-maker/trash/<trash_id>/data/` alongside its original `LanguageEntry` and a project restore point.
3. Can be listed anytime with `language_trash_list` and restored with `language_restore(trash_id)` (supports `dry_run: true` and verifies parent existence, `language_id`/path availability, and project revision).

### GUI Snapshot & Recovery Manager

Prefer visual recovery? Open Conlang Maker's **Snapshot & Recovery Manager** panel to inspect both GUI and MCP snapshots, filter by scope (`lexicon`, `phonology`, `grammar`, `sca`, `corpus`, `font`, `project`), browse trashed languages, preview diffs, and roll back with one click.

---

## 7. FAQ & Troubleshooting

### Why did I get a `CONFLICT` error (or see a Conflict Prompt in the GUI)?

Both the GUI and `conlang-mcp` enforce Compare-And-Swap (`expected_revision`) so neither side silently overwrites the other's work:

- **In your AI client (`CONFLICT`)**: The target file or one of its `base_revisions` changed since the AI last read or dry-ran it. Ask the AI to re-read the latest state (e.g., `phono_get`, `lex_get`, `family_get_tree`), re-run `dry_run: true` if needed, and submit with the fresh `revision` and a new `operation_id`.
- **In the Conlang Maker GUI**:
  - If you had **no unsaved edits** in that module, the GUI automatically reloads the MCP changes on disk — no action needed.
  - If you had **unsaved/in-flight local edits**, auto-save pauses for that module and displays a conflict dialog with three choices:
    - **Keep Local**: Inspects the latest disk diff and saves your local version against the newly confirmed disk revision.
    - **Use Disk**: Discards your pending local draft and reloads the changes written by MCP.
    - **View Diff**: Compares your local state and the on-disk MCP state side by side before choosing.

### What causes `LOCKED`, and how do I clear it?

`LOCKED` means `conlang-mcp` waited more than **5 seconds** to acquire `<project>/.conlang-maker/lock/` because another write or crash-recovery operation is currently active.

- Wait a moment for any large batch import or audit snapshot acquisition to finish, then retry.
- If a previous process crashed, **do not manually delete `.conlang-maker/lock/` while the app or MCP server is running**. Both Rust and `conlang-mcp` automatically verify `owner-<host>-<pid>-<nonce>.json` files and safely reclaim locks belonging to confirmed dead local processes.

### Why does `font_audit_coverage` or `font_inspect` return `NO_FONT`?

`NO_FONT` means neither the target language nor any of its ancestors along `parent_id` has a `font.otf` or `font.ttf` file. Check the `ancestor_chain` in the error `details`, then import a font into either the proto-language (to share across the subtree) or the specific branch via the GUI **Writing** page or `font_import`.

### Why did a write fail with `READ_ONLY` or `DESTRUCTIVE_DISABLED`?

- **`READ_ONLY`**: Your MCP client launched `conlang-mcp` in the default `read-only` mode (or omitted `write` / `evolution` / `admin` from `--toolsets`). Update your client config args to `["--mode", "write", "--toolsets", "core,audit,compute,write,evolution"]` and restart the MCP server connection.
- **`DESTRUCTIVE_DISABLED`**: Tools like `snapshot_rollback`, `language_delete`, `language_restore`, `corpus_delete`, and `import_workspace_bundle` require **both** `--mode write+destructive` in server startup args **and** `"confirm": true` in the tool call parameters.

### How do I resolve `AMBIGUOUS` family or language errors?

`AMBIGUOUS` occurs when a display name matches multiple entries (for example, if the same family name was registered more than once in `registry.json` from backup folders, or two branches share similar names). The error `details` list every matching candidate — call `family_list` or `family_get_tree` and pass the exact `family_id`, `language_id`, or `.conlang` path.

### What do `REVISION_REQUIRED` and `RECOVERY_REQUIRED` mean?

- **`REVISION_REQUIRED`**: A write call omitted `expected_revision` (or `expected_revisions` / `"missing"` when creating a new file). Read or `dry_run` the target first and pass the returned revision.
- **`RECOVERY_REQUIRED`**: An interrupted transaction exists in `.conlang-maker/transactions/`, and either the server is running in `read-only` mode (which refuses to mutate disk for recovery) or recovery encountered an external file conflict. Open the workspace in the Conlang Maker GUI or reconnect `conlang-mcp` with `--mode write` to complete automatic transaction recovery.

### Where can I inspect the MCP Audit Log?

Every committed MCP mutation is idempotently recorded (by `operation_id`) in:

- **Workspace file**: `<project>/.conlang-maker/mcp_audit.ndjson` (newline-delimited JSON containing timestamp, `operation_id`, tool name, affected language/scope, before/after revisions, and `snapshot_id`).
- **Desktop GUI**: Open **MCP Settings** in Conlang Maker to browse the **50 most recent MCP audit log entries** directly in the app.
