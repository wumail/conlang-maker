/**
 * grammar_sync.ts — 历时语法同步（T2.6）
 *
 * 默认只读预览：给出父语言词缀在子语言音变后的形式、锁定项与被中和的格标记；
 * `apply: true` 时在事务 + 语法快照保护下写入子语言 `grammar.json`。
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { GrammarConfig } from "../../src/types";
import {
  applyGrammarPullSync,
  dimensionKey,
  hasPendingChanges,
  planGrammarPullSync,
} from "../../src/core/workflows/grammarPullSync";
import { assertWriteAllowed } from "../config";
import { McpError } from "../errors";
import {
  markSessionScopeWritten,
  planLanguageSnapshot,
  shouldAutoSnapshot,
} from "../storage/snapshot";
import {
  readGrammarUnlocked,
  readPhonologyUnlocked,
  readScaUnlocked,
  readWorkspaceUnlocked,
} from "../storage/read";
import { executeProjectTransaction, type PlannedMutation } from "../storage/transaction";
import { registerDefinedTool } from "../toolRegistry";
import {
  commonWriteInputFields,
  familyInputFields,
  languageInputFields,
  normalizeRelPathPosix,
  resolveFamilyFromArgs,
  resolveLanguageUnlocked,
} from "./_helpers";

interface RawOverride {
  entry_id?: unknown;
  dimension_values?: unknown;
  surface_form?: unknown;
}

/** 以原始 JSON 为基底，只替换音变后的表层，保留未知字段 */
function mergeIntoRaw(
  raw: Record<string, unknown>,
  next: GrammarConfig,
): Record<string, unknown> {
  const affixByRuleId = new Map(
    next.inflection_rules.map((rule) => [rule.rule_id, rule.affix]),
  );
  const derivAffixByRuleId = new Map(
    next.derivation_rules.map((rule) => [rule.rule_id, rule.affix]),
  );
  const surfaceByKey = new Map(
    next.irregular_overrides.map((override) => [
      `${override.entry_id}::${dimensionKey(override.dimension_values)}`,
      override.surface_form,
    ]),
  );

  const replaceAffix = (
    list: unknown,
    lookup: Map<string, string>,
    idField: string,
  ): unknown =>
    Array.isArray(list)
      ? list.map((item) => {
          if (!item || typeof item !== "object") return item;
          const record = item as Record<string, unknown>;
          const id = record[idField];
          const affix = typeof id === "string" ? lookup.get(id) : undefined;
          return affix === undefined ? record : { ...record, affix };
        })
      : list;

  const replacedOverrides = Array.isArray(raw.irregular_overrides)
    ? (raw.irregular_overrides as RawOverride[]).map((item) => {
        if (!item || typeof item !== "object") return item;
        if (typeof item.entry_id !== "string" || typeof item.dimension_values !== "object") {
          return item;
        }
        const key = `${item.entry_id}::${dimensionKey(
          item.dimension_values as Record<string, string>,
        )}`;
        const surface = surfaceByKey.get(key);
        return surface === undefined ? item : { ...item, surface_form: surface };
      })
    : raw.irregular_overrides;

  return {
    ...raw,
    inflection_rules: replaceAffix(raw.inflection_rules, affixByRuleId, "rule_id"),
    derivation_rules: replaceAffix(raw.derivation_rules, derivAffixByRuleId, "rule_id"),
    irregular_overrides: replacedOverrides,
  };
}

export function registerGrammarSyncTools(
  server: Parameters<typeof registerDefinedTool>[0],
  config: Parameters<typeof registerDefinedTool>[1],
): void {
  registerDefinedTool(server, config, {
    name: "gram_pull_sync",
    title: "Pull Parent Affixes Through Sound Changes",
    description:
      "Take the parent language's inflection/derivation affixes and irregular forms, run the child language's sound changes over them, and report the resulting forms plus syncretism collisions. Set apply=true to write the child grammar.",
    toolsets: ["write", "compute"],
    access: "write",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      ...commonWriteInputFields,
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
      const wantsWrite = args.apply === true && args.dry_run !== true;

      if (wantsWrite) {
        assertWriteAllowed(config, "gram_pull_sync");
        if (!args.operation_id?.trim()) {
          throw new McpError(
            "VALIDATION",
            "operation_id is required when applying (use dry_run: true to preview).",
          );
        }
      }

      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "gram_pull_sync",
        operationId: args.operation_id,
        requestPayloadForDigest: args,
        dryRun: !wantsWrite,
        planInsideLock: ({ warnings }) => {
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
            throw new McpError(
              "NOT_FOUND",
              `Parent language "${child.parent_id}" not found.`,
            );
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
            phonology: childPhono.config,
            posIds: args.pos_ids,
          });

          const langRel = normalizeRelPathPosix(child.path);
          const grammarAbs = path.join(family.project_dir, langRel, "grammar.json");
          const grammarRel = `${langRel}/grammar.json`;
          const changed = hasPendingChanges(plan);

          if (plan.collisions.length > 0) {
            warnings.push(
              `${plan.collisions.length} syncretism collision(s) after sound changes.`,
            );
          }

          const mutations: PlannedMutation[] = [];
          let snapshotId: string | null = null;

          if (wantsWrite && changed) {
            if (
              shouldAutoSnapshot({
                projectDir: family.project_dir,
                languageId: child.language_id,
                scope: "grammar",
                batchSize: 1,
              })
            ) {
              const snap = planLanguageSnapshot({
                projectDir: family.project_dir,
                language: child,
                scope: "grammar",
                origin: "mcp",
                operationType: "auto_snapshot",
                description: "MCP gram_pull_sync",
              });
              snapshotId = snap.snapshotId;
              mutations.push(...snap.mutations);
              markSessionScopeWritten(
                family.project_dir,
                child.language_id,
                "grammar",
              );
            }

            const nextGrammar = applyGrammarPullSync(childGrammar.config, plan, {
              skipRuleIds: args.skip_rule_ids,
            });
            const raw = JSON.parse(
              fs.readFileSync(grammarAbs, "utf-8"),
            ) as Record<string, unknown>;
            mutations.push({
              kind: "write_file",
              relPath: grammarRel,
              content: JSON.stringify(mergeIntoRaw(raw, nextGrammar), null, 2),
            });
          }

          const base = {
            family_id: family.family_id,
            language_id: child.language_id,
            parent_language_id: parent.language_id,
            ...plan,
            dependencies: {
              "grammar.json": childGrammar.revision,
              "sca_rules.json": childSca.revision,
              "phonology.json": childPhono.revision,
            },
          };

          return {
            expectations: [
              {
                label: "grammar.json",
                targetPath: grammarAbs,
                expectedRevision: args.expected_revision ?? "",
              },
            ],
            mutations,
            languageId: child.language_id,
            snapshotId,
            auditSummary: `Pulled grammar affixes ${parent.language_id} → ${child.language_id}`,
            buildDryRunResponse: () => ({
              ...base,
              applied: false,
              preview: true,
              would_change: changed,
            }),
            buildResponse: (newRevisions) => ({
              ...base,
              applied: wantsWrite && changed,
              revision: newRevisions["grammar.json"],
              snapshot_id: snapshotId,
            }),
          };
        },
      });
    },
  });
}
