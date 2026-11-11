import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpError } from "./errors";
import packageJson from "../package.json";

export type PermissionMode = "read-only" | "write" | "write+destructive";

export type ToolsetName =
  | "core"
  | "audit"
  | "compute"
  | "write"
  | "evolution"
  | "admin";

export const ALL_TOOLSETS: readonly ToolsetName[] = [
  "core",
  "audit",
  "compute",
  "write",
  "evolution",
  "admin",
] as const;

export const DEFAULT_TOOLSETS: readonly ToolsetName[] = [
  "core",
  "audit",
  "compute",
] as const;

export type AutoSnapshotPolicy = "always" | "threshold" | "off";

export interface ExternalFontProjectLink {
  path: string;
  variant?: string;
}

export interface LanguageMcpSettings {
  residual_glyph_pattern?: string;
  external_font_project?: ExternalFontProjectLink;
}

export interface ProjectMcpSettings {
  autoSnapshot: AutoSnapshotPolicy;
  autoSnapshotThreshold: number;
  residualGlyphPattern?: string;
  residualGlyphPatterns: string[];
  languages: Record<string, LanguageMcpSettings>;
}

export interface McpConfig {
  version: string;
  mode: PermissionMode;
  toolsets: Set<ToolsetName>;
  defaultFamily?: string;
  registryPath: string;
  allowRoots: string[];
  /** HTTP mode: display name of the access token that owns this session. */
  clientName?: string;
  /** HTTP mode: id of the access token that owns this session. */
  tokenId?: string;
}

export type McpRuntimeConfig = McpConfig;

export function getDefaultRegistryPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string {
  if (platform === "darwin") {
    return path.join(
      homeDir,
      "Library",
      "Application Support",
      "com.conlang-maker",
      "registry.json",
    );
  }
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    return path.join(appData, "com.conlang-maker", "registry.json");
  }
  const xdgData = env.XDG_DATA_HOME || path.join(homeDir, ".local", "share");
  return path.join(xdgData, "com.conlang-maker", "registry.json");
}

export function parseMode(raw: string | undefined): PermissionMode {
  if (!raw) return "read-only";
  const normalized = raw.trim() as PermissionMode;
  if (
    normalized === "read-only" ||
    normalized === "write" ||
    normalized === "write+destructive"
  ) {
    return normalized;
  }
  throw new McpError(
    "VALIDATION",
    `Invalid permission mode "${raw}". Expected read-only, write, or write+destructive.`,
  );
}

export function parseToolsets(raw: string | undefined): Set<ToolsetName> {
  if (!raw || raw.trim() === "") {
    return new Set<ToolsetName>(DEFAULT_TOOLSETS);
  }
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.includes("all")) {
    return new Set<ToolsetName>(ALL_TOOLSETS);
  }
  const set = new Set<ToolsetName>();
  for (const part of parts) {
    if ((ALL_TOOLSETS as readonly string[]).includes(part)) {
      set.add(part as ToolsetName);
    } else {
      throw new McpError(
        "VALIDATION",
        `Unknown toolset "${part}". Valid toolsets: ${ALL_TOOLSETS.join(", ")}, all.`,
      );
    }
  }
  return set;
}

/** Toolsets granted by default for each permission mode (HTTP tokens with toolsets "default"). */
export const MODE_DEFAULT_TOOLSETS: Record<PermissionMode, readonly ToolsetName[]> = {
  "read-only": ["core", "audit", "compute"],
  write: ["core", "audit", "compute", "write", "evolution"],
  "write+destructive": ALL_TOOLSETS,
};

/**
 * Server version, embedded at bundle/compile time from package.json so the compiled
 * sidecar reports the real app version (used by the GUI to detect stale servers).
 */
export const SERVER_VERSION: string =
  typeof packageJson.version === "string" && packageJson.version.length > 0
    ? packageJson.version
    : "0.0.0";

function readServerVersion(): string {
  return SERVER_VERSION;
}

export function parseConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): McpConfig {
  let modeRaw: string | undefined = env.CONLANG_MCP_MODE;
  let toolsetsRaw: string | undefined = env.CONLANG_MCP_TOOLSETS;
  let familyRaw: string | undefined = env.CONLANG_MCP_FAMILY;
  let registryRaw: string | undefined = env.CONLANG_MCP_REGISTRY;
  const allowRootsRaw: string[] = [];

  if (env.CONLANG_MCP_ALLOW_ROOT) {
    for (const item of env.CONLANG_MCP_ALLOW_ROOT.split(path.delimiter)) {
      if (item.trim()) allowRootsRaw.push(item.trim());
    }
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eqIdx = arg.indexOf("=");
    const flag = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
    const inlineVal = eqIdx >= 0 ? arg.slice(eqIdx + 1) : undefined;
    const nextVal = (): string => {
      if (inlineVal !== undefined) return inlineVal;
      const v = argv[++i];
      if (v === undefined) {
        throw new McpError("VALIDATION", `Missing value for flag ${flag}`);
      }
      return v;
    };

    switch (flag) {
      case "--mode":
        modeRaw = nextVal();
        break;
      case "--toolsets":
        toolsetsRaw = nextVal();
        break;
      case "--family":
        familyRaw = nextVal();
        break;
      case "--registry":
        registryRaw = nextVal();
        break;
      case "--allow-root":
        for (const piece of nextVal().split(",")) {
          if (piece.trim()) allowRootsRaw.push(piece.trim());
        }
        break;
      default:
        break;
    }
  }

  const allowRoots = allowRootsRaw.map((root) => {
    const resolved = path.resolve(root);
    try {
      return fs.realpathSync(resolved);
    } catch {
      return resolved;
    }
  });

  return {
    version: readServerVersion(),
    mode: parseMode(modeRaw),
    toolsets: parseToolsets(toolsetsRaw),
    defaultFamily: familyRaw?.trim() || undefined,
    registryPath: registryRaw?.trim()
      ? path.resolve(registryRaw.trim())
      : getDefaultRegistryPath(process.platform, env),
    allowRoots,
  };
}

