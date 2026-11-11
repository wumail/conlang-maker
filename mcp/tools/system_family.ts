import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { newLanguageId, nowIso } from "../../src/core/lexicon/ids";
import type {
  FamilyEntry,
  GlobalRegistry,
  LanguageEntry,
  MigrationStats,
  WordEntry,
  WorkspaceConfig,
} from "../../src/types";
import {
  assertDestructiveAllowed,
  assertWriteAllowed,
  type McpConfig,
} from "../config";
import { McpError } from "../errors";
import {
  assertPathAllowed,
  assertSafeRelativeLanguagePath,
  readRegistry,
  resolveFamily,
  resolveLanguage,
  updateRegistryLocked,
} from "../registry/addressing";
import { computeHostKey, isLocalPidDead } from "../storage/lock";
import {
  defaultGrammarConfig,
  defaultPhonologyConfig,
  defaultScaConfig,
  findOwnFontFile,
  isValidWordEntryCompat,
  listLanguageFontStatusesUnlocked,
  normalizeWordEntryFromRaw,
  readLexiconUnlocked,
  readPhonologyUnlocked,
  readWorkspaceUnlocked,
  resolveFontFileUnlocked,
  withConsistentProjectRead,
} from "../storage/read";
import { lookupCompletedOperation } from "../storage/recovery";
import {
  canonicalizeConlangPath,
  computeFamilyId,
  computeFileRevision,
  computeLexiconRevision,
  MISSING_REVISION,
} from "../storage/revision";
import {
  listTrashedLanguagesUnlocked,
  planProjectSnapshot,
  planTrashLanguageDelete,
  planTrashLanguageRestore,
} from "../storage/snapshot";
import {
  computeRequestDigest,
  executeProjectTransaction,
  type PlannedMutation,
  type RevisionExpectation,
} from "../storage/transaction";
import { registerDefinedTool } from "../toolRegistry";
import { projectArrayFields } from "../util/fields";
import { paginate } from "../util/paging";
import {
  bucketFilename,
  commonWriteInputFields,
  familyInputFields,
  languageInputFields,
  normalizeRelPathPosix,
  pickFamilyArg,
  resolveFamilyFromArgs,
  serializeBucketWords,
} from "./_helpers";

const LOCAL_HOST_KEY = computeHostKey();

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

function slugifyIdentifier(raw: string, fallback: string): string {
  const ascii = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || fallback;
}

function detectLiveExternalLock(projectDir: string): boolean {
  const lockDir = path.join(projectDir, ".conlang-maker", "lock");
  if (!fs.existsSync(lockDir)) return false;
  try {
    const entries = fs.readdirSync(lockDir);
    for (const file of entries) {
      const m = /^owner-([0-9a-f]{12})-(\d+)-([0-9a-f]{32})\.json$/.exec(file);
      if (!m) continue;
      const hostKey = m[1];
      const pid = Number(m[2]);
      if (pid === process.pid && hostKey === LOCAL_HOST_KEY) {
        continue;
      }
      if (hostKey !== LOCAL_HOST_KEY || !isLocalPidDead(pid)) {
        return true;
      }
    }
  } catch (err) {
    console.error("[conlang-mcp] Lock inspection warning:", err);
  }
  return false;
}

function computeLanguageDepth(
  langId: string,
  byId: ReadonlyMap<string, LanguageEntry>,
): number {
  let depth = 0;
  const seen = new Set<string>([langId]);
  let cur = byId.get(langId)?.parent_id ?? null;
  while (cur) {
    if (seen.has(cur)) break;
    const parent = byId.get(cur);
    if (!parent) break;
    seen.add(cur);
    depth += 1;
    cur = parent.parent_id ?? null;
  }
  return depth;
}

function isPathAllowedSilent(targetPath: string, config: McpConfig): boolean {
  try {
    assertPathAllowed(targetPath, config);
    return true;
  } catch {
    return false;
  }
}

function resolveConlangFileCandidate(
  rawPath: string,
  config: McpConfig,
): string {
  const abs = path.resolve(rawPath.trim());
  assertPathAllowed(abs, config);
  if (!fs.existsSync(abs)) {
    throw new McpError("NOT_FOUND", `Path does not exist: ${rawPath}`);
  }
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    if (!abs.endsWith(".conlang")) {
      throw new McpError(
        "VALIDATION",
        `Expected a .conlang workspace file, got: ${rawPath}`,
      );
    }
    const canon = canonicalizeConlangPath(abs);
    assertPathAllowed(canon, config);
    return canon;
  }
  if (stat.isDirectory()) {
    const conlangFiles = fs
      .readdirSync(abs)
      .filter((f) => f.endsWith(".conlang"))
      .sort();
    if (conlangFiles.length === 0) {
      throw new McpError(
        "NOT_FOUND",
        `Directory "${rawPath}" contains no .conlang file.`,
      );
    }
    if (conlangFiles.length > 1) {
      throw new McpError(
        "AMBIGUOUS",
        `Directory "${rawPath}" contains multiple .conlang files.`,
        "Pass the exact .conlang file path.",
        { candidates: conlangFiles.map((f) => path.join(abs, f)) },
      );
    }
    const canon = canonicalizeConlangPath(path.join(abs, conlangFiles[0]));
    assertPathAllowed(canon, config);
    return canon;
  }
  throw new McpError("VALIDATION", `Unsupported path type: ${rawPath}`);
}

