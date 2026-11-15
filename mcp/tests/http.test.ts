import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SERVER_VERSION, type McpConfig } from "../config";
import {
  PortInUseError,
  startHttpServer,
  type HttpServeOptions,
  type RunningHttpServer,
} from "../http/serve";
import {
  DEFAULT_HTTP_PORT,
  writeSettingsFile,
  type McpTokenSettings,
} from "../http/settings";
import { EXPECTED_77_TOOLS } from "./expected-tools";

/**
 * Bun 1.3.x dispatches every in-process `Bun.serve()` request through the handler of the
 * first live server, so these tests always keep exactly one server running at a time.
 * (The real app only ever runs one.)
 */
const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const FIXTURE_WORKSPACE = path.join(REPO_ROOT, "tests/fixtures/workspace-basic");
const MCP_MAIN_PATH = path.join(REPO_ROOT, "mcp/main.ts");

interface TestEnv {
  rootDir: string;
  workspaceDir: string;
  conlangPath: string;
  registryPath: string;
  settingsPath: string;
  statePath: string;
  usagePath: string;
  tokens: McpTokenSettings[];
  cleanup: () => void;
}

const tempDirs: string[] = [];
const openClients: Client[] = [];

let tokenSeq = 0;

function tokenFor(overrides: Partial<McpTokenSettings> = {}): McpTokenSettings {
  tokenSeq += 1;
  return {
    id: `tok_http${String(tokenSeq).padStart(4, "0")}`,
    name: `Agent ${tokenSeq}`,
    token: `cmk_${crypto.randomBytes(32).toString("base64url")}`,
    mode: "read-only",
    toolsets: "default",
    family: null,
    enabled: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function createEnv(tokens: McpTokenSettings[]): TestEnv {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-mcp-http-"));
  tempDirs.push(rootDir);
  const workspaceDir = path.join(rootDir, "workspace-basic");
  fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });

  const conlangPath = path.join(workspaceDir, "workspace.conlang");
  const registryPath = path.join(rootDir, "registry.json");
  fs.writeFileSync(
    registryPath,
    JSON.stringify(
      {
        registry_version: "1.0",
        families: [
          {
            name: "Synthetic-Family",
            conlang_file_path: conlangPath,
            last_opened: 1700000000,
          },
        ],
        active_family_index: 0,
      },
      null,
      2,
    ),
    "utf-8",
  );

  const settingsPath = path.join(rootDir, "mcp-server.json");
  writeSettingsFile(settingsPath, { version: 1, port: DEFAULT_HTTP_PORT, tokens });

  return {
    rootDir,
    workspaceDir,
    conlangPath,
    registryPath,
    settingsPath,
    statePath: path.join(rootDir, "mcp-server.state.json"),
    usagePath: path.join(rootDir, "mcp-token-usage.json"),
    tokens,
    cleanup: () => {
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

function baseConfigFor(env: TestEnv): McpConfig {
  // macOS temp dirs live behind the /var -> /private/var symlink; parseConfig realpaths
  // allow roots, so mirror that here or every path check fails.
  const realRoot = fs.realpathSync(env.rootDir);
  return {
    version: SERVER_VERSION,
    mode: "read-only",
    toolsets: new Set(["core", "audit", "compute"]),
    registryPath: env.registryPath,
    allowRoots: [realRoot, fs.realpathSync(path.join(REPO_ROOT, "tests/fixtures/fonts"))],
  };
}

function serveOptions(env: TestEnv, overrides: Partial<HttpServeOptions> = {}): HttpServeOptions {
  return {
    baseConfig: baseConfigFor(env),
    settingsPath: env.settingsPath,
    initialSettings: { version: 1, port: DEFAULT_HTTP_PORT, tokens: env.tokens },
    port: 0,
    statePath: env.statePath,
    usagePath: env.usagePath,
    usageFlushMs: 50,
    ...overrides,
  };
}

/** Starts one server, runs `fn`, and always stops it (see the note above). */
async function withServer(
  env: TestEnv,
  fn: (server: RunningHttpServer) => Promise<void>,
  overrides: Partial<HttpServeOptions> = {},
): Promise<void> {
  const server = await startHttpServer(serveOptions(env, overrides));
  try {
    await fn(server);
  } finally {
    await server.stop();
  }
}

async function connectClient(
  url: string,
  token: string,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "http-suite", version: "1.0.0" });
  await client.connect(transport);
  openClients.push(client);
  return { client, transport };
}

async function closeClient(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // ignore
  }
}

