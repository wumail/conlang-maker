import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { newPrefixedId, nowIso } from "../../src/core/lexicon/ids";
import {
  autoGloss,
  mergeAutoGlossIntoCorpus,
  type AutoGlossScopeMode,
} from "../../src/core/workflows/autoGloss";
import { findWordConcordance } from "../../src/core/engines/concordance";
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

/** reanalyze_selected 下被重算的人工 token 预览项（Roadmap v3 / Pillar 2） */
interface ReplacedProtectedToken {
  line_id: string;
  token_id: string;
  surface: string;
  before_gloss: string;
  after_gloss: string;
}

/**
 * 将最新 autoGloss 结果非破坏性合并回语料（与 UI 侧 `mergeAutoGlossIntoCorpus` 同一不变量）：
 * 任何模式下 100% 保留既有 `line.translation`；新行（全新语料 / 追加句子）完整生成；磁盘未知字段原样保留。
 */
function mergeFreshGlossLines(params: {
  corpus: CorpusText | null;
  freshLines: GlossedLine[];
  mode: AutoGlossScopeMode;
  selectedLineIds: Set<string>;
  preserveTranslations: boolean;
  rawPrevLines: Record<string, unknown>[];
}): { nextLines: GlossedLine[]; replacedProtectedTokens: ReplacedProtectedToken[] } {
  const { corpus, freshLines, mode, selectedLineIds, preserveTranslations } = params;
  const freshById = new Map(freshLines.map((line) => [line.line_id, line]));
  const stampAutoTokens = (line: GlossedLine): GlossedLine => ({
    ...line,
    tokens: line.tokens.map((token) => ({
      ...token,
      status:
        token.status ??
        (token.gloss_labels.trim() || token.linked_entry_id.trim() ? "auto" : undefined),
    })),
  });

  if (!corpus) {
    return {
      nextLines: freshLines.map(stampAutoTokens),
      replacedProtectedTokens: [],
    };
  }

  const merged = mergeAutoGlossIntoCorpus({
    corpus,
    freshLines,
    mode,
    selectedLineIds,
  });

  const rawById = new Map(
    params.rawPrevLines.map((raw) => [String(raw.line_id ?? ""), raw]),
  );

  // 新行（含 original_text 追加的句子行）已由 mergeAutoGlossIntoCorpus 以 freshLines 为主序列生成
  const nextLines = merged.nextLines.map((line) => {
    const raw = rawById.get(line.line_id) ?? {};
    const translation = preserveTranslations
      ? line.translation
      : (freshById.get(line.line_id)?.translation ?? "");
    return {
      ...raw,
      ...line,
      translation,
    } as unknown as GlossedLine;
  });

  return {
    nextLines,
    replacedProtectedTokens: merged.replacedProtectedTokens.map((item) => ({
      line_id: item.lineId,
      token_id: item.tokenId,
      surface: item.surface,
      before_gloss: item.beforeGloss,
      after_gloss: item.afterGloss,
    })),
  };
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
    linked_sense_id: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Exact sense binding inside the linked entry (disambiguates polysemy). Pass null or \"\" to clear the binding.",
      ),
    status: z
      .union([z.enum(["auto", "edited", "verified"]), z.literal("")])
      .nullable()
      .optional()
      .describe(
        "Annotation provenance: auto = machine-produced, edited = human-modified, verified = explicitly locked against auto-overwrite. Pass null or \"\" to clear the status.",
      ),
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
      linked_sense_id,
      status,
      ipa,
      ...extra
    } = tok;
    const merged: Record<string, unknown> = {
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
    };

    // 显式传 null / "" 表示清空旧值；完全省略则沿用磁盘上的旧值
    const nextSenseId =
      linked_sense_id === undefined
        ? prevSenseId(prev)
        : linked_sense_id === null || linked_sense_id === ""
          ? undefined
          : linked_sense_id;
    if (nextSenseId === undefined) {
      delete merged.linked_sense_id;
    } else {
      merged.linked_sense_id = nextSenseId;
    }

    const nextStatus =
      status === undefined
        ? typeof prev.status === "string"
          ? prev.status
          : undefined
        : status === null || status === ""
          ? undefined
          : status;
    if (nextStatus === undefined) {
      delete merged.status;
    } else {
      merged.status = nextStatus;
    }

    return merged as unknown as GlossToken;
  });
}

