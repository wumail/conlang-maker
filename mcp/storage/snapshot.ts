import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  LanguageEntry,
  OperationLog,
  OperationLogEntry,
  OperationType,
  SnapshotDiffSummary,
  SnapshotOrigin,
  SnapshotScope,
  SnapshotSummary,
  TrashedLanguageEntry,
  WorkspaceConfig,
} from "../../src/types";
import { loadProjectMcpSettings } from "../config";
import { McpError } from "../errors";
import { assertSafeRelativeLanguagePath } from "../registry/addressing";
import { sha256FullHex } from "./revision";
import type { PlannedMutation } from "./transaction";

export interface SnapshotFileRecord {
  rel_path: string;
  existed: boolean;
  sha256?: string;
  stored_rel?: string;
}

export interface LanguageSnapshotManifestV1 {
  version: number;
  level: "language";
  log_id: string;
  scope: Exclude<SnapshotScope, "project">;
  origin: SnapshotOrigin;
  created_at: string;
  language_id?: string;
  language_path?: string;
  font_file?: string;
  dir_existed?: boolean;
  files: SnapshotFileRecord[];
}

export interface ProjectSnapshotLangRecord {
  language_id: string;
  entry: LanguageEntry;
  rel_path: string;
  dir_existed: boolean;
}

export interface ProjectSnapshotManifestV2 {
  version: number;
  snapshot_id: string;
  level: "project";
  scope: "project";
  origin: SnapshotOrigin;
  operation_type: string;
  description: string;
  created_at: string;
  timestamp: string;
  restored_from?: string;
  conlang_rel_path?: string;
  conlang_existed: boolean;
  workspace_config?: WorkspaceConfig;
  affected_languages: ProjectSnapshotLangRecord[];
  files: SnapshotFileRecord[];
}

export interface ProjectSnapshotIndexEntry {
  snapshot_id: string;
  operation_type: string;
  description: string;
  timestamp: string;
  created_at: string;
  origin: SnapshotOrigin;
  restored_from?: string;
  snapshot_dir: string;
}

interface ProjectSnapshotIndex {
  max_snapshots: number;
  entries: ProjectSnapshotIndexEntry[];
}

interface ArchivedLanguageMeta {
  language_id: string;
  operation_id: string;
  archived_at: string;
  original_entry: LanguageEntry;
  original_path: string;
  baseline_snapshot_id: string;
}

interface TrashMetaRecord {
  trash_id: string;
  language_id: string;
  name: string;
  original_path: string;
  parent_id: string | null;
  deleted_at: string;
  operation_id: string;
  project_snapshot_id?: string;
  original_entry?: LanguageEntry;
  dir_existed: boolean;
}

const sessionTouchedScopes = new Set<string>();

export function shouldAutoSnapshot(opts: {
  projectDir: string;
  languageId: string | null;
  scope: SnapshotScope;
  batchSize?: number;
  mandatory?: boolean;
}): boolean {
  if (opts.mandatory) {
    return true;
  }
  const settings = loadProjectMcpSettings(opts.projectDir);
  if (settings.autoSnapshot === "off") {
    return false;
  }
  if (settings.autoSnapshot === "always") {
    return true;
  }
  if ((opts.batchSize ?? 1) >= settings.autoSnapshotThreshold) {
    return true;
  }
  const key = `${opts.projectDir}::${opts.languageId ?? "PROJECT"}::${opts.scope}`;
  return !sessionTouchedScopes.has(key);
}

export function markSessionScopeWritten(
  projectDir: string,
  languageId: string | null,
  scope: SnapshotScope,
): void {
  const key = `${projectDir}::${languageId ?? "PROJECT"}::${scope}`;
  sessionTouchedScopes.add(key);
}

export function generateSnapshotId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function nowEpochSecsStr(): string {
  return Math.floor(Date.now() / 1000).toString();
}

function normalizeTimestampForSummary(
  ts: string,
  fallbackCreatedAt?: string,
): string {
  if (fallbackCreatedAt && fallbackCreatedAt.trim().length > 0) {
    return fallbackCreatedAt;
  }
  const trimmed = ts.trim();
  if (/^\d+$/.test(trimmed)) {
    const secs = Number.parseInt(trimmed, 10);
    if (Number.isFinite(secs)) {
      return new Date(secs * 1000).toISOString();
    }
  }
  return ts;
}

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function collectScopeCaptureInfo(
  langDir: string,
  scope: Exclude<SnapshotScope, "project">,
): {
  paths: string[];
  fontFile?: string;
  dirExisted?: boolean;
} {
  switch (scope) {
    case "phonology":
      return { paths: ["phonology.json"] };
    case "grammar":
      return { paths: ["grammar.json"] };
    case "sca":
      return { paths: ["sca_rules.json"] };
    case "font": {
      let fontFile: string | undefined;
      for (const f of ["font.otf", "font.ttf"]) {
        if (fs.existsSync(path.join(langDir, f))) {
          fontFile = f;
          break;
        }
      }
      return { paths: ["font.otf", "font.ttf"], fontFile };
    }
    case "lexicon":
    case "corpus": {
      const subDir = path.join(langDir, scope);
      const exists = fs.existsSync(subDir) && fs.statSync(subDir).isDirectory();
      if (!exists) {
        return { paths: [], dirExisted: false };
      }
      const names = fs
        .readdirSync(subDir, { withFileTypes: true })
        .filter((d) => d.isFile() && !d.name.endsWith(".tmp"))
        .map((d) => `${scope}/${d.name}`)
        .sort();
      return { paths: names, dirExisted: true };
    }
  }
}

export function readLanguageOperationLog(langDir: string): OperationLog {
  const oplogPath = path.join(langDir, ".oplog", "oplog.json");
  if (!fs.existsSync(oplogPath)) {
    return { max_snapshots: 10, entries: [] };
  }
  const raw = JSON.parse(fs.readFileSync(oplogPath, "utf-8")) as Partial<OperationLog>;
  return {
    max_snapshots: typeof raw.max_snapshots === "number" ? raw.max_snapshots : 10,
    entries: Array.isArray(raw.entries) ? raw.entries : [],
  };
}

