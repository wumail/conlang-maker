import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { auditFontCoverage } from "../../src/core/engines/coverage";
import {
  charactersOf,
  formatCodepoint,
  unicodeBlockId,
} from "../../src/core/engines/unicodeBlocks";
import type {
  CorpusText,
  GlyphAnnotation,
  GlyphKind,
  LanguageEntry,
  PhonologyConfig,
} from "../../src/types";
import {
  assertDestructiveAllowed,
  assertWriteAllowed,
  type McpConfig,
} from "../config";
import { McpError } from "../errors";
import {
  loadFontFromBytes,
  loadFontFromFile,
  MAX_FONT_BYTES,
} from "../font/loader";
import { shapeStrings, shapeText } from "../font/shaper";
import type { LayoutOptions, LoadedFontHandle } from "../font/types";
import {
  assertPathAllowed,
  resolveLanguage,
} from "../registry/addressing";
import {
  findOwnFontFile,
  listLanguageFontStatusesUnlocked,
  readCorpusIndexUnlocked,
  readCorpusTextUnlocked,
  readLexiconUnlocked,
  readPhonologyUnlocked,
  readWorkspaceUnlocked,
  resolveFontFileUnlocked,
  withConsistentProjectRead,
} from "../storage/read";
import { computeFileRevision, MISSING_REVISION } from "../storage/revision";
import {
  planLanguageSnapshot,
  planProjectSnapshot,
} from "../storage/snapshot";
import {
  executeProjectTransaction,
  type PlannedMutation,
  type RevisionExpectation,
} from "../storage/transaction";
import { registerDefinedTool } from "../toolRegistry";
import { paginate } from "../util/paging";
import {
  commonWriteInputFields,
  familyInputFields,
  languageInputFields,
  normalizeRelPathPosix,
  planPhonologyWriteUnlocked,
  resolveFamilyFromArgs,
  resolveLanguageUnlocked,
} from "./_helpers";

function requireOperationIdOnCommit(
  operationId: string | undefined,
  dryRun?: boolean,
): string | undefined {
  if (!dryRun && (!operationId || !operationId.trim())) {
    throw new McpError(
      "VALIDATION",
      "operation_id is required when committing writes (omit only for dry_run: true).",
      "Provide a unique client-generated operation_id or preview first with dry_run: true.",
    );
  }
  return operationId?.trim();
}

export function buildAncestorChain(
  languages: readonly LanguageEntry[],
  startLanguageId: string,
): { language_id: string; name: string; path: string }[] {
  const byId = new Map(languages.map((l) => [l.language_id, l]));
  const chain: { language_id: string; name: string; path: string }[] = [];
  const seen = new Set<string>();
  let cur: string | null = startLanguageId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const entry = byId.get(cur);
    if (!entry) break;
    chain.push({
      language_id: entry.language_id,
      name: entry.name,
      path: entry.path,
    });
    cur = entry.parent_id ?? null;
  }
  return chain;
}

function parseCodepointValue(raw: number | string): number {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0 || raw > 0x10ffff) {
      throw new McpError(
        "VALIDATION",
        `Invalid Unicode codepoint ${raw}: expected integer in 0..0x10FFFF.`,
      );
    }
    return raw;
  }
  const trimmed = raw.trim();
  const hexMatch = /^(?:U\+|0x)([0-9a-fA-F]{1,6})$/.exec(trimmed);
  if (hexMatch) {
    const val = Number.parseInt(hexMatch[1], 16);
    if (val >= 0 && val <= 0x10ffff) return val;
  }
  const cps = charactersOf(trimmed);
  if (cps.length === 1) {
    const cp = cps[0].codePointAt(0);
    if (cp !== undefined) return cp;
  }
  throw new McpError(
    "VALIDATION",
    `Invalid codepoint "${raw}". Pass an integer, "U+XXXX" hex string, or a single Unicode character.`,
  );
}

function validateAndReadCandidateFont(
  rawSourcePath: string,
  config: McpConfig,
): {
  allowedPath: string;
  ext: ".ttf" | ".otf";
  targetFileName: "font.ttf" | "font.otf";
  oppositeFileName: "font.otf" | "font.ttf";
  bytes: Buffer;
} {
  const allowedPath = assertPathAllowed(rawSourcePath.trim(), config);
  if (!fs.existsSync(allowedPath) || !fs.statSync(allowedPath).isFile()) {
    throw new McpError("NOT_FOUND", `Source font file not found: ${rawSourcePath}`);
  }
  const extLower = path.extname(allowedPath).toLowerCase();
  if (extLower !== ".ttf" && extLower !== ".otf") {
    throw new McpError(
      "VALIDATION",
      `Unsupported font extension "${extLower}" for "${rawSourcePath}". Only .ttf and .otf are supported.`,
    );
  }
  const stat = fs.statSync(allowedPath);
  if (stat.size > MAX_FONT_BYTES) {
    throw new McpError(
      "VALIDATION",
      `Font file "${rawSourcePath}" exceeds 20 MiB (${stat.size} bytes).`,
    );
  }
  const bytes = fs.readFileSync(allowedPath);
  const ext = extLower as ".ttf" | ".otf";
  return {
    allowedPath,
    ext,
    targetFileName: ext === ".otf" ? "font.otf" : "font.ttf",
    oppositeFileName: ext === ".otf" ? "font.ttf" : "font.otf",
    bytes,
  };
}

function loadCorporaUnlocked(
  projectDir: string,
  language: LanguageEntry,
): CorpusText[] {
  const idx = readCorpusIndexUnlocked(projectDir, language);
  const corpora: CorpusText[] = [];
  for (const item of idx.entries) {
    try {
      corpora.push(
        readCorpusTextUnlocked(projectDir, language, item.corpus_id).corpus,
      );
    } catch (err) {
      console.warn(
        `[conlang-mcp] Skipping missing corpus ${item.corpus_id}:`,
        err,
      );
    }
  }
  return corpora;
}

async function computeLigatureClosures(
  handle: LoadedFontHandle,
  phonology?: PhonologyConfig,
): Promise<
  {
    sequence: string;
    nominal_gids: number[];
    shaped_gids: number[];
    shaped_glyph_names: (string | null)[];
    ligature_formed: boolean;
    substituted: boolean;
  }[]
