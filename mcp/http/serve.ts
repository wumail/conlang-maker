import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpConfig } from "../config";
import { createServer } from "../server";
import {
  buildConfigForToken,
  findTokenBySecret,
  SettingsWatcher,
  STATE_FILE_NAME,
  tokenGrantKey,
  USAGE_FILE_NAME,
  type McpServerSettings,
} from "./settings";

export const SERVER_NAME = "conlang-maker-mcp";
export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/healthz";
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SESSION_IDLE_MS = 60 * 60 * 1000;
const LAST_USED_FLUSH_MS = 15_000;

export const EXIT_ALREADY_RUNNING = 3;
export const EXIT_PORT_IN_USE = 4;

export interface HttpServeOptions {
  baseConfig: McpConfig;
  settingsPath: string;
  initialSettings: McpServerSettings;
  /** Overrides settings.port (CLI `--port`). `0` lets the OS pick a free port. */
  port?: number;
  /** Where to write `mcp-server.state.json`; defaults next to the settings file. */
  statePath?: string;
  /** Where to persist per-token last-used timestamps; defaults next to the settings file. */
  usagePath?: string;
  /** How often token "last used" timestamps are flushed to disk (tests inject a short delay). */
  usageFlushMs?: number;
}

export interface ServerState {
  name: string;
  pid: number;
  port: number;
  url: string;
  version: string;
  started_at: string;
  settings_path: string;
}

interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  tokenId: string;
  grantKey: string;
  lastSeen: number;
}

export interface RunningHttpServer {
  port: number;
  url: string;
  sessionCount(): number;
  stop(): Promise<void>;
}

export class PortInUseError extends Error {
  constructor(
    public readonly port: number,
    public readonly existing: { version?: string; pid?: number } | null,
  ) {
    super(
      existing
        ? `conlang-mcp v${existing.version ?? "?"} (pid ${existing.pid ?? "?"}) is already serving 127.0.0.1:${port}`
        : `Port ${port} on 127.0.0.1 is already in use by another program`,
    );
    this.name = "PortInUseError";
  }
}

function jsonRpcError(status: number, code: number, message: string, headers?: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    { status, headers: { "Content-Type": "application/json", ...headers } },
  );
}

function writeStateFile(statePath: string, state: ServerState): void {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tmp = `${statePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, statePath);
  } catch (err) {
    console.error(`[conlang-mcp] Failed to write state file ${statePath}: ${(err as Error).message}`);
  }
}

function readUsageFile(usagePath: string): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(usagePath, "utf-8")) as {
      token_last_used?: Record<string, unknown>;
    };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.token_last_used ?? {})) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeUsageFile(usagePath: string, tokenLastUsed: Record<string, string>): void {
  try {
    const tmp = `${usagePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ token_last_used: tokenLastUsed }, null, 2) + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
    fs.renameSync(tmp, usagePath);
  } catch (err) {
    console.error(`[conlang-mcp] Failed to write usage file ${usagePath}: ${(err as Error).message}`);
  }
}

function removeStateFileIfOurs(statePath: string): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8")) as { pid?: number };
    if (parsed.pid === process.pid) fs.unlinkSync(statePath);
  } catch {
    // Missing or foreign state file
  }
}

/** Probes an occupied port to tell "our server already running" from "foreign program". */
export async function probeExistingServer(
  port: number,
  timeoutMs = 1000,
): Promise<{ version?: string; pid?: number } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json()) as { name?: string; version?: string; pid?: number };
    if (body && body.name === SERVER_NAME) {
      return { version: body.version, pid: body.pid };
    }
  } catch {
    // Not ours / not HTTP
  }
  return null;
}

async function readBodyLimited(req: Request): Promise<string | Response> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return jsonRpcError(413, -32000, "Request body too large");
  }
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) {
    return jsonRpcError(413, -32000, "Request body too large");
  }
  return new TextDecoder().decode(buf);
}

