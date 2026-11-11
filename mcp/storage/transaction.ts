import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { McpAuditLogEntry } from "../../src/types";
import { McpError } from "../errors";
import { appendAuditLogDeduped } from "./audit";
import { atomicWriteFileSync, syncParentDirBestEffort } from "./atomicWrite";
import { withProjectLock } from "./lock";
import {
  ensureTransactionsRecovered,
  getTransactionsRoot,
  lookupCompletedOperation,
  persistCompletedOperation,
  sanitizeOpId,
  type TxManifest,
  type TxResultRecord,
  type TxTargetEntry,
} from "./recovery";
import {
  computeFileRevision,
  computeLexiconRevision,
  sha256FullHex,
} from "./revision";

export type PlannedMutation =
  | {
      kind: "write_file";
      relPath: string;
      content: Buffer | string;
    }
  | {
      kind: "delete_path";
      relPath: string;
    }
  | {
      kind: "create_dir";
      relPath: string;
    }
  | {
      kind: "move_dir";
      fromRelPath: string;
      toRelPath: string;
    };

export interface RevisionExpectation {
  label: string;
  targetPath: string;
  isLexiconDir?: boolean;
  expectedRevision: string;
}

export interface TransactionFaultHook {
  stage:
    | "after_manifest"
    | "mid_apply"
    | "before_committed"
    | "before_audit";
  trigger: () => void;
}

export interface TransactionPlanResult<
  TResponse = unknown,
  TDryRunResponse = TResponse,
> {
  expectations: RevisionExpectation[];
  mutations: PlannedMutation[];
  buildResponse: (
    newRevisions: Record<string, string>,
    warnings: string[],
  ) => TResponse;
  buildDryRunResponse?: (
    baseRevisions: Record<string, string>,
  ) => TDryRunResponse;
  auditSummary?: string;
  languageId?: string | null;
  snapshotId?: string | null;
}

export interface ExecuteTransactionOptions<
  TResponse = unknown,
  TDryRunResponse = TResponse,
> {
  projectDir: string;
  toolName: string;
  origin?: "mcp" | "gui";
  operationId?: string;
  requestPayloadForDigest: unknown;
  dryRun?: boolean;
  requireRevisionsOnCommit?: boolean;
  faultHook?: TransactionFaultHook;
  planInsideLock: (ctx: {
    operationId: string;
    warnings: string[];
  }) =>
    | Promise<TransactionPlanResult<TResponse, TDryRunResponse>>
    | TransactionPlanResult<TResponse, TDryRunResponse>;
}

export function computeRequestDigest(toolName: string, payload: unknown): string {
  const cleanPayload = stripTransientDigestKeys(payload);
  const canonical = JSON.stringify({ tool: toolName, payload: cleanPayload });
  return sha256FullHex(Buffer.from(canonical, "utf-8"));
}

function stripTransientDigestKeys(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(stripTransientDigestKeys);
  }
  if (typeof val === "object" && val !== null) {
    const rec = val as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) {
      out[key] = stripTransientDigestKeys(rec[key]);
    }
    return out;
  }
  return val;
}

function copyDirForPreimage(srcDir: string, dstDir: string): void {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirForPreimage(s, d);
    } else if (entry.isFile()) {
      atomicWriteFileSync(d, fs.readFileSync(s));
    }
  }
}

function computeActualRevision(exp: RevisionExpectation): string {
  return exp.isLexiconDir
    ? computeLexiconRevision(exp.targetPath)
    : computeFileRevision(exp.targetPath);
}

/**
 * §3.9 Full Project Transaction Executor:
 * 1. Acquires project lock.
 * 2. Recovers any interrupted transactions (or fails RECOVERY_REQUIRED if dryRun in read-only).
 * 3. Checks operation_id deduplication against completed_ops.
 * 4. Runs planInsideLock to collect expectations & mutations.
 * 5. Verifies expected revisions (CAS).
 * 6. Stages preimages + staged bytes + manifest.json and fsyncs.
 * 7. Applies all mutations, writes result.json, syncs affected dirs, writes committed marker,
 *    projects audit & completed_ops, and cleans transaction workspace.
 */
export async function executeProjectTransaction<
  TResponse = unknown,
  TDryRunResponse = TResponse,