export function collectProtectedSnapshotIds(projectDir: string): Set<string> {
  const protectedIds = new Set<string>();

  const archRoot = path.join(
    projectDir,
    ".conlang-maker",
    "snapshots",
    "archived_languages",
  );
  if (fs.existsSync(archRoot)) {
    for (const langEntry of fs.readdirSync(archRoot, { withFileTypes: true })) {
      if (!langEntry.isDirectory()) continue;
      const langArchDir = path.join(archRoot, langEntry.name);
      for (const opEntry of fs.readdirSync(langArchDir, { withFileTypes: true })) {
        if (!opEntry.isDirectory()) continue;
        const metaPath = path.join(langArchDir, opEntry.name, "archive_meta.json");
        if (!fs.existsSync(metaPath)) continue;
        try {
          const meta = JSON.parse(
            fs.readFileSync(metaPath, "utf-8"),
          ) as Partial<ArchivedLanguageMeta>;
          if (typeof meta.baseline_snapshot_id === "string") {
            protectedIds.add(meta.baseline_snapshot_id);
          }
        } catch (err) {
          console.warn("Skipping unreadable archive_meta.json:", err);
        }
      }
    }
  }

  const trashRoot = path.join(projectDir, ".conlang-maker", "trash");
  if (fs.existsSync(trashRoot)) {
    for (const entry of fs.readdirSync(trashRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(trashRoot, entry.name, "meta.json");
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(
          fs.readFileSync(metaPath, "utf-8"),
        ) as Partial<TrashMetaRecord>;
        if (typeof meta.project_snapshot_id === "string") {
          protectedIds.add(meta.project_snapshot_id);
        }
      } catch (err) {
        console.warn("Skipping unreadable trash meta.json:", err);
      }
    }
  }

  return protectedIds;
}

/**
 * Stages a language-level snapshot (`manifest.json` v1) matching Rust `oplog.rs`.
 */
export function planLanguageSnapshot(opts: {
  projectDir: string;
  language: LanguageEntry;
  scope: Exclude<SnapshotScope, "project">;
  origin?: SnapshotOrigin;
  operationType?: OperationType;
  description: string;
  restoredFrom?: string | null;
}): {
  snapshotId: string;
  mutations: PlannedMutation[];
} {
  const origin = opts.origin ?? "mcp";
  const opType = opts.operationType ?? "auto_snapshot";
  const langDir = assertSafeRelativeLanguagePath(
    opts.projectDir,
    opts.language.path,
  );
  const langRel = normalizeRel(opts.language.path);
  const log = readLanguageOperationLog(langDir);

  const logId = generateSnapshotId();
  const snapDirName = `snap_${logId}`;
  const snapRelBase = `${langRel}/.oplog/${snapDirName}`;
  const createdAt = new Date().toISOString();
  const epochSecs = nowEpochSecsStr();

  const { paths, fontFile, dirExisted } = collectScopeCaptureInfo(
    langDir,
    opts.scope,
  );
  const fileRecords: SnapshotFileRecord[] = [];
  const mutations: PlannedMutation[] = [];

  for (const rel of paths) {
    const abs = path.join(langDir, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const bytes = fs.readFileSync(abs);
      const storedRel = `files/${rel}`;
      mutations.push({
        kind: "write_file",
        relPath: `${snapRelBase}/${storedRel}`,
        content: bytes,
      });
      fileRecords.push({
        rel_path: rel,
        existed: true,
        sha256: sha256FullHex(bytes),
        stored_rel: storedRel,
      });
    } else {
      fileRecords.push({
        rel_path: rel,
        existed: false,
      });
    }
  }

  const manifest: LanguageSnapshotManifestV1 = {
    version: 1,
    level: "language",
    log_id: logId,
    scope: opts.scope,
    origin,
    created_at: createdAt,
    language_id: opts.language.language_id,
    language_path: langRel,
    ...(fontFile !== undefined ? { font_file: fontFile } : {}),
    ...(dirExisted !== undefined ? { dir_existed: dirExisted } : {}),
    files: fileRecords,
  };

  mutations.push({
    kind: "write_file",
    relPath: `${snapRelBase}/manifest.json`,
    content: JSON.stringify(manifest, null, 2),
  });

  const newEntry: OperationLogEntry = {
    log_id: logId,
    operation_type: opType,
    timestamp: epochSecs,
    source_language_id: opts.language.language_id,
    target_language_id: opts.language.language_id,
    description: opts.description,
    snapshot_dir: snapDirName,
    origin,
    scope: opts.scope,
    level: "language",
    ...(opts.restoredFrom ? { restored_from: opts.restoredFrom } : {}),
  };

  const nextEntries = [...log.entries, newEntry];
  const protectedIds = collectProtectedSnapshotIds(opts.projectDir);
  for (const e of nextEntries) {
    if (e.restored_from) protectedIds.add(e.restored_from);
  }

  while (nextEntries.length > Math.max(1, log.max_snapshots)) {
    const candidateIdx = nextEntries.findIndex(
      (e) => e.log_id !== logId && !protectedIds.has(e.log_id),
    );
    if (candidateIdx < 0) break;
    const [removed] = nextEntries.splice(candidateIdx, 1);
    mutations.push({
      kind: "delete_path",
      relPath: `${langRel}/.oplog/${removed.snapshot_dir}`,
    });
  }

  const nextLog: OperationLog = {
    ...log,
    entries: nextEntries,
  };

  mutations.push({
    kind: "write_file",
    relPath: `${langRel}/.oplog/oplog.json`,
    content: JSON.stringify(nextLog, null, 2),
  });

  return { snapshotId: logId, mutations };
}

function isExcludedProjectRel(rel: string): boolean {
  if (rel.endsWith(".tmp")) return true;
  if (rel === ".conlang-maker" || rel.startsWith(".conlang-maker/")) return true;
  if (
    rel.includes("/.oplog/") ||
    rel.endsWith("/.oplog") ||
    rel === ".oplog" ||
    rel.startsWith(".oplog/")
  ) {
    return true;
  }
  if (
    rel === ".git" ||
    rel.startsWith(".git/") ||
    rel === ".DS_Store" ||
    rel.endsWith("/.DS_Store")
  ) {
    return true;
  }
  return false;
}

function collectProjectBusinessFilesRecursive(projectDir: string): string[] {
  if (!fs.existsSync(projectDir)) return [];
  const results: string[] = [];

  const walk = (curAbs: string): void => {
    const entries = fs
      .readdirSync(curAbs, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(curAbs, entry.name);
      const rel = normalizeRel(path.relative(projectDir, abs));
      if (!rel || isExcludedProjectRel(rel)) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        results.push(rel);
      }
    }
  };

  walk(projectDir);
  return Array.from(new Set(results)).sort();
}

function readProjectSnapshotIndex(projectDir: string): ProjectSnapshotIndex {
  const idxPath = path.join(
    projectDir,
    ".conlang-maker",
    "snapshots",
    "index.json",
  );
  if (!fs.existsSync(idxPath)) {
    return { max_snapshots: 20, entries: [] };
  }
  const raw = JSON.parse(
    fs.readFileSync(idxPath, "utf-8"),
  ) as Partial<ProjectSnapshotIndex>;
  return {
    max_snapshots: typeof raw.max_snapshots === "number" ? raw.max_snapshots : 20,
    entries: Array.isArray(raw.entries) ? raw.entries : [],
  };
}

