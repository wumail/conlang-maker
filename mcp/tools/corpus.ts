import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { newPrefixedId, nowIso } from "../../src/core/lexicon/ids";
import { autoGloss } from "../../src/core/workflows/autoGloss";
import type {
  CorpusIndexEntry,
  CorpusText,
  GlossedLine,
  GlossToken,
} from "../../src/types";
import {
  assertDestructiveAllowed,
  assertWriteAllowed,
  type McpConfig,
} from "../config";
import { McpError } from "../errors";
import { assertSafeRelativeLanguagePath } from "../registry/addressing";
import {
  readCorpusIndexUnlocked,
  readCorpusTextUnlocked,
  readGrammarUnlocked,
  readLexiconUnlocked,
  readPhonologyUnlocked,
  withConsistentProjectRead,
} from "../storage/read";
import { computeFileRevision, MISSING_REVISION } from "../storage/revision";
import {
  markSessionScopeWritten,
  planLanguageSnapshot,
  shouldAutoSnapshot,
} from "../storage/snapshot";
import {
  executeProjectTransaction,
  type PlannedMutation,
  type RevisionExpectation,
} from "../storage/transaction";
import { registerDefinedTool } from "../toolRegistry";
import { computeStructuralDiff } from "../util/diff";
import { projectArrayFields, projectFields } from "../util/fields";
import { paginate } from "../util/paging";
import {
  commonWriteInputFields,
  familyInputFields,
  languageInputFields,
  normalizeRelPathPosix,
  resolveFamilyFromArgs,
  resolveLanguageUnlocked,
} from "./_helpers";

