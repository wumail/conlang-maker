/**
 * grammar_sync.ts — 历时语法同步（T2.6）
 *
 * 默认只读预览：给出父语言词缀在子语言音变后的形式、锁定项与被中和的格标记；
 * `apply: true` 时在事务 + 快照保护下写入子语言 `grammar.json`。
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { GrammarConfig } from "../../src/types";
import {
  applyGrammarPullSync,
  hasPendingChanges,
  planGrammarPullSync,
} from "../../src/core/workflows/grammarPullSync";
import { McpError } from "../errors";
import { atomicWriteFileSync } from "../storage/atomicWrite";
import {
  readGrammarUnlocked,
  readPhonologyUnlocked,
  readScaUnlocked,
  readWorkspaceUnlocked,
} from "../storage/read";
import { computeFileRevision } from "../storage/revision";
import { registerDefinedTool } from "../toolRegistry";
import {
  familyInputFields,
  languageInputFields,
  normalizeRelPathPosix,
  resolveFamilyFromArgs,
  resolveLanguageUnlocked,
} from "./_helpers";

export function registerGrammarSyncTools(
  server: Parameters<typeof registerDefinedTool>[0],
  config: Parameters<typeof registerDefinedTool>[1],
): void {
  registerDefinedTool(server, config, {
    name: "gram_pull_sync",
    title: "Pull Parent Affixes Through Sound Changes",
    description:
      "Take the parent language's inflection/derivation affixes, run the child language's sound changes over them, and report the resulting forms plus syncretism collisions. Set apply=true to write the child grammar.",
    toolsets: ["core", "compute"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      pos_ids: z.array(z.string()).optional().describe("Restrict to these parts of speech"),
      skip_rule_ids: z
        .array(z.string())
        .optional()
        .describe("Rules to leave untouched when applying"),
      apply: z
        .boolean()
        .optional()
        .describe("Write the child grammar (default false = preview only)"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const resolved = resolveLanguageUnlocked(family, args);
      const child = resolved.language;
      if (!child.parent_id) {
        throw new McpError(
          "VALIDATION",
          `${child.language_id} has no parent language; nothing to pull from.`,
        );
      }

      const ws = readWorkspaceUnlocked(family.conlang_file_path);
      const parent = ws.config.languages.find(
        (language) => language.language_id === child.parent_id,
      );
      if (!parent) {
        throw new McpError("NOT_FOUND", `Parent language "${child.parent_id}" not found.`);
      }

      const parentGrammar = readGrammarUnlocked(family.project_dir, parent);
      const childGrammar = readGrammarUnlocked(family.project_dir, child);
      const childSca = readScaUnlocked(family.project_dir, child);
      const childPhono = readPhonologyUnlocked(
        family.project_dir,
        family.conlang_file_path,
        child,
      );

      const plan = planGrammarPullSync({
        parentGrammar: parentGrammar.config,
        childGrammar: childGrammar.config,
        childSca: childSca.config,
        inventory: childPhono.config.phoneme_inventory,
        phonotactics: childPhono.config.phonotactics,
        posIds: args.pos_ids,
      });

      const shouldApply = args.apply === true;
      if (!shouldApply || !hasPendingChanges(plan)) {
        return {
          family_id: family.family_id,
          language_id: child.language_id,
          parent_language_id: parent.language_id,
          applied: false,
          ...plan,
          dependencies: {
            "grammar.json": childGrammar.revision,
            "sca_rules.json": childSca.revision,
            "phonology.json": childPhono.revision,
          },
        };
      }

      const nextGrammar: GrammarConfig = applyGrammarPullSync(childGrammar.config, plan, {
        skipRuleIds: args.skip_rule_ids,
      });
      const grammarPath = path.join(
        family.project_dir,
        normalizeRelPathPosix(child.path),
        "grammar.json",
      );
      // 保留未知字段：以原文为基底只替换两条规则数组
      const raw = JSON.parse(fs.readFileSync(grammarPath, "utf-8")) as Record<string, unknown>;
      const merged = {
        ...raw,
        inflection_rules: nextGrammar.inflection_rules,
        derivation_rules: nextGrammar.derivation_rules,
      };
      atomicWriteFileSync(grammarPath, JSON.stringify(merged, null, 2));

      return {
        family_id: family.family_id,
        language_id: child.language_id,
        parent_language_id: parent.language_id,
        applied: true,
        ...plan,
        revision: computeFileRevision(grammarPath),
        warnings: plan.collisions.length > 0
          ? [
              `${plan.collisions.length} syncretism collision(s) detected after sound changes.`,
            ]
          : undefined,
      };
    },
  });
}
