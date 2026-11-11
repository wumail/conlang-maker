import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnapshotScope } from "../../src/types";
import {
  assertDestructiveAllowed,
  assertWriteAllowed,
  type McpConfig,
} from "../config";
import { McpError } from "../errors";
import {
  assertSafeRelativeLanguagePath,
  resolveFamily,
  resolveLanguage,
} from "../registry/addressing";
import {
  readWorkspaceUnlocked,
  withConsistentProjectRead,
} from "../storage/read";
import {
  computeFileRevision,
  computeLexiconRevision,
} from "../storage/revision";
import {
  diffSnapshotUnlocked,
  listSnapshotsUnlocked,
  planLanguageSnapshot,
  planProjectSnapshot,
  planSnapshotRollback,
} from "../storage/snapshot";
import {
  executeProjectTransaction,
  type RevisionExpectation,
} from "../storage/transaction";
import { registerDefinedTool } from "../toolRegistry";
import { projectArrayFields } from "../util/fields";
import { paginate } from "../util/paging";

const SNAPSHOT_SCOPES = [
  "lexicon",
  "phonology",
  "grammar",
  "sca",
  "corpus",
  "font",
  "project",
] as const;

function buildScopeExpectation(
  projectDir: string,
  langPath: string,
  scope: Exclude<SnapshotScope, "project">,
  expectedRevision: string,
): RevisionExpectation {
  const langDir = assertSafeRelativeLanguagePath(projectDir, langPath);
  switch (scope) {
    case "lexicon":
      return {
        label: "lexicon",
        targetPath: path.join(langDir, "lexicon"),
        isLexiconDir: true,
        expectedRevision,
      };
    case "phonology":
      return {
        label: "phonology.json",
        targetPath: path.join(langDir, "phonology.json"),
        expectedRevision,
      };
    case "grammar":
      return {
        label: "grammar.json",
        targetPath: path.join(langDir, "grammar.json"),
        expectedRevision,
      };
    case "sca":
      return {
        label: "sca_rules.json",
        targetPath: path.join(langDir, "sca_rules.json"),
        expectedRevision,
      };
    case "corpus":
      return {
        label: "corpus_index.json",
        targetPath: path.join(langDir, "corpus", "corpus_index.json"),
        expectedRevision,
      };
    case "font": {
      const otfPath = path.join(langDir, "font.otf");
      const ttfPath = path.join(langDir, "font.ttf");
      const targetPath = fs.existsSync(otfPath) ? otfPath : ttfPath;
      return {
        label: "font",
        targetPath,
        expectedRevision,
      };
    }
  }
}