function assertSafeCorpusId(rawId: string): string {
  const id = rawId.trim();
  if (!id) {
    throw new McpError("VALIDATION", "corpus_id must be a non-empty string.");
  }
  if (
    id === "." ||
    id === ".." ||
    id === "corpus_index" ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\0") ||
    id.includes("..")
  ) {
    throw new McpError(
      "VALIDATION",
      `Invalid corpus_id "${rawId}". Must be a single safe identifier (not "corpus_index" or a path).`,
    );
  }
  return id.endsWith(".json") ? id.slice(0, -5) : id;
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

const autoGlossReportSchema = z
  .object({
    total: z.number().int().nonnegative(),
    autoApplied: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
  })
  .passthrough();

const glossTokenInputSchema = z
  .object({
    token_id: z.string().optional(),
    surface_form: z.string(),
    morpheme_break: z.string().optional(),
    gloss_labels: z.string().optional(),
    linked_entry_id: z.string().optional(),
    ipa: z.string().optional(),
  })
  .passthrough();

const glossedLineInputSchema = z
  .object({
    line_id: z.string().optional(),
    original: z.string(),
    tokens: z.array(glossTokenInputSchema).default([]),
    translation: z.string().optional(),
  })
  .passthrough();

const corpusMetadataInputSchema = z
  .object({
    tags: z.array(z.string()).optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    auto_gloss_report: autoGlossReportSchema.nullable().optional(),
  })
  .passthrough();

const corpusObjectInputSchema = z
  .object({
    corpus_id: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    original_text: z.string().optional(),
    glossed_lines: z.array(glossedLineInputSchema).optional(),
    free_translation: z.string().optional(),
    tags: z.array(z.string()).optional(),
    metadata: corpusMetadataInputSchema.optional(),
  })
  .passthrough();

type GlossTokenInput = z.infer<typeof glossTokenInputSchema>;
type GlossedLineInput = z.infer<typeof glossedLineInputSchema>;

function mergeTokensPreservingUnknown(
  inputs: GlossTokenInput[],
  existingTokensById: Map<string, Record<string, unknown>>,
): GlossToken[] {
  return inputs.map((tok) => {
    const tokenId = tok.token_id?.trim() || newPrefixedId("tok");
    const prev = existingTokensById.get(tokenId) ?? {};
    const {
      token_id: _tid,
      surface_form,
      morpheme_break,
      gloss_labels,
      linked_entry_id,
      ipa,
      ...extra
    } = tok;
    return {
      ...prev,
      ...extra,
      token_id: tokenId,
      surface_form,
      morpheme_break:
        morpheme_break !== undefined
          ? morpheme_break
          : typeof prev.morpheme_break === "string"
            ? prev.morpheme_break
            : surface_form,
      gloss_labels:
        gloss_labels !== undefined
          ? gloss_labels
          : typeof prev.gloss_labels === "string"
            ? prev.gloss_labels
            : "",
      linked_entry_id:
        linked_entry_id !== undefined
          ? linked_entry_id
          : typeof prev.linked_entry_id === "string"
            ? prev.linked_entry_id
            : "",
      ipa:
        ipa !== undefined
          ? ipa
          : typeof prev.ipa === "string"
            ? prev.ipa
            : "",
    } as unknown as GlossToken;
  });
}

function mergeLinesPreservingUnknown(
  inputs: GlossedLineInput[],
  existingLinesById: Map<string, Record<string, unknown>>,
  existingTokensById: Map<string, Record<string, unknown>>,
): GlossedLine[] {
  return inputs.map((line) => {
    const lineId = line.line_id?.trim() || newPrefixedId("line");
    const prev = existingLinesById.get(lineId) ?? {};
    const { line_id: _lid, original, tokens, translation, ...extra } = line;
    return {
      ...prev,
      ...extra,
      line_id: lineId,
      original,
      tokens: mergeTokensPreservingUnknown(tokens, existingTokensById),
      translation:
        translation !== undefined
          ? translation
          : typeof prev.translation === "string"
            ? prev.translation
            : "",
    } as unknown as GlossedLine;
  });
}

function readRawIndexRecordsUnlocked(indexPath: string): Record<string, unknown>[] {
  if (!fs.existsSync(indexPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isRecord);
}

function buildUpdatedIndexPreservingUnknown(
  rawIndexEntries: Record<string, unknown>[],
  updatedCorpus: CorpusText,
): CorpusIndexEntry[] {
  let found = false;
  const nextEntries: Record<string, unknown>[] = rawIndexEntries.map((raw) => {
    if (raw.corpus_id !== updatedCorpus.corpus_id) {
      return raw;
    }
    found = true;
    const prevMeta = isRecord(raw.metadata) ? raw.metadata : {};
    const nextMeta: Record<string, unknown> = {
      ...prevMeta,
      tags: updatedCorpus.metadata.tags,
      created_at: updatedCorpus.metadata.created_at,
      updated_at: updatedCorpus.metadata.updated_at,
    };
    if (updatedCorpus.metadata.auto_gloss_report !== undefined) {
      nextMeta.auto_gloss_report = updatedCorpus.metadata.auto_gloss_report;
    }
    return {
      ...raw,
      corpus_id: updatedCorpus.corpus_id,
      title: updatedCorpus.title,
      description: updatedCorpus.description,
      metadata: nextMeta,
    };
  });

  if (!found) {
    const newMeta: Record<string, unknown> = {
      tags: updatedCorpus.metadata.tags,
      created_at: updatedCorpus.metadata.created_at,
      updated_at: updatedCorpus.metadata.updated_at,
    };
    if (updatedCorpus.metadata.auto_gloss_report !== undefined) {
      newMeta.auto_gloss_report = updatedCorpus.metadata.auto_gloss_report;
    }
    nextEntries.push({
      corpus_id: updatedCorpus.corpus_id,
      title: updatedCorpus.title,
      description: updatedCorpus.description,
      metadata: newMeta,
    });
  }

  return nextEntries as unknown as CorpusIndexEntry[];
}

export function registerCorpusTools(
  server: McpServer,
  config: McpConfig,
): void {
  // ── 1. corpus_list ───────────────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "corpus_list",
    title: "List Corpus Texts",
    description:
      "List corpus index entries for a language with optional tag/query filtering, cursor pagination bound to corpus_index.json revision, and field projection.",
    toolsets: ["core"],
    access: "read",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      tag: z
        .string()
        .optional()
        .describe("Filter corpus entries containing this exact tag (case-insensitive)"),
      query: z
        .string()
        .optional()
        .describe("Substring search across corpus_id, title, description, and tags"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Page size (default 50, max 500)"),
      cursor: z
        .string()
        .optional()
        .describe("Pagination cursor returned by a previous corpus_list call"),
      fields: z
        .array(z.string())
        .optional()
        .describe("Optional dot-path fields to project on each returned item"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      return await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "corpus_list",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const idx = readCorpusIndexUnlocked(
            family.project_dir,
            resolved.language,
          );

          let filtered = idx.entries;
          if (args.tag?.trim()) {
            const needleTag = args.tag.trim().toLowerCase();
            filtered = filtered.filter((entry) =>
              (entry.metadata?.tags ?? []).some(
                (t) => t.toLowerCase() === needleTag,
              ),
            );
          }

          if (args.query?.trim()) {
            const q = args.query.trim().toLowerCase();
            filtered = filtered.filter((entry) => {
              const inId = entry.corpus_id.toLowerCase().includes(q);
              const inTitle = (entry.title || "").toLowerCase().includes(q);
              const inDesc = (entry.description || "").toLowerCase().includes(q);
              const inTags = (entry.metadata?.tags ?? []).some((t) =>
                t.toLowerCase().includes(q),
              );
              return inId || inTitle || inDesc || inTags;
            });
          }

          const page = paginate(filtered, idx.revision, {
            limit: args.limit,
            cursor: args.cursor,
          });

          const projected = projectArrayFields(page.items, args.fields);

          return {
            family_id: family.family_id,
            language_id: resolved.language.language_id,
            items: projected,
            total: page.total,
            next_cursor: page.next_cursor,
            revision: idx.revision,
          };
        },
      );
    },
  });

  // ── 2. corpus_get ────────────────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "corpus_get",
    title: "Get Corpus Text & Glosses",
    description:
      "Read a single corpus text (<corpus_id>.json) including interlinear glossed lines, optional line-range pagination, and both file and index revisions.",
    toolsets: ["core"],
    access: "read",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      corpus_id: z.string().describe("Corpus ID to load"),
      line_offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Starting index into glossed_lines (default 0)"),
      line_limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Maximum number of glossed_lines to return"),
      fields: z
        .array(z.string())
        .optional()
        .describe("Optional dot-path fields to project on the corpus object"),
    },
    handler: async (args) => {
      const corpusId = assertSafeCorpusId(args.corpus_id);
      const family = resolveFamilyFromArgs(config, args);

      return await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "corpus_get",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const loaded = readCorpusTextUnlocked(
            family.project_dir,
            resolved.language,
            corpusId,
          );

          const allLines = Array.isArray(loaded.corpus.glossed_lines)
            ? loaded.corpus.glossed_lines
            : [];
          const totalLines = allLines.length;
          const offset = args.line_offset ?? 0;
          const slicedLines =
            args.line_limit !== undefined
              ? allLines.slice(offset, offset + args.line_limit)
              : offset > 0
                ? allLines.slice(offset)
                : allLines;
          const hasMoreLines = offset + slicedLines.length < totalLines;

          const corpusView: CorpusText = {
            ...loaded.corpus,
            glossed_lines: slicedLines,
          };

          const projected = projectFields(corpusView, args.fields);

          return {
            family_id: family.family_id,
            language_id: resolved.language.language_id,
            corpus: projected,
            total_lines: totalLines,
            line_offset: offset,
            returned_lines: slicedLines.length,
            has_more_lines: hasMoreLines,
            revision: loaded.revision,
            index_revision: loaded.index_revision,
          };
        },
      );
    },
  });

  // ── 3. corpus_save ───────────────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "corpus_save",
    title: "Save Corpus Text",
    description:
      "Create or update a corpus text (<corpus_id>.json) and atomically synchronize corpus_index.json, preserving unknown fields on CorpusText, GlossedLine, GlossToken, and CorpusIndexEntry.",
    toolsets: ["write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      ...commonWriteInputFields,
      expected_index_revision: z
        .string()
        .optional()
        .describe("Optional expected revision for corpus_index.json"),
      corpus_id: z
        .string()
        .optional()
        .describe("Corpus ID (auto-generated when omitted for a new text; pass expected_revision: 'missing')"),
      title: z.string().optional().describe("Corpus title"),
      description: z.string().optional().describe("Corpus description"),
      original_text: z.string().optional().describe("Raw conlang text"),
      glossed_lines: z
        .array(glossedLineInputSchema)
        .optional()
        .describe("Interlinear glossed lines"),
      free_translation: z.string().optional().describe("Full free translation"),
      tags: z.array(z.string()).optional().describe("Metadata tags"),
      metadata: corpusMetadataInputSchema
        .optional()
        .describe("Optional metadata overrides"),
      corpus: corpusObjectInputSchema
        .optional()
        .describe("Optional nested corpus payload (alternative to top-level fields)"),
    },
    handler: async (args) => {
      const dryRun = Boolean(args.dry_run);
      assertWriteAllowed(config, "corpus_save");
      if (!dryRun && !args.operation_id?.trim()) {
        throw new McpError(
          "VALIDATION",
          "operation_id is required when committing writes (omit only for dry_run: true).",
        );
      }

      const rawId = args.corpus_id ?? args.corpus?.corpus_id;
      const corpusId = rawId?.trim()
        ? assertSafeCorpusId(rawId)
        : newPrefixedId("corpus");

      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "corpus_save",
        operationId: args.operation_id,
        requestPayloadForDigest: args,
        dryRun,
        requireRevisionsOnCommit: true,
        planInsideLock: () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lang = resolved.language;
          const langDir = assertSafeRelativeLanguagePath(
            family.project_dir,
            lang.path,
          );
          const corpusDir = path.join(langDir, "corpus");
          const filePath = path.join(corpusDir, `${corpusId}.json`);
          const indexPath = path.join(corpusDir, "corpus_index.json");

          const existedBefore = fs.existsSync(filePath);
          let rawPrevCorpus: Record<string, unknown> = {};
          if (existedBefore) {
            rawPrevCorpus = JSON.parse(
              fs.readFileSync(filePath, "utf-8"),
            ) as Record<string, unknown>;
          }

          const existingLinesById = new Map<string, Record<string, unknown>>();
          const existingTokensById = new Map<string, Record<string, unknown>>();
          if (Array.isArray(rawPrevCorpus.glossed_lines)) {
            for (const l of rawPrevCorpus.glossed_lines) {
              if (isRecord(l) && typeof l.line_id === "string") {
                existingLinesById.set(l.line_id, l);
              }
              if (isRecord(l) && Array.isArray(l.tokens)) {
                for (const t of l.tokens) {
                  if (isRecord(t) && typeof t.token_id === "string") {
                    existingTokensById.set(t.token_id, t);
                  }
                }
              }
            }
          }

          const nested = args.corpus;
          const extraNested: Record<string, unknown> = {};
          if (nested) {
            const {
              corpus_id: _cid,
              title: _t,
              description: _d,
              original_text: _ot,
              glossed_lines: _gl,
              free_translation: _ft,
              tags: _tags,
              metadata: _meta,
              ...restNested
            } = nested;
            Object.assign(extraNested, restNested);
          }

          const inTitle = args.title ?? nested?.title;
          const inDesc = args.description ?? nested?.description;
          const inOrig = args.original_text ?? nested?.original_text;
          const inLines = args.glossed_lines ?? nested?.glossed_lines;
          const inFree = args.free_translation ?? nested?.free_translation;
          const inMeta = args.metadata ?? nested?.metadata;
          const inTags = args.tags ?? nested?.tags ?? inMeta?.tags;

          const resolvedTitle =
            inTitle !== undefined
              ? inTitle.trim()
              : typeof rawPrevCorpus.title === "string"
                ? rawPrevCorpus.title
                : "";
          if (!resolvedTitle) {
            throw new McpError(
              "VALIDATION",
              `Corpus "${corpusId}" requires a non-empty "title".`,
            );
          }

          const isoNow = nowIso();
          const prevMeta = isRecord(rawPrevCorpus.metadata)
            ? rawPrevCorpus.metadata
            : {};

          const extraMeta: Record<string, unknown> = {};
          if (inMeta) {
            const {
              tags: _mt,
              created_at: _mc,
              updated_at: _mu,
              auto_gloss_report: _mr,
              ...restMeta
            } = inMeta;
            Object.assign(extraMeta, restMeta);
          }

          const nextLines: GlossedLine[] =
            inLines !== undefined
              ? mergeLinesPreservingUnknown(
                  inLines,
                  existingLinesById,
                  existingTokensById,
                )
              : Array.isArray(rawPrevCorpus.glossed_lines)
                ? (rawPrevCorpus.glossed_lines as GlossedLine[])
                : [];

          const nextAutoGlossReport =
            inMeta?.auto_gloss_report !== undefined
              ? inMeta.auto_gloss_report
              : prevMeta.auto_gloss_report !== undefined
                ? (prevMeta.auto_gloss_report as CorpusText["metadata"]["auto_gloss_report"])
                : undefined;

          const nextMetadata: CorpusText["metadata"] & Record<string, unknown> = {
            ...prevMeta,
            ...extraMeta,
            tags:
              inTags !== undefined
                ? inTags
                : Array.isArray(prevMeta.tags)
                  ? (prevMeta.tags as string[])
                  : [],
            created_at:
              inMeta?.created_at ??
              (typeof prevMeta.created_at === "string" && prevMeta.created_at
                ? prevMeta.created_at
                : isoNow),
            updated_at: isoNow,
            ...(nextAutoGlossReport !== undefined
              ? { auto_gloss_report: nextAutoGlossReport }
              : {}),
          };

          const nextCorpus: CorpusText = {
            ...(rawPrevCorpus as unknown as CorpusText),
            ...(extraNested as unknown as Partial<CorpusText>),
            corpus_id: corpusId,
            language_id:
              typeof rawPrevCorpus.language_id === "string" &&
              rawPrevCorpus.language_id
                ? rawPrevCorpus.language_id
                : lang.language_id,
            title: resolvedTitle,
            description:
              inDesc !== undefined
                ? inDesc
                : typeof rawPrevCorpus.description === "string"
                  ? rawPrevCorpus.description
                  : "",
            original_text:
              inOrig !== undefined
                ? inOrig
                : typeof rawPrevCorpus.original_text === "string"
                  ? rawPrevCorpus.original_text
                  : "",
            glossed_lines: nextLines,
            free_translation:
              inFree !== undefined
                ? inFree
                : typeof rawPrevCorpus.free_translation === "string"
                  ? rawPrevCorpus.free_translation
                  : "",
            metadata: nextMetadata,
          };

          const rawIndexEntries = readRawIndexRecordsUnlocked(indexPath);
          const nextIndexEntries = buildUpdatedIndexPreservingUnknown(
            rawIndexEntries,
            nextCorpus,
          );

          const corpusLabel = `corpus/${corpusId}.json`;
          const expectations: RevisionExpectation[] = [
            {
              label: corpusLabel,
              targetPath: filePath,
              expectedRevision: args.expected_revision ?? "",
            },
          ];
          if (dryRun || args.expected_index_revision !== undefined) {
            expectations.push({
              label: "corpus_index.json",
              targetPath: indexPath,
              expectedRevision: args.expected_index_revision ?? "",
            });
          }

          const needSnap = shouldAutoSnapshot({
            projectDir: family.project_dir,
            languageId: lang.language_id,
            scope: "corpus",
            batchSize: Math.max(1, nextLines.length),
          });

          const mutations: PlannedMutation[] = [];
          let snapshotId: string | null = null;
          if (!dryRun && needSnap) {
            const snap = planLanguageSnapshot({
              projectDir: family.project_dir,
              language: lang,
              scope: "corpus",
              origin: "mcp",
              operationType: "auto_snapshot",
              description: `MCP corpus_save (${corpusId})`,
            });
            snapshotId = snap.snapshotId;
            mutations.push(...snap.mutations);
          }

          const langRel = normalizeRelPathPosix(lang.path);
          const fileRel = `${langRel}/corpus/${corpusId}.json`;
          const indexRel = `${langRel}/corpus/corpus_index.json`;

          mutations.push(
            {
              kind: "write_file",
              relPath: fileRel,
              content: JSON.stringify(nextCorpus, null, 2),
            },
            {
              kind: "write_file",
              relPath: indexRel,
              content: JSON.stringify(nextIndexEntries, null, 2),
            },
          );

          const diff = computeStructuralDiff(rawPrevCorpus, nextCorpus);

          return {
            expectations,
            mutations,
            languageId: lang.language_id,
            snapshotId,
            auditSummary: `${existedBefore ? "Updated" : "Created"} corpus "${corpusId}" in ${lang.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              family_id: family.family_id,
              language_id: lang.language_id,
              corpus_id: corpusId,
              created: !existedBefore,
              line_count: nextLines.length,
              would_snapshot: needSnap,
              snapshot_scope: "corpus",
              base_revisions: baseRevisions,
              diff,
              preview_corpus: nextCorpus,
            }),
            buildResponse: (newRevisions, warnings) => {
              markSessionScopeWritten(
                family.project_dir,
                lang.language_id,
                "corpus",
              );
              return {
                committed: true,
                operation_id: args.operation_id,
                family_id: family.family_id,
                language_id: lang.language_id,
                corpus_id: corpusId,
                created: !existedBefore,
                line_count: nextLines.length,
                revision:
                  newRevisions[corpusLabel] ??
                  newRevisions[fileRel] ??
                  computeFileRevision(filePath),
                index_revision:
                  newRevisions["corpus_index.json"] ??
                  newRevisions[indexRel] ??
                  computeFileRevision(indexPath),
                revisions: newRevisions,
                snapshot_id: snapshotId,
                diff,
                warnings: warnings.length > 0 ? warnings : undefined,
              };
            },
          };
        },
      });
    },
  });

  // ── 4. corpus_auto_gloss ─────────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "corpus_auto_gloss",
    title: "Auto-Gloss Corpus Text",
    description:
      "Run automatic morphological & lexical interlinear glossing on raw text or an existing corpus_id. Defaults to read-only preview (apply: false); when apply: true, writes updated glossed_lines and auto_gloss_report to <corpus_id>.json and corpus_index.json.",
    toolsets: ["compute", "write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      ...commonWriteInputFields,
      expected_index_revision: z
        .string()
        .optional()
        .describe("Optional expected revision for corpus_index.json when apply: true"),
      corpus_id: z
        .string()
        .optional()
        .describe("Existing corpus_id to gloss (required when apply: true)"),
      text: z
        .string()
        .optional()
        .describe("Raw conlang text to gloss (overrides corpus.original_text when provided)"),
      apply: z
        .boolean()
        .optional()
        .describe("If true, persist glossed_lines and report to <corpus_id>.json (default false = read-only preview)"),
      preserve_line_translations: z
        .boolean()
        .optional()
        .describe("Preserve existing per-line free translations when line text matches (default true)"),
    },
    handler: async (args) => {
      const apply = Boolean(args.apply);
      const dryRun = Boolean(args.dry_run);
      const preserveTranslations = args.preserve_line_translations ?? true;

      if (!args.corpus_id?.trim() && args.text === undefined) {
        throw new McpError(
          "VALIDATION",
          'Provide either "text" or "corpus_id" (or both) for corpus_auto_gloss.',
        );
      }

      if (!apply) {
        // Pure read-only preview mode — allowed even when server runs in --mode read-only
        const family = resolveFamilyFromArgs(config, args);
        const corpusId = args.corpus_id?.trim()
          ? assertSafeCorpusId(args.corpus_id)
          : null;

        const snapshot = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "corpus_auto_gloss",
          () => {
            const resolved = resolveLanguageUnlocked(family, args);
            const lang = resolved.language;
            const lex = readLexiconUnlocked(family.project_dir, lang);
            const gram = readGrammarUnlocked(family.project_dir, lang);
            const phono = readPhonologyUnlocked(
              family.project_dir,
              family.conlang_file_path,
              lang,
            );
            const existingCorpus = corpusId
              ? readCorpusTextUnlocked(family.project_dir, lang, corpusId)
              : null;
            return {
              languageId: lang.language_id,
              lex,
              gram,
              phono,
              existingCorpus,
            };
          },
        );

        const sourceText =
          args.text !== undefined
            ? args.text
            : snapshot.existingCorpus?.corpus.original_text ?? "";

        const prevLines = snapshot.existingCorpus?.corpus.glossed_lines ?? [];
        const result = autoGloss({
          originalText: sourceText,
          words: snapshot.lex.words,
          grammar: snapshot.gram.config,
          phono: snapshot.phono.local_config ?? snapshot.phono.config,
          createLineId: (lineIdx) =>
            prevLines[lineIdx]?.line_id || newPrefixedId("line"),
          createTokenId: () => newPrefixedId("tok"),
        });

        const mergedLines = result.lines.map((line, idx) => {
          if (!preserveTranslations) return line;
          const prevSameIndex = prevLines[idx];
          if (
            prevSameIndex &&
            prevSameIndex.original.trim() === line.original.trim() &&
            prevSameIndex.translation
          ) {
            return { ...line, translation: prevSameIndex.translation };
          }
          const byText = prevLines.find(
            (pl) =>
              pl.original.trim() === line.original.trim() &&
              Boolean(pl.translation),
          );
          return byText ? { ...line, translation: byText.translation } : line;
        });

        const pendingFormatted = result.pending.map((p) => ({
          line_id: p.lineId,
          token_id: p.tokenId,
          surface_form: p.surfaceForm,
          entry_id: p.suggestion.entry.entry_id,
          romanized: p.suggestion.entry.con_word_romanized,
          morpheme_break: p.suggestion.morphemeBreak,
          gloss_labels: p.suggestion.glossLabels,
          confidence: p.suggestion.confidence,
          score: p.suggestion.score,
          trace: p.suggestion.trace,
        }));

        return {
          preview: true,
          applied: false,
          family_id: family.family_id,
          language_id: snapshot.languageId,
          corpus_id: corpusId,
          glossed_lines: mergedLines,
          pending_suggestions: pendingFormatted,
          report: result.report,
          revision: snapshot.existingCorpus?.revision ?? null,
          index_revision: snapshot.existingCorpus?.index_revision ?? null,
          dependencies: {
            lexicon: snapshot.lex.revision,
            "grammar.json": snapshot.gram.revision,
            "phonology.json": snapshot.phono.revision,
            ...(corpusId && snapshot.existingCorpus
              ? {
                  [`corpus/${corpusId}.json`]: snapshot.existingCorpus.revision,
                  "corpus_index.json": snapshot.existingCorpus.index_revision,
                }
              : {}),
          },
        };
      }

      // Write mode (`apply: true`)
      assertWriteAllowed(config, "corpus_auto_gloss");
      if (!args.corpus_id?.trim()) {
        throw new McpError(
          "VALIDATION",
          'corpus_id is required when apply: true (or use corpus_save to create a new corpus first).',
        );
      }
      if (!dryRun && !args.operation_id?.trim()) {
        throw new McpError(
          "VALIDATION",
          "operation_id is required when committing writes (omit only for dry_run: true).",
        );
      }

      const corpusId = assertSafeCorpusId(args.corpus_id);
      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "corpus_auto_gloss",
        operationId: args.operation_id,
        requestPayloadForDigest: args,
        dryRun,
        requireRevisionsOnCommit: true,
        planInsideLock: () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lang = resolved.language;
          const langDir = assertSafeRelativeLanguagePath(
            family.project_dir,
            lang.path,
          );
          const corpusDir = path.join(langDir, "corpus");
          const filePath = path.join(corpusDir, `${corpusId}.json`);
          const indexPath = path.join(corpusDir, "corpus_index.json");

          const loaded = readCorpusTextUnlocked(
            family.project_dir,
            lang,
            corpusId,
          );
          const rawPrevCorpus = JSON.parse(
            fs.readFileSync(filePath, "utf-8"),
          ) as Record<string, unknown>;

          const lex = readLexiconUnlocked(family.project_dir, lang);
          const gram = readGrammarUnlocked(family.project_dir, lang);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            lang,
          );

          const sourceText =
            args.text !== undefined ? args.text : loaded.corpus.original_text;
          const prevLines = Array.isArray(loaded.corpus.glossed_lines)
            ? loaded.corpus.glossed_lines
            : [];
          const prevRawLines = Array.isArray(rawPrevCorpus.glossed_lines)
            ? rawPrevCorpus.glossed_lines.filter(isRecord)
            : [];

          const glossed = autoGloss({
            originalText: sourceText,
            words: lex.words,
            grammar: gram.config,
            phono: phono.local_config ?? phono.config,
            createLineId: (lineIdx) =>
              prevLines[lineIdx]?.line_id || newPrefixedId("line"),
            createTokenId: () => newPrefixedId("tok"),
          });

          const nextLines: GlossedLine[] = glossed.lines.map((line, idx) => {
            const rawPrevLine =
              prevRawLines.find((rl) => rl.line_id === line.line_id) ?? {};
            let translation = line.translation;
            if (preserveTranslations) {
              const prevSameIdx = prevLines[idx];
              if (
                prevSameIdx &&
                prevSameIdx.original.trim() === line.original.trim() &&
                prevSameIdx.translation
              ) {
                translation = prevSameIdx.translation;
              } else {
                const byText = prevLines.find(
                  (pl) =>
                    pl.original.trim() === line.original.trim() &&
                    Boolean(pl.translation),
                );
                if (byText) translation = byText.translation;
              }
            }
            return {
              ...rawPrevLine,
              ...line,
              translation,
            } as unknown as GlossedLine;
          });

          const isoNow = nowIso();
          const prevMeta = isRecord(rawPrevCorpus.metadata)
            ? rawPrevCorpus.metadata
            : {};

          const nextCorpus: CorpusText = {
            ...(rawPrevCorpus as unknown as CorpusText),
            corpus_id: corpusId,
            language_id: loaded.corpus.language_id || lang.language_id,
            original_text: sourceText,
            glossed_lines: nextLines,
            metadata: {
              ...(prevMeta as CorpusText["metadata"]),
              tags: Array.isArray(prevMeta.tags)
                ? (prevMeta.tags as string[])
                : loaded.corpus.metadata?.tags ?? [],
              created_at:
                typeof prevMeta.created_at === "string" && prevMeta.created_at
                  ? prevMeta.created_at
                  : loaded.corpus.metadata?.created_at || isoNow,
              updated_at: isoNow,
              auto_gloss_report: glossed.report,
            },
          };

          const rawIndexEntries = readRawIndexRecordsUnlocked(indexPath);
          const nextIndexEntries = buildUpdatedIndexPreservingUnknown(
            rawIndexEntries,
            nextCorpus,
          );

          const corpusLabel = `corpus/${corpusId}.json`;
          const expectations: RevisionExpectation[] = [
            {
              label: corpusLabel,
              targetPath: filePath,
              expectedRevision: args.expected_revision ?? "",
            },
          ];
          if (dryRun || args.expected_index_revision !== undefined) {
            expectations.push({
              label: "corpus_index.json",
              targetPath: indexPath,
              expectedRevision: args.expected_index_revision ?? "",
            });
          }

          const needSnap = shouldAutoSnapshot({
            projectDir: family.project_dir,
            languageId: lang.language_id,
            scope: "corpus",
            batchSize: Math.max(1, nextLines.length),
          });

          const mutations: PlannedMutation[] = [];
          let snapshotId: string | null = null;
          if (!dryRun && needSnap) {
            const snap = planLanguageSnapshot({
              projectDir: family.project_dir,
              language: lang,
              scope: "corpus",
              origin: "mcp",
              operationType: "auto_snapshot",
              description: `MCP corpus_auto_gloss (${corpusId})`,
            });
            snapshotId = snap.snapshotId;
            mutations.push(...snap.mutations);
          }

          const langRel = normalizeRelPathPosix(lang.path);
          const fileRel = `${langRel}/corpus/${corpusId}.json`;
          const indexRel = `${langRel}/corpus/corpus_index.json`;

          mutations.push(
            {
              kind: "write_file",
              relPath: fileRel,
              content: JSON.stringify(nextCorpus, null, 2),
            },
            {
              kind: "write_file",
              relPath: indexRel,
              content: JSON.stringify(nextIndexEntries, null, 2),
            },
          );

          const pendingFormatted = glossed.pending.map((p) => ({
            line_id: p.lineId,
            token_id: p.tokenId,
            surface_form: p.surfaceForm,
            entry_id: p.suggestion.entry.entry_id,
            romanized: p.suggestion.entry.con_word_romanized,
            morpheme_break: p.suggestion.morphemeBreak,
            gloss_labels: p.suggestion.glossLabels,
            confidence: p.suggestion.confidence,
            score: p.suggestion.score,
            trace: p.suggestion.trace,
          }));

          return {
            expectations,
            mutations,
            languageId: lang.language_id,
            snapshotId,
            auditSummary: `Auto-glossed corpus "${corpusId}" in ${lang.language_id} (${glossed.report.autoApplied}/${glossed.report.total} tokens applied)`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              applied: false,
              family_id: family.family_id,
              language_id: lang.language_id,
              corpus_id: corpusId,
              report: glossed.report,
              pending_suggestions: pendingFormatted,
              glossed_lines: nextLines,
              would_snapshot: needSnap,
              base_revisions: {
                ...baseRevisions,
                lexicon: lex.revision,
                "grammar.json": gram.revision,
                "phonology.json": phono.revision,
              },
            }),
            buildResponse: (newRevisions, warnings) => {
              markSessionScopeWritten(
                family.project_dir,
                lang.language_id,
                "corpus",
              );
              return {
                committed: true,
                applied: true,
                operation_id: args.operation_id,
                family_id: family.family_id,
                language_id: lang.language_id,
                corpus_id: corpusId,
                report: glossed.report,
                pending_suggestions: pendingFormatted,
                revision:
                  newRevisions[corpusLabel] ??
                  newRevisions[fileRel] ??
                  computeFileRevision(filePath),
                index_revision:
                  newRevisions["corpus_index.json"] ??
                  newRevisions[indexRel] ??
                  computeFileRevision(indexPath),
                revisions: newRevisions,
                snapshot_id: snapshotId,
                warnings: warnings.length > 0 ? warnings : undefined,
              };
            },
          };
        },
      });
    },
  });

  // ── 5. corpus_delete ─────────────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "corpus_delete",
    title: "Delete Corpus Text",
    description:
      "Destructively delete a corpus text (<corpus_id>.json) and remove it from corpus_index.json after taking a mandatory corpus snapshot. Requires --mode write+destructive and confirm: true.",
    toolsets: ["write", "admin"],
    access: "destructive",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      ...commonWriteInputFields,
      expected_index_revision: z
        .string()
        .optional()
        .describe("Optional expected revision for corpus_index.json"),
      corpus_id: z.string().describe("Corpus ID to delete"),
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to execute destructive corpus deletion"),
    },
    handler: async (args) => {
      const dryRun = Boolean(args.dry_run);
      assertDestructiveAllowed(config, "corpus_delete", args.confirm, dryRun);
      if (!dryRun && !args.operation_id?.trim()) {
        throw new McpError(
          "VALIDATION",
          "operation_id is required when committing writes (omit only for dry_run: true).",
        );
      }

      const corpusId = assertSafeCorpusId(args.corpus_id);
      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction({
        projectDir: family.project_dir,
        toolName: "corpus_delete",
        operationId: args.operation_id,
        requestPayloadForDigest: args,
        dryRun,
        requireRevisionsOnCommit: true,
        planInsideLock: () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lang = resolved.language;
          const langDir = assertSafeRelativeLanguagePath(
            family.project_dir,
            lang.path,
          );
          const corpusDir = path.join(langDir, "corpus");
          const filePath = path.join(corpusDir, `${corpusId}.json`);
          const indexPath = path.join(corpusDir, "corpus_index.json");

          if (!fs.existsSync(filePath)) {
            throw new McpError(
              "NOT_FOUND",
              `Corpus text "${corpusId}" not found in language "${lang.name}".`,
            );
          }

          const rawDeleted = JSON.parse(
            fs.readFileSync(filePath, "utf-8"),
          ) as Partial<CorpusText>;
          const rawIndexEntries = readRawIndexRecordsUnlocked(indexPath);
          const nextIndexEntries = rawIndexEntries.filter(
            (entry) => entry.corpus_id !== corpusId,
          );

          const corpusLabel = `corpus/${corpusId}.json`;
          const expectations: RevisionExpectation[] = [
            {
              label: corpusLabel,
              targetPath: filePath,
              expectedRevision: args.expected_revision ?? "",
            },
          ];
          if (dryRun || args.expected_index_revision !== undefined) {
            expectations.push({
              label: "corpus_index.json",
              targetPath: indexPath,
              expectedRevision: args.expected_index_revision ?? "",
            });
          }

          const mutations: PlannedMutation[] = [];
          let snapshotId: string | null = null;
          if (!dryRun) {
            const snap = planLanguageSnapshot({
              projectDir: family.project_dir,
              language: lang,
              scope: "corpus",
              origin: "mcp",
              operationType: "auto_snapshot",
              description: `MCP corpus_delete (${corpusId})`,
            });
            snapshotId = snap.snapshotId;
            mutations.push(...snap.mutations);
          }

          const langRel = normalizeRelPathPosix(lang.path);
          const fileRel = `${langRel}/corpus/${corpusId}.json`;
          const indexRel = `${langRel}/corpus/corpus_index.json`;

          mutations.push(
            {
              kind: "delete_path",
              relPath: fileRel,
            },
            {
              kind: "write_file",
              relPath: indexRel,
              content: JSON.stringify(nextIndexEntries, null, 2),
            },
          );

          return {
            expectations,
            mutations,
            languageId: lang.language_id,
            snapshotId,
            auditSummary: `Deleted corpus "${corpusId}" (${rawDeleted.title ?? corpusId}) from ${lang.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              family_id: family.family_id,
              language_id: lang.language_id,
              corpus_id: corpusId,
              deleted_title: rawDeleted.title ?? "",
              remaining_index_count: nextIndexEntries.length,
              would_snapshot: true,
              snapshot_scope: "corpus",
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => {
              markSessionScopeWritten(
                family.project_dir,
                lang.language_id,
                "corpus",
              );
              return {
                committed: true,
                operation_id: args.operation_id,
                family_id: family.family_id,
                language_id: lang.language_id,
                deleted_corpus_id: corpusId,
                deleted_title: rawDeleted.title ?? "",
                remaining_index_count: nextIndexEntries.length,
                revision: MISSING_REVISION,
                index_revision:
                  newRevisions["corpus_index.json"] ??
                  newRevisions[indexRel] ??
                  computeFileRevision(indexPath),
                revisions: newRevisions,
                snapshot_id: snapshotId,
                warnings: warnings.length > 0 ? warnings : undefined,
              };
            },
          };
        },
      });
    },
  });
}
