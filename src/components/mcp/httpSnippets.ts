import type { McpPermissionMode } from "../../types";

/**
 * Pure builders for the client configuration snippets shown on the MCP settings page.
 * Kept free of React/i18n so they can be unit tested directly.
 */

export const MODE_TOOLSETS: Record<McpPermissionMode, string> = {
  "read-only": "core,audit,compute",
  write: "core,audit,compute,write,evolution",
  "write+destructive": "all",
};

export type HttpSnippetId = "cursor" | "claude-code" | "generic";

export interface HttpSnippetItem {
  id: HttpSnippetId;
  code: string;
}

/** `.cursor/mcp.json` entry for the streamable HTTP endpoint. */
export function buildCursorConfig(url: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "conlang-maker": {
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

/** `claude mcp add` command for Claude Code. */
export function buildClaudeCodeCommand(url: string, token: string): string {
  return `claude mcp add --transport http conlang-maker ${url} --header "Authorization: Bearer ${token}"`;
}

/** Raw HTTP request shape for any other MCP client. */
export function buildGenericRequest(url: string, token: string): string {
  return [
    `POST ${url}`,
    `Authorization: Bearer ${token}`,
    "Content-Type: application/json",
    "Accept: application/json, text/event-stream",
  ].join("\n");
}

export function buildHttpSnippets(url: string, token: string): HttpSnippetItem[] {
  return [
    { id: "cursor", code: buildCursorConfig(url, token) },
    { id: "claude-code", code: buildClaudeCodeCommand(url, token) },
    { id: "generic", code: buildGenericRequest(url, token) },
  ];
}

/** CLI arguments for the stdio fallback (Claude Desktop and other stdio-only clients). */
export function buildMcpCliArgs(
  mode: McpPermissionMode,
  familyFilePath: string | null,
): string[] {
  const args = ["--mode", mode, "--toolsets", MODE_TOOLSETS[mode]];
  if (familyFilePath && familyFilePath.trim().length > 0) {
    args.push("--family", familyFilePath.trim());
  }
  return args;
}

/** `claude_desktop_config.json`-style JSON for the stdio fallback. */
export function buildStdioConfig(
  binaryPath: string,
  mode: McpPermissionMode,
  familyFilePath: string | null,
): string {
  return JSON.stringify(
    {
      mcpServers: {
        "conlang-maker": {
          command: binaryPath.trim() || "conlang-mcp",
          args: buildMcpCliArgs(mode, familyFilePath),
        },
      },
    },
    null,
    2,
  );
}
