/**
 * concepts.ts — 概念库只读检索与工作区自定义概念写入
 *
 * 概念表挂在 `workspace.conlang` 的 `custom_concepts`，与词条的
 * `Sense.concept_id` 共同构成跨语言对齐锚点（T2.2）。
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ConceptDefinition, WorkspaceConfig } from "../../src/types";
import { CORE_CONCEPTS, searchConcepts } from "../../src/data/core_concepts";
import { McpError } from "../errors";
import { computeFileRevision } from "../storage/revision";
import { readWorkspaceUnlocked } from "../storage/read";
import {
  executeProjectTransaction,
  type PlannedMutation,
  type RevisionExpectation,
} from "../storage/transaction";
import { registerDefinedTool } from "../toolRegistry";
import {
  commonWriteInputFields,
  familyInputFields,
  resolveFamilyFromArgs,
} from "./_helpers";

const conceptSchema = z
  .object({
    concept_id: z.string().min(1),
    gloss_en: z.string().optional(),
    gloss_zh: z.string().optional(),
    semantic_field: z.string().optional(),
    concepticon_id: z.string().optional(),
    standard_lists: z.array(z.string()).optional(),
  })
  .passthrough();

const SEMANTIC_FIELDS = [
  "pronoun",
  "person",
  "kinship",
  "body",
  "animal",
  "plant",
  "nature",
  "substance",
  "action",
  "motion",
  "cognition",
  "perception",
  "property",
  "quantity",
  "culture",
  "place",
] as const;

function normalizeCustomConcepts(raw: unknown): ConceptDefinition[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is ConceptDefinition =>
      !!item &&
      typeof item === "object" &&
      typeof (item as ConceptDefinition).concept_id === "string",
  );
}

export function registerConceptTools(
  server: Parameters<typeof registerDefinedTool>[0],
  config: Parameters<typeof registerDefinedTool>[1],
): void {
  // ── concept_list ────────────────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "concept_list",
    title: "List Core and Workspace Concepts",
    description:
      "Search the built-in Swadesh-100 / Leipzig-Jakarta concept library plus the workspace's custom concepts. Supports Chinese/English gloss, concept_id and semantic-field filtering.",
    toolsets: ["core", "compute"],
    access: "read",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      query: z
        .string()
        .optional()
        .describe("Free-text query over concept_id / English gloss / Chinese gloss"),
      semantic_field: z.enum(SEMANTIC_FIELDS).optional().describe("Restrict to one semantic field"),
      standard_list: z
        .enum(["swadesh_100", "leipzig_jakarta_100"])
        .optional()
        .describe("Only return concepts belonging to the given standard list"),
      include_core: z
        .boolean()
        .optional()
        .describe("Include the built-in library (default true)"),
      limit: z.number().int().min(1).max(500).optional().describe("Max results (default 100)"),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default 0)"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const ws = readWorkspaceUnlocked(family.conlang_file_path);
      const custom = normalizeCustomConcepts(ws.config.custom_concepts);
      const includeCore = args.include_core !== false;
      const limit = args.limit ?? 100;
      const offset = args.offset ?? 0;

      const matched = searchConcepts(args.query ?? "", {
        field: args.semantic_field ?? "",
        limit: Number.MAX_SAFE_INTEGER,
        extra: custom,
      })
        .map((hit) => ({
          ...hit.concept,
          source: (hit.isCustom ? "custom" : "core") as "core" | "custom",
        }))
        .filter((concept) =>
          args.standard_list
            ? (concept.standard_lists ?? []).includes(args.standard_list)
            : true,
        )
        .filter((concept) => (includeCore ? true : concept.source === "custom"));

      return {
        family_id: family.family_id,
        total: matched.length,
        offset,
        limit,
        concepts: matched.slice(offset, offset + limit),
        core_library_size: CORE_CONCEPTS.length,
        custom_count: custom.length,
        dependencies: { "workspace.conlang": ws.revision },
      };
    },
  });

  // ── concept_upsert ──────────────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "concept_upsert",
    title: "Upsert or Delete Workspace Concepts",
    description:
      "Create/update custom concepts in workspace.conlang (matched by concept_id), or delete them by id. Core library concepts are read-only and cannot be modified.",
    toolsets: ["core", "write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...commonWriteInputFields,
      concepts: z.array(conceptSchema).optional().describe("Concepts to create or update"),
      delete_ids: z.array(z.string()).optional().describe("Custom concept ids to remove"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const wsPath = family.conlang_file_path;
      const dryRun = args.dry_run === true;

      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "concept_upsert",
        operationId: args.operation_id,
        requestPayloadForDigest: args,
        dryRun,
        requireRevisionsOnCommit: true,
        planInsideLock: () => {
          const raw = JSON.parse(fs.readFileSync(wsPath, "utf-8")) as Record<string, unknown>;
          const existing = normalizeCustomConcepts(raw.custom_concepts);
          const coreIds = new Set(CORE_CONCEPTS.map((concept) => concept.concept_id));

          const byId = new Map(existing.map((concept) => [concept.concept_id, concept]));
          const created: string[] = [];
          const updated: string[] = [];
          const rejected: { concept_id: string; reason: string }[] = [];

          for (const incoming of args.concepts ?? []) {
            if (coreIds.has(incoming.concept_id)) {
              rejected.push({
                concept_id: incoming.concept_id,
                reason: "core concept is read-only",
              });
              continue;
            }
            const prev = byId.get(incoming.concept_id);
            const merged: ConceptDefinition = {
              ...(prev ?? {}),
              ...incoming,
              concept_id: incoming.concept_id,
              gloss_en: incoming.gloss_en ?? prev?.gloss_en ?? incoming.concept_id,
              gloss_zh: incoming.gloss_zh ?? prev?.gloss_zh ?? "",
              semantic_field:
                incoming.semantic_field ?? prev?.semantic_field ?? "culture",
              standard_lists: (incoming.standard_lists ??
                prev?.standard_lists ??
                []) as ConceptDefinition["standard_lists"],
            };
            byId.set(incoming.concept_id, merged);
            if (prev) updated.push(incoming.concept_id);
            else created.push(incoming.concept_id);
          }

          const deleted: string[] = [];
          for (const id of args.delete_ids ?? []) {
            if (coreIds.has(id)) {
              rejected.push({ concept_id: id, reason: "core concept is read-only" });
              continue;
            }
            if (byId.delete(id)) deleted.push(id);
          }

          const nextConcepts = [...byId.values()].sort((a, b) =>
            a.concept_id.localeCompare(b.concept_id),
          );
          const nextRaw: WorkspaceConfig & Record<string, unknown> = {
            ...(raw as unknown as WorkspaceConfig & Record<string, unknown>),
            custom_concepts: nextConcepts,
          };

          const expectations: RevisionExpectation[] = [
            {
              label: "workspace.conlang",
              targetPath: wsPath,
              expectedRevision: args.expected_revision ?? "",
            },
          ];

          const mutations: PlannedMutation[] = [];
          if (!dryRun) {
            mutations.push({
              kind: "write_file",
              relPath: path.basename(wsPath),
              content: JSON.stringify(nextRaw, null, 2),
            });
          }

          const summary = {
            created,
            updated,
            deleted,
            rejected,
            total_custom: nextConcepts.length,
          };

          return {
            expectations,
            mutations,
            auditSummary: `concept_upsert: +${created.length} ~${updated.length} -${deleted.length}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              family_id: family.family_id,
              ...summary,
              base_revisions: baseRevisions,
              preview_concepts: nextConcepts,
            }),
            buildResponse: (newRevisions, warnings) => ({
              committed: true,
              family_id: family.family_id,
              ...summary,
              revision:
                newRevisions["workspace.conlang"] ??
                newRevisions[path.basename(wsPath)] ??
                computeFileRevision(wsPath),
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });
}

/** 未使用的占位以便未来批量导入 Concepticon 时复用校验 */
export function assertConceptWritable(conceptId: string): void {
  if (CORE_CONCEPTS.some((concept) => concept.concept_id === conceptId)) {
    throw new McpError("VALIDATION", `Concept "${conceptId}" is part of the read-only core library.`);
  }
}