function prevSenseId(prev: Record<string, unknown>): string | undefined {
  return typeof prev.linked_sense_id === "string" ? prev.linked_sense_id : undefined;
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
      "Run automatic morphological & lexical interlinear glossing on raw text or an existing corpus_id. Merging is non-destructive: mode fill_empty (default) only fills blank tokens, recompute_auto refreshes machine tokens, reanalyze_selected force-recomputes selected_line_ids and reports replaced_protected_tokens. line.translation is always preserved. Defaults to read-only preview (apply: false); when apply: true, writes updated glossed_lines and auto_gloss_report to <corpus_id>.json and corpus_index.json.",
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
      mode: z
        .enum(["fill_empty", "recompute_auto", "reanalyze_selected"])
        .optional()
        .describe(
          "Non-destructive merge scope: fill_empty (default) only fills blank tokens, recompute_auto also refreshes auto tokens but never touches edited/verified ones, reanalyze_selected force-recomputes only selected_line_ids and reports replaced protected tokens.",
        ),
      selected_line_ids: z
        .array(z.string())
        .optional()
        .describe("Line ids targeted by mode: reanalyze_selected (ignored by other modes)."),
    },
    handler: async (args) => {
      const apply = Boolean(args.apply);
      const dryRun = Boolean(args.dry_run);
      const preserveTranslations = args.preserve_line_translations ?? true;
      const mode: AutoGlossScopeMode = args.mode ?? "fill_empty";
      const selectedLineIds = new Set(args.selected_line_ids ?? []);

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

        const merged = mergeFreshGlossLines({
          corpus: snapshot.existingCorpus?.corpus ?? null,
          freshLines: result.lines,
          mode,
          selectedLineIds,
          preserveTranslations,
          rawPrevLines: [],
        });
        const mergedLines = merged.nextLines;

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
          mode,
          glossed_lines: mergedLines,
          replaced_protected_tokens: merged.replacedProtectedTokens,
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

          const mergedGloss = mergeFreshGlossLines({
            corpus: loaded.corpus,
            freshLines: glossed.lines,
            mode,
            selectedLineIds,
            preserveTranslations,
            rawPrevLines: prevRawLines,
          });
          const nextLines: GlossedLine[] = mergedGloss.nextLines;
          const replacedProtectedTokens = mergedGloss.replacedProtectedTokens;

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
              mode,
              report: glossed.report,
              pending_suggestions: pendingFormatted,
              glossed_lines: nextLines,
              replaced_protected_tokens: replacedProtectedTokens,
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
                mode,
                report: glossed.report,
                pending_suggestions: pendingFormatted,
                replaced_protected_tokens: replacedProtectedTokens,
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

  // ── 6. corpus_concordance ────────────────────────────────────────────────
  registerDefinedTool(server, config, {
    name: "corpus_concordance",
    title: "Find Corpus Occurrences of a Lexicon Entry",
    description:
      "Reverse-index a lexicon entry across every corpus text of a language. Matches explicit token links, morpheme stems, and known inflected forms (with homograph protection for tokens linked to other entries).",
    toolsets: ["core", "compute"],
    access: "read",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      entry_id: z
        .string()
        .optional()
        .describe("Lexicon entry id to trace (required unless word_romanized is given)"),
      word_romanized: z
        .string()
        .optional()
        .describe("Romanized form used to resolve the entry when entry_id is omitted"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Maximum returned matches (default 200); total always reports the full count"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      const snapshot = await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "corpus_concordance",
        () => {
          const resolved = resolveLanguageUnlocked(family, args);
          const lex = readLexiconUnlocked(family.project_dir, resolved.language);
          const phono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            resolved.language,
          );
          const grammar = readGrammarUnlocked(family.project_dir, resolved.language);
          const idx = readCorpusIndexUnlocked(family.project_dir, resolved.language);
          const texts: CorpusText[] = [];
          for (const entry of idx.entries) {
            // 索引里可能存在孤立项（<corpus_id>.json 已被删/改名）：跳过而不是让整次查询崩溃
            try {
              texts.push(
                readCorpusTextUnlocked(
                  family.project_dir,
                  resolved.language,
                  entry.corpus_id,
                ).corpus,
              );
            } catch (err) {
              console.warn(
                `Skipping unreadable corpus "${entry.corpus_id}" in corpus_concordance:`,
                err,
              );
            }
          }
          return { resolved, lex, phono, grammar, idx, texts };
        },
      );

      const rawEntryId = args.entry_id?.trim();
      const rawRomanized = args.word_romanized?.trim().toLowerCase();
      if (!rawEntryId && !rawRomanized) {
        throw new McpError(
          "VALIDATION",
          "corpus_concordance requires either entry_id or word_romanized.",
        );
      }

      const entry = snapshot.lex.words.find((word) => {
        if (rawEntryId) return word.entry_id === rawEntryId;
        return word.con_word_romanized.trim().toLowerCase() === rawRomanized;
      });
      if (!entry) {
        throw new McpError("NOT_FOUND", "No lexicon entry matches the given selector.");
      }

      const result = findWordConcordance({
        entry,
        corpusTexts: snapshot.texts,
        grammar: snapshot.grammar.config,
        phono: snapshot.phono.config,
        limit: args.limit,
      });

      return {
        family_id: family.family_id,
        language_id: snapshot.resolved.language.language_id,
        entry_id: entry.entry_id,
        word_romanized: entry.con_word_romanized,
        matches: result.matches,
        total: result.total,
        corpus_texts_scanned: snapshot.texts.length,
        dependencies: {
          lexicon: snapshot.lex.revision,
          "corpus_index.json": snapshot.idx.revision,
          "phonology.json": snapshot.phono.revision,
          "grammar.json": snapshot.grammar.revision,
        },
      };
    },
  });
}
