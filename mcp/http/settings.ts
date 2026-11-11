import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getDefaultRegistryPath,
  MODE_DEFAULT_TOOLSETS,
  parseMode,
  parseToolsets,
  type McpConfig,
  type PermissionMode,
  type ToolsetName,
} from "../config";
import { McpError } from "../errors";

/**
 * Central HTTP server settings (`<app data>/mcp-server.json`, mode 0600).
 *
 * The GUI (Rust) owns this file and edits it; the server only reads it (re-reading on
 * mtime change so token edits take effect without restarting). The server creates it
 * only when it does not exist yet (CLI-only usage).
 */

export const DEFAULT_HTTP_PORT = 43117;
export const SETTINGS_FILE_NAME = "mcp-server.json";
export const STATE_FILE_NAME = "mcp-server.state.json";
export const USAGE_FILE_NAME = "mcp-token-usage.json";

export interface McpTokenSettings {
  id: string;
  name: string;
  token: string;
  mode: PermissionMode;
  /** "default" (derived from mode), "all", or a comma separated toolset list. */
  toolsets: string;
  /** Default family `.conlang` path for this Agent, or null for dynamic discovery. */
  family: string | null;
  enabled: boolean;
  created_at: string;
}

export interface McpServerSettings {
  version: 1;
  port: number;
  tokens: McpTokenSettings[];
}

export function getAppDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.dirname(getDefaultRegistryPath(process.platform, env));
}

export function getDefaultSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getAppDataDir(env), SETTINGS_FILE_NAME);
}

export function generateTokenSecret(): string {
  return `cmk_${crypto.randomBytes(32).toString("base64url")}`;
}

export function generateTokenId(): string {
  return `tok_${crypto.randomBytes(6).toString("hex")}`;
}