async function listToolNames(client: Client): Promise<string[]> {
  const res = await client.listTools();
  return res.tools.map((t) => t.name).sort();
}

function readToolText(res: unknown): Record<string, unknown> {
  const content = (res as { content?: unknown }).content;
  const first = Array.isArray(content) ? content[0] : undefined;
  const text =
    first && typeof first === "object" && first !== null && "text" in first
      ? String((first as { text?: unknown }).text ?? "{}")
      : "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await client.callTool({ name, arguments: args });
  if ((res as { isError?: boolean }).isError) {
    throw new Error(`Tool ${name} failed: ${JSON.stringify(res)}`);
  }
  return readToolText(res);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function rawHttpRequest(port: number, requestText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(requestText);
    });
    let data = "";
    socket.setEncoding("utf-8");
    socket.on("data", (chunk: string) => {
      data += chunk;
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
    socket.setTimeout(5000, () => {
      socket.destroy();
      resolve(data);
    });
  });
}

function statusOf(rawResponse: string): number {
  const match = /^HTTP\/1\.[01] (\d{3})/.exec(rawResponse);
  return match ? Number(match[1]) : 0;
}

function initializeBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "raw-probe", version: "1.0.0" },
    },
  });
}

function rawPost(port: number, headers: string[], body = initializeBody()): string {
  return [
    "POST /mcp HTTP/1.1",
    `Host: 127.0.0.1:${port}`,
    ...headers,
    "Content-Type: application/json",
    "Accept: application/json, text/event-stream",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Connection: close",
    "",
    body,
  ].join("\r\n");
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body,
  });
}