export function loadProjectMcpSettings(projectDir: string): ProjectMcpSettings {
  const defaults: ProjectMcpSettings = {
    autoSnapshot: "threshold",
    autoSnapshotThreshold: 20,
    residualGlyphPattern: undefined,
    residualGlyphPatterns: [],
    languages: {},
  };
  const cfgPath = path.join(projectDir, ".conlang-maker", "mcp.json");
  if (!fs.existsSync(cfgPath)) {
    return defaults;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const rawPolicy = raw.auto_snapshot ?? raw.autoSnapshot;
    const autoSnapshot =
      rawPolicy === "always" ||
      rawPolicy === "threshold" ||
      rawPolicy === "off"
        ? rawPolicy
        : defaults.autoSnapshot;
    const rawThreshold = raw.auto_snapshot_threshold ?? raw.autoSnapshotThreshold;
    const autoSnapshotThreshold =
      typeof rawThreshold === "number" && Number.isFinite(rawThreshold) && rawThreshold >= 1
        ? Math.floor(rawThreshold)
        : defaults.autoSnapshotThreshold;
    const singlePattern =
      typeof raw.residual_glyph_pattern === "string" && raw.residual_glyph_pattern.trim()
        ? raw.residual_glyph_pattern.trim()
        : typeof raw.residualGlyphPattern === "string" && raw.residualGlyphPattern.trim()
          ? raw.residualGlyphPattern.trim()
          : undefined;
    const listPatterns = Array.isArray(raw.residualGlyphPatterns)
      ? raw.residualGlyphPatterns.filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0,
        )
      : [];
    const residualGlyphPatterns =
      listPatterns.length > 0
        ? listPatterns
        : singlePattern
          ? [singlePattern]
          : [];
    const residualGlyphPattern = singlePattern ?? residualGlyphPatterns[0];

    const languages: Record<string, LanguageMcpSettings> = {};
    if (typeof raw.languages === "object" && raw.languages !== null) {
      for (const [key, val] of Object.entries(
        raw.languages as Record<string, unknown>,
      )) {
        if (typeof val === "object" && val !== null) {
          const item = val as Record<string, unknown>;
          const langCfg: LanguageMcpSettings = {};
          if (typeof item.residual_glyph_pattern === "string" && item.residual_glyph_pattern.trim()) {
            langCfg.residual_glyph_pattern = item.residual_glyph_pattern.trim();
          }
          if (
            typeof item.external_font_project === "object" &&
            item.external_font_project !== null
          ) {
            const ext = item.external_font_project as Record<string, unknown>;
            if (typeof ext.path === "string" && ext.path.trim()) {
              langCfg.external_font_project = {
                path: ext.path.trim(),
                variant: typeof ext.variant === "string" ? ext.variant : undefined,
              };
            }
          }
          languages[key] = langCfg;
        }
      }
    }

    return {
      autoSnapshot,
      autoSnapshotThreshold,
      residualGlyphPattern,
      residualGlyphPatterns,
      languages,
    };
  } catch (err) {
    console.error("[conlang-mcp] Invalid .conlang-maker/mcp.json:", err);
    return defaults;
  }
}

export function resolveResidualGlyphPattern(
  projectDir: string,
  languageId: string,
  languageName: string,
  explicitPattern?: string,
): { pattern?: string; source: "argument" | "project_language" | "project_default" | "none" } {
  if (typeof explicitPattern === "string" && explicitPattern.trim().length > 0) {
    return { pattern: explicitPattern.trim(), source: "argument" };
  }
  const settings = loadProjectMcpSettings(projectDir);
  const byId = settings.languages[languageId]?.residual_glyph_pattern;
  if (byId) {
    return { pattern: byId, source: "project_language" };
  }
  const byName = settings.languages[languageName]?.residual_glyph_pattern;
  if (byName) {
    return { pattern: byName, source: "project_language" };
  }
  if (settings.residualGlyphPattern) {
    return { pattern: settings.residualGlyphPattern, source: "project_default" };
  }
  return { pattern: undefined, source: "none" };
}

export function assertWriteAllowed(config: McpConfig, toolName: string): void {
  if (config.mode === "read-only") {
    throw new McpError(
      "READ_ONLY",
      `Tool "${toolName}" requires write permission, but server is running in read-only mode.`,
      "Restart conlang-mcp with --mode write (or --mode write+destructive) to enable write tools.",
    );
  }
}

export function assertDestructiveAllowed(
  config: McpConfig,
  toolName: string,
  confirm?: boolean,
  dryRun?: boolean,
): void {
  if (dryRun) {
    // Dry-run previews are safe in write mode, still blocked in read-only if registered
    assertWriteAllowed(config, toolName);
    return;
  }
  if (config.mode !== "write+destructive") {
    throw new McpError(
      "DESTRUCTIVE_DISABLED",
      `Tool "${toolName}" is destructive and requires --mode write+destructive.`,
      "Restart conlang-mcp with --mode write+destructive and pass confirm: true.",
    );
  }
  if (confirm !== true) {
    throw new McpError(
      "VALIDATION",
      `Destructive tool "${toolName}" requires explicit confirm: true (or run with dry_run: true first).`,
      "Preview changes with dry_run: true, then pass confirm: true to execute.",
    );
  }
}
