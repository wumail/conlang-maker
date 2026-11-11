import fs from "node:fs";
import path from "node:path";
import type {
  FamilyEntry,
  GlobalRegistry,
  LanguageEntry,
  WorkspaceConfig,
} from "../../src/types";
import type { McpConfig } from "../config";
import { McpError } from "../errors";
import { atomicWriteFileSync } from "../storage/atomicWrite";
import { withDirectoryLock } from "../storage/lock";
import {
  canonicalizeConlangPath,
  computeFamilyId,
  computeFileRevision,
  MISSING_REVISION,
} from "../storage/revision";

export interface ResolvedFamily {
  family_id: string;
  name: string;
  conlang_file_path: string;
  project_dir: string;
  is_active: boolean;
  last_opened: string;
  exists: boolean;
}

export interface RegistrySnapshot {
  registry: GlobalRegistry;
  registry_revision: string;
  families: ResolvedFamily[];
}

export interface ResolvedLanguage {
  family: ResolvedFamily;
  workspace: WorkspaceConfig;
  workspace_revision: string;
  language: LanguageEntry;
  language_dir: string;
}

export function assertPathAllowed(
  targetPath: string,
  config: McpConfig,
): string {
  const resolved = canonicalizeConlangPath(targetPath);
  if (config.allowRoots.length === 0) {
    return resolved;
  }
  const allowed = config.allowRoots.some((root) => {
    const rel = path.relative(root, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!allowed) {
    throw new McpError(
      "VALIDATION",
      `Path "${targetPath}" is outside allowed root directories.`,
      "Pass a path inside --allow-root or adjust CONLANG_MCP_ALLOW_ROOT.",
      { target: resolved, allow_roots: config.allowRoots },
    );
  }
  return resolved;
}

export function readRegistry(config: McpConfig): RegistrySnapshot {
  const regPath = config.registryPath;
  if (!fs.existsSync(regPath)) {
    return {
      registry: {
        registry_version: "1.0",
        families: [],
        active_family_index: null,
      },
      registry_revision: MISSING_REVISION,
      families: [],
    };
  }

  const rev = computeFileRevision(regPath);
  const raw = JSON.parse(fs.readFileSync(regPath, "utf-8")) as GlobalRegistry;
  const rawFamilies = Array.isArray(raw.families) ? raw.families : [];

  // Deduplicate exact canonical paths while preserving active status & most recent last_opened
  const byId = new Map<string, ResolvedFamily>();
  rawFamilies.forEach((entry: FamilyEntry, idx: number) => {
    const canonicalPath = canonicalizeConlangPath(entry.conlang_file_path);
    const familyId = computeFamilyId(canonicalPath);
    const isActive = raw.active_family_index === idx;
    const exists = fs.existsSync(canonicalPath);
    const projectDir = path.dirname(canonicalPath);

    const existing = byId.get(familyId);
    if (!existing) {
      byId.set(familyId, {
        family_id: familyId,
        name: entry.name,
        conlang_file_path: canonicalPath,
        project_dir: projectDir,
        is_active: isActive,
        last_opened: entry.last_opened,
        exists,
      });
    } else {
      if (isActive) existing.is_active = true;
      if (entry.last_opened > existing.last_opened) {
        existing.last_opened = entry.last_opened;
        existing.name = entry.name;
      }
    }
  });

  return {
    registry: raw,
    registry_revision: rev,
    families: Array.from(byId.values()),
  };
}

export async function updateRegistryLocked<T>(
  config: McpConfig,
  toolName: string,
  expectedRevision: string | undefined,
  mutator: (current: GlobalRegistry, currentRevision: string) => {
    nextRegistry?: GlobalRegistry;
    result: T;
  },
): Promise<{ revision: string; result: T }> {
  const regPath = config.registryPath;
  const lockDir = path.join(path.dirname(regPath), "registry.lock");
  return await withDirectoryLock(lockDir, toolName, () => {
    const snap = readRegistry(config);
    if (expectedRevision !== undefined && expectedRevision !== snap.registry_revision) {
      throw new McpError(
        "CONFLICT",
        `Registry revision mismatch: expected "${expectedRevision}", actual "${snap.registry_revision}".`,
        "Call family_list to read the latest registry_revision and retry.",
        {
          expected_revision: expectedRevision,
          actual_revision: snap.registry_revision,
        },
      );
    }
    const { nextRegistry, result } = mutator(snap.registry, snap.registry_revision);
    if (nextRegistry) {
      atomicWriteFileSync(regPath, JSON.stringify(nextRegistry, null, 2));
      const newRev = computeFileRevision(regPath);
      return { revision: newRev, result };
    }
    return { revision: snap.registry_revision, result };
  });
}

function resolveDirectWorkspacePath(
  candidate: string,
  config: McpConfig,
): ResolvedFamily | null {
  const looksLikePath =
    candidate.endsWith(".conlang") ||
    candidate.includes("/") ||
    candidate.includes("\\") ||
    candidate.startsWith(".");

  if (!looksLikePath && !fs.existsSync(candidate)) {
    return null;
  }

  const abs = path.resolve(candidate);
  if (!fs.existsSync(abs)) {
    return null;
  }

  const stat = fs.statSync(abs);
  let conlangPath: string;
  if (stat.isFile() && abs.endsWith(".conlang")) {
    conlangPath = canonicalizeConlangPath(abs);
  } else if (stat.isDirectory()) {
    const files = fs
      .readdirSync(abs)
      .filter((f) => f.endsWith(".conlang"))
      .sort();
    if (files.length === 0) {
      throw new McpError(
        "NOT_FOUND",
        `Directory "${candidate}" does not contain a .conlang workspace file.`,
      );
    }
    if (files.length > 1) {
      throw new McpError(
        "AMBIGUOUS",
        `Directory "${candidate}" contains multiple .conlang files.`,
        "Specify the exact .conlang file path.",
        { candidates: files.map((f) => path.join(abs, f)) },
      );
    }
    conlangPath = canonicalizeConlangPath(path.join(abs, files[0]));
  } else {
    return null;
  }

  assertPathAllowed(conlangPath, config);
  const projectDir = path.dirname(conlangPath);
  return {
    family_id: computeFamilyId(conlangPath),
    name: path.basename(conlangPath, ".conlang"),
    conlang_file_path: conlangPath,
    project_dir: projectDir,
    is_active: false,
    last_opened: "",
    exists: true,
  };
}

/**
 * PRD §4.1 Family Resolution:
 * 1. Explicit arg -> config.defaultFamily -> active family in registry.json
 * 2. Matches by direct .conlang/directory path, 8-hex family_id, or family name (case-insensitive fallback).
 * 3. Multiple distinct families with the same name -> AMBIGUOUS with candidate family_ids & paths.
 */
export function resolveFamily(
  config: McpConfig,
  familyArg?: string,
): ResolvedFamily {
  const query = familyArg?.trim() || config.defaultFamily;
  const snap = readRegistry(config);

  if (!query) {
    const active = snap.families.find((f) => f.is_active);
    if (!active) {
      throw new McpError(
        "NOT_FOUND",
        "No family specified and no active family is set in registry.json.",
        "Pass the family parameter (family_id, name, or path) or run family_list.",
      );
    }
    assertPathAllowed(active.conlang_file_path, config);
    if (!active.exists) {
      throw new McpError(
        "NOT_FOUND",
        `Active family "${active.name}" points to a missing file: ${active.conlang_file_path}`,
      );
    }
    return active;
  }

  // 1. Direct path check
  const direct = resolveDirectWorkspacePath(query, config);
  if (direct) {
    const registered = snap.families.find((f) => f.family_id === direct.family_id);
    return registered
      ? { ...registered, conlang_file_path: direct.conlang_file_path, project_dir: direct.project_dir, exists: true }
      : direct;
  }

  // 2. Match by family_id
  const byId = snap.families.filter((f) => f.family_id === query);
  if (byId.length === 1) {
    assertPathAllowed(byId[0].conlang_file_path, config);
    if (!byId[0].exists) {
      throw new McpError(
        "NOT_FOUND",
        `Family "${byId[0].name}" (${byId[0].family_id}) file does not exist: ${byId[0].conlang_file_path}`,
      );
    }
    return byId[0];
  }

  // 3. Match by name (exact, then case-insensitive)
  let byName = snap.families.filter((f) => f.name === query);
  if (byName.length === 0) {
    const lower = query.toLowerCase();
    byName = snap.families.filter((f) => f.name.toLowerCase() === lower);
  }

  if (byName.length > 1) {
    // Prefer existing files if only one exists? No: PRD §4.1 says ambiguous same-name families must report AMBIGUOUS so caller uses family_id!
    throw new McpError(
      "AMBIGUOUS",
      `Multiple registered families match "${query}". Please specify family_id or exact path.`,
      "Use one of the candidate family_id values from family_list.",
      {
        candidates: byName.map((f) => ({
          family_id: f.family_id,
          name: f.name,
          conlang_file_path: f.conlang_file_path,
          exists: f.exists,
        })),
      },
    );
  }

  if (byName.length === 1) {
    assertPathAllowed(byName[0].conlang_file_path, config);
    if (!byName[0].exists) {
      throw new McpError(
        "NOT_FOUND",
        `Family "${byName[0].name}" (${byName[0].family_id}) file does not exist: ${byName[0].conlang_file_path}`,
      );
    }
    return byName[0];
  }

  throw new McpError(
    "NOT_FOUND",
    `Family "${query}" was not found in registry or on disk.`,
    "Call family_list to see available families or pass an absolute path to a .conlang file.",
  );
}

export function loadWorkspaceRaw(family: ResolvedFamily): {
  workspace: WorkspaceConfig;
  revision: string;
} {
  if (!fs.existsSync(family.conlang_file_path)) {
    throw new McpError(
      "NOT_FOUND",
      `Workspace file not found: ${family.conlang_file_path}`,
    );
  }
  const revision = computeFileRevision(family.conlang_file_path);
  const workspace = JSON.parse(
    fs.readFileSync(family.conlang_file_path, "utf-8"),
  ) as WorkspaceConfig;
  return { workspace, revision };
}

export function assertSafeRelativeLanguagePath(
  projectDir: string,
  relPath: string,
): string {
  const normalizedRel = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = path.resolve(projectDir, normalizedRel);
  const canonicalProject = (() => {
    try {
      return fs.realpathSync(projectDir);
    } catch {
      return path.resolve(projectDir);
    }
  })();
  const candidateReal = (() => {
    try {
      return fs.realpathSync(resolved);
    } catch {
      return resolved;
    }
  })();
  const relCheck = path.relative(canonicalProject, candidateReal);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new McpError(
      "VALIDATION",
      `Language path "${relPath}" escapes project root.`,
    );
  }
  return resolved;
}

/**
 * PRD §4.1 Language Resolution:
 * Accepts language_id ("lang_..."), display name, or relative directory path ("roots/root").
 */
export function resolveLanguage(
  family: ResolvedFamily,
  languageArg: string,
  preloaded?: { workspace: WorkspaceConfig; revision: string },
): ResolvedLanguage {
  const { workspace, revision } = preloaded ?? loadWorkspaceRaw(family);
  const q = languageArg.trim();
  const normalizedPathQuery = q.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

  // 1. Exact language_id match
  const byId = workspace.languages.filter((l) => l.language_id === q);
  if (byId.length === 1) {
    const langDir = assertSafeRelativeLanguagePath(family.project_dir, byId[0].path);
    return {
      family,
      workspace,
      workspace_revision: revision,
      language: byId[0],
      language_dir: langDir,
    };
  }

  // 2. Relative path match
  const byPath = workspace.languages.filter(
    (l) => l.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") === normalizedPathQuery,
  );
  if (byPath.length === 1) {
    const langDir = assertSafeRelativeLanguagePath(family.project_dir, byPath[0].path);
    return {
      family,
      workspace,
      workspace_revision: revision,
      language: byPath[0],
      language_dir: langDir,
    };
  }

  // 3. Name match (exact, then case-insensitive)
  let byName = workspace.languages.filter((l) => l.name === q);
  if (byName.length === 0) {
    const lower = q.toLowerCase();
    byName = workspace.languages.filter((l) => l.name.toLowerCase() === lower);
  }

  if (byName.length > 1) {
    throw new McpError(
      "AMBIGUOUS",
      `Multiple languages match "${languageArg}" in family "${family.name}".`,
      "Specify language_id or relative path instead.",
      {
        candidates: byName.map((l) => ({
          language_id: l.language_id,
          name: l.name,
          path: l.path,
        })),
      },
    );
  }

  if (byName.length === 1) {
    const langDir = assertSafeRelativeLanguagePath(family.project_dir, byName[0].path);
    return {
      family,
      workspace,
      workspace_revision: revision,
      language: byName[0],
      language_dir: langDir,
    };
  }

  throw new McpError(
    "NOT_FOUND",
    `Language "${languageArg}" not found in family "${family.name}".`,
    "Call family_get_tree to list all languages in this family.",
    {
      available_languages: workspace.languages.map((l) => ({
        language_id: l.language_id,
        name: l.name,
        path: l.path,
      })),
    },
  );
}
