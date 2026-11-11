import fs from "node:fs";
import path from "node:path";
import type { McpAuditLogEntry } from "../../src/types";
import { McpError } from "../errors";
import { appendAuditLogDeduped } from "./audit";
import { atomicWriteFileSync, syncParentDirBestEffort } from "./atomicWrite";

export interface TxTargetEntry {
  rel_path: string;
  kind: "file" | "dir_create" | "dir_move" | "delete";
  existed_before: boolean;
  before_sha256: string | null;
  after_sha256: string | null;
  preimage_rel: string | null;
  staged_rel: string | null;
  move_from_rel: string | null;
}

export interface TxManifest {
  version: 1;
  operation_id: string;
  origin: "gui" | "mcp";
  tool: string;
  request_digest: string;
  created_at: string;
  targets: TxTargetEntry[];
}

export interface TxResultRecord {
  operation_id: string;
  request_digest: string;
  committed_at: string;
  response: unknown;
  audit_entry?: McpAuditLogEntry;
}

const COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function getTransactionsRoot(projectDir: string): string {
  return path.join(projectDir, ".conlang-maker", "transactions");
}

export function getCompletedOpsRoot(projectDir: string): string {
  return path.join(projectDir, ".conlang-maker", "completed_ops");
}

function copyDirRecursiveSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursiveSync(srcPath, destPath);
    } else if (entry.isFile()) {
      atomicWriteFileSync(destPath, fs.readFileSync(srcPath));
    }
  }
}

function removePathRecursiveIfExists(targetPath: string): void {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.lstatSync(targetPath);
  if (stat.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(targetPath);
  }
}

export function lookupCompletedOperation(
  projectDir: string,
  operationId: string,
  requestDigest: string,
): TxResultRecord | null {
  const safeId = sanitizeOpId(operationId);
  const completedPath = path.join(getCompletedOpsRoot(projectDir), `${safeId}.json`);
  if (!fs.existsSync(completedPath)) {
    return null;
  }
  const record = JSON.parse(
    fs.readFileSync(completedPath, "utf-8"),
  ) as TxResultRecord;
  const ageMs = Date.now() - Date.parse(record.committed_at || "");
  if (Number.isFinite(ageMs) && ageMs > COMPLETED_RETENTION_MS) {
    throw new McpError(
      "VALIDATION",
      `operation_id "${operationId}" has expired its retention window; generate a new operation_id after reading current state.`,
    );
  }
  if (record.request_digest !== requestDigest) {
    throw new McpError(
      "VALIDATION",
      `operation_id "${operationId}" was already used with a different request payload.`,
      "Generate a fresh operation_id for a new request.",
    );
  }
  return record;
}

export function persistCompletedOperation(
  projectDir: string,
  record: TxResultRecord,
): void {
  const root = getCompletedOpsRoot(projectDir);
  fs.mkdirSync(root, { recursive: true });
  const safeId = sanitizeOpId(record.operation_id);
  atomicWriteFileSync(
    path.join(root, `${safeId}.json`),
    JSON.stringify(record, null, 2),
  );
  pruneExpiredCompletedOps(root);
}

function pruneExpiredCompletedOps(root: string): void {
  try {
    for (const file of fs.readdirSync(root)) {
      if (!file.endsWith(".json")) continue;
      const fullPath = path.join(root, file);
      const stat = fs.statSync(fullPath);
      if (Date.now() - stat.mtimeMs > COMPLETED_RETENTION_MS * 2) {
        fs.unlinkSync(fullPath);
      }
    }
  } catch {
    // Non-fatal cleanup
  }
}

export function sanitizeOpId(opId: string): string {
  const trimmed = opId.trim();
  if (!trimmed || !/^[a-zA-Z0-9._:-]{1,128}$/.test(trimmed)) {
    throw new McpError(
      "VALIDATION",
      `Invalid operation_id "${opId}". Use 1..128 ASCII alphanumeric/._:- characters.`,
    );
  }
  return trimmed.replace(/:/g, "_");
}

/**
 * §3.9 Crash Recovery & Pending Transaction Inspection (MUST run inside project lock!):
 * - If allowRecovery === false (read-only mode) and any uncommitted transaction exists:
 *   throws RECOVERY_REQUIRED without modifying business files.
 * - If committed marker exists: completes result/audit projection (idempotent) and cleans tx dir.
 * - If uncommitted: restores preimages in reverse target order, syncs, and cleans tx dir.
 */