export function createDefaultSettings(): McpServerSettings {
  return {
    version: 1,
    port: DEFAULT_HTTP_PORT,
    tokens: [
      {
        id: generateTokenId(),
        name: "Default",
        token: generateTokenSecret(),
        mode: "read-only",
        toolsets: "default",
        family: null,
        enabled: true,
        created_at: new Date().toISOString(),
      },
    ],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeSettings(raw: unknown): McpServerSettings {
  const obj = asRecord(raw);
  const portRaw = obj.port;
  const port =
    typeof portRaw === "number" && Number.isInteger(portRaw) && portRaw > 0 && portRaw < 65536
      ? portRaw
      : DEFAULT_HTTP_PORT;

  const tokens: McpTokenSettings[] = [];
  const seenIds = new Set<string>();
  const list = Array.isArray(obj.tokens) ? obj.tokens : [];
  for (const item of list) {
    const t = asRecord(item);
    const token = typeof t.token === "string" ? t.token.trim() : "";
    if (token.length < 16) continue; // refuse weak / empty secrets
    let id = typeof t.id === "string" && t.id.trim() ? t.id.trim() : generateTokenId();
    if (seenIds.has(id)) id = generateTokenId();
    seenIds.add(id);
    let mode: PermissionMode = "read-only";
    try {
      mode = parseMode(typeof t.mode === "string" ? t.mode : undefined);
    } catch {
      mode = "read-only";
    }
    const toolsets =
      typeof t.toolsets === "string" && t.toolsets.trim() ? t.toolsets.trim() : "default";
    tokens.push({
      id,
      name: typeof t.name === "string" && t.name.trim() ? t.name.trim() : id,
      token,
      mode,
      toolsets,
      family: typeof t.family === "string" && t.family.trim() ? t.family.trim() : null,
      enabled: t.enabled !== false,
      created_at: typeof t.created_at === "string" ? t.created_at : new Date(0).toISOString(),
    });
  }
  return { version: 1, port, tokens };
}

export function writeSettingsFile(settingsPath: string, settings: McpServerSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    // Best effort on platforms without POSIX modes
  }
  fs.renameSync(tmp, settingsPath);
}

/**
 * Loads settings, creating a default file (with one read-only token) when it is missing.
 * Returns `created: true` so the CLI can print the generated token once.
 */
export function loadOrCreateSettings(settingsPath: string): {
  settings: McpServerSettings;
  created: boolean;
} {
  if (!fs.existsSync(settingsPath)) {
    const settings = createDefaultSettings();
    try {
      // `wx` semantics: never clobber a file the GUI created concurrently.
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", {
        encoding: "utf-8",
        mode: 0o600,
        flag: "wx",
      });
      return { settings, created: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  return { settings: readSettingsFile(settingsPath), created: false };
}

export function readSettingsFile(settingsPath: string): McpServerSettings {
  let text: string;
  try {
    text = fs.readFileSync(settingsPath, "utf-8");
  } catch (err) {
    throw new McpError(
      "IO",
      `Cannot read MCP server settings at ${settingsPath}: ${(err as Error).message}`,
    );
  }
  try {
    return normalizeSettings(JSON.parse(text));
  } catch (err) {
    throw new McpError(
      "VALIDATION",
      `MCP server settings at ${settingsPath} are not valid JSON: ${(err as Error).message}`,
    );
  }
}

/** mtime-cached reader so every request sees token edits made by the GUI. */
export class SettingsWatcher {
  private cached: McpServerSettings;
  private cachedKey: string;

  constructor(
    private readonly settingsPath: string,
    initial: McpServerSettings,
  ) {
    this.cached = initial;
    this.cachedKey = this.statKey();
  }

  private statKey(): string {
    try {
      const st = fs.statSync(this.settingsPath);
      return `${st.mtimeMs}:${st.size}:${st.ino}`;
    } catch {
      return "missing";
    }
  }

  current(): McpServerSettings {
    const key = this.statKey();
    if (key !== this.cachedKey) {
      this.cachedKey = key;
      if (key === "missing") {
        // Settings deleted: revoke everything rather than keep stale grants.
        this.cached = { ...this.cached, tokens: [] };
      } else {
        try {
          this.cached = readSettingsFile(this.settingsPath);
        } catch (err) {
          console.error(
            `[conlang-mcp] Ignoring unreadable settings update (keeping previous): ${(err as Error).message}`,
          );
        }
      }
    }
    return this.cached;
  }
}

function sha256(value: string): Buffer {
  return crypto.createHash("sha256").update(value, "utf-8").digest();
}

/** Constant-time lookup of an enabled token by its secret. */
export function findTokenBySecret(
  settings: McpServerSettings,
  secret: string,
): McpTokenSettings | null {
  const probe = sha256(secret);
  let found: McpTokenSettings | null = null;
  for (const t of settings.tokens) {
    // Compare every token (no early exit) to keep timing independent of position.
    const match = crypto.timingSafeEqual(probe, sha256(t.token));
    if (match && t.enabled && found === null) {
      found = t;
    }
  }
  return found;
}

export function resolveTokenToolsets(token: McpTokenSettings): Set<ToolsetName> {
  const raw = token.toolsets.trim();
  if (raw === "" || raw === "default") {
    return new Set<ToolsetName>(MODE_DEFAULT_TOOLSETS[token.mode]);
  }
  return parseToolsets(raw);
}

/** Session config for a token: same shape as the stdio CLI config, sourced from settings. */
export function buildConfigForToken(base: McpConfig, token: McpTokenSettings): McpConfig {
  return {
    ...base,
    mode: token.mode,
    toolsets: resolveTokenToolsets(token),
    defaultFamily: token.family ?? undefined,
    clientName: token.name,
    tokenId: token.id,
  };
}

/** Fingerprint of the grants that shape a session; sessions are dropped when it changes. */
export function tokenGrantKey(token: McpTokenSettings): string {
  return JSON.stringify([token.mode, token.toolsets, token.family, token.name]);
}