> {
  if (!phonology) return [];
  const multiCharSet = new Set<string>();
  for (const map of phonology.romanization_maps) {
    for (const rule of map.rules) {
      const norm = (rule.input ?? "").normalize("NFC");
      if (charactersOf(norm).length > 1) {
        multiCharSet.add(norm);
        if (multiCharSet.size >= 100) break;
      }
    }
    if (multiCharSet.size >= 100) break;
  }

  const closures: {
    sequence: string;
    nominal_gids: number[];
    shaped_gids: number[];
    shaped_glyph_names: (string | null)[];
    ligature_formed: boolean;
    substituted: boolean;
  }[] = [];

  for (const seq of Array.from(multiCharSet).sort()) {
    const cps = charactersOf(seq).map((c) => c.codePointAt(0) ?? 0);
    if (cps.some((cp) => !handle.unicodes.has(cp))) {
      continue;
    }
    const nominalGids = cps.map((cp) => handle.nominalGlyph(cp) ?? 0);
    const shaped = await shapeText(handle, seq);
    const shapedGids = shaped.glyphs.map((g) => g.gid);
    const ligatureFormed =
      shaped.glyphs.some(
        (g) => !g.is_notdef && g.codepoint_span[1] - g.codepoint_span[0] > 1,
      ) ||
      (cps.length > 1 && shapedGids.length < cps.length && !shaped.has_notdef);
    const substituted =
      shapedGids.length !== nominalGids.length ||
      shapedGids.some((gid, i) => gid !== nominalGids[i]);

    if (ligatureFormed || substituted) {
      closures.push({
        sequence: seq,
        nominal_gids: nominalGids,
        shaped_gids: shapedGids,
        shaped_glyph_names: shaped.glyphs.map((g) => g.name),
        ligature_formed: ligatureFormed,
        substituted,
      });
    }
  }

  return closures;
}

