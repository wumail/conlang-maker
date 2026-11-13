/**
 * word_family.ts — 词族图谱只读工具（T2.4）
 */
import { z } from "zod";
import {
  computeComponentsDigest,
  getWordFamilyGraph,
  hasUnresolvedComponents,
  wouldIntroduceCycle,
} from "../../src/core/engines/wordFamily";
import { McpError } from "../errors";
import { readLexiconUnlocked } from "../storage/read";
import { registerDefinedTool } from "../toolRegistry";
import {
  familyInputFields,
  languageInputFields,
  resolveFamilyFromArgs,
  resolveLanguageUnlocked,
} from "./_helpers";

export function registerWordFamilyTools(
  server: Parameters<typeof registerDefinedTool>[0],
  config: Parameters<typeof registerDefinedTool>[1],
): void {
  registerDefinedTool(server, config, {
    name: "lex_word_family",
    title: "Inspect a Word Family (DAG)",
    description:
      "Return the morpheme-component DAG around a lexicon entry: upstream components, downstream derivatives, pronunciation digest drift and unresolved references. Optionally test whether adding a component would create a cycle.",
    toolsets: ["core", "compute"],
    access: "read",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      entry_id: z.string().describe("Lexicon entry to inspect"),
      test_component_id: z
        .string()
        .optional()
        .describe("Check whether adding this entry as a component would introduce a cycle"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const resolved = resolveLanguageUnlocked(family, args);
      const lex = readLexiconUnlocked(family.project_dir, resolved.language);

      const wordsMap: Record<string, (typeof lex.words)[number]> = {};
      for (const word of lex.words) wordsMap[word.entry_id] = word;

      const entry = wordsMap[args.entry_id];
      if (!entry) {
        throw new McpError(
          "NOT_FOUND",
          `Entry "${args.entry_id}" not found in ${resolved.language.language_id}.`,
        );
      }

      const graph = getWordFamilyGraph(entry.entry_id, wordsMap);
      const components = entry.etymology?.components ?? [];
      const digest = computeComponentsDigest(components, wordsMap);
      const storedDigest = entry.etymology?.compounds_stale_digest ?? null;

      return {
        family_id: family.family_id,
        language_id: resolved.language.language_id,
        entry_id: entry.entry_id,
        word: entry.con_word_romanized,
        components,
        digest,
        stored_digest: storedDigest,
        stale: Boolean(storedDigest) && storedDigest !== digest,
        unresolved_components: hasUnresolvedComponents(entry, wordsMap),
        upstream: graph.upstream,
        downstream: graph.downstream,
        family_size: graph.size,
        ...(args.test_component_id
          ? {
              would_create_cycle: wouldIntroduceCycle(
                entry.entry_id,
                args.test_component_id,
                wordsMap,
              ),
            }
          : {}),
        dependencies: { lexicon: lex.revision },
      };
    },
  });
}