/**
 * Stages a project-level snapshot (`manifest.json` v2 + `index.json`) matching Rust `oplog.rs`.
 */
export function planProjectSnapshot(opts: {
  projectDir: string;
  conlangFilePath: string;
  workspace: WorkspaceConfig;
  origin?: SnapshotOrigin;
  operationType?: OperationType;
  description: string;
  restoredFrom?: string | null;
  extraProtectedIds?: Iterable<string>;
}): {
  snapshotId: string;
  mutations: PlannedMutation[];
} {
  const origin = opts.origin ?? "mcp";
  const opType = opts.operationType ?? "auto_snapshot";
  const snapshotId = generateSnapshotId();
  const snapDirName = `snap_${snapshotId}`;
  const snapRelBase = `.conlang-maker/snapshots/${snapDirName}`;
  const createdAt = new Date().toISOString();
  const epochSecs = nowEpochSecsStr();

  const conlangRel = normalizeRel(
    path.relative(opts.projectDir, opts.conlangFilePath),
  );
  const conlangExisted =
    fs.existsSync(opts.conlangFilePath) &&
    fs.statSync(opts.conlangFilePath).isFile();

  const affectedLanguages: ProjectSnapshotLangRecord[] =
    opts.workspace.languages.map((lang) => {
      const relPath = normalizeRel(lang.path);
      const dirExisted =
        fs.existsSync(path.join(opts.projectDir, relPath)) &&
        fs.statSync(path.join(opts.projectDir, relPath)).isDirectory();
      return {
        language_id: lang.language_id,
        entry: lang,
        rel_path: relPath,
        dir_existed: dirExisted,
      };
    });

  const businessRels = collectProjectBusinessFilesRecursive(opts.projectDir);
  const fileRecords: SnapshotFileRecord[] = [];
  const mutations: PlannedMutation[] = [];

  for (const rel of businessRels) {
    const abs = path.join(opts.projectDir, rel);
    const bytes = fs.readFileSync(abs);
    const storedRel = `files/${rel}`;
    mutations.push({
      kind: "write_file",
      relPath: `${snapRelBase}/${storedRel}`,
      content: bytes,
    });
    fileRecords.push({
      rel_path: rel,
      existed: true,
      sha256: sha256FullHex(bytes),
      stored_rel: storedRel,
    });
  }

  const manifest: ProjectSnapshotManifestV2 = {
    version: 2,
    snapshot_id: snapshotId,
    level: "project",
    scope: "project",
    origin,
    operation_type: opType,
    description: opts.description,
    created_at: createdAt,
    timestamp: epochSecs,
    ...(opts.restoredFrom ? { restored_from: opts.restoredFrom } : {}),
    conlang_rel_path: conlangRel,
    conlang_existed: conlangExisted,
    workspace_config: opts.workspace,
    affected_languages: affectedLanguages,
    files: fileRecords,
  };

  mutations.push({
    kind: "write_file",
    relPath: `${snapRelBase}/manifest.json`,
    content: JSON.stringify(manifest, null, 2),
  });

  const index = readProjectSnapshotIndex(opts.projectDir);
  const indexEntry: ProjectSnapshotIndexEntry = {
    snapshot_id: snapshotId,
    operation_type: opType,
    description: opts.description,
    timestamp: epochSecs,
    created_at: createdAt,
    origin,
    ...(opts.restoredFrom ? { restored_from: opts.restoredFrom } : {}),
    snapshot_dir: snapDirName,
  };

  const nextEntries = [...index.entries, indexEntry];
  const protectedIds = collectProtectedSnapshotIds(opts.projectDir);
  if (opts.extraProtectedIds) {
    for (const id of opts.extraProtectedIds) protectedIds.add(id);
  }
  for (const e of nextEntries) {
    if (e.restored_from) protectedIds.add(e.restored_from);
  }

  while (nextEntries.length > Math.max(1, index.max_snapshots)) {
    const idx = nextEntries.findIndex(
      (e) => e.snapshot_id !== snapshotId && !protectedIds.has(e.snapshot_id),
    );
    if (idx < 0) break;
    const [removed] = nextEntries.splice(idx, 1);
    const dirToDelete = removed.snapshot_dir || `snap_${removed.snapshot_id}`;
    mutations.push({
      kind: "delete_path",
      relPath: `.conlang-maker/snapshots/${dirToDelete}`,
    });
  }

  mutations.push({
    kind: "write_file",
    relPath: `.conlang-maker/snapshots/index.json`,
    content: JSON.stringify({ ...index, entries: nextEntries }, null, 2),
  });

  return { snapshotId, mutations };
}

function findLatestArchivedLanguage(
  projectDir: string,
  languageId: string,
): { opDir: string; meta: ArchivedLanguageMeta } | null {
  const archLangDir = path.join(
    projectDir,
    ".conlang-maker",
    "snapshots",
    "archived_languages",
    languageId,
  );
  if (!fs.existsSync(archLangDir)) return null;

  const candidates: { archivedAt: string; opDir: string; meta: ArchivedLanguageMeta }[] = [];
  for (const entry of fs.readdirSync(archLangDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const opDir = path.join(archLangDir, entry.name);
    const metaPath = path.join(opDir, "archive_meta.json");
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(
        fs.readFileSync(metaPath, "utf-8"),
      ) as ArchivedLanguageMeta;
      candidates.push({ archivedAt: meta.archived_at ?? "", opDir, meta });
    } catch (err) {
      console.warn("Skipping unreadable archive_meta.json:", err);
    }
  }
  candidates.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  const best = candidates[0];
  return best ? { opDir: best.opDir, meta: best.meta } : null;
}