export async function startHttpServer(opts: HttpServeOptions): Promise<RunningHttpServer> {
  const watcher = new SettingsWatcher(opts.settingsPath, opts.initialSettings);
  const requestedPort = opts.port ?? opts.initialSettings.port;
  const statePath = opts.statePath ?? path.join(path.dirname(opts.settingsPath), STATE_FILE_NAME);
  const sessions = new Map<string, SessionEntry>();
  const startedAt = new Date().toISOString();
  const usageFlushMs = opts.usageFlushMs ?? LAST_USED_FLUSH_MS;

  // Filled in once Bun.serve() tells us which port we actually got: with `port: 0` the OS
  // picks one, and both the Host/Origin allowlists and the state file must use it.
  let actualPort = requestedPort;
  let allowedHosts = new Set<string>();
  let allowedOrigins = new Set<string>();

  const usagePath = opts.usagePath ?? path.join(path.dirname(opts.settingsPath), USAGE_FILE_NAME);
  const tokenLastUsed = readUsageFile(usagePath);
  let lastUsedDirty = false;

  const closeSession = async (sid: string): Promise<void> => {
    const entry = sessions.get(sid);
    if (!entry) return;
    sessions.delete(sid);
    try {
      await entry.transport.close();
    } catch {
      // ignore
    }
    try {
      await entry.server.close();
    } catch {
      // ignore
    }
  };

  const createSession = async (
    tokenId: string,
    grantKey: string,
    config: McpConfig,
  ): Promise<WebStandardStreamableHTTPServerTransport> => {
    const server = createServer(config);
    const transport: WebStandardStreamableHTTPServerTransport =
      new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        maxRequestBodySize: MAX_BODY_BYTES,
        onsessioninitialized: (sid) => {
          sessions.set(sid, { transport, server, tokenId, grantKey, lastSeen: Date.now() });
          // Never log the token itself, only its display name.
          console.error(
            `[conlang-mcp] session ${sid.slice(0, 8)} opened by "${config.clientName}" (mode=${config.mode})`,
          );
        },
        onsessionclosed: (sid) => {
          sessions.delete(sid);
        },
      });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    return transport;
  };

  const handleMcp = async (req: Request): Promise<Response> => {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return jsonRpcError(413, -32000, "Request body too large");
    }

    const settings = watcher.current();
    const auth = req.headers.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    const token = match ? findTokenBySecret(settings, match[1].trim()) : null;
    if (!token) {
      return jsonRpcError(401, -32001, "Unauthorized: missing or invalid access token", {
        "WWW-Authenticate": 'Bearer realm="conlang-maker"',
      });
    }

    tokenLastUsed[token.id] = new Date().toISOString();
    lastUsedDirty = true;

    const grantKey = tokenGrantKey(token);
    const sid = req.headers.get("mcp-session-id");
    if (sid) {
      const entry = sessions.get(sid);
      if (!entry || entry.tokenId !== token.id) {
        return jsonRpcError(404, -32001, "Session not found");
      }
      if (entry.grantKey !== grantKey) {
        // Permissions of this token changed in the GUI: force the client to re-initialize.
        await closeSession(sid);
        return jsonRpcError(404, -32001, "Session expired because token permissions changed; reinitialize");
      }
      entry.lastSeen = Date.now();
      return await entry.transport.handleRequest(req);
    }

    if (req.method !== "POST") {
      return jsonRpcError(400, -32000, "Bad Request: Mcp-Session-Id header is required");
    }
    const bodyText = await readBodyLimited(req);
    if (bodyText instanceof Response) return bodyText;
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return jsonRpcError(400, -32700, "Parse error: invalid JSON");
    }
    const isInit = Array.isArray(body) ? body.some(isInitializeRequest) : isInitializeRequest(body);
    if (!isInit) {
      return jsonRpcError(400, -32000, "Bad Request: no valid session ID provided");
    }
    const transport = await createSession(token.id, grantKey, buildConfigForToken(opts.baseConfig, token));
    return await transport.handleRequest(req, { parsedBody: body });
  };

  const fetchHandler = async (req: Request): Promise<Response> => {
    const host = (req.headers.get("host") ?? "").toLowerCase();
    if (!allowedHosts.has(host)) {
      return jsonRpcError(403, -32000, "Forbidden: invalid Host header");
    }
    const origin = req.headers.get("origin");
    if (origin && !allowedOrigins.has(origin.toLowerCase())) {
      return jsonRpcError(403, -32000, "Forbidden: invalid Origin header");
    }

    const url = new URL(req.url);
    if (url.pathname === HEALTH_PATH && req.method === "GET") {
      return Response.json({
        ok: true,
        name: SERVER_NAME,
        version: opts.baseConfig.version,
        pid: process.pid,
        port: actualPort,
        started_at: startedAt,
        sessions: sessions.size,
      });
    }
    if (url.pathname === MCP_PATH) {
      if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
        return jsonRpcError(405, -32000, "Method not allowed", { Allow: "GET, POST, DELETE" });
      }
      try {
        return await handleMcp(req);
      } catch (err) {
        console.error(`[conlang-mcp] HTTP handler error: ${(err as Error).stack ?? err}`);
        return jsonRpcError(500, -32603, "Internal server error");
      }
    }
    return new Response("Not Found", { status: 404 });
  };

  let bunServer: ReturnType<typeof Bun.serve>;
  try {
    bunServer = Bun.serve({
      hostname: "127.0.0.1",
      port: requestedPort,
      // SSE streams are kept alive by 15s comment frames; stay above that.
      idleTimeout: 255,
      fetch: fetchHandler,
    });
  } catch (err) {
    // Bun 1.3.x sets `code: "EADDRINUSE"` and reports "Failed to start server. Is port N in use?".
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE" || /in use|EADDRINUSE/i.test(String((err as Error).message))) {
      throw new PortInUseError(requestedPort, requestedPort > 0 ? await probeExistingServer(requestedPort) : null);
    }
    throw err;
  }

  actualPort = bunServer.port ?? requestedPort;
  allowedHosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`]);
  allowedOrigins = new Set([
    `http://127.0.0.1:${actualPort}`,
    `http://localhost:${actualPort}`,
    `http://[::1]:${actualPort}`,
  ]);

  const url = `http://127.0.0.1:${actualPort}${MCP_PATH}`;
  const state: ServerState = {
    name: SERVER_NAME,
    pid: process.pid,
    port: actualPort,
    url,
    version: opts.baseConfig.version,
    started_at: startedAt,
    settings_path: opts.settingsPath,
  };
  writeStateFile(statePath, state);

  const flushTimer = setInterval(() => {
    if (lastUsedDirty) {
      lastUsedDirty = false;
      writeUsageFile(usagePath, tokenLastUsed);
    }
  }, usageFlushMs);
  const sweepTimer = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [sid, entry] of sessions) {
      if (entry.lastSeen < cutoff) void closeSession(sid);
    }
  }, 60_000);
  flushTimer.unref?.();
  sweepTimer.unref?.();

  let stopped = false;
  return {
    port: actualPort,
    url,
    sessionCount: () => sessions.size,
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(flushTimer);
      clearInterval(sweepTimer);
      await Promise.all(Array.from(sessions.keys()).map((sid) => closeSession(sid)));
      bunServer.stop(true);
      if (lastUsedDirty) writeUsageFile(usagePath, tokenLastUsed);
      removeStateFileIfOurs(statePath);
    },
  };
}
