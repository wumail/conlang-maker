import { describe, expect, test } from "bun:test";
import {
  buildClaudeCodeCommand,
  buildCursorConfig,
  buildGenericRequest,
  buildHttpSnippets,
  buildMcpCliArgs,
  buildStdioConfig,
} from "./httpSnippets";

const URL = "http://127.0.0.1:43117/mcp";
const TOKEN = "cmk_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

describe("MCP HTTP snippets (T-G2)", () => {
  test("cursor config is valid JSON with url + bearer header", () => {
    const parsed = JSON.parse(buildCursorConfig(URL, TOKEN)) as {
      mcpServers: Record<string, { url: string; headers: Record<string, string> }>;
    };
    const entry = parsed.mcpServers["conlang-maker"];
    expect(entry).toBeDefined();
    expect(entry.url).toBe(URL);
    expect(entry.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(entry.headers.Authorization).not.toContain("cmk_cmk_");
  });

  test("claude code command uses the http transport and quotes the header", () => {
    const command = buildClaudeCodeCommand(URL, TOKEN);
    expect(command.startsWith("claude mcp add --transport http conlang-maker ")).toBe(true);
    expect(command).toContain(URL);
    expect(command).toContain(`--header "Authorization: Bearer ${TOKEN}"`);
  });

  test("generic snippet carries method, url, auth and accept headers", () => {
    const lines = buildGenericRequest(URL, TOKEN).split("\n");
    expect(lines[0]).toBe(`POST ${URL}`);
    expect(lines[1]).toBe(`Authorization: Bearer ${TOKEN}`);
    expect(lines.some((line) => line.startsWith("Accept:"))).toBe(true);
    expect(lines.some((line) => line.includes("text/event-stream"))).toBe(true);
  });

  test("buildHttpSnippets returns the three HTTP clients in display order", () => {
    const snippets = buildHttpSnippets(URL, TOKEN);
    expect(snippets.map((s) => s.id)).toEqual(["cursor", "claude-code", "generic"]);
    for (const snippet of snippets) {
      expect(snippet.code).toContain(TOKEN);
    }
  });

  test("stdio fallback maps each permission mode to its toolsets", () => {
    expect(buildMcpCliArgs("read-only", null)).toEqual([
      "--mode",
      "read-only",
      "--toolsets",
      "core,audit,compute",
    ]);
    expect(buildMcpCliArgs("write", null)).toEqual([
      "--mode",
      "write",
      "--toolsets",
      "core,audit,compute,write,evolution",
    ]);
    expect(buildMcpCliArgs("write+destructive", null)).toEqual([
      "--mode",
      "write+destructive",
      "--toolsets",
      "all",
    ]);
  });

  test("stdio fallback appends --family only for a non-empty path", () => {
    expect(buildMcpCliArgs("read-only", "/tmp/fam.conlang")).toContain("--family");
    expect(buildMcpCliArgs("read-only", "/tmp/fam.conlang")).toContain("/tmp/fam.conlang");
    expect(buildMcpCliArgs("read-only", "   ")).not.toContain("--family");
    expect(buildMcpCliArgs("read-only", null)).not.toContain("--family");
  });

  test("stdio config falls back to the bare command name when the path is unknown", () => {
    const parsed = JSON.parse(buildStdioConfig("", "write", null)) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(parsed.mcpServers["conlang-maker"].command).toBe("conlang-mcp");
    expect(parsed.mcpServers["conlang-maker"].args).toContain("--mode");
  });
});
