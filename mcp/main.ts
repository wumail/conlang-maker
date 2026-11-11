import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseConfig } from "./config";
import { normalizeToMcpError } from "./errors";
import { createServer } from "./server";

async function main(): Promise<void> {
  const config = parseConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error(
    `[conlang-mcp] v${config.version} running (mode=${config.mode}, toolsets=${Array.from(config.toolsets).sort().join(",")})`,
  );
}

main().catch((err: unknown) => {
  const mcpErr = normalizeToMcpError(err);
  console.error(`[conlang-mcp] Fatal startup error [${mcpErr.code}]: ${mcpErr.message}`);
  process.exit(1);
});