function loadLanguageSnapshotManifestCompat(
  snapDir: string,
  fallbackEntry?: OperationLogEntry,
): LanguageSnapshotManifestV1 {
  const manifestPath = path.join(snapDir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const rawScope = Array.isArray(raw.scope)
      ? String(raw.scope[0] ?? "lexicon")
      : typeof raw.scope === "string" && raw.scope.trim().length > 0
        ? raw.scope
        : "lexicon";
    const scope = rawScope as Exclude<SnapshotScope, "project">;
    const logId =
      (typeof raw.log_id === "string" && raw.log_id) ||
      (typeof raw.logId === "string" && raw.logId) ||
      (typeof raw.snapshot_id === "string" && raw.snapshot_id) ||
      fallbackEntry?.log_id ||
      "";
    const origin = (
      typeof raw.origin === "string" ? raw.origin : fallbackEntry?.origin ?? "gui"
    ) as SnapshotOrigin;
    const createdAt =
      (typeof raw.created_at === "string" && raw.created_at) ||
      (typeof raw.createdAt === "string" && raw.createdAt) ||
      "";
    let files = Array.isArray(raw.files)
      ? (raw.files as SnapshotFileRecord[])
      : [];
    let dirExisted =
      typeof raw.dir_existed === "boolean" ? raw.dir_existed : undefined;

    if (files.length === 0 && (scope === "lexicon" || scope === "corpus")) {
      const directSub = path.join(snapDir, scope);
      if (fs.existsSync(directSub) && fs.statSync(directSub).isDirectory()) {
        dirExisted = true;
        files = fs
          .readdirSync(directSub, { withFileTypes: true })
          .filter((d) => d.isFile())
          .map((d) => d.name)
          .sort()
          .map((name) => {
            const bytes = fs.readFileSync(path.join(directSub, name));
            return {
              rel_path: `${scope}/${name}`,
              existed: true,
              sha256: sha256FullHex(bytes),
              stored_rel: `${scope}/${name}`,
            };
          });
      }
    }

    return {
      version: typeof raw.version === "number" ? raw.version : 1,
      level: "language",
      log_id: logId,
      scope,
      origin,
      created_at: createdAt,
      language_id:
        typeof raw.language_id === "string" ? raw.language_id : undefined,
      language_path:
        typeof raw.language_path === "string" ? raw.language_path : undefined,
      font_file: typeof raw.font_file === "string" ? raw.font_file : undefined,
      dir_existed: dirExisted,
      files,
    };
  }

  // Legacy manifest-less snapshot (<snap_dir>/lexicon/*.ndjson) -> treat as scope "lexicon"
  const lexDir = path.join(snapDir, "lexicon");
  const files: SnapshotFileRecord[] = [];
  if (fs.existsSync(lexDir) && fs.statSync(lexDir).isDirectory()) {
    for (const f of fs
      .readdirSync(lexDir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .sort()) {
      const bytes = fs.readFileSync(path.join(lexDir, f));
      files.push({
        rel_path: `lexicon/${f}`,
        existed: true,
        sha256: sha256FullHex(bytes),
        stored_rel: `lexicon/${f}`,
      });
    }
  }

  return {
    version: 0,
    level: "language",
    log_id: fallbackEntry?.log_id ?? "",
    scope: "lexicon",
    origin: fallbackEntry?.origin ?? "gui",
    created_at: fallbackEntry
      ? normalizeTimestampForSummary(fallbackEntry.timestamp)
      : new Date().toISOString(),
    language_id: fallbackEntry?.target_language_id,
    dir_existed: true,
    files,
  };
}

function collectSummariesFromOplog(
  oplogBase: string,
  languageId: string,
  archived: boolean,
  filterScope: SnapshotScope | undefined,
  out: SnapshotSummary[],
): void {
  const oplogFile = path.join(oplogBase, "oplog.json");
  if (!fs.existsSync(oplogFile)) return;
  const raw = JSON.parse(
    fs.readFileSync(oplogFile, "utf-8"),
  ) as Partial<OperationLog>;
  for (const entry of raw.entries ?? []) {
    const snapDir = path.join(oplogBase, entry.snapshot_dir);
    let manifestOpt: LanguageSnapshotManifestV1 | null = null;
    try {
      manifestOpt = loadLanguageSnapshotManifestCompat(snapDir, entry);
    } catch {
      manifestOpt = null;
    }
    const scope: SnapshotScope =
      entry.scope ?? manifestOpt?.scope ?? "lexicon";
    if (filterScope && scope !== filterScope) continue;
    const origin: SnapshotOrigin =
      entry.origin ?? manifestOpt?.origin ?? "gui";
    const ts = normalizeTimestampForSummary(
      entry.timestamp,
      manifestOpt?.created_at,
    );
    out.push({
      snapshot_id: entry.log_id,
      level: "language",
      scope,
      origin,
      language_id: languageId,
      operation_type: entry.operation_type,
      description: entry.description,
      timestamp: ts,
      restored_from: entry.restored_from ?? null,
      archived_language: archived,
    });
  }
}

export function listSnapshotsUnlocked(
  projectDir: string,
  workspace: WorkspaceConfig,
  filterLanguageId?: string,
  filterScope?: SnapshotScope,
): SnapshotSummary[] {
  const summaries: SnapshotSummary[] = [];

  // 1. Project-level snapshots
  if (!filterLanguageId && (!filterScope || filterScope === "project")) {
    const projIdx = readProjectSnapshotIndex(projectDir);
    for (const e of projIdx.entries) {
      summaries.push({
        snapshot_id: e.snapshot_id,
        level: "project",
        scope: "project",
        origin: e.origin ?? "gui",
        language_id: null,
        operation_type: e.operation_type,
        description: e.description,
        timestamp: normalizeTimestampForSummary(e.timestamp, e.created_at),
        restored_from: e.restored_from ?? null,
        archived_language: false,
      });
    }
  }

  // 2. Active language-level snapshots
  const seenActive = new Set<string>();
  for (const lang of workspace.languages) {
    seenActive.add(lang.language_id);
    if (filterLanguageId && lang.language_id !== filterLanguageId) continue;
    const langDir = assertSafeRelativeLanguagePath(projectDir, lang.path);
    collectSummariesFromOplog(
      path.join(langDir, ".oplog"),
      lang.language_id,
      false,
      filterScope,
      summaries,
    );
  }

  // 3. Archived language oplogs (for languages removed by project rollback, §3.6)
  const archivedRoot = path.join(
    projectDir,
    ".conlang-maker",
    "snapshots",
    "archived_languages",
  );
  if (fs.existsSync(archivedRoot)) {
    const archLangIds = filterLanguageId
      ? [filterLanguageId]
      : fs
          .readdirSync(archivedRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);

    for (const archLangId of archLangIds) {
      if (seenActive.has(archLangId)) continue;
      const latest = findLatestArchivedLanguage(projectDir, archLangId);
      if (!latest) continue;
      collectSummariesFromOplog(
        path.join(latest.opDir, ".oplog"),
        archLangId,
        true,
        filterScope,
        summaries,
      );
    }
  }

  return summaries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function resolveLanguageSnapshotTarget(
  projectDir: string,
  workspace: WorkspaceConfig,
  snapshotId: string,
  languageId?: string,
): {
  snapDir: string;
  entry?: OperationLogEntry;
  languageEntry: LanguageEntry;
  isArchivedLanguage: boolean;
  archivedOpDir?: string;
  archivedMeta?: ArchivedLanguageMeta;
} | null {
  const candidates = languageId
    ? workspace.languages.filter((l) => l.language_id === languageId)
    : workspace.languages;

  for (const lang of candidates) {
    const langDir = assertSafeRelativeLanguagePath(projectDir, lang.path);
    const log = readLanguageOperationLog(langDir);
    const found = log.entries.find((e) => e.log_id === snapshotId);
    if (found) {
      return {
        snapDir: path.join(langDir, ".oplog", found.snapshot_dir),
        entry: found,
        languageEntry: lang,
        isArchivedLanguage: false,
      };
    }
  }

  const archivedRoot = path.join(
    projectDir,
    ".conlang-maker",
    "snapshots",
    "archived_languages",
  );
  if (fs.existsSync(archivedRoot)) {
    const archIds = languageId
      ? [languageId]
      : fs
          .readdirSync(archivedRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);

    for (const archId of archIds) {
      if (workspace.languages.some((l) => l.language_id === archId)) continue;
      const latest = findLatestArchivedLanguage(projectDir, archId);
      if (!latest) continue;
      const oplogFile = path.join(latest.opDir, ".oplog", "oplog.json");
      if (!fs.existsSync(oplogFile)) continue;
      const log = JSON.parse(
        fs.readFileSync(oplogFile, "utf-8"),
      ) as Partial<OperationLog>;
      const found = (log.entries ?? []).find((e) => e.log_id === snapshotId);
      if (found) {
        return {
          snapDir: path.join(latest.opDir, ".oplog", found.snapshot_dir),
          entry: found,
          languageEntry: latest.meta.original_entry,
          isArchivedLanguage: true,
          archivedOpDir: latest.opDir,
          archivedMeta: latest.meta,
        };
      }
    }
  }

  return null;
}

function planApplyLanguageManifest(
  projectDir: string,
  langRelPath: string,
  snapDir: string,
  manifest: LanguageSnapshotManifestV1,
  virtualCurrent?: Map<string, Buffer>,
): { diff: SnapshotDiffSummary; mutations: PlannedMutation[] } {
  const langRel = normalizeRel(langRelPath);
  const langDir = path.join(projectDir, langRel);

  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const mutations: PlannedMutation[] = [];

  const currentShaOf = (projRel: string): string | null => {
    if (virtualCurrent) {
      const buf = virtualCurrent.get(projRel);
      return buf ? sha256FullHex(buf) : null;
    }
    const p = path.join(projectDir, projRel);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return sha256FullHex(fs.readFileSync(p));
    }
    return null;
  };

  if (manifest.scope === "lexicon" || manifest.scope === "corpus") {
    const subRel = `${langRel}/${manifest.scope}`;
    const snapExisting = new Set(
      manifest.files
        .filter((f) => f.existed)
        .map((f) => `${langRel}/${f.rel_path}`),
    );

    const currentSubFiles: string[] = [];
    if (virtualCurrent) {
      const prefix = `${subRel}/`;
      for (const k of virtualCurrent.keys()) {
        if (k.startsWith(prefix)) currentSubFiles.push(k);
      }
    } else {
      const subAbs = path.join(langDir, manifest.scope);
      if (fs.existsSync(subAbs) && fs.statSync(subAbs).isDirectory()) {
        for (const d of fs.readdirSync(subAbs, { withFileTypes: true })) {
          if (d.isFile()) {
            currentSubFiles.push(`${subRel}/${d.name}`);
          }
        }
      }
    }
    currentSubFiles.sort();

    for (const curRel of currentSubFiles) {
      if (!snapExisting.has(curRel)) {
        removed.push(curRel);
        mutations.push({ kind: "delete_path", relPath: curRel });
      }
    }

    if (manifest.dir_existed === false && snapExisting.size === 0) {
      mutations.push({ kind: "delete_path", relPath: subRel });
    }
  }

  for (const rec of manifest.files) {
    const projRel = `${langRel}/${rec.rel_path}`;
    const curSha = currentShaOf(projRel);
    if (rec.existed && rec.stored_rel) {
      const bytes = fs.readFileSync(path.join(snapDir, rec.stored_rel));
      const targetSha = sha256FullHex(bytes);
      if (curSha === null) {
        added.push(projRel);
      } else if (curSha !== targetSha) {
        changed.push(projRel);
      }
      mutations.push({
        kind: "write_file",
        relPath: projRel,
        content: bytes,
      });
    } else if (!rec.existed && curSha !== null) {
      removed.push(projRel);
      mutations.push({ kind: "delete_path", relPath: projRel });
    }
  }

  return {
    diff: {
      snapshot_id: manifest.log_id,
      level: "language",
      scope: manifest.scope,
      changed_files: changed.sort(),
      added_files: added.sort(),
      removed_files: removed.sort(),
      conflicts: [],
    },
    mutations,
  };
}

export function diffSnapshotUnlocked(
  projectDir: string,
  _conlangFilePath: string,
  workspace: WorkspaceConfig,
  snapshotId: string,
  languageId?: string,
): SnapshotDiffSummary {
  const projSnapDir = path.join(
    projectDir,
    ".conlang-maker",
    "snapshots",
    `snap_${snapshotId}`,
  );
  if (!languageId && fs.existsSync(path.join(projSnapDir, "manifest.json"))) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projSnapDir, "manifest.json"), "utf-8"),
    ) as ProjectSnapshotManifestV2;

    const currentRels = collectProjectBusinessFilesRecursive(projectDir);
    const snapMap = new Map(manifest.files.map((f) => [f.rel_path, f]));

    const changed: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];

    for (const curRel of currentRels) {
      const rec = snapMap.get(curRel);
      if (!rec || !rec.existed) {
        removed.push(curRel);
      }
    }

    for (const rec of manifest.files) {
      const abs = path.join(projectDir, rec.rel_path);
      const existsNow = fs.existsSync(abs) && fs.statSync(abs).isFile();
      if (rec.existed && !existsNow) {
        added.push(rec.rel_path);
      } else if (!rec.existed && existsNow) {
        if (!removed.includes(rec.rel_path)) removed.push(rec.rel_path);
      } else if (rec.existed && existsNow) {
        const nowSha = sha256FullHex(fs.readFileSync(abs));
        if (nowSha !== rec.sha256) {
          changed.push(rec.rel_path);
        }
      }
    }

    return {
      snapshot_id: snapshotId,
      level: "project",
      scope: "project",
      changed_files: changed.sort(),
      added_files: added.sort(),
      removed_files: removed.sort(),
      conflicts: [],
    };
  }

  const resolved = resolveLanguageSnapshotTarget(
    projectDir,
    workspace,
    snapshotId,
    languageId,
  );
  if (!resolved) {
    throw new McpError(
      "NOT_FOUND",
      `Snapshot "${snapshotId}" was not found.`,
      "Call snapshot_list to inspect available language and project snapshots.",
    );
  }

  const manifest = loadLanguageSnapshotManifestCompat(
    resolved.snapDir,
    resolved.entry,
  );
  const langRel = normalizeRel(
    resolved.archivedMeta?.original_path ?? resolved.languageEntry.path,
  );

  if (resolved.isArchivedLanguage && resolved.archivedMeta) {
    const conflicts: string[] = [];
    if (
      resolved.languageEntry.parent_id &&
      !workspace.languages.some(
        (l) => l.language_id === resolved.languageEntry.parent_id,
      )
    ) {
      conflicts.push(
        `Parent language "${resolved.languageEntry.parent_id}" does not exist in active workspace.`,
      );
    }
    if (
      workspace.languages.some(
        (l) => l.language_id === resolved.languageEntry.language_id,
      )
    ) {
      conflicts.push(
        `Language ID "${resolved.languageEntry.language_id}" already exists in active workspace.`,
      );
    }
    if (fs.existsSync(path.join(projectDir, langRel))) {
      conflicts.push(`Directory "${langRel}" already exists on disk.`);
    }

    const virtualCurrent = new Map<string, Buffer>();
    const baseDir = path.join(
      projectDir,
      ".conlang-maker",
      "snapshots",
      `snap_${resolved.archivedMeta.baseline_snapshot_id}`,
    );
    const addedSet = new Set<string>();
    if (fs.existsSync(path.join(baseDir, "manifest.json"))) {
      const baseManifest = JSON.parse(
        fs.readFileSync(path.join(baseDir, "manifest.json"), "utf-8"),
      ) as ProjectSnapshotManifestV2;
      for (const f of baseManifest.files) {
        if (f.rel_path.startsWith(`${langRel}/`) && f.existed && f.stored_rel) {
          const bytes = fs.readFileSync(path.join(baseDir, f.stored_rel));
          virtualCurrent.set(f.rel_path, bytes);
          addedSet.add(f.rel_path);
        }
      }
    }

    const { diff: scopeDiff } = planApplyLanguageManifest(
      projectDir,
      langRel,
      resolved.snapDir,
      manifest,
      virtualCurrent,
    );
    for (const f of scopeDiff.added_files) addedSet.add(f);
    for (const f of scopeDiff.changed_files) addedSet.add(f);
    for (const f of scopeDiff.removed_files) addedSet.delete(f);

    return {
      snapshot_id: snapshotId,
      level: "language",
      scope: manifest.scope,
      changed_files: [],
      added_files: Array.from(addedSet).sort(),
      removed_files: [],
      conflicts,
    };
  }

  const { diff } = planApplyLanguageManifest(
    projectDir,
    langRel,
    resolved.snapDir,
    manifest,
  );
  return {
    ...diff,
    snapshot_id: snapshotId,
  };
}

