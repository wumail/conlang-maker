import { McpError } from "../errors";

export interface ListParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  total: number;
  items: T[];
  next_cursor: string | null;
  revision: string;
}

interface CursorPayload {
  offset: number;
  revision: string;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export function encodeCursor(offset: number, revision: string): string {
  const payload: CursorPayload = { offset, revision };
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
}

export function decodeCursor(cursor: string, currentRevision: string): number {
  let parsed: unknown;
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf-8");
    parsed = JSON.parse(json);
  } catch {
    throw new McpError(
      "VALIDATION",
      "Invalid pagination cursor format.",
      "Omit cursor to start from the first page.",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as CursorPayload).offset !== "number" ||
    !Number.isInteger((parsed as CursorPayload).offset) ||
    (parsed as CursorPayload).offset < 0 ||
    typeof (parsed as CursorPayload).revision !== "string"
  ) {
    throw new McpError(
      "VALIDATION",
      "Malformed pagination cursor payload.",
      "Omit cursor to start from the first page.",
    );
  }

  const { offset, revision } = parsed as CursorPayload;
  if (revision !== currentRevision) {
    throw new McpError(
      "CONFLICT",
      `Dataset revision changed from "${revision}" to "${currentRevision}" during pagination.`,
      "Re-run the query without cursor to read from the latest revision.",
      { cursor_revision: revision, current_revision: currentRevision },
    );
  }
  return offset;
}

export function paginate<T>(
  allItems: readonly T[],
  currentRevision: string,
  params?: ListParams,
): PaginatedResult<T> {
  const rawLimit = params?.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(rawLimit) || rawLimit < 1) {
    throw new McpError("VALIDATION", "limit must be a positive integer.");
  }
  const limit = Math.min(rawLimit, MAX_LIMIT);
  const startIndex = params?.cursor
    ? decodeCursor(params.cursor, currentRevision)
    : 0;

  const items = allItems.slice(startIndex, startIndex + limit);
  const nextOffset = startIndex + items.length;
  const next_cursor =
    nextOffset < allItems.length
      ? encodeCursor(nextOffset, currentRevision)
      : null;

  return {
    total: allItems.length,
    items,
    next_cursor,
    revision: currentRevision,
  };
}
