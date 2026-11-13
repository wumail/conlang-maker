/**
 * cognates.ts — 全语系同源词矩阵（T2.3）
 *
 * 只读：按概念横向汇总每门语言的词形，并把共享祖语词根的单元格归入同源组。
 */
import { z } from "zod";
import type { ConceptDefinition, WordEntry } from "../../src/types";
import { CORE_CONCEPTS } from "../../src/data/core_concepts";
import { buildCognateMatrix } from "../../src/core/engines/cognateMatrix";
import { readLexiconUnlocked, readWorkspaceUnlocked } from "../storage/read";
import { registerDefinedTool } from "../toolRegistry";
import { familyInputFields, resolveFamilyFromArgs } from "./_helpers";

export function registerCognateTools(
  server: Parameters<typeof registerDefinedTool>[0],
  config: Parameters<typeof registerDefinedTool>[1],
): void {
  registerDefinedTool(server, config, {
    name: "family_cognate_matrix",
    title: "Build the Family Cognate Matrix",
    description:
      "Aggregate every language's lexicon by concept and group cells that descend from the same proto-form. Distinguishes inherited cognates, borrowings and independent innovations; reports broken parent links.",
    toolsets: ["core", "compute"],
    access: "read",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      concept_ids: z
        .array(z.string())
        .optional()
        .describe("Restrict to these concept ids (default: the whole core library)"),
      language_ids: z
        .array(z.string())
        .optional()
        .describe("Restrict to these languages (default: every language in the family)"),
      only_filled: z
        .boolean()
        .optional()
        .describe("Drop concept rows with no forms at all"),
      include_empty_languages: z
        .boolean()
        .optional()
        .describe("Keep languages whose lexicon is empty (default true)"),
      max_rows: z.number().int().min(1).max(500).optional().describe("Row cap (default 200)"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const ws = readWorkspaceUnlocked(family.conlang_file_path);
      const customConcepts = Array.isArray(ws.config.custom_concepts)
        ? (ws.config.custom_concepts as ConceptDefinition[])
        : [];

      const languageFilter = args.language_ids?.length
        ? new Set(args.language_ids)
        : null;
      const selectedLanguages = ws.config.languages.filter(
        (language) => !languageFilter || languageFilter.has(language.language_id),
      );
      if (selectedLanguages.length === 0) {
        throw new Error("No languages matched language_ids.");
      }

      const wordsByLanguage: Record<string, WordEntry[]> = {};
      const dependencies: Record<string, string> = { "workspace.conlang": ws.revision };
      for (const language of selectedLanguages) {
        const lex = readLexiconUnlocked(family.project_dir, language);
        wordsByLanguage[language.language_id] = args.include_empty_languages === false
          ? lex.words.filter((word) => word.senses.length > 0)
          : lex.words;
        dependencies[`lexicon:${language.language_id}`] = lex.revision;
      }

      const conceptPool = [...CORE_CONCEPTS, ...customConcepts];
      const concepts = args.concept_ids?.length
        ? conceptPool.filter((concept) => args.concept_ids!.includes(concept.concept_id))
        : conceptPool;

      const matrix = buildCognateMatrix({
        languages: selectedLanguages,
        wordsByLanguage,
        concepts,
        onlyFilled: args.only_filled === true,
        maxRows: args.max_rows ?? 200,
      });

      return {
        family_id: family.family_id,
        languages: matrix.languages,
        stats: matrix.stats,
        rows: matrix.rows.map((row) => ({
          concept_id: row.conceptId,
          gloss_zh: row.glossZh,
          gloss_en: row.glossEn,
          semantic_field: row.semanticField,
          cognate_set_count: row.cognateSetCount,
          filled: row.filled,
          cells: row.cells,
        })),
        dependencies,
      };
    },
  });
}
