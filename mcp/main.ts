import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseConfig } from "./config";
import { normalizeToMcpError } from "./errors";
import { runServeCommand } from "./http/cli";
import { createServer } from "./server";

async function runStdioServer(): Promise<void> {
  // `--stdio` is accepted as an explicit alias; parseConfig ignores unknown flags.
  const config = parseConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();

  // stdout is reserved for JSON-RPC frames: every log line must go to stderr.
  await server.connect(transport);
  console.error(
    `[conlang-mcp] v${config.version} running (mode=${config.mode}, toolsets=${Array.from(config.toolsets).sort().join(",")})`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "serve") {
    process.exit(await runServeCommand(argv.slice(1)));
  }
  await runStdioServer();
}

main().catch((err: unknown) => {
  const mcpErr = normalizeToMcpError(err);
  console.error(`[conlang-mcp] Fatal startup error [${mcpErr.code}]: ${mcpErr.message}`);
  process.exit(1);
});
