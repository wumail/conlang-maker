import fs from "node:fs";
import path from "node:path";
import type { McpAuditLogEntry } from "../../src/types";
import { currentClient } from "../clientContext";

export function getAuditLogPath(projectDir: string): string {
  return path.join(projectDir, ".conlang-maker", "mcp_audit.ndjson");
}

/**
 * Appends an audit entry to <project>/.conlang-maker/mcp_audit.ndjson,
 * deduplicated by operation_id per §3.9.
 */
export function appendAuditLogDeduped(
  projectDir: string,
  entry: McpAuditLogEntry,
): void {
  const auditPath = getAuditLogPath(projectDir);
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });

  if (fs.existsSync(auditPath)) {
    const existingText = fs.readFileSync(auditPath, "utf-8");
    const lines = existingText.split("\n").filter((l) => l.trim().length > 0);
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 200); i--) {
      try {
        const parsed = JSON.parse(lines[i]) as Partial<McpAuditLogEntry>;
        if (parsed.operation_id === entry.operation_id) {
          return; // Already projected
        }
      } catch {
        // Ignore malformed historical line
      }
    }
  }

  const client = currentClient();
  const finalEntry: McpAuditLogEntry =
    entry.client === undefined && client?.clientName
      ? { ...entry, client: client.clientName }
      : entry;
  const line = JSON.stringify(finalEntry) + "\n";
  const fd = fs.openSync(auditPath, "a", 0o644);
  try {
    fs.writeFileSync(fd, line, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function readAuditLogs(
  projectDir: string,
  limit: number = 50,
): McpAuditLogEntry[] {
  const auditPath = getAuditLogPath(projectDir);
  if (!fs.existsSync(auditPath)) {
    return [];
  }
  const lines = fs
    .readFileSync(auditPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  const entries: McpAuditLogEntry[] = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    try {
      entries.push(JSON.parse(lines[i]) as McpAuditLogEntry);
    } catch {
      // Skip malformed line
    }
  }
  return entries;
}