export function registerFontsWritingTools(
  server: McpServer,
  config: McpConfig,
): void {
  // 1. font_list
  registerDefinedTool(server, config, {
    name: "font_list",
    title: "List Language Font Status Across Family",
    description:
      "Lists font status (own, inherited, or none) for every language in the family, including own file revision and resolved ancestor font owner and revision.",
    toolsets: ["core", "audit"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      return await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "font_list",
        () => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const statuses = listLanguageFontStatusesUnlocked(
            family.project_dir,
            ws.config.languages,
          );
          const langById = new Map(
            ws.config.languages.map((l) => [l.language_id, l]),
          );

          let ownCount = 0;
          let inheritedCount = 0;
          let noneCount = 0;
          const distinctRevs = new Set<string>();

          const languages = statuses.map((s) => {
            const lang = langById.get(s.language_id);
            const status = s.has_own
              ? ("own" as const)
              : s.resolved_owner_id
                ? ("inherited" as const)
                : ("none" as const);
            if (status === "own") ownCount += 1;
            else if (status === "inherited") inheritedCount += 1;
            else noneCount += 1;
            if (s.resolved_revision) {
              distinctRevs.add(s.resolved_revision);
            }

            return {
              language_id: s.language_id,
              name: lang?.name ?? s.language_id,
              path: lang?.path ?? "",
              parent_id: lang?.parent_id ?? null,
              status,
              has_own: s.has_own,
              own_file_name: s.own_file_name,
              revision: s.revision,
              resolved_owner_id: s.resolved_owner_id,
              resolved_owner_name: s.resolved_owner_name,
              resolved_file_name: s.resolved_file_name,
              resolved_revision: s.resolved_revision,
            };
          });

          return {
            family_id: family.family_id,
            name: family.name,
            workspace_revision: ws.revision,
            summary: {
              total_languages: languages.length,
              own: ownCount,
              inherited: inheritedCount,
              none: noneCount,
              distinct_font_files: distinctRevs.size,
            },
            languages,
          };
        },
      );
    },
  });

  // 2. font_inspect
  registerDefinedTool(server, config, {
    name: "font_inspect",
    title: "Inspect Resolved or Explicit Font",
    description:
      "Inspects a language's resolved font (or an explicit font_path) via HarfBuzz Wasm, returning face metadata, GSUB substitution_features, GPOS positioning_features, glyph_names_reliable, codepoint_count, Unicode block counts, cmap_ranges, paged U+XXXX codepoints, ligature_closures, revision, and resolved_revision. Throws NO_FONT if neither the language nor its ancestors have a font.",
    toolsets: ["core", "audit"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      font_path: z
        .string()
        .optional()
        .describe("Optional explicit .ttf/.otf file path to inspect"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(100)
        .describe("Page size for U+XXXX codepoints"),
      cursor: z
        .string()
        .optional()
        .describe("Pagination cursor for codepoints"),
    },
    handler: async (args) => {
      let handle: LoadedFontHandle;
      let ownRevision: string;
      let resolvedRevision: string;
      let ownerInfo: {
        source: "language" | "explicit_path";
        language_id: string | null;
        owner_language_id: string | null;
        owner_name: string | null;
        inherited: boolean;
        has_own: boolean;
        file_name: string;
      };
      let phonoForClosures: PhonologyConfig | undefined;

      if (args.font_path?.trim()) {
        const allowedPath = assertPathAllowed(args.font_path.trim(), config);
        handle = await loadFontFromFile(allowedPath);
        const fileRev = computeFileRevision(allowedPath);
        ownRevision = fileRev;
        resolvedRevision = fileRev;
        ownerInfo = {
          source: "explicit_path",
          language_id: null,
          owner_language_id: null,
          owner_name: null,
          inherited: false,
          has_own: true,
          file_name: handle.fileName,
        };

        if ((args.language ?? args.language_id)?.trim()) {
          const family = resolveFamilyFromArgs(config, args);
          phonoForClosures = await withConsistentProjectRead(
            family.project_dir,
            config.mode,
            "font_inspect_phono",
            () => {
              const resolved = resolveLanguageUnlocked(family, args);
              ownerInfo.language_id = resolved.language.language_id;
              return readPhonologyUnlocked(
                family.project_dir,
                family.conlang_file_path,
                resolved.language,
              ).config;
            },
          );
        }
      } else {
        const family = resolveFamilyFromArgs(config, args);
        const snap = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "font_inspect",
          () => {
            const ws = readWorkspaceUnlocked(family.conlang_file_path);
            const resolvedLang = resolveLanguageUnlocked(family, args);
            const ownFont = findOwnFontFile(resolvedLang.language_dir);
            const ownRev = ownFont
              ? computeFileRevision(ownFont)
              : MISSING_REVISION;
            const resolvedFont = resolveFontFileUnlocked(
              family.project_dir,
              ws.config.languages,
              resolvedLang.language.language_id,
            );
            if (!resolvedFont) {
              throw new McpError(
                "NO_FONT",
                `Language "${resolvedLang.language.name}" (${resolvedLang.language.language_id}) and its ancestors have no font installed.`,
                "Import a font with font_import or pass an explicit font_path.",
                {
                  language_id: resolvedLang.language.language_id,
                  ancestor_chain: buildAncestorChain(
                    ws.config.languages,
                    resolvedLang.language.language_id,
                  ),
                },
              );
            }
            const phono = readPhonologyUnlocked(
              family.project_dir,
              family.conlang_file_path,
              resolvedLang.language,
            );
            return { resolvedLang, ownRev, resolvedFont, phono: phono.config };
          },
        );

        handle = await loadFontFromBytes(
          snap.resolvedFont.bytes,
          snap.resolvedFont.file_name,
        );
        ownRevision = snap.ownRev;
        resolvedRevision = snap.resolvedFont.revision;
        phonoForClosures = snap.phono;
        ownerInfo = {
          source: "language",
          language_id: snap.resolvedLang.language.language_id,
          owner_language_id: snap.resolvedFont.owner_language_id,
          owner_name: snap.resolvedFont.owner_name,
          inherited: snap.resolvedFont.inherited,
          has_own: snap.resolvedFont.has_own,
          file_name: snap.resolvedFont.file_name,
        };
      }

      const unicodeBlocks: Record<string, number> = {};
      const formattedCodepoints = handle.unicodeList.map((cp) => {
        const blk = unicodeBlockId(cp);
        unicodeBlocks[blk] = (unicodeBlocks[blk] ?? 0) + 1;
        return formatCodepoint(cp);
      });

      const page = paginate(formattedCodepoints, resolvedRevision, {
        limit: args.limit,
        cursor: args.cursor,
      });

      const ligatureClosures = await computeLigatureClosures(
        handle,
        phonoForClosures,
      );

      return {
        ...ownerInfo,
        family_name: handle.familyName,
        subfamily_name: handle.subfamilyName,
        version: handle.version,
        upem: handle.upem,
        byte_length: handle.byteLength,
        sha256: handle.sha256,
        glyph_count: handle.glyphCount,
        glyph_names_reliable: handle.hasGlyphNames,
        substitution_features: handle.gsubFeatures,
        positioning_features: handle.gposFeatures,
        gsub_scripts: handle.gsubScripts,
        gpos_scripts: handle.gposScripts,
        codepoint_count: handle.unicodeList.length,
        unicode_blocks: unicodeBlocks,
        cmap_ranges: handle.cmapRanges,
        codepoints: page.items,
        next_cursor: page.next_cursor,
        ligature_closures: ligatureClosures,
        revision: ownRevision,
        resolved_revision: resolvedRevision,
      };
    },
  });

  // 3. font_shape
  registerDefinedTool(server, config, {
    name: "font_shape",
    title: "Shape Text with OpenType HarfBuzz Engine",
    description:
      "Shapes up to 200 strings through HarfBuzz Wasm using the language's resolved font (or explicit font_path) with GUI_DEFAULT_LAYOUT by default, returning glyphs (gid, glyph_name, cluster, codepoint_span, source_codepoint_span, ax, ay, dx, dy), has_notdef, and ligature_formed.",
    toolsets: ["audit", "compute"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      font_path: z
        .string()
        .optional()
        .describe("Optional explicit .ttf/.otf file path"),
      text: z.string().optional().describe("Single string to shape"),
      texts: z
        .array(z.string())
        .max(200)
        .optional()
        .describe("Batch of up to 200 strings to shape"),
      strings: z
        .array(z.string())
        .max(200)
        .optional()
        .describe("Alias for texts: batch of up to 200 strings to shape"),
      features: z
        .array(z.string())
        .optional()
        .describe(
          "OpenType feature tags/overrides (e.g. ['+ss01', '-liga']); defaults to GUI_DEFAULT_LAYOUT",
        ),
      script: z
        .string()
        .optional()
        .describe("Optional OpenType/ISO-15924 script tag override"),
      language_tag: z
        .string()
        .optional()
        .describe("Optional OpenType/BCP-47 language tag (defaults to 'en')"),
      direction: z.enum(["ltr", "rtl", "ttb", "btt"]).optional(),
      normalization: z.enum(["as_used", "NFC", "NFD", "none"]).optional(),
    },
    handler: async (args) => {
      const inputs: string[] = [];
      if (args.text !== undefined) inputs.push(args.text);
      if (args.texts !== undefined) inputs.push(...args.texts);
      if (args.strings !== undefined) inputs.push(...args.strings);
      if (inputs.length === 0) {
        throw new McpError(
          "VALIDATION",
          'Provide at least one string in "text", "texts", or "strings".',
        );
      }
      if (inputs.length > 200) {
        throw new McpError(
          "VALIDATION",
          `font_shape supports at most 200 strings per call (got ${inputs.length}).`,
        );
      }

      let handle: LoadedFontHandle;
      let resolvedRevision: string;
      let fontMeta: {
        owner_language_id: string | null;
        owner_name: string | null;
        inherited: boolean;
        file_name: string;
      };

      if (args.font_path?.trim()) {
        const allowedPath = assertPathAllowed(args.font_path.trim(), config);
        handle = await loadFontFromFile(allowedPath);
        resolvedRevision = computeFileRevision(allowedPath);
        fontMeta = {
          owner_language_id: null,
          owner_name: null,
          inherited: false,
          file_name: handle.fileName,
        };
      } else {
        const family = resolveFamilyFromArgs(config, args);
        const resolvedFont = await withConsistentProjectRead(
          family.project_dir,
          config.mode,
          "font_shape",
          () => {
            const ws = readWorkspaceUnlocked(family.conlang_file_path);
            const resolvedLang = resolveLanguageUnlocked(family, args);
            const found = resolveFontFileUnlocked(
              family.project_dir,
              ws.config.languages,
              resolvedLang.language.language_id,
            );
            if (!found) {
              throw new McpError(
                "NO_FONT",
                `Language "${resolvedLang.language.name}" (${resolvedLang.language.language_id}) and its ancestors have no font installed.`,
                "Import a font with font_import or pass an explicit font_path.",
                {
                  language_id: resolvedLang.language.language_id,
                  ancestor_chain: buildAncestorChain(
                    ws.config.languages,
                    resolvedLang.language.language_id,
                  ),
                },
              );
            }
            return found;
          },
        );
        handle = await loadFontFromBytes(
          resolvedFont.bytes,
          resolvedFont.file_name,
        );
        resolvedRevision = resolvedFont.revision;
        fontMeta = {
          owner_language_id: resolvedFont.owner_language_id,
          owner_name: resolvedFont.owner_name,
          inherited: resolvedFont.inherited,
          file_name: resolvedFont.file_name,
        };
      }

      const layoutOptions: LayoutOptions = {
        direction: args.direction,
        script: args.script,
        language: args.language_tag,
        features: args.features,
        normalization: args.normalization,
      };

      const shapedResults = await shapeStrings(handle, inputs, layoutOptions);
      const results = shapedResults.map((res) => {
        const ligatureFormed =
          res.glyphs.some(
            (g) => !g.is_notdef && g.codepoint_span[1] - g.codepoint_span[0] > 1,
          ) ||
          (res.codepoint_count > 1 &&
            res.glyphs.length < res.codepoint_count &&
            !res.has_notdef);

        return {
          input: res.input,
          shaped_input: res.shaped_input,
          codepoint_count: res.codepoint_count,
          source_codepoint_count: res.source_codepoint_count,
          cluster_unit: res.cluster_unit,
          has_notdef: res.has_notdef,
          ligature_formed: ligatureFormed,
          total_x_advance: res.total_x_advance,
          glyphs: res.glyphs.map((g) => ({
            gid: g.gid,
            glyph_name: g.name,
            cluster: g.cluster,
            codepoint_span: g.codepoint_span,
            source_codepoint_span: g.source_codepoint_span,
            source_text: g.source_text,
            ax: g.x_advance,
            ay: g.y_advance,
            dx: g.x_offset,
            dy: g.y_offset,
            is_notdef: g.is_notdef,
          })),
        };
      });

      return {
        font: {
          ...fontMeta,
          family_name: handle.familyName,
          version: handle.version,
          glyph_names_reliable: handle.hasGlyphNames,
          resolved_revision: resolvedRevision,
        },
        layout: shapedResults[0]?.layout ?? null,
        results,
      };
    },
  });

  // 4. font_import
  registerDefinedTool(server, config, {
    name: "font_import",
    title: "Import Language Font (.ttf / .otf)",
    description:
      "Validates a source .ttf or .otf font (<= 20 MiB, HarfBuzz loadable with non-empty cmap and glyph outlines), takes a font snapshot, writes <lang>/font.<ext>, and deletes any opposite .ttf/.otf file.",
    toolsets: ["write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      source_path: z
        .string()
        .min(1)
        .describe("Path to source .ttf or .otf font file"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "font_import");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const candidate = validateAndReadCandidateFont(args.source_path, config);
      const loadedCandidate = await loadFontFromBytes(
        candidate.bytes,
        candidate.targetFileName,
      );

      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "font_import",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId }) => {
          const resolved = resolveLanguageUnlocked(family, args);
          const langDir = resolved.language_dir;
          const langRel = normalizeRelPathPosix(resolved.language.path);
          const currentOwn = findOwnFontFile(langDir);

          const expectation: RevisionExpectation = {
            label: "font",
            targetPath: currentOwn ?? path.join(langDir, candidate.targetFileName),
            expectedRevision: args.expected_revision ?? "",
          };

          const snap = planLanguageSnapshot({
            projectDir: family.project_dir,
            language: resolved.language,
            scope: "font",
            origin: "mcp",
            operationType: "auto_snapshot",
            description: `Before importing ${candidate.targetFileName} into '${resolved.language.name}'`,
          });

          const mutations: PlannedMutation[] = [
            ...snap.mutations,
            {
              kind: "write_file",
              relPath: `${langRel}/${candidate.targetFileName}`,
              content: candidate.bytes,
            },
          ];

          const oppositeAbs = path.join(langDir, candidate.oppositeFileName);
          if (fs.existsSync(oppositeAbs)) {
            mutations.push({
              kind: "delete_path",
              relPath: `${langRel}/${candidate.oppositeFileName}`,
            });
          }

          return {
            expectations: [expectation],
            mutations,
            languageId: resolved.language.language_id,
            snapshotId: snap.snapshotId,
            auditSummary: `Imported ${candidate.targetFileName} (${loadedCandidate.familyName ?? "unnamed"}) into ${resolved.language.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              target_file: `${langRel}/${candidate.targetFileName}`,
              previous_own_file: currentOwn ? path.basename(currentOwn) : null,
              font_info: {
                family_name: loadedCandidate.familyName,
                version: loadedCandidate.version,
                glyph_count: loadedCandidate.glyphCount,
                codepoint_count: loadedCandidate.unicodeList.length,
                substitution_features: loadedCandidate.gsubFeatures,
                positioning_features: loadedCandidate.gposFeatures,
              },
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => {
              const writtenRev = computeFileRevision(
                path.join(langDir, candidate.targetFileName),
              );
              const finalRevisions = { ...newRevisions, font: writtenRev };
              return {
                operation_id: operationId,
                committed: true,
                changed: true,
                language_id: resolved.language.language_id,
                file_name: candidate.targetFileName,
                family_name: loadedCandidate.familyName,
                version: loadedCandidate.version,
                codepoint_count: loadedCandidate.unicodeList.length,
                snapshot_id: snap.snapshotId,
                revision: writtenRev,
                revisions: finalRevisions,
                summary: `Imported ${candidate.targetFileName} into '${resolved.language.name}'.`,
                warnings: warnings.length > 0 ? warnings : undefined,
              };
            },
          };
        },
      });
    },
  });

  // 5. font_import_batch
  const batchImportItemSchema = z.object({
    language: z.string().min(1).describe("Target language ID, name, or path"),
    source_path: z.string().min(1).describe("Source .ttf or .otf file path"),
  });

  registerDefinedTool(server, config, {
    name: "font_import_batch",
    title: "Batch Import Fonts Across Languages",
    description:
      "Imports multiple { language, source_path } font files in a single atomic project transaction. When dry_run: true, computes before/after font coverage summaries (auditFontCoverage) comparing candidate fonts against current resolved fonts.",
    toolsets: ["write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      imports: z
        .array(batchImportItemSchema)
        .min(1)
        .max(100)
        .optional()
        .describe("List of { language, source_path } items to import"),
      mapping: z
        .record(z.string(), z.string())
        .optional()
        .describe("Alternative { [language]: source_path } map"),
      expected_revisions: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional map of revisions from dry_run base_revisions"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "font_import_batch");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);

      const rawItems: { language: string; source_path: string }[] = [
        ...(args.imports ?? []),
        ...Object.entries(args.mapping ?? {}).map(([language, source_path]) => ({
          language,
          source_path,
        })),
      ];

      if (rawItems.length === 0) {
        throw new McpError(
          "VALIDATION",
          'Provide at least one font import in "imports" or "mapping".',
        );
      }
      if (rawItems.length > 100) {
        throw new McpError(
          "VALIDATION",
          `Batch size ${rawItems.length} exceeds maximum of 100.`,
        );
      }

      // Validate and pre-parse all candidate fonts via HarfBuzz before acquiring lock
      const prepared = await Promise.all(
        rawItems.map(async (item) => {
          const fileData = validateAndReadCandidateFont(
            item.source_path,
            config,
          );
          const handle = await loadFontFromBytes(
            fileData.bytes,
            fileData.targetFileName,
          );
          return {
            languageQuery: item.language,
            sourcePath: item.source_path,
            ...fileData,
            handle,
          };
        }),
      );

      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "font_import_batch",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: async ({ operationId }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const seenLangIds = new Set<string>();

          const resolvedTargets = prepared.map((item) => {
            const resolvedLang = resolveLanguage(family, item.languageQuery, {
              workspace: ws.config,
              revision: ws.revision,
            });
            if (seenLangIds.has(resolvedLang.language.language_id)) {
              throw new McpError(
                "VALIDATION",
                `Duplicate target language "${resolvedLang.language.language_id}" in font_import_batch.`,
              );
            }
            seenLangIds.add(resolvedLang.language.language_id);
            return {
              ...item,
              language: resolvedLang.language,
              langDir: resolvedLang.language_dir,
              langRel: normalizeRelPathPosix(resolvedLang.language.path),
            };
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

          for (const tgt of resolvedTargets) {
            const fontLabel = `font:${tgt.language.language_id}`;
            if (args.dry_run || args.expected_revisions?.[fontLabel]) {
              const curOwn = findOwnFontFile(tgt.langDir);
              expectations.push({
                label: fontLabel,
                targetPath:
                  curOwn ?? path.join(tgt.langDir, tgt.targetFileName),
                expectedRevision: args.expected_revisions?.[fontLabel] ?? "",
              });
            }
          }

          let dryRunComparisons:
            | {
                language_id: string;
                language_name: string;
                target_file: string;
                old_font: {
                  present: boolean;
                  inherited: boolean;
                  owner_language_id: string | null;
                  file_name: string | null;
                  family_name: string | null;
                };
                new_font: {
                  file_name: string;
                  family_name: string | null;
                  version: string | null;
                  codepoint_count: number;
                };
                coverage_before: ReturnType<typeof auditFontCoverage>["summary"] | null;
                coverage_after: ReturnType<typeof auditFontCoverage>["summary"];
                missing_delta: number | null;
              }[]
            | undefined;

          if (args.dry_run) {
            dryRunComparisons = [];
            const currentFontCache = new Map<string, LoadedFontHandle>();

            for (const tgt of resolvedTargets) {
              const phono = readPhonologyUnlocked(
                family.project_dir,
                family.conlang_file_path,
                tgt.language,
              );
              const lex = readLexiconUnlocked(family.project_dir, tgt.language);
              const corpora = loadCorporaUnlocked(
                family.project_dir,
                tgt.language,
              );
              const effPhono = phono.effective_config ?? phono.config;

              const curResolved = resolveFontFileUnlocked(
                family.project_dir,
                ws.config.languages,
                tgt.language.language_id,
              );

              let beforeSummary:
                | ReturnType<typeof auditFontCoverage>["summary"]
                | null = null;
              let oldFamilyName: string | null = null;

              if (curResolved) {
                let curHandle = currentFontCache.get(curResolved.revision);
                if (!curHandle) {
                  curHandle = await loadFontFromBytes(
                    curResolved.bytes,
                    curResolved.file_name,
                  );
                  currentFontCache.set(curResolved.revision, curHandle);
                }
                oldFamilyName = curHandle.familyName;
                beforeSummary = auditFontCoverage({
                  phonology: effPhono,
                  words: lex.words,
                  corpora,
                  cmap: curHandle.unicodes,
                }).summary;
              }

              const afterSummary = auditFontCoverage({
                phonology: effPhono,
                words: lex.words,
                corpora,
                cmap: tgt.handle.unicodes,
              }).summary;

              dryRunComparisons.push({
                language_id: tgt.language.language_id,
                language_name: tgt.language.name,
                target_file: `${tgt.langRel}/${tgt.targetFileName}`,
                old_font: curResolved
                  ? {
                      present: true,
                      inherited: curResolved.inherited,
                      owner_language_id: curResolved.owner_language_id,
                      file_name: curResolved.file_name,
                      family_name: oldFamilyName,
                    }
                  : {
                      present: false,
                      inherited: false,
                      owner_language_id: null,
                      file_name: null,
                      family_name: null,
                    },
                new_font: {
                  file_name: tgt.targetFileName,
                  family_name: tgt.handle.familyName,
                  version: tgt.handle.version,
                  codepoint_count: tgt.handle.unicodeList.length,
                },
                coverage_before: beforeSummary,
                coverage_after: afterSummary,
                missing_delta:
                  beforeSummary !== null
                    ? afterSummary.missing - beforeSummary.missing
                    : null,
              });
            }
          }

          const snap = planProjectSnapshot({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            workspace: ws.config,
            origin: "mcp",
            operationType: "batch_font",
            description: `Before batch importing ${resolvedTargets.length} font(s)`,
          });

          const mutations: PlannedMutation[] = [...snap.mutations];
          for (const tgt of resolvedTargets) {
            mutations.push({
              kind: "write_file",
              relPath: `${tgt.langRel}/${tgt.targetFileName}`,
              content: tgt.bytes,
            });
            const oppositeAbs = path.join(tgt.langDir, tgt.oppositeFileName);
            if (fs.existsSync(oppositeAbs)) {
              mutations.push({
                kind: "delete_path",
                relPath: `${tgt.langRel}/${tgt.oppositeFileName}`,
              });
            }
          }

          return {
            expectations,
            mutations,
            snapshotId: snap.snapshotId,
            auditSummary: `Batch imported ${resolvedTargets.length} font(s): ${resolvedTargets.map((t) => t.language.language_id).join(", ")}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              count: resolvedTargets.length,
              comparisons: dryRunComparisons ?? [],
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => {
              const fontRevs: Record<string, string> = {};
              const imported = resolvedTargets.map((tgt) => {
                const rev = computeFileRevision(
                  path.join(tgt.langDir, tgt.targetFileName),
                );
                fontRevs[`font:${tgt.language.language_id}`] = rev;
                return {
                  language_id: tgt.language.language_id,
                  language_name: tgt.language.name,
                  file_name: tgt.targetFileName,
                  family_name: tgt.handle.familyName,
                  revision: rev,
                };
              });
              return {
                operation_id: operationId,
                committed: true,
                changed: true,
                snapshot_id: snap.snapshotId,
                imported_count: imported.length,
                imported,
                revision: newRevisions.workspace,
                revisions: { ...newRevisions, ...fontRevs },
                summary: `Batch imported ${imported.length} font file(s).`,
                warnings: warnings.length > 0 ? warnings : undefined,
              };
            },
          };
        },
      });
    },
  });

  // 6. glyph_annotations_upsert
  const glyphAnnotationInputSchema = z
    .object({
      codepoint: z
        .union([z.number().int().min(0).max(0x10ffff), z.string().min(1)])
        .describe("Unicode codepoint integer (e.g. 57344), 'U+E000', or single char"),
      label: z.string().describe("Reference label or glyph name"),
      kind: z
        .enum(["base", "vowel", "carrier", "mark", "punctuation"])
        .optional()
        .describe("Optional structural glyph category"),
      phonemes: z
        .array(z.string())
        .optional()
        .describe("Optional associated phoneme tokens"),
    })
    .passthrough();

  registerDefinedTool(server, config, {
    name: "glyph_annotations_upsert",
    title: "Upsert Local Glyph Annotations",
    description:
      "Upserts GlyphAnnotation entries by codepoint onto local_config.glyph_annotations, preserving unknown fields per codepoint. When annotations_source is currently 'inherited' and inherit_base !== false, seeds local_config with inherited ancestor annotations before applying upserts so inherited entries are preserved locally.",
    toolsets: ["write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      annotations: z
        .array(glyphAnnotationInputSchema)
        .min(1)
        .max(1000)
        .describe("Glyph annotations to insert or update by codepoint"),
      inherit_base: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "If true (default) and local_config currently inherits glyph_annotations from an ancestor, copy ancestor annotations into local_config before applying upserts; set false to start local_config with only the specified annotations",
        ),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "glyph_annotations_upsert");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const parsedItems = args.annotations.map((item) => ({
        raw: item,
        codepoint: parseCodepointValue(item.codepoint),
      }));

      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "glyph_annotations_upsert",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId, warnings }) => {
          const resolved = resolveLanguageUnlocked(family, args);
          let seededFromAncestor: string | null = null;
          let insertedCount = 0;
          let updatedCount = 0;

          const plan = planPhonologyWriteUnlocked({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            language: resolved.language,
            operationId,
            expectedRevision: args.expected_revision,
            dryRun: args.dry_run,
            batchSize: parsedItems.length,
            description: `Upsert ${parsedItems.length} glyph annotation(s) in '${resolved.language.name}'`,
            buildNextLocalConfig: (currentLocal, phonoLoad) => {
              const next = structuredClone(currentLocal);
              const localExisting = next.glyph_annotations ?? [];

              let working: GlyphAnnotation[];
              if (
                localExisting.length === 0 &&
                phonoLoad.annotations_source === "inherited" &&
                args.inherit_base !== false
              ) {
                working = structuredClone(
                  phonoLoad.effective_config?.glyph_annotations ?? [],
                );
                seededFromAncestor = phonoLoad.annotations_owner_id ?? null;
              } else {
                working = structuredClone(localExisting);
              }

              const byCp = new Map<number, GlyphAnnotation>();
              for (const existing of working) {
                byCp.set(existing.codepoint, existing);
              }

              for (const { raw, codepoint } of parsedItems) {
                const prev = byCp.get(codepoint);
                const mergedRecord: Record<string, unknown> = {
                  ...((prev ?? {}) as Record<string, unknown>),
                  ...(raw as Record<string, unknown>),
                  codepoint,
                  label: raw.label,
                };
                if (raw.kind !== undefined) {
                  mergedRecord.kind = raw.kind as GlyphKind;
                }
                if (raw.phonemes !== undefined) {
                  if (raw.phonemes.length > 0) {
                    mergedRecord.phonemes = raw.phonemes;
                  } else {
                    delete mergedRecord.phonemes;
                  }
                }

                if (prev) {
                  updatedCount += 1;
                } else {
                  insertedCount += 1;
                }
                byCp.set(codepoint, mergedRecord as unknown as GlyphAnnotation);
              }

              next.glyph_annotations = Array.from(byCp.values()).sort(
                (a, b) => a.codepoint - b.codepoint,
              );
              return next;
            },
          });

          warnings.push(...plan.warnings);
          if (seededFromAncestor) {
            warnings.push(
              `Seeded local glyph_annotations from inherited ancestor "${seededFromAncestor}" (pass inherit_base: false to avoid seeding).`,
            );
          }

          return {
            expectations: [plan.expectation],
            mutations: plan.mutations,
            languageId: resolved.language.language_id,
            snapshotId: plan.snapshotId,
            auditSummary: `Upserted glyph_annotations in ${resolved.language.language_id} (${insertedCount} inserted, ${updatedCount} updated)`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              inserted_count: insertedCount,
              updated_count: updatedCount,
              seeded_from_ancestor: seededFromAncestor,
              total_local_annotations:
                plan.afterLocal.glyph_annotations?.length ?? 0,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, txWarnings) => ({
              operation_id: operationId,
              committed: true,
              changed: true,
              language_id: resolved.language.language_id,
              inserted_count: insertedCount,
              updated_count: updatedCount,
              seeded_from_ancestor: seededFromAncestor,
              total_local_annotations:
                plan.afterLocal.glyph_annotations?.length ?? 0,
              snapshot_id: plan.snapshotId,
              revision: newRevisions["phonology.json"],
              revisions: newRevisions,
              summary: `Upserted glyph annotations in '${resolved.language.name}': ${insertedCount} inserted, ${updatedCount} updated.`,
              warnings: txWarnings.length > 0 ? txWarnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 7. glyph_annotations_delete
  registerDefinedTool(server, config, {
    name: "glyph_annotations_delete",
    title: "Delete Local Glyph Annotations",
    description:
      "Deletes specified Unicode codepoints from local_config.glyph_annotations.",
    toolsets: ["write"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      codepoints: z
        .array(z.union([z.number().int().min(0).max(0x10ffff), z.string().min(1)]))
        .min(1)
        .max(1000)
        .describe("Codepoints to remove from local_config.glyph_annotations"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "glyph_annotations_delete");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const targetCpSet = new Set(args.codepoints.map(parseCodepointValue));
      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "glyph_annotations_delete",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId, warnings }) => {
          const resolved = resolveLanguageUnlocked(family, args);
          const deletedCps: number[] = [];
          const missingCps: number[] = [];
          let inheritedOwnerOnEmpty: string | null = null;

          const plan = planPhonologyWriteUnlocked({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            language: resolved.language,
            operationId,
            expectedRevision: args.expected_revision,
            dryRun: args.dry_run,
            batchSize: targetCpSet.size,
            description: `Delete ${targetCpSet.size} glyph annotation(s) in '${resolved.language.name}'`,
            buildNextLocalConfig: (currentLocal, phonoLoad) => {
              const next = structuredClone(currentLocal);
              const existing = next.glyph_annotations ?? [];
              const existingSet = new Set(existing.map((a) => a.codepoint));

              for (const cp of targetCpSet) {
                if (existingSet.has(cp)) {
                  deletedCps.push(cp);
                } else {
                  missingCps.push(cp);
                }
              }

              if (
                existing.length === 0 &&
                phonoLoad.annotations_source === "inherited"
              ) {
                inheritedOwnerOnEmpty = phonoLoad.annotations_owner_id ?? null;
              }

              const remaining = existing.filter(
                (a) => !targetCpSet.has(a.codepoint),
              );
              if (remaining.length > 0) {
                next.glyph_annotations = remaining;
              } else {
                delete next.glyph_annotations;
              }
              return next;
            },
          });

          warnings.push(...plan.warnings);
          if (inheritedOwnerOnEmpty) {
            warnings.push(
              `local_config has no local glyph_annotations; annotations are currently inherited from "${inheritedOwnerOnEmpty}".`,
            );
          }

          return {
            expectations: [plan.expectation],
            mutations: deletedCps.length > 0 ? plan.mutations : [],
            languageId: resolved.language.language_id,
            snapshotId: deletedCps.length > 0 ? plan.snapshotId : null,
            auditSummary: `Deleted ${deletedCps.length} glyph annotation(s) from ${resolved.language.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              deleted_codepoints: deletedCps.map(formatCodepoint),
              not_found_codepoints: missingCps.map(formatCodepoint),
              remaining_local_count:
                plan.afterLocal.glyph_annotations?.length ?? 0,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, txWarnings) => ({
              operation_id: operationId,
              committed: true,
              changed: deletedCps.length > 0,
              language_id: resolved.language.language_id,
              deleted_count: deletedCps.length,
              deleted_codepoints: deletedCps.map(formatCodepoint),
              not_found_codepoints: missingCps.map(formatCodepoint),
              remaining_local_count:
                plan.afterLocal.glyph_annotations?.length ?? 0,
              snapshot_id: deletedCps.length > 0 ? plan.snapshotId : null,
              revision: newRevisions["phonology.json"],
              revisions: newRevisions,
              summary: `Deleted ${deletedCps.length} local glyph annotation(s) from '${resolved.language.name}'.`,
              warnings: txWarnings.length > 0 ? txWarnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 8. glyph_annotations_sync_parent
  registerDefinedTool(server, config, {
    name: "glyph_annotations_sync_parent",
    title: "Sync Glyph Annotations from Nearest Ancestor",
    description:
      "Copies the nearest ancestor's glyph_annotations into local_config.glyph_annotations using mode 'merge_missing' or 'replace'.",
    toolsets: ["write", "evolution"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      mode: z
        .enum(["replace", "merge_missing"])
        .default("merge_missing")
        .describe(
          "'merge_missing' adds ancestor codepoints absent locally; 'replace' overwrites local_config.glyph_annotations with ancestor annotations",
        ),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "glyph_annotations_sync_parent");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "glyph_annotations_sync_parent",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId, warnings }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const resolved = resolveLanguageUnlocked(family, args);

          if (!resolved.language.parent_id) {
            throw new McpError(
              "VALIDATION",
              `Language "${resolved.language.name}" (${resolved.language.language_id}) is a root language and has no parent to sync from.`,
            );
          }

          const parentEntry = ws.config.languages.find(
            (l) => l.language_id === resolved.language.parent_id,
          );
          if (!parentEntry) {
            throw new McpError(
              "NOT_FOUND",
              `Parent language "${resolved.language.parent_id}" not found in workspace.`,
            );
          }

          const parentPhono = readPhonologyUnlocked(
            family.project_dir,
            family.conlang_file_path,
            parentEntry,
          );
          const ancestorAnnots =
            parentPhono.effective_config?.glyph_annotations ?? [];
          const sourceAncestorId =
            parentPhono.annotations_owner_id ?? parentEntry.language_id;

          if (ancestorAnnots.length === 0) {
            throw new McpError(
              "NOT_FOUND",
              `Neither parent "${parentEntry.name}" nor any higher ancestor has glyph_annotations to sync.`,
            );
          }

          let addedCount = 0;
          let replacedTotal = 0;

          const plan = planPhonologyWriteUnlocked({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            language: resolved.language,
            operationId,
            expectedRevision: args.expected_revision,
            dryRun: args.dry_run,
            batchSize: ancestorAnnots.length,
            description: `Sync glyph_annotations (${args.mode}) from '${sourceAncestorId}' into '${resolved.language.name}'`,
            buildNextLocalConfig: (currentLocal) => {
              const next = structuredClone(currentLocal);
              if (args.mode === "replace") {
                next.glyph_annotations = structuredClone(ancestorAnnots).sort(
                  (a, b) => a.codepoint - b.codepoint,
                );
                replacedTotal = next.glyph_annotations.length;
                return next;
              }

              const byCp = new Map<number, GlyphAnnotation>();
              for (const loc of next.glyph_annotations ?? []) {
                byCp.set(loc.codepoint, loc);
              }
              for (const anc of ancestorAnnots) {
                if (!byCp.has(anc.codepoint)) {
                  byCp.set(anc.codepoint, structuredClone(anc));
                  addedCount += 1;
                }
              }
              next.glyph_annotations = Array.from(byCp.values()).sort(
                (a, b) => a.codepoint - b.codepoint,
              );
              return next;
            },
          });

          warnings.push(...plan.warnings);

          return {
            expectations: [plan.expectation],
            mutations: plan.mutations,
            languageId: resolved.language.language_id,
            snapshotId: plan.snapshotId,
            auditSummary: `Synced glyph_annotations (${args.mode}) from ${sourceAncestorId} into ${resolved.language.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              source_ancestor_id: sourceAncestorId,
              mode: args.mode,
              added_count: addedCount,
              replaced_total: replacedTotal,
              total_local_annotations:
                plan.afterLocal.glyph_annotations?.length ?? 0,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, txWarnings) => ({
              operation_id: operationId,
              committed: true,
              changed: args.mode === "replace" || addedCount > 0,
              language_id: resolved.language.language_id,
              source_ancestor_id: sourceAncestorId,
              mode: args.mode,
              added_count: addedCount,
              total_local_annotations:
                plan.afterLocal.glyph_annotations?.length ?? 0,
              snapshot_id: plan.snapshotId,
              revision: newRevisions["phonology.json"],
              revisions: newRevisions,
              summary:
                args.mode === "replace"
                  ? `Replaced local glyph_annotations in '${resolved.language.name}' with ${replacedTotal} annotation(s) from '${sourceAncestorId}'.`
                  : `Merged ${addedCount} missing glyph annotation(s) from '${sourceAncestorId}' into '${resolved.language.name}'.`,
              warnings: txWarnings.length > 0 ? txWarnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 9. font_clear
  registerDefinedTool(server, config, {
    name: "font_clear",
    title: "Clear Language's Own Font",
    description:
      "Deletes a language's own font.ttf / font.otf after taking a font snapshot, falling back to any inherited ancestor font. Destructive: requires --mode write+destructive and confirm: true.",
    toolsets: ["admin", "write"],
    access: "destructive",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to commit destructive font removal"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertDestructiveAllowed(
        config,
        "font_clear",
        args.confirm,
        args.dry_run,
      );
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "font_clear",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const resolved = resolveLanguageUnlocked(family, args);
          const langDir = resolved.language_dir;
          const langRel = normalizeRelPathPosix(resolved.language.path);
          const ownFont = findOwnFontFile(langDir);

          const fallback = resolved.language.parent_id
            ? resolveFontFileUnlocked(
                family.project_dir,
                ws.config.languages,
                resolved.language.parent_id,
              )
            : null;
          const fallbackSummary = fallback
            ? {
                owner_language_id: fallback.owner_language_id,
                owner_name: fallback.owner_name,
                file_name: fallback.file_name,
                revision: fallback.revision,
              }
            : null;

          const expectation: RevisionExpectation = {
            label: "font",
            targetPath: ownFont ?? path.join(langDir, "font.otf"),
            expectedRevision: args.expected_revision ?? "",
          };

          const mutations: PlannedMutation[] = [];
          let snapshotId: string | null = null;

          if (ownFont) {
            const snap = planLanguageSnapshot({
              projectDir: family.project_dir,
              language: resolved.language,
              scope: "font",
              origin: "mcp",
              operationType: "auto_snapshot",
              description: `Before clearing own font (${path.basename(ownFont)}) from '${resolved.language.name}'`,
            });
            snapshotId = snap.snapshotId;
            mutations.push(...snap.mutations);

            for (const fname of ["font.otf", "font.ttf"]) {
              if (fs.existsSync(path.join(langDir, fname))) {
                mutations.push({
                  kind: "delete_path",
                  relPath: `${langRel}/${fname}`,
                });
              }
            }
          }

          return {
            expectations: [expectation],
            mutations,
            languageId: resolved.language.language_id,
            snapshotId,
            auditSummary: ownFont
              ? `Cleared own font (${path.basename(ownFont)}) from ${resolved.language.language_id}`
              : `No own font present on ${resolved.language.language_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language_id: resolved.language.language_id,
              had_own_font: ownFont !== null,
              cleared_file: ownFont ? path.basename(ownFont) : null,
              fallback_font: fallbackSummary,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed: ownFont !== null,
              language_id: resolved.language.language_id,
              cleared_file: ownFont ? path.basename(ownFont) : null,
              fallback_font: fallbackSummary,
              snapshot_id: snapshotId,
              revision: MISSING_REVISION,
              revisions: { ...newRevisions, font: MISSING_REVISION },
              summary: ownFont
                ? `Cleared own font ${path.basename(ownFont)} from '${resolved.language.name}'` +
                  (fallbackSummary
                    ? `; now inherits ${fallbackSummary.file_name} from '${fallbackSummary.owner_name}'.`
                    : "; language now has no font.")
                : `Language '${resolved.language.name}' already had no own font.`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });
}
