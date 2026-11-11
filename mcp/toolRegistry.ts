import type {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpConfig, ToolsetName } from "./config";
import { runWithClient } from "./clientContext";
import { wrap } from "./errors";

export type ToolAccessLevel = "read" | "write" | "destructive";

export interface ServerContext {
  config: McpConfig;
}

export interface ToolMetadata<TShape extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  toolsets: readonly ToolsetName[];
  access: ToolAccessLevel;
  idempotent?: boolean;
  alwaysRegister?: boolean;
  inputSchema: TShape;
  handler: (args: z.infer<z.ZodObject<TShape>>) => Promise<unknown> | unknown;
}

export type ToolDefinition<TShape extends z.ZodRawShape> = ToolMetadata<TShape>;

export function shouldRegisterTool(
  config: McpConfig,
  toolsets: readonly ToolsetName[],
  alwaysRegister?: boolean,
): boolean {
  if (alwaysRegister) {
    return true;
  }
  return toolsets.some((ts) => config.toolsets.has(ts));
}

export function registerDefinedTool<TShape extends z.ZodRawShape>(
  server: McpServer,
  config: McpConfig,
  spec: ToolMetadata<TShape>,
): void {
  if (!shouldRegisterTool(config, spec.toolsets, spec.alwaysRegister)) {
    return;
  }

  const isRead = spec.access === "read";
  const isDestructive = spec.access === "destructive";
  const isIdempotent = spec.idempotent ?? isRead;

  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema,
      annotations: {
        title: spec.title,
        readOnlyHint: isRead,
        destructiveHint: isDestructive,
        idempotentHint: isIdempotent,
        openWorldHint: false,
      },
    },
    wrap(async (rawArgs: unknown) => {
      const parsed = z.object(spec.inputSchema).parse(rawArgs ?? {});
      return await runWithClient(
        { clientName: config.clientName, tokenId: config.tokenId },
        async () => await spec.handler(parsed),
      );
    }) as ToolCallback<TShape>,
  );
}