afterAll(async () => {
  for (const client of openClients) await closeClient(client);
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("HTTP transport (mcp serve)", () => {
  test("1. GET /healthz reports name, version, pid and port", async () => {
    const env = createEnv([tokenFor()]);
    try {
      await withServer(env, async (server) => {
        const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.ok).toBe(true);
        expect(body.name).toBe("conlang-maker-mcp");
        expect(body.version).toBe(SERVER_VERSION);
        expect(body.pid).toBe(process.pid);
        expect(body.port).toBe(server.port);
        expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`);
      });
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("2. POST initialize without a token is rejected with 401 + WWW-Authenticate", async () => {
    const env = createEnv([tokenFor()]);
    try {
      await withServer(env, async (server) => {
        const res = await postJson(`http://127.0.0.1:${server.port}/mcp`, {}, initializeBody());
        expect(res.status).toBe(401);
        const header = res.headers.get("www-authenticate") ?? "";
        expect(header).toContain("Bearer");
        expect(header).toContain("conlang-maker");
      });
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("3. unknown and disabled tokens are rejected with 401", async () => {
    const disabled = tokenFor({ name: "Disabled", enabled: false });
    const env = createEnv([tokenFor({ name: "Active" }), disabled]);
    try {
      await withServer(env, async (server) => {
        const unknown = await postJson(
          `http://127.0.0.1:${server.port}/mcp`,
          { Authorization: "Bearer cmk_this_token_does_not_exist" },
          initializeBody(),
        );
        expect(unknown.status).toBe(401);

        const inactive = await postJson(
          `http://127.0.0.1:${server.port}/mcp`,
          { Authorization: `Bearer ${disabled.token}` },
          initializeBody(),
        );
        expect(inactive.status).toBe(401);
      });
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("4. foreign Host header is rejected with 403", async () => {
    const env = createEnv([tokenFor()]);
    try {
      await withServer(env, async (server) => {
        const raw = await rawHttpRequest(
          server.port,
          [
            "GET /healthz HTTP/1.1",
            `Host: evil.example:${server.port}`,
            "Connection: close",
            "",
            "",
          ].join("\r\n"),
        );
        expect(statusOf(raw)).toBe(403);

        const okRaw = await rawHttpRequest(
          server.port,
          [
            "GET /healthz HTTP/1.1",
            `Host: localhost:${server.port}`,
            "Connection: close",
            "",
            "",
          ].join("\r\n"),
        );
        expect(statusOf(okRaw)).toBe(200);
      });
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("5. foreign Origin is rejected with 403, loopback Origin is allowed", async () => {
    const token = tokenFor();
    const env = createEnv([token]);
    try {
      await withServer(env, async (server) => {
        const auth = [`Authorization: Bearer ${token.token}`];

        const evil = await rawHttpRequest(
          server.port,
          rawPost(server.port, [...auth, "Origin: https://evil.example"]),
        );
        expect(statusOf(evil)).toBe(403);

        const loopback = await rawHttpRequest(
          server.port,
          rawPost(server.port, [...auth, `Origin: http://127.0.0.1:${server.port}`]),
        );
        expect(statusOf(loopback)).toBe(200);

        const noOrigin = await rawHttpRequest(server.port, rawPost(server.port, auth));
        expect(statusOf(noOrigin)).toBe(200);
      });
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("6. read-only token exposes read tools only", async () => {
    const token = tokenFor({ name: "Reader", mode: "read-only", toolsets: "default" });
    const env = createEnv([token]);
    try {
      await withServer(env, async (server) => {
        const { client } = await connectClient(server.url, token.token);
        try {
          const names = await listToolNames(client);
          expect(names).toContain("lex_search");
          expect(names).toContain("server_info");
          expect(names).not.toContain("lex_upsert");
          expect(names).not.toContain("project_create");
        } finally {
          await closeClient(client);
        }
      });
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("7. write+destructive token with toolsets all exposes all 77 tools", async () => {
    const token = tokenFor({ name: "Admin", mode: "write+destructive", toolsets: "all" });
    const env = createEnv([token]);
    try {
      await withServer(env, async (server) => {
        const { client } = await connectClient(server.url, token.token);
        try {
          const names = await listToolNames(client);
          expect(names.length).toBe(EXPECTED_77_TOOLS.length);
          for (const expected of EXPECTED_77_TOOLS) {
            expect(names).toContain(expected);
          }
        } finally {
          await closeClient(client);
        }
      });
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("8. token family becomes server_info.default_family", async () => {
    const env = createEnv([]);
    const token = tokenFor({ name: "Bound", family: env.conlangPath });
    writeSettingsFile(env.settingsPath, {
      version: 1,
      port: DEFAULT_HTTP_PORT,
      tokens: [token],
    });
    try {
      await withServer(
        env,
        async (server) => {
          const { client } = await connectClient(server.url, token.token);
          try {
            const info = await callTool(client, "server_info");
            expect(info.default_family).toBe(env.conlangPath);
          } finally {
            await closeClient(client);
          }
        },
        { initialSettings: { version: 1, port: DEFAULT_HTTP_PORT, tokens: [token] } },
      );
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("9. deleting the token mid-session makes the next call 401", async () => {
    const token = tokenFor({ name: "Doomed" });
    const env = createEnv([token]);
    try {
      await withServer(env, async (server) => {
        const { client, transport } = await connectClient(server.url, token.token);
        try {
          expect(await listToolNames(client)).toContain("lex_search");
          const sessionId = transport.sessionId;
          expect(sessionId).toBeTruthy();

          writeSettingsFile(env.settingsPath, {
            version: 1,
            port: DEFAULT_HTTP_PORT,
            tokens: [],
          });

          const res = await postJson(
            `http://127.0.0.1:${server.port}/mcp`,
            {
              Authorization: `Bearer ${token.token}`,
              "Mcp-Session-Id": sessionId ?? "",
            },
            JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
          );
          expect(res.status).toBe(401);
        } finally {
          await closeClient(client);
        }
      });
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("10. changing token grants invalidates the session (404) and re-connect sees new tools", async () => {
    const token = tokenFor({ name: "Promoted", mode: "read-only", toolsets: "default" });
    const env = createEnv([token]);
    try {
      await withServer(env, async (server) => {
        const { client, transport } = await connectClient(server.url, token.token);
        let fresh: Client | null = null;
        try {
          expect(await listToolNames(client)).not.toContain("lex_upsert");
          const sessionId = transport.sessionId;
          expect(sessionId).toBeTruthy();

          writeSettingsFile(env.settingsPath, {
            version: 1,
            port: DEFAULT_HTTP_PORT,
            tokens: [{ ...token, mode: "write", toolsets: "default" }],
          });

          const stale = await postJson(
            `http://127.0.0.1:${server.port}/mcp`,
            { Authorization: `Bearer ${token.token}`, "Mcp-Session-Id": sessionId ?? "" },
            JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
          );
          expect(stale.status).toBe(404);

          const reconnected = await connectClient(server.url, token.token);
          fresh = reconnected.client;
          expect(await listToolNames(fresh)).toContain("lex_upsert");
        } finally {
          await closeClient(client);
          if (fresh) await closeClient(fresh);
        }
      });
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("11. two write tokens can upsert concurrently and audit entries carry their names", async () => {
    const tokenA = tokenFor({ name: "Agent A", mode: "write", toolsets: "default" });
    const tokenB = tokenFor({ name: "Agent B", mode: "write", toolsets: "default" });
    const env = createEnv([tokenA, tokenB]);
    try {
      await withServer(env, async (server) => {
        const { client: clientA } = await connectClient(server.url, tokenA.token);
        const { client: clientB } = await connectClient(server.url, tokenB.token);
        try {
          // Two different languages so the two commits contend only on the directory lock,
          // not on the same optimistic-concurrency revision.
          const upsert = (
            language: string,
            entryId: string,
            romanized: string,
            operationId: string,
          ) => ({
            language,
            operation_id: operationId,
            entries: [
              {
                entry_id: entryId,
                con_word_romanized: romanized,
                senses: [{ pos_id: "pos_noun", gloss: `${romanized} thing` }],
              },
            ],
          });

          const commitAs = async (
            client: Client,
            language: string,
            entryId: string,
            romanized: string,
            operationId: string,
          ): Promise<void> => {
            const args = upsert(language, entryId, romanized, operationId);
            const preview = await callTool(client, "lex_upsert", { ...args, dry_run: true });
            const revisions = preview.base_revisions as Record<string, string> | undefined;
            await callTool(client, "lex_upsert", {
              ...args,
              expected_revision: revisions?.lexicon,
            });
          };

          await Promise.all([
            commitAs(clientA, "lang_root", "entry_http_a", "paka", "op_http_a"),
            commitAs(clientB, "lang_other", "entry_http_b", "tika", "op_http_b"),
          ]);

          const auditPath = path.join(env.workspaceDir, ".conlang-maker", "mcp_audit.ndjson");
          expect(fs.existsSync(auditPath)).toBe(true);
          const entries = fs
            .readFileSync(auditPath, "utf-8")
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as Record<string, unknown>)
            .filter((entry) => entry.tool === "lex_upsert");

          const clients = new Set(entries.map((entry) => entry.client));
          expect(clients.has("Agent A")).toBe(true);
          expect(clients.has("Agent B")).toBe(true);
        } finally {
          await closeClient(clientA);
          await closeClient(clientB);
        }
      });
    } finally {
      env.cleanup();
    }
  }, 60000);

  test("12. starting twice on the same port reports the running conlang-mcp", async () => {
    const env = createEnv([tokenFor()]);
    try {
      await withServer(env, async (server) => {
        let captured: PortInUseError | null = null;
        try {
          await startHttpServer(
            serveOptions(env, {
              port: server.port,
              initialSettings: { version: 1, port: server.port, tokens: [] },
              statePath: path.join(env.rootDir, "second.state.json"),
              usagePath: path.join(env.rootDir, "second-usage.json"),
            }),
          );
        } catch (err) {
          captured = err as PortInUseError;
        }
        expect(captured).toBeInstanceOf(PortInUseError);
        expect(captured?.existing).not.toBeNull();
        expect(captured?.existing?.version).toBe(SERVER_VERSION);
        expect(captured?.existing?.pid).toBe(process.pid);
      });
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("13. starting on a port held by another program reports existing === null", async () => {
    const env = createEnv([tokenFor()]);
    const foreign = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("not conlang-mcp"),
    });
    const foreignPort = foreign.port ?? 0;
    try {
      let captured: PortInUseError | null = null;
      try {
        await startHttpServer(
          serveOptions(env, {
            port: foreignPort,
            initialSettings: { version: 1, port: foreignPort, tokens: [] },
            statePath: path.join(env.rootDir, "foreign.state.json"),
            usagePath: path.join(env.rootDir, "foreign-usage.json"),
          }),
        );
      } catch (err) {
        captured = err as PortInUseError;
      }
      expect(captured).toBeInstanceOf(PortInUseError);
      expect(captured?.existing).toBeNull();
    } finally {
      foreign.stop(true);
      env.cleanup();
    }
  }, 30000);

  test("14. state file appears with our pid and is removed on stop", async () => {
    const env = createEnv([tokenFor()]);
    try {
      await withServer(env, async (server) => {
        expect(fs.existsSync(env.statePath)).toBe(true);
        const state = JSON.parse(fs.readFileSync(env.statePath, "utf-8")) as Record<
          string,
          unknown
        >;
        expect(state.name).toBe("conlang-maker-mcp");
        expect(state.pid).toBe(process.pid);
        expect(state.port).toBe(server.port);
        expect(state.url).toBe(server.url);
        expect(state.version).toBe(SERVER_VERSION);
      });
      expect(fs.existsSync(env.statePath)).toBe(false);
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("15. token last-used timestamps are persisted to mcp-token-usage.json", async () => {
    const token = tokenFor({ name: "Used" });
    const env = createEnv([token]);
    try {
      await withServer(env, async (server) => {
        const { client } = await connectClient(server.url, token.token);
        try {
          await listToolNames(client);
          await waitFor(
            () => {
              if (!fs.existsSync(env.usagePath)) return false;
              const parsed = JSON.parse(fs.readFileSync(env.usagePath, "utf-8")) as {
                token_last_used?: Record<string, string>;
              };
              return typeof parsed.token_last_used?.[token.id] === "string";
            },
            3000,
            "token usage file",
          );

          const parsed = JSON.parse(fs.readFileSync(env.usagePath, "utf-8")) as {
            token_last_used: Record<string, string>;
          };
          expect(Number.isNaN(Date.parse(parsed.token_last_used[token.id] ?? ""))).toBe(false);
        } finally {
          await closeClient(client);
        }
      });
    } finally {
      env.cleanup();
    }
  }, 30000);

  test("16. request bodies over 4 MiB are rejected with 413", async () => {
    const token = tokenFor();
    const env = createEnv([token]);
    try {
      await withServer(env, async (server) => {
        const huge = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "x".repeat(4 * 1024 * 1024 + 1024), version: "1" },
          },
        });
        const res = await postJson(
          `http://127.0.0.1:${server.port}/mcp`,
          { Authorization: `Bearer ${token.token}` },
          huge,
        );
        expect(res.status).toBe(413);
      });
    } finally {
      env.cleanup();
    }
  }, 60000);

  test("17. stdio fallback still works (bun mcp/main.ts --mode read-only)", async () => {
    const env = createEnv([tokenFor()]);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MCP_MAIN_PATH, "--mode", "read-only", "--registry", env.registryPath],
      cwd: REPO_ROOT,
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-fallback", version: "1.0.0" });
    openClients.push(client);
    try {
      await client.connect(transport);
      const names = await listToolNames(client);
      expect(names).toContain("lex_search");
      expect(names).not.toContain("lex_upsert");
    } finally {
      await closeClient(client);
      env.cleanup();
    }
  }, 30000);
});

describe("serve --parent-pid watchdog", () => {
  test("the server exits within 5s after its parent disappears", async () => {
    const env = createEnv([tokenFor()]);
    const parent = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const child = Bun.spawn(
      [
        process.execPath,
        MCP_MAIN_PATH,
        "serve",
        "--port",
        "0",
        "--settings",
        env.settingsPath,
        "--parent-pid",
        String(parent.pid),
      ],
      { cwd: REPO_ROOT, stdout: "ignore", stderr: "pipe" },
    );

    try {
      await waitFor(() => fs.existsSync(env.statePath), 10000, "state file");
      const state = JSON.parse(fs.readFileSync(env.statePath, "utf-8")) as { port: number };
      const health = await fetch(`http://127.0.0.1:${state.port}/healthz`);
      expect(health.status).toBe(200);

      parent.kill();
      await parent.exited;

      const outcome = await Promise.race([
        child.exited.then((code) => ({ code })),
        sleep(5000).then(() => ({ code: "timeout" as const })),
      ]);
      expect(outcome.code).toBe(0);
      expect(fs.existsSync(env.statePath)).toBe(false);
    } finally {
      try {
        child.kill();
      } catch {
        // already gone
      }
      try {
        parent.kill();
      } catch {
        // already gone
      }
      env.cleanup();
    }
  }, 30000);
});