export function planSnapshotRollback(opts: {
  projectDir: string;
  conlangFilePath: string;
  workspace: WorkspaceConfig;
  snapshotId: string;
  languageId?: string;
  operationId: string;
  origin?: SnapshotOrigin;
}): {
  recoverySnapshotId: string;
  diff: SnapshotDiffSummary;
  mutations: PlannedMutation[];
} {
  const origin = opts.origin ?? "mcp";
  const diff = diffSnapshotUnlocked(
    opts.projectDir,
    opts.conlangFilePath,
    opts.workspace,
    opts.snapshotId,
    opts.languageId,
  );

  if (diff.conflicts.length > 0) {
    throw new McpError(
      "CONFLICT",
      `Cannot roll back snapshot "${opts.snapshotId}": ${diff.conflicts.join("; ")}`,
      "Resolve topology or path conflicts before rolling back.",
      { conflicts: diff.conflicts },
    );
  }

  const projSnapDir = path.join(
    opts.projectDir,
    ".conlang-maker",
    "snapshots",
    `snap_${opts.snapshotId}`,
  );

  if (
    diff.level === "project" &&
    fs.existsSync(path.join(projSnapDir, "manifest.json"))
  ) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projSnapDir, "manifest.json"), "utf-8"),
    ) as ProjectSnapshotManifestV2;

    // 1. Create non-destructive recovery point of current project state first
    const recovery = planProjectSnapshot({
      projectDir: opts.projectDir,
      conlangFilePath: opts.conlangFilePath,
      workspace: opts.workspace,
      origin,
      operationType: "rollback_recovery",
      description: `Recovery point before rolling back to project snapshot ${opts.snapshotId}`,
      restoredFrom: opts.snapshotId,
      extraProtectedIds: [opts.snapshotId],
    });

    const mutations: PlannedMutation[] = [...recovery.mutations];
    const targetLangIds = new Set(
      manifest.affected_languages.map((a) => a.language_id),
    );

    // 2. Archive .oplog of any currently-active language missing from target snapshot (§3.6)
    for (const curLang of opts.workspace.languages) {
      if (!targetLangIds.has(curLang.language_id)) {
        const curRel = normalizeRel(curLang.path);
        const absLangDir = path.join(opts.projectDir, curRel);
        const oplogDir = path.join(absLangDir, ".oplog");
        if (fs.existsSync(oplogDir) && fs.statSync(oplogDir).isDirectory()) {
          const archBase = `.conlang-maker/snapshots/archived_languages/${curLang.language_id}/op_${opts.operationId}`;
          const meta: ArchivedLanguageMeta = {
            language_id: curLang.language_id,
            operation_id: opts.operationId,
            archived_at: new Date().toISOString(),
            original_entry: curLang,
            original_path: curRel,
            baseline_snapshot_id: recovery.snapshotId,
          };
          mutations.push({
            kind: "write_file",
            relPath: `${archBase}/archive_meta.json`,
            content: JSON.stringify(meta, null, 2),
          });
          mutations.push({
            kind: "move_dir",
            fromRelPath: `${curRel}/.oplog`,
            toRelPath: `${archBase}/.oplog`,
          });
        }
        if (fs.existsSync(absLangDir)) {
          mutations.push({
            kind: "delete_path",
            relPath: curRel,
          });
        }
      }
    }

    // 3. Delete extra business files created after snapshot
    const currentRels = collectProjectBusinessFilesRecursive(opts.projectDir);
    const snapMap = new Map(manifest.files.map((f) => [f.rel_path, f]));
    for (const curRel of currentRels) {
      const rec = snapMap.get(curRel);
      if (!rec || !rec.existed) {
        mutations.push({
          kind: "delete_path",
          relPath: curRel,
        });
      }
    }

    // 4. Restore all recorded files from snapshot
    for (const rec of manifest.files) {
      if (rec.existed && rec.stored_rel) {
        const bytes = fs.readFileSync(path.join(projSnapDir, rec.stored_rel));
        mutations.push({
          kind: "write_file",
          relPath: rec.rel_path,
          content: bytes,
        });
      } else if (!rec.existed) {
        mutations.push({
          kind: "delete_path",
          relPath: rec.rel_path,
        });
      }
    }

    return {
      recoverySnapshotId: recovery.snapshotId,
      diff,
      mutations,
    };
  }

  // Language-level snapshot rollback
  const resolved = resolveLanguageSnapshotTarget(
    opts.projectDir,
    opts.workspace,
    opts.snapshotId,
    opts.languageId,
  );
  if (!resolved) {
    throw new McpError("NOT_FOUND", `Snapshot "${opts.snapshotId}" not found.`);
  }

  const manifest = loadLanguageSnapshotManifestCompat(
    resolved.snapDir,
    resolved.entry,
  );
  const langRel = normalizeRel(
    resolved.archivedMeta?.original_path ?? resolved.languageEntry.path,
  );

  const mutations: PlannedMutation[] = [];
  let recoverySnapshotId: string;

  if (resolved.isArchivedLanguage && resolved.archivedOpDir && resolved.archivedMeta) {
    const projRecovery = planProjectSnapshot({
      projectDir: opts.projectDir,
      conlangFilePath: opts.conlangFilePath,
      workspace: opts.workspace,
      origin,
      operationType: "rollback_recovery",
      description: `Project recovery point before restoring archived language ${resolved.languageEntry.language_id}`,
      restoredFrom: opts.snapshotId,
      extraProtectedIds: [resolved.archivedMeta.baseline_snapshot_id],
    });
    recoverySnapshotId = projRecovery.snapshotId;
    mutations.push(...projRecovery.mutations);

    const virtualCurrent = new Map<string, Buffer>();
    const baseDir = path.join(
      opts.projectDir,
      ".conlang-maker",
      "snapshots",
      `snap_${resolved.archivedMeta.baseline_snapshot_id}`,
    );
    if (fs.existsSync(path.join(baseDir, "manifest.json"))) {
      const baseManifest = JSON.parse(
        fs.readFileSync(path.join(baseDir, "manifest.json"), "utf-8"),
      ) as ProjectSnapshotManifestV2;
      for (const f of baseManifest.files) {
        if (f.rel_path.startsWith(`${langRel}/`) && f.existed && f.stored_rel) {
          const bytes = fs.readFileSync(path.join(baseDir, f.stored_rel));
          virtualCurrent.set(f.rel_path, bytes);
          mutations.push({
            kind: "write_file",
            relPath: f.rel_path,
            content: bytes,
          });
        }
      }
    }

    mutations.push({
      kind: "move_dir",
      fromRelPath: normalizeRel(
        path.relative(opts.projectDir, path.join(resolved.archivedOpDir, ".oplog")),
      ),
      toRelPath: `${langRel}/.oplog`,
    });
    mutations.push({
      kind: "delete_path",
      relPath: normalizeRel(path.relative(opts.projectDir, resolved.archivedOpDir)),
    });

    const { mutations: scopeMutations } = planApplyLanguageManifest(
      opts.projectDir,
      langRel,
      resolved.snapDir,
      manifest,
      virtualCurrent,
    );
    mutations.push(...scopeMutations);

    const restoredEntry: LanguageEntry = {
      ...resolved.languageEntry,
      path: langRel,
    };
    const nextWs: WorkspaceConfig = {
      ...opts.workspace,
      languages: [...opts.workspace.languages, restoredEntry],
    };
    const conlangRel = normalizeRel(
      path.relative(opts.projectDir, opts.conlangFilePath),
    );
    mutations.push({
      kind: "write_file",
      relPath: conlangRel,
      content: JSON.stringify(nextWs, null, 2),
    });

    return {
      recoverySnapshotId,
      diff,
      mutations,
    };
  }

  // Active language: create non-destructive recovery point for the target scope first
  const recovery = planLanguageSnapshot({
    projectDir: opts.projectDir,
    language: resolved.languageEntry,
    scope: manifest.scope,
    origin,
    operationType: "rollback_recovery",
    description: `Recovery point before rolling back ${manifest.scope} to ${opts.snapshotId}`,
    restoredFrom: opts.snapshotId,
  });
  recoverySnapshotId = recovery.snapshotId;
  mutations.push(...recovery.mutations);

  const { mutations: scopeMutations } = planApplyLanguageManifest(
    opts.projectDir,
    langRel,
    resolved.snapDir,
    manifest,
  );
  mutations.push(...scopeMutations);

  return {
    recoverySnapshotId,
    diff,
    mutations,
  };
}