export function ensureTransactionsRecovered(
  projectDir: string,
  allowRecovery: boolean,
): { warnings: string[] } {
  const txRoot = getTransactionsRoot(projectDir);
  const warnings: string[] = [];
  if (!fs.existsSync(txRoot)) {
    return { warnings };
  }

  const txDirs = fs
    .readdirSync(txRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (txDirs.length === 0) {
    return { warnings };
  }

  for (const dirName of txDirs) {
    const txDir = path.join(txRoot, dirName);
    const committedPath = path.join(txDir, "committed");
    const manifestPath = path.join(txDir, "manifest.json");
    const resultPath = path.join(txDir, "result.json");
    const isCommitted = fs.existsSync(committedPath);

    if (!allowRecovery) {
      throw new McpError(
        "RECOVERY_REQUIRED",
        `Workspace has a pending transaction ("${dirName}") requiring recovery, which cannot run in read-only mode.`,
        "Open the workspace in Conlang Maker GUI or run conlang-mcp in write mode to complete crash recovery.",
        { transaction_id: dirName, committed: isCommitted },
      );
    }

    try {
      if (isCommitted) {
        if (fs.existsSync(resultPath)) {
          const resultRecord = JSON.parse(
            fs.readFileSync(resultPath, "utf-8"),
          ) as TxResultRecord;
          persistCompletedOperation(projectDir, resultRecord);
          if (resultRecord.audit_entry) {
            try {
              appendAuditLogDeduped(projectDir, resultRecord.audit_entry);
            } catch (auditErr) {
              warnings.push(
                `Audit projection warning for ${dirName}: ${String(auditErr)}`,
              );
            }
          }
        }
        fs.rmSync(txDir, { recursive: true, force: true });
        continue;
      }

      // Uncommitted transaction: roll back from manifest if manifest was written
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(
          fs.readFileSync(manifestPath, "utf-8"),
        ) as TxManifest;

        for (let i = manifest.targets.length - 1; i >= 0; i--) {
          const t = manifest.targets[i];
          const absTarget = path.join(projectDir, t.rel_path);

          if (t.kind === "dir_move" && t.move_from_rel) {
            const absFrom = path.join(projectDir, t.move_from_rel);
            if (fs.existsSync(absTarget) && !fs.existsSync(absFrom)) {
              fs.mkdirSync(path.dirname(absFrom), { recursive: true });
              fs.renameSync(absTarget, absFrom);
              syncParentDirBestEffort(path.dirname(absFrom));
              syncParentDirBestEffort(path.dirname(absTarget));
            } else if (!t.existed_before && fs.existsSync(absTarget)) {
              removePathRecursiveIfExists(absTarget);
            }
          } else if (t.kind === "dir_create") {
            if (!t.existed_before) {
              removePathRecursiveIfExists(absTarget);
              syncParentDirBestEffort(path.dirname(absTarget));
            }
          } else {
            // "file" or "delete"
            if (t.existed_before && t.preimage_rel) {
              const preimagePath = path.join(txDir, t.preimage_rel);
              if (fs.existsSync(preimagePath)) {
                const stat = fs.statSync(preimagePath);
                if (stat.isDirectory()) {
                  removePathRecursiveIfExists(absTarget);
                  copyDirRecursiveSync(preimagePath, absTarget);
                } else {
                  atomicWriteFileSync(absTarget, fs.readFileSync(preimagePath));
                }
              }
            } else if (!t.existed_before) {
              removePathRecursiveIfExists(absTarget);
              syncParentDirBestEffort(path.dirname(absTarget));
            }
          }
        }
      }

      fs.rmSync(txDir, { recursive: true, force: true });
      syncParentDirBestEffort(txRoot);
    } catch (err) {
      throw new McpError(
        "RECOVERY_REQUIRED",
        `Failed to recover pending transaction "${dirName}": ${err instanceof Error ? err.message : String(err)}`,
        "Transaction journal materials have been preserved under .conlang-maker/transactions/ for inspection.",
        { transaction_id: dirName },
      );
    }
  }

  return { warnings };
}