>(
  opts: ExecuteTransactionOptions<TResponse, TDryRunResponse>,
): Promise<TResponse | TDryRunResponse> {
  const origin = opts.origin ?? "mcp";
  const opId = opts.operationId?.trim() || crypto.randomUUID();
  sanitizeOpId(opId);

  const requestDigest = computeRequestDigest(
    opts.toolName,
    opts.requestPayloadForDigest,
  );

  return await withProjectLock(opts.projectDir, opts.toolName, async () => {
    const { warnings } = ensureTransactionsRecovered(opts.projectDir, true);

    if (!opts.dryRun && opts.operationId) {
      const prior = lookupCompletedOperation(
        opts.projectDir,
        opId,
        requestDigest,
      );
      if (prior) {
        return prior.response as TResponse | TDryRunResponse;
      }
    }

    const plan = await opts.planInsideLock({ operationId: opId, warnings });

    const currentRevisions: Record<string, string> = {};
    for (const exp of plan.expectations) {
      currentRevisions[exp.label] = computeActualRevision(exp);
    }

    if (opts.dryRun) {
      if (plan.buildDryRunResponse) {
        return plan.buildDryRunResponse(currentRevisions);
      }
      return plan.buildResponse(currentRevisions, warnings);
    }

    // Verify expected revisions (CAS)
    for (const exp of plan.expectations) {
      if (!exp.expectedRevision) {
        if (opts.requireRevisionsOnCommit !== false) {
          throw new McpError(
            "REVISION_REQUIRED",
            `Missing expected revision for "${exp.label}".`,
            "Read the latest revision (or run with dry_run: true to obtain base_revisions) and pass expected_revision / expected_revisions.",
            { target: exp.label, current_revision: currentRevisions[exp.label] },
          );
        }
        continue;
      }
      const actual = currentRevisions[exp.label];
      if (exp.expectedRevision !== actual) {
        throw new McpError(
          "CONFLICT",
          `Revision mismatch on "${exp.label}": expected "${exp.expectedRevision}", actual "${actual}".`,
          "Re-read the latest resource revision and retry with a fresh operation_id.",
          {
            target: exp.label,
            expected_revision: exp.expectedRevision,
            actual_revision: actual,
          },
        );
      }
    }

    const safeId = sanitizeOpId(opId);
    const txDir = path.join(getTransactionsRoot(opts.projectDir), safeId);
    const preimagesDir = path.join(txDir, "preimages");
    const stagedDir = path.join(txDir, "staged");
    fs.mkdirSync(preimagesDir, { recursive: true });
    fs.mkdirSync(stagedDir, { recursive: true });

    const targets: TxTargetEntry[] = [];

    for (let idx = 0; idx < plan.mutations.length; idx++) {
      const m = plan.mutations[idx];
      if (m.kind === "write_file") {
        const relPath = normalizeRel(m.relPath);
        const absTarget = path.join(opts.projectDir, relPath);
        const existed = fs.existsSync(absTarget);
        let beforeSha: string | null = null;
        let preimageRel: string | null = null;
        if (existed && fs.statSync(absTarget).isFile()) {
          const oldBytes = fs.readFileSync(absTarget);
          beforeSha = sha256FullHex(oldBytes);
          preimageRel = `preimages/${idx}`;
          atomicWriteFileSync(path.join(txDir, preimageRel), oldBytes);
        }
        const newBytes =
          typeof m.content === "string"
            ? Buffer.from(m.content, "utf-8")
            : m.content;
        const afterSha = sha256FullHex(newBytes);
        const stagedRel = `staged/${idx}`;
        atomicWriteFileSync(path.join(txDir, stagedRel), newBytes);
        targets.push({
          rel_path: relPath,
          kind: "file",
          existed_before: existed,
          before_sha256: beforeSha,
          after_sha256: afterSha,
          preimage_rel: preimageRel,
          staged_rel: stagedRel,
          move_from_rel: null,
        });
      } else if (m.kind === "delete_path") {
        const relPath = normalizeRel(m.relPath);
        const absTarget = path.join(opts.projectDir, relPath);
        const existed = fs.existsSync(absTarget);
        let beforeSha: string | null = null;
        let preimageRel: string | null = null;
        if (existed) {
          preimageRel = `preimages/${idx}`;
          const stat = fs.statSync(absTarget);
          if (stat.isDirectory()) {
            copyDirForPreimage(absTarget, path.join(txDir, preimageRel));
          } else {
            const oldBytes = fs.readFileSync(absTarget);
            beforeSha = sha256FullHex(oldBytes);
            atomicWriteFileSync(path.join(txDir, preimageRel), oldBytes);
          }
        }
        targets.push({
          rel_path: relPath,
          kind: "delete",
          existed_before: existed,
          before_sha256: beforeSha,
          after_sha256: null,
          preimage_rel: preimageRel,
          staged_rel: null,
          move_from_rel: null,
        });
      } else if (m.kind === "create_dir") {
        const relPath = normalizeRel(m.relPath);
        const absTarget = path.join(opts.projectDir, relPath);
        targets.push({
          rel_path: relPath,
          kind: "dir_create",
          existed_before: fs.existsSync(absTarget),
          before_sha256: null,
          after_sha256: null,
          preimage_rel: null,
          staged_rel: null,
          move_from_rel: null,
        });
      } else if (m.kind === "move_dir") {
        const fromRel = normalizeRel(m.fromRelPath);
        const toRel = normalizeRel(m.toRelPath);
        const absTo = path.join(opts.projectDir, toRel);
        targets.push({
          rel_path: toRel,
          kind: "dir_move",
          existed_before: fs.existsSync(absTo),
          before_sha256: null,
          after_sha256: null,
          preimage_rel: null,
          staged_rel: null,
          move_from_rel: fromRel,
        });
      }
    }

    const manifest: TxManifest = {
      version: 1,
      operation_id: opId,
      origin,
      tool: opts.toolName,
      request_digest: requestDigest,
      created_at: new Date().toISOString(),
      targets,
    };

    atomicWriteFileSync(
      path.join(txDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    syncParentDirBestEffort(txDir);

    if (opts.faultHook?.stage === "after_manifest") {
      opts.faultHook.trigger();
    }

    // Apply all targets
    const affectedParentDirs = new Set<string>();
    for (let idx = 0; idx < targets.length; idx++) {
      const t = targets[idx];
      const absTarget = path.join(opts.projectDir, t.rel_path);
      affectedParentDirs.add(path.dirname(absTarget));

      if (t.kind === "file" && t.staged_rel) {
        const stagedBytes = fs.readFileSync(path.join(txDir, t.staged_rel));
        atomicWriteFileSync(absTarget, stagedBytes);
      } else if (t.kind === "delete") {
        if (fs.existsSync(absTarget)) {
          const stat = fs.lstatSync(absTarget);
          if (stat.isDirectory()) {
            fs.rmSync(absTarget, { recursive: true, force: true });
          } else {
            fs.unlinkSync(absTarget);
          }
        }
      } else if (t.kind === "dir_create") {
        fs.mkdirSync(absTarget, { recursive: true });
      } else if (t.kind === "dir_move" && t.move_from_rel) {
        const absFrom = path.join(opts.projectDir, t.move_from_rel);
        affectedParentDirs.add(path.dirname(absFrom));
        fs.mkdirSync(path.dirname(absTarget), { recursive: true });
        if (fs.existsSync(absTarget)) {
          fs.rmSync(absTarget, { recursive: true, force: true });
        }
        fs.renameSync(absFrom, absTarget);
      }

      if (opts.faultHook?.stage === "mid_apply" && idx === 0) {
        opts.faultHook.trigger();
      }
    }

    for (const dir of affectedParentDirs) {
      syncParentDirBestEffort(dir);
    }

    const newRevisions: Record<string, string> = {};
    for (const exp of plan.expectations) {
      newRevisions[exp.label] = computeActualRevision(exp);
    }

    const committedAt = new Date().toISOString();
    const response = plan.buildResponse(newRevisions, warnings);
    const auditEntry: McpAuditLogEntry = {
      timestamp: committedAt,
      operation_id: opId,
      tool: opts.toolName,
      origin,
      family_path: opts.projectDir,
      language_id: plan.languageId ?? null,
      summary: plan.auditSummary ?? `${opts.toolName} committed`,
      snapshot_id: plan.snapshotId ?? null,
      status: "committed",
    };

    const resultRecord: TxResultRecord = {
      operation_id: opId,
      request_digest: requestDigest,
      committed_at: committedAt,
      response,
      audit_entry: auditEntry,
    };

    atomicWriteFileSync(
      path.join(txDir, "result.json"),
      JSON.stringify(resultRecord, null, 2),
    );

    if (opts.faultHook?.stage === "before_committed") {
      opts.faultHook.trigger();
    }

    // Write committed marker and sync transaction directory
    atomicWriteFileSync(path.join(txDir, "committed"), committedAt);
    syncParentDirBestEffort(txDir);

    if (opts.faultHook?.stage === "before_audit") {
      opts.faultHook.trigger();
    }

    persistCompletedOperation(opts.projectDir, resultRecord);
    try {
      appendAuditLogDeduped(opts.projectDir, auditEntry);
    } catch (auditErr) {
      warnings.push(`Audit log projection warning: ${String(auditErr)}`);
      // Preserve txDir if audit failed? No: completed_ops has it, or keep warning per §3.9
    }

    try {
      fs.rmSync(txDir, { recursive: true, force: true });
      syncParentDirBestEffort(path.dirname(txDir));
    } catch (cleanErr) {
      console.warn("[conlang-mcp] Non-fatal tx cleanup warning:", cleanErr);
    }

    return response;
  });
}

function normalizeRel(rel: string): string {
  const norm = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (norm === "" || norm.startsWith("..") || norm.includes("/../")) {
    throw new McpError("VALIDATION", `Invalid transaction relative path "${rel}".`);
  }
  return norm;
}

export const executeWriteTransaction = executeProjectTransaction;