// ── §3.7 Language Trash ────────────────────────────────────────────────────

export function listTrashedLanguagesUnlocked(
  projectDir: string,
): TrashedLanguageEntry[] {
  const trashRoot = path.join(projectDir, ".conlang-maker", "trash");
  if (!fs.existsSync(trashRoot)) {
    return [];
  }
  const items: TrashedLanguageEntry[] = [];
  for (const d of fs.readdirSync(trashRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const metaPath = path.join(trashRoot, d.name, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    try {
      const record = JSON.parse(
        fs.readFileSync(metaPath, "utf-8"),
      ) as TrashMetaRecord;
      items.push({
        trash_id: record.trash_id,
        language_id: record.language_id,
        name: record.name,
        original_path: record.original_path,
        parent_id: record.parent_id,
        deleted_at: record.deleted_at,
        operation_id: record.operation_id,
        project_snapshot_id: record.project_snapshot_id ?? null,
        ...(record.original_entry ? { original_entry: record.original_entry } : {}),
      });
    } catch (err) {
      console.warn("Skipping unreadable trash meta.json:", err);
    }
  }
  return items.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}

function nowCompactUtc(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function planTrashLanguageDelete(opts: {
  projectDir: string;
  conlangFilePath: string;
  workspace: WorkspaceConfig;
  language: LanguageEntry;
  operationId: string;
  origin?: SnapshotOrigin;
}): {
  trashEntry: TrashedLanguageEntry;
  projectSnapshotId: string;
  mutations: PlannedMutation[];
} {
  const children = opts.workspace.languages.filter(
    (l) => l.parent_id === opts.language.language_id,
  );
  if (children.length > 0) {
    throw new McpError(
      "VALIDATION",
      `Cannot delete language "${opts.language.name}" (${opts.language.language_id}) because it has child languages: ${children.map((c) => c.language_id).join(", ")}.`,
      "Delete or reparent child languages first.",
      { child_language_ids: children.map((c) => c.language_id) },
    );
  }

  if (opts.workspace.languages.length <= 1) {
    throw new McpError(
      "VALIDATION",
      "Cannot delete the last language in the workspace.",
      "Fork or create another language first before deleting this one.",
    );
  }

  const snap = planProjectSnapshot({
    projectDir: opts.projectDir,
    conlangFilePath: opts.conlangFilePath,
    workspace: opts.workspace,
    origin: opts.origin ?? "mcp",
    operationType: "delete_language",
    description: `Before deleting language '${opts.language.name}' (${opts.language.language_id})`,
  });

  const trashId = `trash_${nowCompactUtc()}_${crypto.randomUUID().slice(0, 8)}`;
  const langRel = normalizeRel(opts.language.path);
  const dirExisted =
    fs.existsSync(path.join(opts.projectDir, langRel)) &&
    fs.statSync(path.join(opts.projectDir, langRel)).isDirectory();
  const trashBaseRel = `.conlang-maker/trash/${trashId}`;
  const deletedAt = new Date().toISOString();

  const metaRecord: TrashMetaRecord = {
    trash_id: trashId,
    language_id: opts.language.language_id,
    name: opts.language.name,
    original_path: opts.language.path,
    parent_id: opts.language.parent_id,
    deleted_at: deletedAt,
    operation_id: opts.operationId,
    project_snapshot_id: snap.snapshotId,
    original_entry: opts.language,
    dir_existed: dirExisted,
  };

  const trashEntry: TrashedLanguageEntry = {
    trash_id: trashId,
    language_id: opts.language.language_id,
    name: opts.language.name,
    original_path: opts.language.path,
    parent_id: opts.language.parent_id,
    deleted_at: deletedAt,
    operation_id: opts.operationId,
    project_snapshot_id: snap.snapshotId,
    original_entry: opts.language,
  };

  const nextWs: WorkspaceConfig = {
    ...opts.workspace,
    languages: opts.workspace.languages.filter(
      (l) => l.language_id !== opts.language.language_id,
    ),
  };
  const conlangRel = normalizeRel(
    path.relative(opts.projectDir, opts.conlangFilePath),
  );

  const mutations: PlannedMutation[] = [...snap.mutations];
  if (dirExisted) {
    mutations.push({
      kind: "move_dir",
      fromRelPath: langRel,
      toRelPath: `${trashBaseRel}/data`,
    });
  }
  mutations.push(
    {
      kind: "write_file",
      relPath: `${trashBaseRel}/meta.json`,
      content: JSON.stringify(metaRecord, null, 2),
    },
    {
      kind: "write_file",
      relPath: conlangRel,
      content: JSON.stringify(nextWs, null, 2),
    },
  );

  return {
    trashEntry,
    projectSnapshotId: snap.snapshotId,
    mutations,
  };
}

export function planTrashLanguageRestore(opts: {
  projectDir: string;
  conlangFilePath: string;
  workspace: WorkspaceConfig;
  trashId: string;
  origin?: SnapshotOrigin;
}): {
  restoredEntry: LanguageEntry;
  conflicts: string[];
  projectSnapshotId: string | null;
  mutations: PlannedMutation[];
} {
  const trashBaseRel = `.conlang-maker/trash/${opts.trashId}`;
  const trashAbs = path.join(opts.projectDir, trashBaseRel);
  const metaPath = path.join(trashAbs, "meta.json");
  const dataAbs = path.join(trashAbs, "data");

  if (!fs.existsSync(metaPath)) {
    throw new McpError(
      "NOT_FOUND",
      `Trashed language "${opts.trashId}" was not found in .conlang-maker/trash/.`,
      "Call language_trash_list to view available trash_id entries.",
    );
  }

  const record = JSON.parse(
    fs.readFileSync(metaPath, "utf-8"),
  ) as TrashMetaRecord & Record<string, unknown>;

  const conflicts: string[] = [];
  if (
    record.parent_id &&
    !opts.workspace.languages.some((l) => l.language_id === record.parent_id)
  ) {
    conflicts.push(
      `Parent language "${record.parent_id}" no longer exists in workspace.`,
    );
  }
  if (
    opts.workspace.languages.some((l) => l.language_id === record.language_id)
  ) {
    conflicts.push(
      `Language ID "${record.language_id}" already exists in workspace.`,
    );
  }
  const origRel = normalizeRel(record.original_path);
  if (
    opts.workspace.languages.some((l) => normalizeRel(l.path) === origRel) ||
    fs.existsSync(path.join(opts.projectDir, origRel))
  ) {
    conflicts.push(`Target directory path "${origRel}" is already occupied.`);
  }

  const restoredEntry: LanguageEntry = record.original_entry ?? {
    language_id: record.language_id,
    name: record.name,
    path: record.original_path,
    parent_id: record.parent_id,
  };

  if (conflicts.length > 0) {
    return {
      restoredEntry,
      conflicts,
      projectSnapshotId: null,
      mutations: [],
    };
  }

  const snap = planProjectSnapshot({
    projectDir: opts.projectDir,
    conlangFilePath: opts.conlangFilePath,
    workspace: opts.workspace,
    origin: opts.origin ?? "mcp",
    operationType: "restore_language",
    description: `Before restoring language '${restoredEntry.name}' (${restoredEntry.language_id}) from trash`,
  });

  const nextWs: WorkspaceConfig = {
    ...opts.workspace,
    languages: [...opts.workspace.languages, restoredEntry],
  };
  const conlangRel = normalizeRel(
    path.relative(opts.projectDir, opts.conlangFilePath),
  );

  const mutations: PlannedMutation[] = [...snap.mutations];
  if (fs.existsSync(dataAbs) && fs.statSync(dataAbs).isDirectory()) {
    mutations.push({
      kind: "move_dir",
      fromRelPath: `${trashBaseRel}/data`,
      toRelPath: origRel,
    });
  }
  mutations.push(
    {
      kind: "delete_path",
      relPath: trashBaseRel,
    },
    {
      kind: "write_file",
      relPath: conlangRel,
      content: JSON.stringify(nextWs, null, 2),
    },
  );

  return {
    restoredEntry,
    conflicts: [],
    projectSnapshotId: snap.snapshotId,
    mutations,
  };
}
