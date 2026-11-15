/**
 * concepts.ts — 概念库只读检索与工作区自定义概念写入
 *
 * 概念表挂在 `workspace.conlang` 的 `custom_concepts`，与词条的
 * `Sense.concept_id` 共同构成跨语言对齐锚点（T2.2）。
 *
 * Roadmap v3 / Pillar 4 & 5：
 * - `concept_upsert` 支持 `aliases`、`merge_from_id`（把一个自定义概念原子合并
 *   进目标概念：同一事务内移除源概念并把全语系绑定的义项 `concept_id` 重写）；
 * - 支持写入 / 删除 `lexical_gaps` 与 `primary_cognate_overrides`。
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  ConceptDefinition,
  LanguageEntry,
  LexicalGap,
  LexicalGapStatus,
  PrimaryCognateOverride,
  WorkspaceConfig,
  WordEntry,
} from "../../src/types";
import { CORE_CONCEPTS, searchConcepts } from "../../src/data/core_concepts";
import { previewMergeCustomConcepts } from "../../src/core/workflows/conceptMigration";
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
  planLexiconBucketWriteUnlocked,
  readLexiconBucketsPreserveUnknownUnlocked,
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
    aliases: z
      .array(z.string().min(1))
      .optional()
      .describe("Synonym / near-synonym aliases used for concept alignment and lexicon search"),
  })
  .passthrough();

const LEXICAL_GAP_STATUSES: [LexicalGapStatus, ...LexicalGapStatus[]] = [
  "unrecorded",
  "tbd",
  "periphrastic",
  "confirmed_absent",
];

const lexicalGapInputSchema = z.object({
  language_id: z.string().min(1),
  concept_id: z.string().min(1),
  status: z.enum(LEXICAL_GAP_STATUSES).describe(
    "unrecorded | tbd (meaning pending) | periphrastic (expressed by a phrase) | confirmed_absent",
  ),
  note: z.string().optional().describe("Phrase form or free-text note"),
});

const primaryOverrideInputSchema = z.object({
  language_id: z.string().min(1),
  concept_id: z.string().min(1),
  entry_id: z.string().min(1),
  sense_id: z.string().optional(),
  reason: z.string().optional().describe("Why this entry is the preferred primary"),
});

const gapKeyInputSchema = z.object({
  language_id: z.string().min(1),
  concept_id: z.string().min(1),
});

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

function normalizeLexicalGaps(raw: unknown): LexicalGap[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is LexicalGap =>
      !!item &&
      typeof item === "object" &&
      typeof (item as LexicalGap).language_id === "string" &&
      typeof (item as LexicalGap).concept_id === "string" &&
      typeof (item as LexicalGap).status === "string",
  );
}

function normalizePrimaryOverrides(raw: unknown): PrimaryCognateOverride[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is PrimaryCognateOverride =>
      !!item &&
      typeof item === "object" &&
      typeof (item as PrimaryCognateOverride).language_id === "string" &&
      typeof (item as PrimaryCognateOverride).concept_id === "string" &&
      typeof (item as PrimaryCognateOverride).entry_id === "string",
  );
}

function gapKey(gap: { language_id: string; concept_id: string }): string {
  return `${gap.language_id}::${gap.concept_id}`;
}

function assertLanguageExists(
  languages: readonly LanguageEntry[],
  languageId: string,
): void {
  if (!languages.some((language) => language.language_id === languageId)) {
    throw new McpError(
      "VALIDATION",
      `Unknown language_id "${languageId}" (must exist in the workspace).`,
    );
  }
}

interface MergePlan {
  nextConcepts: ConceptDefinition[];
  affectedLanguages: LanguageEntry[];
  affectedBindings: Array<{
    languageId: string;
    entryId: string;
    senseId: string;
    romanized: string;
  }>;
}

/** 计算合并后的概念表与受影响语言（在锁内执行，读到的都是最新状态） */
function planConceptMerge(params: {
  sourceConceptId: string;
  targetConceptId: string;
  conceptsAfterUpsert: ConceptDefinition[];
  languages: readonly LanguageEntry[];
  projectDir: string;
}): MergePlan {
  const { sourceConceptId, targetConceptId, conceptsAfterUpsert, languages, projectDir } =
    params;
  if (sourceConceptId === targetConceptId) {
    throw new McpError(
      "VALIDATION",
      `merge_from_id cannot equal the target concept_id ("${targetConceptId}").`,
    );
  }
  if (!conceptsAfterUpsert.some((concept) => concept.concept_id === sourceConceptId)) {
    throw new McpError(
      "VALIDATION",
      `merge_from_id "${sourceConceptId}" is not an existing custom concept.`,
    );
  }

  const wordsByLanguage: Record<string, WordEntry[]> = {};
  for (const language of languages) {
    const buckets = readLexiconBucketsPreserveUnknownUnlocked(projectDir, language);
    wordsByLanguage[language.language_id] = [...buckets.values()].flat();
  }

  const { nextConcepts, affectedBindings } = previewMergeCustomConcepts({
    sourceConceptId,
    targetConceptId,
    customConcepts: conceptsAfterUpsert,
    wordsByLanguage,
  });

  const affectedLanguageIds = new Set(affectedBindings.map((item) => item.languageId));
  const affectedLanguages = languages.filter((language) =>
    affectedLanguageIds.has(language.language_id),
  );

  return { nextConcepts, affectedLanguages, affectedBindings };
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
      "Search the built-in Swadesh-100 / Leipzig-Jakarta concept library plus the workspace's custom concepts. Supports Chinese/English gloss, concept_id, aliases and semantic-field filtering.",
    toolsets: ["core", "compute"],
    access: "read",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      query: z
        .string()
        .optional()
        .describe("Free-text query over concept_id / English gloss / Chinese gloss / aliases"),
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
    title: "Upsert, Merge or Delete Workspace Concepts",
    description:
      "Create/update custom concepts in workspace.conlang (matched by concept_id, supports aliases), or delete them by id. Core library concepts are read-only. merge_from_id atomically merges another custom concept into the (single) target concept and rewrites every lexicon sense bound to the source in the same transaction. Also upserts/removes lexical_gaps and primary_cognate_overrides.",
    toolsets: ["core", "write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...commonWriteInputFields,
      concepts: z.array(conceptSchema).optional().describe("Concepts to create or update"),
      delete_ids: z.array(z.string()).optional().describe("Custom concept ids to remove"),
      merge_from_id: z
        .string()
        .optional()
        .describe(
          "Source custom concept id to merge INTO the single concept passed via `concepts`. The source is deleted, its aliases/lists merge into the target, and all senses bound to the source are rebound to the target atomically.",
        ),
      expected_lexicon_revisions: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Optional CAS revisions per language_id for the lexicon rewrite performed by merge_from_id (obtain via dry_run: base_revisions['lexicon:<language_id>'])",
        ),
      lexical_gaps: z
        .array(lexicalGapInputSchema)
        .optional()
        .describe("Upsert lexical gap records by (language_id, concept_id)"),
      remove_lexical_gaps: z
        .array(gapKeyInputSchema)
        .optional()
        .describe("Remove lexical gap records by (language_id, concept_id)"),
      primary_cognate_overrides: z
        .array(primaryOverrideInputSchema)
        .optional()
        .describe("Upsert cognate-matrix primary overrides by (language_id, concept_id)"),
      remove_primary_cognate_overrides: z
        .array(gapKeyInputSchema)
        .optional()
        .describe("Remove primary overrides by (language_id, concept_id)"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const wsPath = family.conlang_file_path;
      const dryRun = args.dry_run === true;

      if (args.merge_from_id && (args.concepts?.length ?? 0) !== 1) {
        throw new McpError(
          "VALIDATION",
          "merge_from_id requires exactly one target concept in `concepts`.",
        );
      }

      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "concept_upsert",
        operationId: args.operation_id,
        requestPayloadForDigest: args,
        dryRun,
        // 词典重写（合并）时各语言词典修订可选；工作区修订仍强制 CAS
        requireRevisionsOnCommit: !args.merge_from_id,
        planInsideLock: () => {
          const raw = JSON.parse(fs.readFileSync(wsPath, "utf-8")) as Record<string, unknown>;
          const workspace = raw as unknown as WorkspaceConfig;
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
              aliases: incoming.aliases ?? prev?.aliases,
            };
            if (!merged.aliases || merged.aliases.length === 0) {
              delete merged.aliases;
            }
            byId.set(incoming.concept_id, merged);
            if (prev) updated.push(incoming.concept_id);
            else created.push(incoming.concept_id);
          }

          if (args.merge_from_id && rejected.length > 0) {
            throw new McpError(
              "VALIDATION",
              `Merge target cannot be a read-only core concept: ${rejected
                .map((item) => item.concept_id)
                .join(", ")}.`,
            );
          }

          const deleted: string[] = [];
          for (const id of args.delete_ids ?? []) {
            if (coreIds.has(id)) {
              rejected.push({ concept_id: id, reason: "core concept is read-only" });
              continue;
            }
            if (byId.delete(id)) deleted.push(id);
          }

          let nextConcepts = [...byId.values()].sort((a, b) =>
            a.concept_id.localeCompare(b.concept_id),
          );

          // ── merge_from_id：原子合并 + 词典义项 concept_id 重写 ──────────
          let mergeInfo:
            | {
                source_concept_id: string;
                target_concept_id: string;
                rebound_senses: number;
                affected_languages: string[];
              }
            | undefined;
          let mergePreviewBindings: MergePlan["affectedBindings"] = [];
          const lexiconMutations: PlannedMutation[] = [];
          const lexiconExpectations: RevisionExpectation[] = [];

          if (args.merge_from_id) {
            const sourceId = args.merge_from_id;
            const targetConcept = args.concepts?.[0];
            if (!targetConcept) {
              throw new McpError(
                "VALIDATION",
                "merge_from_id requires exactly one target concept in `concepts`.",
              );
            }
            const targetId = targetConcept.concept_id;
            if (sourceId === targetId) {
              throw new McpError(
                "VALIDATION",
                `merge_from_id cannot equal the target concept_id ("${targetId}").`,
              );
            }

            const mergePlan = planConceptMerge({
              sourceConceptId: sourceId,
              targetConceptId: targetId,
              conceptsAfterUpsert: nextConcepts,
              languages: workspace.languages,
              projectDir: family.project_dir,
            });

            if (!dryRun && !args.expected_revision) {
              throw new McpError(
                "REVISION_REQUIRED",
                "Missing expected revision for \"workspace.conlang\".",
                "Run with dry_run: true to obtain base_revisions, then pass expected_revision.",
                { target: "workspace.conlang", current_revision: computeFileRevision(wsPath) },
              );
            }

            nextConcepts = mergePlan.nextConcepts;
            mergePreviewBindings = mergePlan.affectedBindings;

            for (const language of mergePlan.affectedLanguages) {
              const bucketPlan = planLexiconBucketWriteUnlocked({
                projectDir: family.project_dir,
                language,
                expectedRevision:
                  args.expected_lexicon_revisions?.[language.language_id] ?? "",
                dryRun,
                operationType: "auto_snapshot",
                description: `MCP concept_upsert merge (${sourceId} -> ${targetId})`,
                batchSize: mergePlan.affectedBindings.length,
                mutateBuckets: (buckets) => {
                  const dirtyBuckets = new Set<string>();
                  let changedCount = 0;
                  for (const [bucketName, words] of buckets.entries()) {
                    let bucketDirty = false;
                    for (const word of words) {
                      for (const sense of word.senses) {
                        if (sense.concept_id !== sourceId) continue;
                        sense.concept_id = targetId;
                        changedCount += 1;
                        bucketDirty = true;
                      }
                    }
                    if (bucketDirty) dirtyBuckets.add(bucketName);
                  }
                  return { dirtyBuckets, changedCount };
                },
              });
              bucketPlan.expectation.label = `lexicon:${language.language_id}`;
              lexiconExpectations.push(bucketPlan.expectation);
              lexiconMutations.push(...bucketPlan.mutations);
            }

            mergeInfo = {
              source_concept_id: sourceId,
              target_concept_id: targetId,
              rebound_senses: mergePlan.affectedBindings.length,
              affected_languages: mergePlan.affectedLanguages.map(
                (language) => language.language_id,
              ),
            };
          }

          // ── lexical_gaps / primary_cognate_overrides 写入 ──────────────
          const gapsUpserted: string[] = [];
          const gapsRemoved: string[] = [];
          const overridesUpserted: string[] = [];
          const overridesRemoved: string[] = [];

          const nextGaps = new Map(
            normalizeLexicalGaps(raw.lexical_gaps).map((gap) => [gapKey(gap), { ...gap }]),
          );
          for (const gap of args.lexical_gaps ?? []) {
            assertLanguageExists(workspace.languages, gap.language_id);
            nextGaps.set(gapKey(gap), {
              language_id: gap.language_id,
              concept_id: gap.concept_id,
              status: gap.status,
              ...(gap.note !== undefined ? { note: gap.note } : {}),
              updated_at: new Date().toISOString(),
            });
            gapsUpserted.push(gapKey(gap));
          }
          for (const key of args.remove_lexical_gaps ?? []) {
            assertLanguageExists(workspace.languages, key.language_id);
            if (nextGaps.delete(gapKey(key))) gapsRemoved.push(gapKey(key));
          }

          const nextOverrides = new Map(
            normalizePrimaryOverrides(raw.primary_cognate_overrides).map((override) => [
              gapKey(override),
              { ...override },
            ]),
          );
          for (const override of args.primary_cognate_overrides ?? []) {
            assertLanguageExists(workspace.languages, override.language_id);
            nextOverrides.set(gapKey(override), { ...override });
            overridesUpserted.push(gapKey(override));
          }
          for (const key of args.remove_primary_cognate_overrides ?? []) {
            assertLanguageExists(workspace.languages, key.language_id);
            if (nextOverrides.delete(gapKey(key))) overridesRemoved.push(gapKey(key));
          }

          const nextRaw: WorkspaceConfig & Record<string, unknown> = {
            ...(raw as unknown as WorkspaceConfig & Record<string, unknown>),
            custom_concepts: nextConcepts,
          };
          if (nextGaps.size > 0) {
            nextRaw.lexical_gaps = [...nextGaps.values()];
          } else {
            delete nextRaw.lexical_gaps;
          }
          if (nextOverrides.size > 0) {
            nextRaw.primary_cognate_overrides = [...nextOverrides.values()];
          } else {
            delete nextRaw.primary_cognate_overrides;
          }

          const expectations: RevisionExpectation[] = [
            {
              label: "workspace.conlang",
              targetPath: wsPath,
              expectedRevision: args.expected_revision ?? "",
            },
            ...lexiconExpectations,
          ];

          const mutations: PlannedMutation[] = [];
          if (!dryRun) {
            mutations.push({
              kind: "write_file",
              relPath: path.basename(wsPath),
              content: JSON.stringify(nextRaw, null, 2),
            });
            mutations.push(...lexiconMutations);
          }

          const summary = {
            created,
            updated,
            deleted,
            rejected,
            total_custom: nextConcepts.length,
            ...(mergeInfo ? { merged: mergeInfo } : {}),
            lexical_gaps: {
              upserted: gapsUpserted.length,
              removed: gapsRemoved.length,
            },
            primary_cognate_overrides: {
              upserted: overridesUpserted.length,
              removed: overridesRemoved.length,
            },
          };

          return {
            expectations,
            mutations,
            auditSummary: `concept_upsert: +${created.length} ~${updated.length} -${deleted.length}${
              mergeInfo ? ` merge(${mergeInfo.rebound_senses} senses)` : ""
            }`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              family_id: family.family_id,
              ...summary,
              base_revisions: baseRevisions,
              preview_concepts: nextConcepts,
              ...(mergeInfo ? { preview_merged_bindings: mergePreviewBindings } : {}),
            }),
            buildResponse: (newRevisions, warnings) => ({
              committed: true,
              family_id: family.family_id,
              ...summary,
              revision:
                newRevisions["workspace.conlang"] ??
                newRevisions[path.basename(wsPath)] ??
                computeFileRevision(wsPath),
              ...(mergeInfo?.affected_languages?.length
                ? {
                    lexicon_revisions: Object.fromEntries(
                      mergeInfo.affected_languages.map((languageId) => [
                        languageId,
                        newRevisions[`lexicon:${languageId}`] ?? "",
                      ]),
                    ),
                  }
                : {}),
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