export function registerSnapshotTools(
  server: McpServer,
  config: McpConfig,
): void {
  registerDefinedTool(server, config, {
    name: "snapshot_list",
    title: "List Language & Project Snapshots",
    description:
      "Use when inspecting recovery points (language-level .oplog snapshots, project-level topology snapshots, or archived oplogs of removed languages). Do NOT use to inspect deleted language directories in trash — call language_trash_list instead.",
    toolsets: ["core", "admin"],
    access: "read",
    inputSchema: {
      family: z.string().optional().describe("Family ID, name, or .conlang path"),
      family_id: z.string().optional().describe("Alias for family"),
      language: z
        .string()
        .optional()
        .describe(
          "Optional language ID, name, or path (also accepts archived language_id of a removed language)",
        ),
      language_id: z.string().optional().describe("Alias for language"),
      scope: z
        .enum(SNAPSHOT_SCOPES)
        .optional()
        .describe("Optional filter by snapshot scope"),
      limit: z.number().int().min(1).max(500).optional(),
      cursor: z.string().optional(),
      fields: z.array(z.string()).optional(),
    },
    handler: async (args) => {
      const family = resolveFamily(config, args.family ?? args.family_id);
      const languageQuery = args.language ?? args.language_id;
      return await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "snapshot_list",
        () => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          let filterLangId: string | undefined;
          if (languageQuery) {
            try {
              const resolved = resolveLanguage(family, languageQuery, {
                workspace: ws.config,
                revision: ws.revision,
              });
              filterLangId = resolved.language.language_id;
            } catch {
              // Allow direct archived language_id query even after language directory removal (§3.6)
              filterLangId = languageQuery.trim();
            }
          }

          const all = listSnapshotsUnlocked(
            family.project_dir,
            ws.config,
            filterLangId,
            args.scope,
          );
          const page = paginate(all, ws.revision, {
            limit: args.limit,
            cursor: args.cursor,
          });
          return {
            family_id: family.family_id,
            workspace_revision: ws.revision,
            total: page.total,
            next_cursor: page.next_cursor,
            snapshots: projectArrayFields(page.items, args.fields),
          };
        },
      );
    },
  });

  registerDefinedTool(server, config, {
    name: "snapshot_diff",
    title: "Diff Snapshot Against Current Workspace",
    description:
      "Use before rolling back a language or project snapshot to preview added, removed, and changed files as well as any topology/path conflicts. Read-only.",
    toolsets: ["core", "admin"],
    access: "read",
    inputSchema: {
      family: z.string().optional().describe("Family ID, name, or .conlang path"),
      family_id: z.string().optional().describe("Alias for family"),
      snapshot_id: z.string().describe("Target snapshot ID from snapshot_list"),
      language: z
        .string()
        .optional()
        .describe("Optional active or archived language identifier"),
      language_id: z.string().optional().describe("Alias for language"),
    },
    handler: async (args) => {
      const family = resolveFamily(config, args.family ?? args.family_id);
      const languageQuery = args.language ?? args.language_id;
      return await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "snapshot_diff",
        () => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          let langId: string | undefined;
          if (languageQuery) {
            try {
              langId = resolveLanguage(family, languageQuery, {
                workspace: ws.config,
                revision: ws.revision,
              }).language.language_id;
            } catch {
              langId = languageQuery.trim();
            }
          }
          const diff = diffSnapshotUnlocked(
            family.project_dir,
            family.conlang_file_path,
            ws.config,
            args.snapshot_id,
            langId,
          );
          return {
            family_id: family.family_id,
            workspace_revision: ws.revision,
            diff,
          };
        },
      );
    },
  });

  registerDefinedTool(server, config, {
    name: "snapshot_create",
    title: "Create Manual Snapshot",
    description:
      "Use when manually creating a named language-scope or project-level recovery point before exploratory edits. Write operations already auto-snapshot by policy, so only call this when an explicit checkpoint is needed.",
    toolsets: ["write", "admin"],
    access: "write",
    idempotent: true,
    inputSchema: {
      family: z.string().optional().describe("Family ID, name, or .conlang path"),
      family_id: z.string().optional().describe("Alias for family"),
      scope: z
        .enum(SNAPSHOT_SCOPES)
        .default("project")
        .describe("Snapshot scope ('project' or language domain scope)"),
      language: z
        .string()
        .optional()
        .describe("Required when scope is not 'project'"),
      language_id: z.string().optional().describe("Alias for language"),
      description: z
        .string()
        .min(1)
        .max(500)
        .default("Manual MCP snapshot")
        .describe("Human-readable description"),
      operation_id: z.string().optional(),
      expected_revision: z
        .string()
        .optional()
        .describe("Expected workspace or target scope revision"),
      dry_run: z.boolean().optional(),
    },
    handler: async (args) => {
      assertWriteAllowed(config, "snapshot_create");
      const family = resolveFamily(config, args.family ?? args.family_id);
      const languageQuery = args.language ?? args.language_id;
      if (args.scope !== "project" && !languageQuery) {
        throw new McpError(
          "VALIDATION",
          `Parameter "language" is required when creating a "${args.scope}" snapshot.`,
        );
      }

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "snapshot_create",
        operationId: args.operation_id,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        requireRevisionsOnCommit: Boolean(args.expected_revision),
        planInsideLock: ({ operationId }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          if (args.scope === "project") {
            const snap = planProjectSnapshot({
              projectDir: family.project_dir,
              conlangFilePath: family.conlang_file_path,
              workspace: ws.config,
              origin: "mcp",
              operationType: "manual_snapshot",
              description: args.description,
            });
            return {
              expectations: [
                {
                  label: "workspace",
                  targetPath: family.conlang_file_path,
                  expectedRevision: args.expected_revision ?? ws.revision,
                },
              ],
              mutations: snap.mutations,
              snapshotId: snap.snapshotId,
              auditSummary: `Created project snapshot ${snap.snapshotId}: ${args.description}`,
              buildDryRunResponse: (baseRevisions) => ({
                dry_run: true,
                scope: "project",
                affected_languages: ws.config.languages.map((l) => l.language_id),
                base_revisions: baseRevisions,
              }),
              buildResponse: (newRevisions, warnings) => ({
                operation_id: operationId,
                committed: true,
                changed: true,
                snapshot_id: snap.snapshotId,
                level: "project",
                scope: "project",
                revisions: newRevisions,
                summary: `Created project snapshot ${snap.snapshotId}`,
                warnings: warnings.length > 0 ? warnings : undefined,
              }),
            };
          }

          const resolvedLang = resolveLanguage(family, languageQuery!, {
            workspace: ws.config,
            revision: ws.revision,
          });
          const langScope = args.scope as Exclude<SnapshotScope, "project">;
          const exp = buildScopeExpectation(
            family.project_dir,
            resolvedLang.language.path,
            langScope,
            args.expected_revision ?? "",
          );
          if (!exp.expectedRevision) {
            exp.expectedRevision = exp.isLexiconDir
              ? computeLexiconRevision(exp.targetPath)
              : computeFileRevision(exp.targetPath);
          }

          const snap = planLanguageSnapshot({
            projectDir: family.project_dir,
            language: resolvedLang.language,
            scope: langScope,
            origin: "mcp",
            operationType: "manual_snapshot",
            description: args.description,
          });

          return {
            expectations: [exp],
            mutations: snap.mutations,
            languageId: resolvedLang.language.language_id,
            snapshotId: snap.snapshotId,
            auditSummary: `Created ${langScope} snapshot ${snap.snapshotId} for ${resolvedLang.language.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              level: "language",
              scope: langScope,
              language_id: resolvedLang.language.language_id,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed: true,
              snapshot_id: snap.snapshotId,
              level: "language",
              scope: langScope,
              language_id: resolvedLang.language.language_id,
              revisions: newRevisions,
              summary: `Created ${langScope} snapshot ${snap.snapshotId} for ${resolvedLang.language.name}`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });

  registerDefinedTool(server, config, {
    name: "snapshot_rollback",
    title: "Roll Back Language or Project Snapshot",
    description:
      "Use when restoring a language scope or full project topology to a previous snapshot. Destructive: requires --mode write+destructive, confirm: true, operation_id, and expected_revision (or preview first with dry_run: true). Non-destructively creates a recovery snapshot of current state before restoring.",
    toolsets: ["admin", "write"],
    access: "destructive",
    idempotent: true,
    inputSchema: {
      family: z.string().optional().describe("Family ID, name, or .conlang path"),
      family_id: z.string().optional().describe("Alias for family"),
      snapshot_id: z.string().describe("Snapshot ID to restore"),
      language: z
        .string()
        .optional()
        .describe("Optional active or archived language ID/name/path"),
      language_id: z.string().optional().describe("Alias for language"),
      operation_id: z
        .string()
        .optional()
        .describe("Client-generated idempotency ID (required when committing)"),
      expected_revision: z
        .string()
        .optional()
        .describe("Current workspace revision (from family_get_tree or dry_run)"),
      expected_revisions: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional map of target revisions from dry_run base_revisions"),
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to execute rollback"),
      dry_run: z.boolean().optional(),
    },
    handler: async (args) => {
      assertDestructiveAllowed(
        config,
        "snapshot_rollback",
        args.confirm,
        args.dry_run,
      );
      if (!args.dry_run && !args.operation_id) {
        throw new McpError(
          "VALIDATION",
          "operation_id is required when committing snapshot_rollback.",
        );
      }

      const family = resolveFamily(config, args.family ?? args.family_id);
      const languageQuery = args.language ?? args.language_id;
      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "snapshot_rollback",
        operationId: args.operation_id,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          let langId: string | undefined;
          let activeLangPath: string | undefined;
          if (languageQuery) {
            try {
              const resolved = resolveLanguage(family, languageQuery, {
                workspace: ws.config,
                revision: ws.revision,
              });
              langId = resolved.language.language_id;
              activeLangPath = resolved.language.path;
            } catch {
              langId = languageQuery.trim();
            }
          }

          const plan = planSnapshotRollback({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            workspace: ws.config,
            snapshotId: args.snapshot_id,
            languageId: langId,
            operationId,
            origin: "mcp",
          });

          const expectations: RevisionExpectation[] = [
            {
              label: "workspace",
              targetPath: family.conlang_file_path,
              expectedRevision:
                args.expected_revisions?.workspace ??
                args.expected_revision ??
                "",
            },
          ];

          if (
            plan.diff.level === "language" &&
            plan.diff.scope !== "project" &&
            activeLangPath &&
            args.expected_revisions?.[plan.diff.scope]
          ) {
            expectations.push(
              buildScopeExpectation(
                family.project_dir,
                activeLangPath,
                plan.diff.scope,
                args.expected_revisions[plan.diff.scope],
              ),
            );
          }

          return {
            expectations,
            mutations: plan.mutations,
            languageId: langId ?? null,
            snapshotId: plan.recoverySnapshotId,
            auditSummary: `Rolled back ${plan.diff.scope} snapshot ${args.snapshot_id} (recovery snapshot: ${plan.recoverySnapshotId})`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              restored_from: args.snapshot_id,
              diff: plan.diff,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed:
                plan.diff.changed_files.length > 0 ||
                plan.diff.added_files.length > 0 ||
                plan.diff.removed_files.length > 0,
              snapshot_id: plan.recoverySnapshotId,
              restored_from: args.snapshot_id,
              diff: plan.diff,
              revisions: newRevisions,
              summary: `Restored ${plan.diff.scope} snapshot ${args.snapshot_id}; pre-rollback state saved as ${plan.recoverySnapshotId}`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });
}
