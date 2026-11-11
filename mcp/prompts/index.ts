import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpConfig } from "../config";

export function registerAllPrompts(server: McpServer, _config: McpConfig): void {
  server.registerPrompt(
    "audit_font_coverage",
    {
      title: "Audit Font Coverage",
      description:
        "Audit single-language or family-wide OpenType font coverage, interpret missing codepoints, ununified sequences, and residual glyphs, and produce actionable glyph/.fea checklists.",
      argsSchema: {
        family: z
          .string()
          .optional()
          .describe("Optional family_id, name, or .conlang path"),
        language: z
          .string()
          .optional()
          .describe("Single language_id, name, or relative path to audit"),
        root: z
          .string()
          .optional()
          .describe("Optional subtree root language for family-wide audit"),
        residual_glyph_pattern: z
          .string()
          .optional()
          .describe("Optional regex matching untransformed glyph names (e.g. ^roman\\.)"),
      },
    },
    ({ family, language, root, residual_glyph_pattern }) => {
      const scopeHint = language
        ? `target language "${language}"`
        : root
          ? `language subtree rooted at "${root}"`
          : "the entire language family";
      const familyArg = family ? ` (family: "${family}")` : "";
      const patternArg = residual_glyph_pattern
        ? ` with residual_glyph_pattern="${residual_glyph_pattern}"`
        : "";
      const toolToCall = language ? "font_audit_coverage" : "font_audit_family";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Please perform a comprehensive font coverage audit for ${scopeHint}${familyArg}${patternArg}.`,
                "",
                "Workflow:",
                `1. Call \`${toolToCall}\` (and \`font_list\` if inspecting inheritance across branches).`,
                "2. Group and interpret findings into three distinct categories:",
                "   - **Missing / Decomposed-Only Characters** (`missing_chars`, `decomposed_only`): list Unicode codepoints, affected romanization rule IDs, and concrete lexicon/corpus examples.",
                "   - **Ununified Multi-Character Sequences** (`sequence_issues` with `sequence_not_unified` or `positioning_only`): identify multi-character romanization inputs that lack GSUB ligature/contextual substitution rules.",
                "   - **Residual / `.notdef` Glyphs** (`words_with_notdef`, `words_with_residual`, `checks_not_evaluated`): highlight words that shape to `.notdef` (gid 0) or retain untransformed glyphs.",
                "3. Deliver an actionable engineering checklist:",
                "   - Glyphs & cmap entries to add to the font source.",
                "   - Concrete OpenType `.fea` rules (`ccmp`, `liga`, `calt`) to implement or fix.",
                "   - Any branches currently inheriting an ancestor font that need their own compiled regional font (`font_import_batch`).",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "review_romanization",
    {
      title: "Review Romanization & Phonology Alignment",
      description:
        "Run romanization lint checks and cross-validate romanization rules against the phoneme inventory and lexicon.",
      argsSchema: {
        language: z
          .string()
          .describe("Language ID, name, or relative path to review"),
        family: z
          .string()
          .optional()
          .describe("Optional family_id, name, or .conlang path"),
      },
    },
    ({ language, family }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Please review the romanization system for language "${language}"${family ? ` in family "${family}"` : ""}.`,
              "",
              "Workflow:",
              "1. Call `romanization_get` and `romanization_analyze` on the language.",
              "2. Cross-check against `phono_get` (inventory & allophony) and `lex_quality_check` (unmapped spellings / empty IPA).",
              "3. Report:",
              "   - Unreachable inventory phonemes (no rule outputs them).",
              "   - Out-of-inventory rule outputs.",
              "   - Conflicting, duplicate, or shadowed rules (greedy longest-match / context ordering issues).",
              "   - Case-sensitivity gaps and unmapped lexicon spellings.",
              "4. Propose concrete rule additions/edits (`romanization_upsert_rules` with `dry_run: true` and `regenerate_ipa: true`) and wait for confirmation before committing.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "design_sound_changes",
    {
      title: "Design Diachronic Sound Changes (SCA)",
      description:
        "Iteratively design and simulate diachronic sound change rules between a parent language and a child language.",
      argsSchema: {
        parent: z
          .string()
          .describe("Parent language ID, name, or relative path"),
        child: z
          .string()
          .describe("Child language ID, name, or relative path"),
        family: z
          .string()
          .optional()
          .describe("Optional family_id, name, or .conlang path"),
      },
    },
    ({ parent, child, family }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Please help design and verify diachronic sound changes from parent language "${parent}" to child language "${child}"${family ? ` (family: "${family}")` : ""}.`,
              "",
              "Workflow:",
              "1. Call `phono_get` on both `parent` and `child` to compare their consonant/vowel inventories, phonotactics, and macros.",
              "2. Call `sca_get` on `child` and `lex_parent_diff` to inspect existing sound change rules and current parent→child lexicon divergences.",
              "3. Propose ordered phonological rules (using `sca_feature_query` or `sca_parse_rules_text` to validate syntax) and test them non-destructively via `sca_simulate` with temporary `rule_sets` against the parent lexicon.",
              "4. Present representative before/after reflexes and step-by-step changelogs, then ask for confirmation before saving via `sca_update` or syncing via `lex_pull_sync`.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "lexicon_cleanup",
    {
      title: "Lexicon Quality Check & Batch Cleanup",
      description:
        "Run lexicon quality diagnostics and guide safe dry-run → confirm → commit batch fixes.",
      argsSchema: {
        language: z
          .string()
          .describe("Language ID, name, or relative path"),
        family: z
          .string()
          .optional()
          .describe("Optional family_id, name, or .conlang path"),
      },
    },
    ({ language, family }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Please run a lexicon quality audit and cleanup workflow for language "${language}"${family ? ` (family: "${family}")` : ""}.`,
              "",
              "Workflow:",
              "1. Call `lex_quality_check` and `lex_stats` to summarize missing POS, unmapped spellings, empty IPA, phonotactic violations, missing glosses, and duplicates.",
              "2. Fetch affected entries in manageable batches with `lex_get` or `lex_search`.",
              "3. Prepare proposed fixes and preview them using `lex_upsert` or `lex_regenerate_ipa` with `dry_run: true`.",
              "4. Present the dry-run summary and `base_revisions` to the user, and only execute the write after explicit confirmation.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