function inspectWorkspaceHealth(conlangPath: string): {
  valid: boolean;
  language_count: number;
  missing_language_dirs: string[];
  error?: string;
} {
  try {
    const raw = JSON.parse(fs.readFileSync(conlangPath, "utf-8")) as Record<
      string,
      unknown
    >;
    if (!Array.isArray(raw.languages)) {
      return {
        valid: false,
        language_count: 0,
        missing_language_dirs: [],
        error: "Missing languages array in .conlang file",
      };
    }
    const projectDir = path.dirname(conlangPath);
    const missingDirs: string[] = [];
    for (const item of raw.languages) {
      if (typeof item === "object" && item !== null) {
        const lPath = (item as { path?: unknown }).path;
        if (typeof lPath === "string" && lPath.trim()) {
          const absDir = assertSafeRelativeLanguagePath(projectDir, lPath);
          if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
            missingDirs.push(lPath);
          }
        }
      }
    }
    return {
      valid: missingDirs.length === 0,
      language_count: raw.languages.length,
      missing_language_dirs: missingDirs,
    };
  } catch (err) {
    return {
      valid: false,
      language_count: 0,
      missing_language_dirs: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function collectCopyableWorkspaceFiles(sourceProjectDir: string): string[] {
  const files: string[] = [];
  const walk = (curAbs: string): void => {
    const entries = fs
      .readdirSync(curAbs, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(curAbs, entry.name);
      const rel = normalizeRelPathPosix(path.relative(sourceProjectDir, abs));
      if (!rel) continue;
      if (
        rel === ".DS_Store" ||
        rel.endsWith("/.DS_Store") ||
        rel.endsWith(".tmp") ||
        rel === ".conlang-maker/lock" ||
        rel.startsWith(".conlang-maker/lock/") ||
        rel === ".conlang-maker/transactions" ||
        rel.startsWith(".conlang-maker/transactions/")
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };
  walk(sourceProjectDir);
  return files;
}

function upsertFamilyInRegistryObject(
  current: GlobalRegistry,
  canonicalPath: string,
  displayName: string,
  setActive: boolean,
): { nextRegistry: GlobalRegistry; familyId: string; activeIndex: number | null } {
  const familyId = computeFamilyId(canonicalPath);
  const now = nowIso();
  const existingFamilies = Array.isArray(current.families) ? current.families : [];

  let matchedIndex = -1;
  const nextFamilies: FamilyEntry[] = existingFamilies.map((entry, idx) => {
    const entryCanon = canonicalizeConlangPath(entry.conlang_file_path);
    if (computeFamilyId(entryCanon) === familyId) {
      if (matchedIndex < 0) matchedIndex = idx;
      return {
        ...entry,
        name: displayName,
        conlang_file_path: canonicalPath,
        last_opened: now,
      };
    }
    return entry;
  });

  if (matchedIndex < 0) {
    matchedIndex = nextFamilies.length;
    nextFamilies.push({
      name: displayName,
      conlang_file_path: canonicalPath,
      last_opened: now,
    });
  }

  const nextActive = setActive
    ? matchedIndex
    : current.active_family_index ?? (nextFamilies.length === 1 ? 0 : null);

  return {
    nextRegistry: {
      ...current,
      registry_version: current.registry_version || "1.0",
      families: nextFamilies,
      active_family_index: nextActive,
    },
    familyId,
    activeIndex: nextActive,
  };
}

export function registerSystemFamilyTools(
  server: McpServer,
  config: McpConfig,
): void {
  // 1. server_info
  registerDefinedTool(server, config, {
    name: "server_info",
    title: "Get MCP Server Info",
    description:
      "Returns conlang-mcp server version, permission mode, enabled toolsets, registry path, default family, allowed root directories, and whether active lock owners are detected.",
    toolsets: ["core"],
    access: "read",
    alwaysRegister: true,
    inputSchema: {},
    handler: () => {
      let guiDetected = false;
      try {
        const snap = readRegistry(config);
        guiDetected = snap.families.some(
          (f) =>
            f.exists &&
            isPathAllowedSilent(f.conlang_file_path, config) &&
            detectLiveExternalLock(f.project_dir),
        );
      } catch (err) {
        console.error("[conlang-mcp] server_info registry probe warning:", err);
      }

      return {
        name: "conlang-maker-mcp",
        version: config.version,
        mode: config.mode,
        toolsets: Array.from(config.toolsets).sort(),
        registry_path: config.registryPath,
        default_family: config.defaultFamily ?? null,
        allow_roots: config.allowRoots,
        gui_detected: guiDetected,
      };
    },
  });

  // 2. family_list
  registerDefinedTool(server, config, {
    name: "family_list",
    title: "List Registered Language Families",
    description:
      "Lists all language families registered in registry.json with stable family_id, path, active status, existence check, language_count, and registry_revision.",
    toolsets: ["core"],
    access: "read",
    inputSchema: {
      include_missing: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include registry entries whose .conlang file is missing on disk"),
    },
    handler: (args) => {
      const snap = readRegistry(config);
      const items = snap.families
        .filter((f) => args.include_missing || f.exists)
        .map((f) => {
          const allowed = isPathAllowedSilent(f.conlang_file_path, config);
          const health =
            f.exists && allowed
              ? inspectWorkspaceHealth(f.conlang_file_path)
              : {
                  valid: false,
                  language_count: 0,
                  missing_language_dirs: [] as string[],
                };
          return {
            family_id: f.family_id,
            name: f.name,
            conlang_file_path: f.conlang_file_path,
            project_dir: f.project_dir,
            active: f.is_active,
            is_active: f.is_active,
            last_opened: f.last_opened,
            exists: f.exists,
            allowed,
            valid: f.exists && allowed && health.valid,
            language_count: health.language_count,
            missing_language_dirs: health.missing_language_dirs,
          };
        });

      return {
        registry_revision: snap.registry_revision,
        total: items.length,
        families: items,
      };
    },
  });

  // 3. family_get_tree
  registerDefinedTool(server, config, {
    name: "family_get_tree",
    title: "Get Language Family Tree",
    description:
      "Reads a language family's topology (.conlang), returning workspace revision and each language's parent/children IDs, tree depth, lexicon word count, directory timestamps, and font inheritance status.",
    toolsets: ["core"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      include_word_counts: z
        .boolean()
        .optional()
        .default(true)
        .describe("Compute valid lexicon word count per language"),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      return await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "family_get_tree",
        () => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const byId = new Map<string, LanguageEntry>(
            ws.config.languages.map((l) => [l.language_id, l]),
          );
          const fontStatuses = listLanguageFontStatusesUnlocked(
            family.project_dir,
            ws.config.languages,
          );
          const fontByLangId = new Map(
            fontStatuses.map((s) => [s.language_id, s]),
          );

          const languages = ws.config.languages.map((lang) => {
            const childrenIds = ws.config.languages
              .filter((c) => c.parent_id === lang.language_id)
              .map((c) => c.language_id);
            const depth = computeLanguageDepth(lang.language_id, byId);
            const langDir = assertSafeRelativeLanguagePath(
              family.project_dir,
              lang.path,
            );
            const dirExists =
              fs.existsSync(langDir) && fs.statSync(langDir).isDirectory();

            let createdAt: string | null = null;
            let updatedAt: string | null = null;
            if (dirExists) {
              const st = fs.statSync(langDir);
              createdAt = new Date(st.birthtimeMs || st.ctimeMs).toISOString();
              updatedAt = new Date(st.mtimeMs).toISOString();
            }

            const wordCount =
              args.include_word_counts && dirExists
                ? readLexiconUnlocked(family.project_dir, lang).words.length
                : 0;

            const fsEntry = fontByLangId.get(lang.language_id);
            const fontStatus = fsEntry
              ? {
                  status: fsEntry.has_own
                    ? ("own" as const)
                    : fsEntry.resolved_owner_id
                      ? ("inherited" as const)
                      : ("none" as const),
                  has_own: fsEntry.has_own,
                  own_file_name: fsEntry.own_file_name,
                  revision: fsEntry.revision,
                  resolved_owner_id: fsEntry.resolved_owner_id,
                  resolved_owner_name: fsEntry.resolved_owner_name,
                  resolved_file_name: fsEntry.resolved_file_name,
                  resolved_revision: fsEntry.resolved_revision,
                }
              : {
                  status: "none" as const,
                  has_own: false,
                  own_file_name: null,
                  revision: MISSING_REVISION,
                  resolved_owner_id: null,
                  resolved_owner_name: null,
                  resolved_file_name: null,
                  resolved_revision: null,
                };

            return {
              ...lang,
              language_id: lang.language_id,
              name: lang.name,
              path: lang.path,
              parent_id: lang.parent_id ?? null,
              children_ids: childrenIds,
              depth,
              dir_exists: dirExists,
              word_count: wordCount,
              created_at: createdAt,
              updated_at: updatedAt,
              font_status: fontStatus,
            };
          });

          return {
            family_id: family.family_id,
            name: family.name,
            project_dir: family.project_dir,
            conlang_file_path: family.conlang_file_path,
            workspace_version: ws.config.workspace_version,
            revision: ws.revision,
            languages,
          };
        },
      );
    },
  });

  // 4. language_fork
  registerDefinedTool(server, config, {
    name: "language_fork",
    title: "Fork Daughter Language",
    description:
      "Derives a new daughter language from a parent language: snapshots the project, copies phonology and grammar (updating language_id and preserving unknown fields), initializes empty sca_rules.json, evolves lexicon entries (origin_type='evolved', parent_entry_id, source_language_id), copies corpus if present, and appends the LanguageEntry to .conlang.",
    toolsets: ["write", "evolution"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      parent: z
        .string()
        .optional()
        .describe("Parent language ID, name, or relative path"),
      parent_id: z.string().optional().describe("Alias for parent"),
      new_name: z
        .string()
        .min(1)
        .describe("Display name for the newly forked language"),
      new_id: z
        .string()
        .optional()
        .describe("Optional explicit language_id (auto-generated if omitted)"),
      new_path: z
        .string()
        .optional()
        .describe("Optional relative directory path inside the workspace"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "language_fork");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const parentQuery = (args.parent ?? args.parent_id)?.trim();
      if (!parentQuery) {
        throw new McpError(
          "VALIDATION",
          'Missing required parameter "parent" (or "parent_id").',
        );
      }

      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "language_fork",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const rawWsObj = JSON.parse(
            fs.readFileSync(family.conlang_file_path, "utf-8"),
          ) as Record<string, unknown>;

          const parentResolved = resolveLanguage(family, parentQuery, {
            workspace: ws.config,
            revision: ws.revision,
          });
          const parentLang = parentResolved.language;
          const parentDir = parentResolved.language_dir;

          let newId = args.new_id?.trim() || newLanguageId();
          if (/[/\\]/.test(newId)) {
            throw new McpError(
              "VALIDATION",
              `Invalid language_id "${newId}": must not contain path separators.`,
            );
          }
          if (!args.new_id) {
            while (ws.config.languages.some((l) => l.language_id === newId)) {
              newId = `${newLanguageId()}_${Math.random().toString(36).slice(2, 5)}`;
            }
          } else if (ws.config.languages.some((l) => l.language_id === newId)) {
            throw new McpError(
              "CONFLICT",
              `Language ID "${newId}" already exists in workspace.`,
            );
          }

          const defaultRel = slugifyIdentifier(args.new_name, newId);
          const newRel = normalizeRelPathPosix(
            args.new_path?.trim() || defaultRel,
          );
          if (!newRel) {
            throw new McpError(
              "VALIDATION",
              "new_path resolved to an empty relative path.",
            );
          }
          const newAbsDir = assertSafeRelativeLanguagePath(
            family.project_dir,
            newRel,
          );

          if (
            ws.config.languages.some(
              (l) => normalizeRelPathPosix(l.path) === newRel,
            ) ||
            fs.existsSync(newAbsDir)
          ) {
            throw new McpError(
              "CONFLICT",
              `Language path "${newRel}" is already in use inside the workspace.`,
              "Pass an explicit unused new_path.",
            );
          }

          const snap = planProjectSnapshot({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            workspace: ws.config,
            origin: "mcp",
            operationType: "fork_language",
            description: `Before forking '${args.new_name.trim()}' (${newId}) from '${parentLang.name}'`,
          });

          const mutations: PlannedMutation[] = [...snap.mutations];
          mutations.push({ kind: "create_dir", relPath: newRel });

          // 1. Copy phonology.json preserving unknown fields
          const parentPhonoPath = path.join(parentDir, "phonology.json");
          const childPhonoObj: Record<string, unknown> = fs.existsSync(
            parentPhonoPath,
          )
            ? {
                ...(JSON.parse(
                  fs.readFileSync(parentPhonoPath, "utf-8"),
                ) as Record<string, unknown>),
                language_id: newId,
              }
            : (defaultPhonologyConfig(newId) as unknown as Record<
                string,
                unknown
              >);
          mutations.push({
            kind: "write_file",
            relPath: `${newRel}/phonology.json`,
            content: JSON.stringify(childPhonoObj, null, 2),
          });

          // 2. Copy grammar.json preserving unknown fields
          const parentGrammarPath = path.join(parentDir, "grammar.json");
          const childGrammarObj: Record<string, unknown> = fs.existsSync(
            parentGrammarPath,
          )
            ? {
                ...(JSON.parse(
                  fs.readFileSync(parentGrammarPath, "utf-8"),
                ) as Record<string, unknown>),
                language_id: newId,
              }
            : (defaultGrammarConfig(newId) as unknown as Record<
                string,
                unknown
              >);
          mutations.push({
            kind: "write_file",
            relPath: `${newRel}/grammar.json`,
            content: JSON.stringify(childGrammarObj, null, 2),
          });

          // 3. Empty sca_rules.json
          mutations.push({
            kind: "write_file",
            relPath: `${newRel}/sca_rules.json`,
            content: JSON.stringify(defaultScaConfig(newId), null, 2),
          });

          // 4. Copy lexicon/*.ndjson evolving entries and preserving unknown fields
          mutations.push({ kind: "create_dir", relPath: `${newRel}/lexicon` });
          const parentLexDir = path.join(parentDir, "lexicon");
          const childBuckets = new Map<string, WordEntry[]>();
          let copiedWordCount = 0;

          if (
            fs.existsSync(parentLexDir) &&
            fs.statSync(parentLexDir).isDirectory()
          ) {
            const ndjsonFiles = fs
              .readdirSync(parentLexDir)
              .filter((f) => f.endsWith(".ndjson"))
              .sort();
            for (const fname of ndjsonFiles) {
              const lines = fs
                .readFileSync(path.join(parentLexDir, fname), "utf-8")
                .split(/\r?\n/);
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const rawWord = JSON.parse(trimmed) as Record<string, unknown>;
                  const norm = normalizeWordEntryFromRaw(
                    rawWord,
                    parentLang.language_id,
                  );
                  if (!isValidWordEntryCompat(norm)) continue;

                  const rawEtym =
                    typeof rawWord.etymology === "object" &&
                    rawWord.etymology !== null
                      ? (rawWord.etymology as Record<string, unknown>)
                      : {};

                  const evolvedWord: WordEntry = {
                    ...norm,
                    ...(rawWord as unknown as WordEntry),
                    entry_id: norm.entry_id,
                    language_id: newId,
                    con_word_romanized: norm.con_word_romanized,
                    phonetic_ipa: norm.phonetic_ipa,
                    phonetic_override: norm.phonetic_override,
                    senses: norm.senses,
                    metadata: norm.metadata,
                    evolution: norm.evolution,
                    etymology: {
                      ...(rawEtym as unknown as WordEntry["etymology"]),
                      origin_type: "evolved",
                      parent_entry_id: norm.entry_id,
                      source_language_id: parentLang.language_id,
                      applied_sound_changes: norm.etymology.applied_sound_changes,
                      semantic_shift_note: norm.etymology.semantic_shift_note,
                    },
                  };

                  const bname = bucketFilename(evolvedWord.con_word_romanized);
                  const arr = childBuckets.get(bname) ?? [];
                  arr.push(evolvedWord);
                  childBuckets.set(bname, arr);
                  copiedWordCount += 1;
                } catch (err) {
                  console.warn(
                    `[conlang-mcp] Skipping corrupt line in ${fname} during fork:`,
                    err,
                  );
                }
              }
            }
          }

          for (const bname of Array.from(childBuckets.keys()).sort()) {
            const bwords = childBuckets.get(bname) ?? [];
            if (bwords.length > 0) {
              mutations.push({
                kind: "write_file",
                relPath: `${newRel}/lexicon/${bname}`,
                content: serializeBucketWords(bwords),
              });
            }
          }

          // 5. Copy corpus/ if present
          const parentCorpusDir = path.join(parentDir, "corpus");
          let copiedCorpusFiles = 0;
          mutations.push({ kind: "create_dir", relPath: `${newRel}/corpus` });
          if (
            fs.existsSync(parentCorpusDir) &&
            fs.statSync(parentCorpusDir).isDirectory()
          ) {
            const cFiles = fs
              .readdirSync(parentCorpusDir, { withFileTypes: true })
              .filter((d) => d.isFile() && d.name.endsWith(".json"))
              .map((d) => d.name)
              .sort();
            for (const cFile of cFiles) {
              const rawBytes = fs.readFileSync(path.join(parentCorpusDir, cFile));
              if (cFile === "corpus_index.json") {
                mutations.push({
                  kind: "write_file",
                  relPath: `${newRel}/corpus/${cFile}`,
                  content: rawBytes,
                });
              } else {
                try {
                  const parsed = JSON.parse(rawBytes.toString("utf-8")) as Record<
                    string,
                    unknown
                  >;
                  parsed.language_id = newId;
                  mutations.push({
                    kind: "write_file",
                    relPath: `${newRel}/corpus/${cFile}`,
                    content: JSON.stringify(parsed, null, 2),
                  });
                } catch {
                  mutations.push({
                    kind: "write_file",
                    relPath: `${newRel}/corpus/${cFile}`,
                    content: rawBytes,
                  });
                }
                copiedCorpusFiles += 1;
              }
            }
            if (!cFiles.includes("corpus_index.json")) {
              mutations.push({
                kind: "write_file",
                relPath: `${newRel}/corpus/corpus_index.json`,
                content: "[]\n",
              });
            }
          } else {
            mutations.push({
              kind: "write_file",
              relPath: `${newRel}/corpus/corpus_index.json`,
              content: "[]\n",
            });
          }

          // 6. Append LanguageEntry to .conlang preserving unknown workspace fields
          const newEntry: LanguageEntry = {
            language_id: newId,
            name: args.new_name.trim(),
            path: newRel,
            parent_id: parentLang.language_id,
          };
          const rawLanguages = Array.isArray(rawWsObj.languages)
            ? (rawWsObj.languages as unknown[])
            : ws.config.languages;
          const nextWsObj: Record<string, unknown> = {
            ...rawWsObj,
            workspace_version: ws.config.workspace_version,
            languages: [...rawLanguages, newEntry],
          };
          const conlangRel = normalizeRelPathPosix(
            path.relative(family.project_dir, family.conlang_file_path),
          );
          mutations.push({
            kind: "write_file",
            relPath: conlangRel,
            content: JSON.stringify(nextWsObj, null, 2),
          });

          return {
            expectations: [
              {
                label: "workspace",
                targetPath: family.conlang_file_path,
                expectedRevision: args.expected_revision ?? "",
              },
            ],
            mutations,
            languageId: newId,
            snapshotId: snap.snapshotId,
            auditSummary: `Forked language '${newEntry.name}' (${newId}) from '${parentLang.name}' (${copiedWordCount} words)`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              parent_language_id: parentLang.language_id,
              new_language: newEntry,
              words_to_copy: copiedWordCount,
              corpus_texts_to_copy: copiedCorpusFiles,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed: true,
              revision: newRevisions.workspace,
              revisions: newRevisions,
              snapshot_id: snap.snapshotId,
              language: newEntry,
              words_copied: copiedWordCount,
              corpus_texts_copied: copiedCorpusFiles,
              summary: `Forked '${newEntry.name}' (${newId}) from '${parentLang.name}' with ${copiedWordCount} evolved lexicon entries.`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 5. language_update
  registerDefinedTool(server, config, {
    name: "language_update",
    title: "Update Language Name or Parent",
    description:
      "Updates a language's display name and/or parent_id in .conlang with cycle detection, inheritance impact warnings (fonts and glyph_annotations), and an automatic project snapshot.",
    toolsets: ["write", "admin"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      name: z.string().min(1).optional().describe("Updated language display name"),
      parent_id: z
        .string()
        .nullable()
        .optional()
        .describe("Updated parent language ID/name/path, or null for root"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "language_update");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      if (args.name === undefined && args.parent_id === undefined) {
        throw new McpError(
          "VALIDATION",
          'Provide at least one of "name" or "parent_id" to update.',
        );
      }

      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "language_update",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId, warnings }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const rawWsObj = JSON.parse(
            fs.readFileSync(family.conlang_file_path, "utf-8"),
          ) as Record<string, unknown>;

          const langQuery = (args.language ?? args.language_id)?.trim();
          if (!langQuery) {
            throw new McpError(
              "VALIDATION",
              'Missing required parameter "language" (or "language_id").',
            );
          }
          const targetResolved = resolveLanguage(family, langQuery, {
            workspace: ws.config,
            revision: ws.revision,
          });
          const target = targetResolved.language;

          let nextParentId: string | null = target.parent_id ?? null;
          if (args.parent_id !== undefined) {
            if (args.parent_id === null || args.parent_id.trim() === "") {
              nextParentId = null;
            } else {
              const parentResolved = resolveLanguage(family, args.parent_id, {
                workspace: ws.config,
                revision: ws.revision,
              });
              nextParentId = parentResolved.language.language_id;
            }

            if (nextParentId === target.language_id) {
              throw new McpError(
                "VALIDATION",
                `Language "${target.language_id}" cannot be its own parent.`,
              );
            }

            // Cycle detection
            const byId = new Map(
              ws.config.languages.map((l) => [l.language_id, l]),
            );
            let walkId: string | null = nextParentId;
            const visited = new Set<string>([target.language_id]);
            while (walkId) {
              if (visited.has(walkId)) {
                throw new McpError(
                  "VALIDATION",
                  `Setting parent_id="${nextParentId}" on "${target.language_id}" would introduce a cycle in the language tree.`,
                );
              }
              visited.add(walkId);
              walkId = byId.get(walkId)?.parent_id ?? null;
            }
          }

          const nextName =
            args.name !== undefined ? args.name.trim() : target.name;
          const changed =
            nextName !== target.name || nextParentId !== (target.parent_id ?? null);

          const inheritanceNotes: string[] = [];
          if (nextParentId !== (target.parent_id ?? null)) {
            const ownFont = findOwnFontFile(targetResolved.language_dir);
            if (!ownFont) {
              const beforeFont = resolveFontFileUnlocked(
                family.project_dir,
                ws.config.languages,
                target.language_id,
              );
              const simulatedLangs = ws.config.languages.map((l) =>
                l.language_id === target.language_id
                  ? { ...l, parent_id: nextParentId }
                  : l,
              );
              const afterFont = resolveFontFileUnlocked(
                family.project_dir,
                simulatedLangs,
                target.language_id,
              );
              if (
                (beforeFont?.owner_language_id ?? null) !==
                (afterFont?.owner_language_id ?? null)
              ) {
                const note = `Inherited font changes from ${beforeFont ? `${beforeFont.owner_name} (${beforeFont.file_name})` : "none"} to ${afterFont ? `${afterFont.owner_name} (${afterFont.file_name})` : "none"}.`;
                inheritanceNotes.push(note);
                warnings.push(note);
              }
            }

            const phonoLoad = readPhonologyUnlocked(
              family.project_dir,
              family.conlang_file_path,
              target,
            );
            if (phonoLoad.annotations_source === "inherited") {
              const note =
                "Language currently inherits glyph_annotations from an ancestor; changing parent_id may alter effective glyph_annotations.";
              inheritanceNotes.push(note);
              warnings.push(note);
            }
          }

          const mutations: PlannedMutation[] = [];
          let snapshotId: string | null = null;

          let updatedEntry: LanguageEntry = {
            ...target,
            name: nextName,
            parent_id: nextParentId,
          };

          if (changed) {
            const snap = planProjectSnapshot({
              projectDir: family.project_dir,
              conlangFilePath: family.conlang_file_path,
              workspace: ws.config,
              origin: "mcp",
              operationType: "update_language",
              description: `Before updating language '${target.name}' (${target.language_id})`,
            });
            snapshotId = snap.snapshotId;
            mutations.push(...snap.mutations);

            const rawLangs = Array.isArray(rawWsObj.languages)
              ? (rawWsObj.languages as Record<string, unknown>[])
              : (ws.config.languages as unknown as Record<string, unknown>[]);

            const nextRawLangs = rawLangs.map((rawItem) => {
              if (
                typeof rawItem === "object" &&
                rawItem !== null &&
                rawItem.language_id === target.language_id
              ) {
                const merged = {
                  ...rawItem,
                  name: nextName,
                  parent_id: nextParentId,
                };
                updatedEntry = merged as unknown as LanguageEntry;
                return merged;
              }
              return rawItem;
            });

            const nextWsObj: Record<string, unknown> = {
              ...rawWsObj,
              workspace_version: ws.config.workspace_version,
              languages: nextRawLangs,
            };
            const conlangRel = normalizeRelPathPosix(
              path.relative(family.project_dir, family.conlang_file_path),
            );
            mutations.push({
              kind: "write_file",
              relPath: conlangRel,
              content: JSON.stringify(nextWsObj, null, 2),
            });
          }

          return {
            expectations: [
              {
                label: "workspace",
                targetPath: family.conlang_file_path,
                expectedRevision: args.expected_revision ?? "",
              },
            ],
            mutations,
            languageId: target.language_id,
            snapshotId,
            auditSummary: `Updated language ${target.language_id} (name='${nextName}', parent_id=${nextParentId ?? "null"})`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              changed,
              before: target,
              after: updatedEntry,
              inheritance_notes: inheritanceNotes,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, txWarnings) => ({
              operation_id: operationId,
              committed: true,
              changed,
              revision: newRevisions.workspace,
              revisions: newRevisions,
              snapshot_id: snapshotId,
              language: updatedEntry,
              inheritance_notes: inheritanceNotes,
              summary: changed
                ? `Updated language '${updatedEntry.name}' (${updatedEntry.language_id}).`
                : `No changes needed for language '${updatedEntry.name}'.`,
              warnings: txWarnings.length > 0 ? txWarnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 6. language_delete
  registerDefinedTool(server, config, {
    name: "language_delete",
    title: "Delete Language to Trash",
    description:
      "Moves a leaf language directory into .conlang-maker/trash/<trash_id> and removes it from .conlang inside a single recoverable transaction. Rejects languages that have children. Requires --mode write+destructive and confirm: true.",
    toolsets: ["admin"],
    access: "destructive",
    inputSchema: {
      ...familyInputFields,
      ...languageInputFields,
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to commit destructive deletion"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertDestructiveAllowed(
        config,
        "language_delete",
        args.confirm,
        args.dry_run,
      );
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const family = resolveFamilyFromArgs(config, args);
      const langQuery = (args.language ?? args.language_id)?.trim();
      if (!langQuery) {
        throw new McpError(
          "VALIDATION",
          'Missing required parameter "language" (or "language_id").',
        );
      }

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "language_delete",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const resolved = resolveLanguage(family, langQuery, {
            workspace: ws.config,
            revision: ws.revision,
          });
          const plan = planTrashLanguageDelete({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            workspace: ws.config,
            language: resolved.language,
            operationId,
            origin: "mcp",
          });

          return {
            expectations: [
              {
                label: "workspace",
                targetPath: family.conlang_file_path,
                expectedRevision: args.expected_revision ?? "",
              },
            ],
            mutations: plan.mutations,
            languageId: resolved.language.language_id,
            snapshotId: plan.projectSnapshotId,
            auditSummary: `Deleted language '${resolved.language.name}' (${resolved.language.language_id}) to trash ${plan.trashEntry.trash_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              language: resolved.language,
              trash_preview: plan.trashEntry,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed: true,
              trash_id: plan.trashEntry.trash_id,
              trashed: plan.trashEntry,
              snapshot_id: plan.projectSnapshotId,
              revision: newRevisions.workspace,
              revisions: newRevisions,
              summary: `Moved language '${resolved.language.name}' (${resolved.language.language_id}) to trash (${plan.trashEntry.trash_id}).`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 7. language_trash_list
  registerDefinedTool(server, config, {
    name: "language_trash_list",
    title: "List Trashed Languages",
    description:
      "Lists deleted languages stored in the workspace trash (.conlang-maker/trash/), including trash_id, original language_id, parent_id, original_path, and deletion timestamp.",
    toolsets: ["core", "admin"],
    access: "read",
    inputSchema: {
      ...familyInputFields,
      limit: z.number().int().min(1).max(500).optional(),
      cursor: z.string().optional(),
      fields: z.array(z.string()).optional(),
    },
    handler: async (args) => {
      const family = resolveFamilyFromArgs(config, args);
      return await withConsistentProjectRead(
        family.project_dir,
        config.mode,
        "language_trash_list",
        () => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const all = listTrashedLanguagesUnlocked(family.project_dir);
          const page = paginate(all, ws.revision, {
            limit: args.limit,
            cursor: args.cursor,
          });
          return {
            family_id: family.family_id,
            workspace_revision: ws.revision,
            total: page.total,
            next_cursor: page.next_cursor,
            items: projectArrayFields(page.items, args.fields),
          };
        },
      );
    },
  });

  // 8. language_restore
  registerDefinedTool(server, config, {
    name: "language_restore",
    title: "Restore Language from Trash",
    description:
      "Restores a trashed language directory and its .conlang entry by trash_id. Reports conflicts on dry_run: true and throws CONFLICT on commit if parent/ID/path conflicts exist. Requires --mode write+destructive and confirm: true.",
    toolsets: ["admin"],
    access: "destructive",
    inputSchema: {
      ...familyInputFields,
      trash_id: z
        .string()
        .min(1)
        .describe("Trash entry ID from language_trash_list"),
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to commit destructive restore"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertDestructiveAllowed(
        config,
        "language_restore",
        args.confirm,
        args.dry_run,
      );
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "language_restore",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const plan = planTrashLanguageRestore({
            projectDir: family.project_dir,
            conlangFilePath: family.conlang_file_path,
            workspace: ws.config,
            trashId: args.trash_id.trim(),
            origin: "mcp",
          });

          if (!args.dry_run && plan.conflicts.length > 0) {
            throw new McpError(
              "CONFLICT",
              `Cannot restore trashed language "${args.trash_id}": ${plan.conflicts.join("; ")}`,
              "Resolve parent, language_id, or directory path conflicts before restoring.",
              { conflicts: plan.conflicts, restored: plan.restoredEntry },
            );
          }

          return {
            expectations: [
              {
                label: "workspace",
                targetPath: family.conlang_file_path,
                expectedRevision: args.expected_revision ?? "",
              },
            ],
            mutations: plan.mutations,
            languageId: plan.restoredEntry.language_id,
            snapshotId: plan.projectSnapshotId,
            auditSummary: `Restored language '${plan.restoredEntry.name}' (${plan.restoredEntry.language_id}) from ${args.trash_id}`,
            buildDryRunResponse: (baseRevisions) => ({
              dry_run: true,
              trash_id: args.trash_id,
              restored: plan.restoredEntry,
              conflicts: plan.conflicts,
              can_restore: plan.conflicts.length === 0,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => ({
              operation_id: operationId,
              committed: true,
              changed: true,
              trash_id: args.trash_id,
              restored: plan.restoredEntry,
              conflicts: [] as string[],
              snapshot_id: plan.projectSnapshotId,
              revision: newRevisions.workspace,
              revisions: newRevisions,
              summary: `Restored language '${plan.restoredEntry.name}' (${plan.restoredEntry.language_id}) from trash.`,
              warnings: warnings.length > 0 ? warnings : undefined,
            }),
          };
        },
      });
    },
  });

  // 9. family_register
  registerDefinedTool(server, config, {
    name: "family_register",
    title: "Register Language Family in Registry",
    description:
      "Validates a .conlang workspace path against --allow-root and registers (or updates) it in registry.json.",
    toolsets: ["admin"],
    access: "write",
    inputSchema: {
      conlang_file_path: z
        .string()
        .min(1)
        .describe("Path to a .conlang file or workspace directory"),
      name: z
        .string()
        .optional()
        .describe("Optional display name (defaults to .conlang file stem)"),
      set_active: z
        .boolean()
        .optional()
        .default(true)
        .describe("Set as the active family in registry.json"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "family_register");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const canonicalPath = resolveConlangFileCandidate(
        args.conlang_file_path,
        config,
      );
      const health = inspectWorkspaceHealth(canonicalPath);
      if (health.error) {
        throw new McpError(
          "VALIDATION",
          `Invalid .conlang file "${canonicalPath}": ${health.error}`,
        );
      }

      const displayName =
        args.name?.trim() || path.basename(canonicalPath, ".conlang");

      const { revision, result } = await updateRegistryLocked<
        Record<string, unknown>
      >(
        config,
        "family_register",
        args.dry_run ? undefined : args.expected_revision,
        (current, currentRevision) => {
          if (
            !args.dry_run &&
            args.expected_revision === undefined &&
            currentRevision !== MISSING_REVISION
          ) {
            throw new McpError(
              "REVISION_REQUIRED",
              'Missing expected_revision for "registry.json".',
              "Call family_list to read registry_revision (or run with dry_run: true) and pass expected_revision.",
              { target: "registry", current_revision: currentRevision },
            );
          }

          const { nextRegistry, familyId, activeIndex } =
            upsertFamilyInRegistryObject(
              current,
              canonicalPath,
              displayName,
              args.set_active,
            );

          if (args.dry_run) {
            return {
              nextRegistry: undefined,
              result: {
                dry_run: true,
                family_id: familyId,
                name: displayName,
                conlang_file_path: canonicalPath,
                set_active: args.set_active,
                missing_language_dirs: health.missing_language_dirs,
                base_revisions: { registry: currentRevision },
              },
            };
          }

          return {
            nextRegistry,
            result: {
              operation_id: opId!,
              committed: true,
              changed: true,
              family_id: familyId,
              name: displayName,
              conlang_file_path: canonicalPath,
              active_family_index: activeIndex,
              summary: `Registered family '${displayName}' (${familyId}) in registry.json.`,
              warnings:
                health.missing_language_dirs.length > 0
                  ? [
                      `Missing language directories: ${health.missing_language_dirs.join(", ")}`,
                    ]
                  : undefined,
            },
          };
        },
      );

      if (args.dry_run) {
        return result;
      }
      return {
        ...result,
        revision,
        revisions: { registry: revision },
      };
    },
  });

  // 10. family_unregister
  registerDefinedTool(server, config, {
    name: "family_unregister",
    title: "Unregister Family from Registry",
    description:
      "Removes a family entry from registry.json ONLY without modifying or deleting any workspace files on disk. Requires --mode write+destructive and confirm: true.",
    toolsets: ["admin"],
    access: "destructive",
    inputSchema: {
      ...familyInputFields,
      conlang_file_path: z
        .string()
        .optional()
        .describe("Optional .conlang file path to unregister"),
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to commit unregister"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertDestructiveAllowed(
        config,
        "family_unregister",
        args.confirm,
        args.dry_run,
      );
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const query = (
        args.conlang_file_path ?? pickFamilyArg(args)
      )?.trim();
      if (!query) {
        throw new McpError(
          "VALIDATION",
          'Provide "family", "family_id", or "conlang_file_path" to unregister.',
        );
      }

      const { revision, result } = await updateRegistryLocked<
        Record<string, unknown>
      >(
        config,
        "family_unregister",
        args.dry_run ? undefined : args.expected_revision,
        (current, currentRevision) => {
          if (!args.dry_run && !args.expected_revision) {
            throw new McpError(
              "REVISION_REQUIRED",
              'Missing expected_revision for "registry.json".',
              "Call family_list to read registry_revision and pass expected_revision.",
              { target: "registry", current_revision: currentRevision },
            );
          }

          const rawFamilies = Array.isArray(current.families)
            ? current.families
            : [];
          const indexed = rawFamilies.map((entry, idx) => {
            const canon = canonicalizeConlangPath(entry.conlang_file_path);
            return {
              idx,
              entry,
              canon,
              family_id: computeFamilyId(canon),
            };
          });

          const queryCanonCandidate =
            query.includes("/") ||
            query.includes("\\") ||
            query.endsWith(".conlang")
              ? canonicalizeConlangPath(query)
              : null;

          let matches = indexed.filter(
            (item) =>
              item.family_id === query ||
              (queryCanonCandidate !== null && item.canon === queryCanonCandidate),
          );
          if (matches.length === 0) {
            matches = indexed.filter((item) => item.entry.name === query);
          }
          if (matches.length === 0) {
            const lower = query.toLowerCase();
            matches = indexed.filter(
              (item) => item.entry.name.toLowerCase() === lower,
            );
          }

          const distinctIds = Array.from(
            new Set(matches.map((m) => m.family_id)),
          );
          if (distinctIds.length === 0) {
            throw new McpError(
              "NOT_FOUND",
              `Family "${query}" was not found in registry.json.`,
            );
          }
          if (distinctIds.length > 1) {
            throw new McpError(
              "AMBIGUOUS",
              `Multiple registered families match "${query}". Pass exact family_id.`,
              "Call family_list and pass family_id.",
              {
                candidates: matches.map((m) => ({
                  family_id: m.family_id,
                  name: m.entry.name,
                  conlang_file_path: m.canon,
                })),
              },
            );
          }

          const targetFamilyId = distinctIds[0];
          const removedIndices = new Set(matches.map((m) => m.idx));
          const nextFamilies = rawFamilies.filter(
            (_, idx) => !removedIndices.has(idx),
          );

          let nextActive: number | null = current.active_family_index;
          if (nextFamilies.length === 0) {
            nextActive = null;
          } else if (nextActive !== null) {
            if (removedIndices.has(nextActive)) {
              nextActive = 0;
            } else {
              const removedBefore = Array.from(removedIndices).filter(
                (rIdx) => rIdx < nextActive!,
              ).length;
              nextActive = Math.max(0, nextActive - removedBefore);
            }
          }

          if (args.dry_run) {
            return {
              nextRegistry: undefined,
              result: {
                dry_run: true,
                family_id: targetFamilyId,
                removed_entries: matches.map((m) => m.entry),
                next_active_family_index: nextActive,
                base_revisions: { registry: currentRevision },
              },
            };
          }

          return {
            nextRegistry: {
              ...current,
              families: nextFamilies,
              active_family_index: nextActive,
            },
            result: {
              operation_id: opId!,
              committed: true,
              changed: true,
              family_id: targetFamilyId,
              removed_count: matches.length,
              active_family_index: nextActive,
              summary: `Unregistered family ${targetFamilyId} (${matches[0].entry.name}) from registry.json (workspace files untouched).`,
            },
          };
        },
      );

      if (args.dry_run) return result;
      return {
        ...result,
        revision,
        revisions: { registry: revision },
      };
    },
  });

  // 11. family_set_active
  registerDefinedTool(server, config, {
    name: "family_set_active",
    title: "Set Active Language Family",
    description:
      "Updates active_family_index in registry.json to point to the specified registered family.",
    toolsets: ["admin"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "family_set_active");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const query = pickFamilyArg(args)?.trim();
      if (!query) {
        throw new McpError(
          "VALIDATION",
          'Missing required parameter "family" (or "family_id").',
        );
      }

      const resolved = resolveFamily(config, query);

      const { revision, result } = await updateRegistryLocked<
        Record<string, unknown>
      >(
        config,
        "family_set_active",
        args.dry_run ? undefined : args.expected_revision,
        (current, currentRevision) => {
          if (!args.dry_run && !args.expected_revision) {
            throw new McpError(
              "REVISION_REQUIRED",
              'Missing expected_revision for "registry.json".',
              "Call family_list to read registry_revision and pass expected_revision.",
              { target: "registry", current_revision: currentRevision },
            );
          }

          const rawFamilies = Array.isArray(current.families)
            ? current.families
            : [];
          const targetIdx = rawFamilies.findIndex(
            (entry) =>
              computeFamilyId(
                canonicalizeConlangPath(entry.conlang_file_path),
              ) === resolved.family_id,
          );
          if (targetIdx < 0) {
            throw new McpError(
              "NOT_FOUND",
              `Family "${resolved.name}" (${resolved.family_id}) is not registered in registry.json.`,
              "Call family_register first to add it to registry.json.",
            );
          }

          const changed = current.active_family_index !== targetIdx;
          if (args.dry_run) {
            return {
              nextRegistry: undefined,
              result: {
                dry_run: true,
                changed,
                family_id: resolved.family_id,
                name: resolved.name,
                active_family_index: targetIdx,
                base_revisions: { registry: currentRevision },
              },
            };
          }

          const nextFamilies = rawFamilies.map((f, idx) =>
            idx === targetIdx ? { ...f, last_opened: nowIso() } : f,
          );
          return {
            nextRegistry: {
              ...current,
              families: nextFamilies,
              active_family_index: targetIdx,
            },
            result: {
              operation_id: opId!,
              committed: true,
              changed: true,
              family_id: resolved.family_id,
              name: resolved.name,
              active_family_index: targetIdx,
              summary: `Set active family to '${resolved.name}' (${resolved.family_id}).`,
            },
          };
        },
      );

      if (args.dry_run) return result;
      return {
        ...result,
        revision,
        revisions: { registry: revision },
      };
    },
  });

  // 12. project_create
  registerDefinedTool(server, config, {
    name: "project_create",
    title: "Create New Conlang Workspace",
    description:
      "Creates a new language family workspace directory (validated against --allow-root) with <slug>.conlang and an initial root language (default phonology, grammar, sca_rules, lexicon/, corpus/corpus_index.json), and optionally registers it in registry.json.",
    toolsets: ["admin"],
    access: "write",
    inputSchema: {
      target_dir: z
        .string()
        .min(1)
        .describe("Directory path for the new workspace"),
      name: z.string().min(1).describe("Project / family name"),
      slug: z
        .string()
        .optional()
        .describe("Optional .conlang file stem (defaults to slugified name)"),
      root_language_id: z
        .string()
        .optional()
        .default("lang_proto")
        .describe("Initial root language_id"),
      root_name: z
        .string()
        .optional()
        .default("Proto Language")
        .describe("Initial root language display name"),
      root_path: z
        .string()
        .optional()
        .default("proto_language")
        .describe("Initial root language relative directory path"),
      register: z
        .boolean()
        .optional()
        .default(true)
        .describe("Register the created workspace in registry.json"),
      set_active: z
        .boolean()
        .optional()
        .default(true)
        .describe("Set as active family when registering"),
      registry_expected_revision: z
        .string()
        .optional()
        .describe("Optional expected revision of registry.json"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "project_create");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const targetDir = assertPathAllowed(args.target_dir.trim(), config);

      const fileStem = slugifyIdentifier(args.slug ?? args.name, "workspace");
      const conlangFileName = `${fileStem}.conlang`;
      const conlangPath = path.join(targetDir, conlangFileName);
      const rootId = args.root_language_id.trim();
      const rootName = args.root_name.trim();
      const rootRel = normalizeRelPathPosix(args.root_path);

      if (!rootId || /[/\\]/.test(rootId)) {
        throw new McpError("VALIDATION", `Invalid root_language_id "${rootId}".`);
      }
      if (!rootRel || rootRel.startsWith("..") || rootRel.includes("/../")) {
        throw new McpError("VALIDATION", `Invalid root_path "${args.root_path}".`);
      }

      if (fs.existsSync(targetDir)) {
        if (!fs.statSync(targetDir).isDirectory()) {
          throw new McpError(
            "CONFLICT",
            `Target path "${targetDir}" exists and is not a directory.`,
          );
        }
        const entries = fs.readdirSync(targetDir);
        if (entries.length > 0) {
          if (opId) {
            const digest = computeRequestDigest("project_create", args);
            const prior = lookupCompletedOperation(targetDir, opId, digest);
            if (prior) {
              return prior.response;
            }
          }
          throw new McpError(
            "CONFLICT",
            `Target directory "${targetDir}" already exists and is not empty.`,
            "Choose a new or empty target_dir.",
          );
        }
      }

      const rootEntry: LanguageEntry = {
        language_id: rootId,
        name: rootName,
        path: rootRel,
        parent_id: null,
      };

      if (args.dry_run) {
        const regSnap = readRegistry(config);
        return {
          dry_run: true,
          target_dir: targetDir,
          conlang_file_path: conlangPath,
          family_id: computeFamilyId(conlangPath),
          root_language: rootEntry,
          will_register: args.register,
          base_revisions: {
            workspace: MISSING_REVISION,
            ...(args.register ? { registry: regSnap.registry_revision } : {}),
          },
        };
      }

      fs.mkdirSync(targetDir, { recursive: true });
      const canonicalConlangPath = canonicalizeConlangPath(conlangPath);
      const canonicalTargetDir = path.dirname(canonicalConlangPath);

      const wsConfig: WorkspaceConfig = {
        workspace_version: "3.0",
        languages: [rootEntry],
      };

      const txResult = await executeProjectTransaction({
        projectDir: canonicalTargetDir,
        toolName: "project_create",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: false,
        planInsideLock: ({ operationId }) => ({
          expectations: [
            {
              label: "workspace",
              targetPath: canonicalConlangPath,
              expectedRevision: args.expected_revision ?? MISSING_REVISION,
            },
          ],
          mutations: [
            { kind: "create_dir", relPath: rootRel },
            { kind: "create_dir", relPath: `${rootRel}/lexicon` },
            { kind: "create_dir", relPath: `${rootRel}/corpus` },
            {
              kind: "write_file",
              relPath: conlangFileName,
              content: JSON.stringify(wsConfig, null, 2),
            },
            {
              kind: "write_file",
              relPath: `${rootRel}/phonology.json`,
              content: JSON.stringify(defaultPhonologyConfig(rootId), null, 2),
            },
            {
              kind: "write_file",
              relPath: `${rootRel}/grammar.json`,
              content: JSON.stringify(defaultGrammarConfig(rootId), null, 2),
            },
            {
              kind: "write_file",
              relPath: `${rootRel}/sca_rules.json`,
              content: JSON.stringify(defaultScaConfig(rootId), null, 2),
            },
            {
              kind: "write_file",
              relPath: `${rootRel}/corpus/corpus_index.json`,
              content: "[]\n",
            },
          ],
          languageId: rootId,
          auditSummary: `Created project '${args.name.trim()}' at ${canonicalTargetDir}`,
          buildResponse: (newRevisions, warnings) => ({
            operation_id: operationId,
            committed: true,
            changed: true,
            family_id: computeFamilyId(canonicalConlangPath),
            name: args.name.trim(),
            project_dir: canonicalTargetDir,
            conlang_file_path: canonicalConlangPath,
            root_language: rootEntry,
            revision: newRevisions.workspace,
            revisions: newRevisions,
            warnings,
          }),
        }),
      });

      let registryRegistered = false;
      let registryRevision: string | null = null;
      const allWarnings = [...txResult.warnings];

      if (args.register) {
        try {
          const regUpdate = await updateRegistryLocked(
            config,
            "project_create",
            args.registry_expected_revision,
            (current) => {
              const { nextRegistry } = upsertFamilyInRegistryObject(
                current,
                canonicalConlangPath,
                args.name.trim(),
                args.set_active,
              );
              return { nextRegistry, result: true };
            },
          );
          registryRegistered = regUpdate.result;
          registryRevision = regUpdate.revision;
        } catch (regErr) {
          allWarnings.push(
            `Workspace created, but registry update failed: ${regErr instanceof Error ? regErr.message : String(regErr)}`,
          );
        }
      }

      return {
        ...txResult,
        revisions: {
          ...txResult.revisions,
          ...(registryRevision ? { registry: registryRevision } : {}),
        },
        registry_registered: registryRegistered,
        summary: `Created workspace '${args.name.trim()}' at ${canonicalConlangPath}.`,
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
      };
    },
  });

  // 13. project_copy
  registerDefinedTool(server, config, {
    name: "project_copy",
    title: "Copy Language Family Workspace",
    description:
      "Copies an existing family workspace to a new target directory (excluding .conlang-maker/lock and .conlang-maker/transactions), optionally renaming the family and registering it in registry.json.",
    toolsets: ["admin"],
    access: "write",
    inputSchema: {
      ...familyInputFields,
      target_dir: z
        .string()
        .min(1)
        .describe("New destination directory for the copied workspace"),
      new_name: z
        .string()
        .optional()
        .describe("Optional new family display name and .conlang stem"),
      register: z
        .boolean()
        .optional()
        .default(false)
        .describe("Register the copied workspace in registry.json"),
      set_active: z.boolean().optional().default(false),
      registry_expected_revision: z.string().optional(),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "project_copy");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const sourceFamily = resolveFamilyFromArgs(config, args);
      const targetDir = assertPathAllowed(args.target_dir.trim(), config);

      const relFromSource = path.relative(sourceFamily.project_dir, targetDir);
      if (
        relFromSource === "" ||
        (!relFromSource.startsWith("..") && !path.isAbsolute(relFromSource))
      ) {
        throw new McpError(
          "VALIDATION",
          `target_dir "${targetDir}" cannot be equal to or nested inside source workspace "${sourceFamily.project_dir}".`,
        );
      }

      if (fs.existsSync(targetDir)) {
        if (!fs.statSync(targetDir).isDirectory()) {
          throw new McpError(
            "CONFLICT",
            `Target path "${targetDir}" exists and is not a directory.`,
          );
        }
        const entries = fs.readdirSync(targetDir);
        if (entries.length > 0) {
          if (opId) {
            const digest = computeRequestDigest("project_copy", args);
            const prior = lookupCompletedOperation(targetDir, opId, digest);
            if (prior) {
              return prior.response;
            }
          }
          throw new McpError(
            "CONFLICT",
            `Target directory "${targetDir}" already exists and is not empty.`,
          );
        }
      }

      const sourceSnapshot = await withConsistentProjectRead(
        sourceFamily.project_dir,
        config.mode,
        "project_copy_source",
        () => {
          const ws = readWorkspaceUnlocked(sourceFamily.conlang_file_path);
          const relFiles = collectCopyableWorkspaceFiles(
            sourceFamily.project_dir,
          );
          const payloads = relFiles.map((rel) => ({
            rel,
            bytes: fs.readFileSync(path.join(sourceFamily.project_dir, rel)),
          }));
          return { wsRevision: ws.revision, payloads };
        },
      );

      const srcConlangRel = normalizeRelPathPosix(
        path.relative(sourceFamily.project_dir, sourceFamily.conlang_file_path),
      );
      const finalDisplayName = args.new_name?.trim() || sourceFamily.name;
      const dstConlangFileName = args.new_name?.trim()
        ? `${slugifyIdentifier(args.new_name.trim(), path.basename(srcConlangRel, ".conlang"))}.conlang`
        : path.basename(srcConlangRel);
      const previewConlangPath = path.join(targetDir, dstConlangFileName);

      if (args.dry_run) {
        const regSnap = readRegistry(config);
        return {
          dry_run: true,
          source_family_id: sourceFamily.family_id,
          target_dir: targetDir,
          conlang_file_path: previewConlangPath,
          new_family_id: computeFamilyId(previewConlangPath),
          name: finalDisplayName,
          files_to_copy: sourceSnapshot.payloads.length,
          will_register: args.register,
          base_revisions: {
            source_workspace: sourceSnapshot.wsRevision,
            workspace: MISSING_REVISION,
            ...(args.register ? { registry: regSnap.registry_revision } : {}),
          },
        };
      }

      fs.mkdirSync(targetDir, { recursive: true });
      const canonicalConlangPath = canonicalizeConlangPath(previewConlangPath);
      const canonicalTargetDir = path.dirname(canonicalConlangPath);

      const mutations: PlannedMutation[] = sourceSnapshot.payloads.map(
        ({ rel, bytes }) => {
          if (rel === srcConlangRel) {
            if (args.new_name?.trim()) {
              try {
                const parsed = JSON.parse(bytes.toString("utf-8")) as Record<
                  string,
                  unknown
                >;
                if (typeof parsed.name === "string") {
                  parsed.name = finalDisplayName;
                }
                return {
                  kind: "write_file" as const,
                  relPath: dstConlangFileName,
                  content: JSON.stringify(parsed, null, 2),
                };
              } catch (parseErr) {
                console.warn(
                  "[conlang-mcp] Preserving raw .conlang bytes on copy:",
                  parseErr,
                );
              }
            }
            return {
              kind: "write_file" as const,
              relPath: dstConlangFileName,
              content: bytes,
            };
          }
          return {
            kind: "write_file" as const,
            relPath: rel,
            content: bytes,
          };
        },
      );

      const txResult = await executeProjectTransaction({
        projectDir: canonicalTargetDir,
        toolName: "project_copy",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: false,
        planInsideLock: ({ operationId }) => ({
          expectations: [
            {
              label: "workspace",
              targetPath: canonicalConlangPath,
              expectedRevision: args.expected_revision ?? MISSING_REVISION,
            },
          ],
          mutations,
          auditSummary: `Copied workspace '${sourceFamily.name}' to ${canonicalTargetDir} (${mutations.length} files)`,
          buildResponse: (newRevisions, warnings) => ({
            operation_id: operationId,
            committed: true,
            changed: true,
            source_family_id: sourceFamily.family_id,
            family_id: computeFamilyId(canonicalConlangPath),
            name: finalDisplayName,
            project_dir: canonicalTargetDir,
            conlang_file_path: canonicalConlangPath,
            files_copied: mutations.length,
            revision: newRevisions.workspace,
            revisions: newRevisions,
            warnings,
          }),
        }),
      });

      let registryRegistered = false;
      let registryRevision: string | null = null;
      const allWarnings = [...txResult.warnings];

      if (args.register) {
        try {
          const regUpdate = await updateRegistryLocked(
            config,
            "project_copy",
            args.registry_expected_revision,
            (current) => {
              const { nextRegistry } = upsertFamilyInRegistryObject(
                current,
                canonicalConlangPath,
                finalDisplayName,
                args.set_active,
              );
              return { nextRegistry, result: true };
            },
          );
          registryRegistered = regUpdate.result;
          registryRevision = regUpdate.revision;
        } catch (regErr) {
          allWarnings.push(
            `Workspace copied, but registry update failed: ${regErr instanceof Error ? regErr.message : String(regErr)}`,
          );
        }
      }

      return {
        ...txResult,
        revisions: {
          ...txResult.revisions,
          ...(registryRevision ? { registry: registryRevision } : {}),
        },
        registry_registered: registryRegistered,
        summary: `Copied workspace '${sourceFamily.name}' to ${canonicalConlangPath} (${mutations.length} files).`,
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
      };
    },
  });

  // 14. lexicon_migrate_inherited_links
  registerDefinedTool(server, config, {
    name: "lexicon_migrate_inherited_links",
    title: "Migrate Inherited Lexicon Links",
    description:
      "Scans daughter languages whose entry_id matches a parent language's entry_id and populates missing etymology.parent_entry_id, etymology.source_language_id, and etymology.origin_type='evolved' while preserving unknown fields.",
    toolsets: ["evolution", "admin"],
    access: "write",
    idempotent: true,
    inputSchema: {
      ...familyInputFields,
      expected_revisions: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional map of revisions from dry_run base_revisions"),
      ...commonWriteInputFields,
    },
    handler: async (args) => {
      assertWriteAllowed(config, "lexicon_migrate_inherited_links");
      const opId = requireOperationIdOnCommit(args.operation_id, args.dry_run);
      const family = resolveFamilyFromArgs(config, args);

      return await executeProjectTransaction<Record<string, unknown>>({
        projectDir: family.project_dir,
        toolName: "lexicon_migrate_inherited_links",
        operationId: opId,
        requestPayloadForDigest: args,
        dryRun: args.dry_run,
        planInsideLock: ({ operationId }) => {
          const ws = readWorkspaceUnlocked(family.conlang_file_path);
          const byId = new Map(
            ws.config.languages.map((l) => [l.language_id, l]),
          );

          const stats: MigrationStats = {
            dry_run: Boolean(args.dry_run),
            languages_processed: 0,
            words_scanned: 0,
            parent_link_filled: 0,
            source_language_filled: 0,
            origin_fixed: 0,
            files_changed: 0,
          };

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

          const bucketMutations: PlannedMutation[] = [];

          for (const lang of ws.config.languages) {
            if (!lang.parent_id) continue;
            const parentLang = byId.get(lang.parent_id);
            if (!parentLang) continue;

            const langDir = assertSafeRelativeLanguagePath(
              family.project_dir,
              lang.path,
            );
            const lexDir = path.join(langDir, "lexicon");
            const lexLabel = `lexicon:${lang.language_id}`;

            if (args.dry_run || args.expected_revisions?.[lexLabel]) {
              expectations.push({
                label: lexLabel,
                targetPath: lexDir,
                isLexiconDir: true,
                expectedRevision: args.expected_revisions?.[lexLabel] ?? "",
              });
            }

            if (!fs.existsSync(lexDir) || !fs.statSync(lexDir).isDirectory()) {
              continue;
            }

            const parentLex = readLexiconUnlocked(
              family.project_dir,
              parentLang,
            );
            const parentEntryIds = new Set(
              parentLex.words.map((w) => w.entry_id),
            );
            if (parentEntryIds.size === 0) {
              stats.languages_processed += 1;
              continue;
            }

            stats.languages_processed += 1;
            const langRel = normalizeRelPathPosix(lang.path);
            const ndjsonFiles = fs
              .readdirSync(lexDir)
              .filter((f) => f.endsWith(".ndjson"))
              .sort();

            for (const fname of ndjsonFiles) {
              const absFile = path.join(lexDir, fname);
              const lines = fs.readFileSync(absFile, "utf-8").split(/\r?\n/);
              const updatedWords: WordEntry[] = [];
              let fileDirty = false;

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const rawObj = JSON.parse(trimmed) as Record<string, unknown>;
                  const norm = normalizeWordEntryFromRaw(
                    rawObj,
                    lang.language_id,
                  );
                  if (!isValidWordEntryCompat(norm)) continue;

                  stats.words_scanned += 1;

                  const rawEtym =
                    typeof rawObj.etymology === "object" &&
                    rawObj.etymology !== null
                      ? (rawObj.etymology as Record<string, unknown>)
                      : {};

                  let nextParentEntryId = norm.etymology.parent_entry_id;
                  let nextSourceLangId = norm.etymology.source_language_id;
                  let nextOriginType = norm.etymology.origin_type;
                  let wordChanged = false;

                  if (
                    parentEntryIds.has(norm.entry_id) &&
                    norm.etymology.origin_type !== "borrowed"
                  ) {
                    if (!nextParentEntryId) {
                      nextParentEntryId = norm.entry_id;
                      stats.parent_link_filled += 1;
                      wordChanged = true;
                    }
                    if (!nextSourceLangId) {
                      nextSourceLangId = parentLang.language_id;
                      stats.source_language_filled += 1;
                      wordChanged = true;
                    }
                    if (nextOriginType === "a_priori") {
                      nextOriginType = "evolved";
                      stats.origin_fixed += 1;
                      wordChanged = true;
                    }
                  } else if (
                    nextOriginType === "evolved" &&
                    nextParentEntryId &&
                    parentEntryIds.has(nextParentEntryId) &&
                    !nextSourceLangId
                  ) {
                    nextSourceLangId = parentLang.language_id;
                    stats.source_language_filled += 1;
                    wordChanged = true;
                  }

                  if (wordChanged) {
                    fileDirty = true;
                  }

                  updatedWords.push({
                    ...norm,
                    ...(rawObj as unknown as WordEntry),
                    entry_id: norm.entry_id,
                    language_id: norm.language_id,
                    con_word_romanized: norm.con_word_romanized,
                    phonetic_ipa: norm.phonetic_ipa,
                    phonetic_override: norm.phonetic_override,
                    senses: norm.senses,
                    metadata: norm.metadata,
                    evolution: norm.evolution,
                    etymology: {
                      ...(rawEtym as unknown as WordEntry["etymology"]),
                      origin_type: nextOriginType,
                      parent_entry_id: nextParentEntryId,
                      source_language_id: nextSourceLangId,
                      applied_sound_changes: norm.etymology.applied_sound_changes,
                      semantic_shift_note: norm.etymology.semantic_shift_note,
                    },
                  });
                } catch (err) {
                  console.warn(
                    `[conlang-mcp] Skipping corrupt NDJSON line in ${fname}:`,
                    err,
                  );
                }
              }

              if (fileDirty) {
                stats.files_changed += 1;
                bucketMutations.push({
                  kind: "write_file",
                  relPath: `${langRel}/lexicon/${fname}`,
                  content: serializeBucketWords(updatedWords),
                });
              }
            }
          }

          const mutations: PlannedMutation[] = [];
          let snapshotId: string | null = null;

          if (bucketMutations.length > 0) {
            const snap = planProjectSnapshot({
              projectDir: family.project_dir,
              conlangFilePath: family.conlang_file_path,
              workspace: ws.config,
              origin: "mcp",
              operationType: "auto_snapshot",
              description: `Before lexicon_migrate_inherited_links (${stats.files_changed} bucket files)`,
            });
            snapshotId = snap.snapshotId;
            mutations.push(...snap.mutations, ...bucketMutations);
          }

          return {
            expectations,
            mutations,
            snapshotId,
            auditSummary: `Migrated inherited lexicon links (${stats.parent_link_filled} parent_entry_id, ${stats.source_language_filled} source_language_id, ${stats.origin_fixed} origin_type across ${stats.files_changed} files)`,
            buildDryRunResponse: (baseRevisions) => ({
              ...stats,
              dry_run: true,
              base_revisions: baseRevisions,
            }),
            buildResponse: (newRevisions, warnings) => {
              const latestLexRevs: Record<string, string> = {};
              for (const lang of ws.config.languages) {
                if (!lang.parent_id) continue;
                const lDir = assertSafeRelativeLanguagePath(
                  family.project_dir,
                  lang.path,
                );
                latestLexRevs[`lexicon:${lang.language_id}`] =
                  computeLexiconRevision(path.join(lDir, "lexicon"));
              }
              return {
                operation_id: operationId,
                committed: true,
                changed: stats.files_changed > 0,
                snapshot_id: snapshotId,
                revision: computeFileRevision(family.conlang_file_path),
                revisions: { ...newRevisions, ...latestLexRevs },
                stats,
                summary: `Processed ${stats.languages_processed} daughter language(s); updated ${stats.files_changed} bucket file(s).`,
                warnings: warnings.length > 0 ? warnings : undefined,
              };
            },
          };
        },
      });
    },
  });
}
