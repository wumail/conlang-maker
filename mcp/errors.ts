import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { enforceMaxResponseSize } from "./util/size";

export type McpErrorCode =
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "VALIDATION"
  | "CONFLICT"
  | "REVISION_REQUIRED"
  | "RECOVERY_REQUIRED"
  | "LOCKED"
  | "READ_ONLY"
  | "DESTRUCTIVE_DISABLED"
  | "NO_FONT"
  | "IO";

const KNOWN_CODES: ReadonlySet<McpErrorCode> = new Set<McpErrorCode>([
  "NOT_FOUND",
  "AMBIGUOUS",
  "VALIDATION",
  "CONFLICT",
  "REVISION_REQUIRED",
  "RECOVERY_REQUIRED",
  "LOCKED",
  "READ_ONLY",
  "DESTRUCTIVE_DISABLED",
  "NO_FONT",
  "IO",
]);

export interface McpErrorPayload {
  code: McpErrorCode;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

export class McpError extends Error {
  public readonly code: McpErrorCode;
  public readonly hint?: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: McpErrorCode,
    message: string,
    hint?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.hint = hint;
    this.details = details;
  }

  toPayload(): McpErrorPayload {
    const payload: McpErrorPayload = {
      code: this.code,
      message: this.message,
    };
    if (this.hint !== undefined) {
      payload.hint = this.hint;
    }
    if (this.details !== undefined) {
      payload.details = this.details;
    }
    return payload;
  }
}

export type ToolResponse = CallToolResult;

export function normalizeToMcpError(err: unknown): McpError {
  if (err instanceof McpError) {
    return err;
  }
  if (err instanceof Error) {
    const match = /^([A-Z_]+):\s*(.*)$/s.exec(err.message);
    if (match) {
      const candidate = match[1] as McpErrorCode;
      if (KNOWN_CODES.has(candidate)) {
        return new McpError(candidate, match[2] || err.message);
      }
    }
    const errno = (err as NodeJS.ErrnoException).code;
    if (typeof errno === "string") {
      return new McpError(
        "IO",
        err.message,
        "Verify file permissions and path accessibility.",
        { errno },
      );
    }
    return new McpError("IO", err.message);
  }
  return new McpError("IO", String(err));
}

export function formatSuccess(result: unknown): ToolResponse {
  const sized = enforceMaxResponseSize(result);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(sized, null, 2),
      },
    ],
  };
}

export function formatError(err: unknown): ToolResponse {
  const mcpErr = normalizeToMcpError(err);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(mcpErr.toPayload(), null, 2),
      },
    ],
  };
}

export function wrap<TArgs>(
  handler: (args: TArgs) => Promise<unknown> | unknown,
): (args: TArgs) => Promise<ToolResponse> {
  return async (args: TArgs): Promise<ToolResponse> => {
    try {
      const res = await handler(args);
      return formatSuccess(res);
    } catch (err: unknown) {
      console.error("[conlang-mcp] Tool error:", err);
      return formatError(err);
    }
  };
}

export const jsonResult = formatSuccess;
export const errorResult = formatError;
export {
  assertDestructiveAllowed,
  assertWriteAllowed,
  assertWriteAllowed as assertWritable,
} from "./config";
