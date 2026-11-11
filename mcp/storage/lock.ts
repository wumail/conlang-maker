import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpError } from "../errors";

export interface LockContext {
  heldLocks: Map<string, string>; // canonicalLockDir -> ownerFileName
}

const lockContextStorage = new AsyncLocalStorage<LockContext>();
const inProcessChains = new Map<string, Promise<void>>();

export const LOCK_TIMEOUT_MS = 5_000;
const BASE_BACKOFF_MS = 50;
const EMPTY_DIR_GRACE_MS = 30_000;

export function computeHostKey(): string {
  const host = (os.hostname() || "localhost").trim().toLowerCase();
  return crypto.createHash("sha256").update(host, "utf-8").digest("hex").slice(0, 12);
}

const LOCAL_HOST_KEY = computeHostKey();

function canonicalizeDir(dirPath: string): string {
  const abs = path.resolve(dirPath);
  try {
    return fs.realpathSync(abs);
  } catch {
    const parent = path.dirname(abs);
    try {
      return path.join(fs.realpathSync(parent), path.basename(abs));
    } catch {
      return abs;
    }
  }
}

/**
 * Reliable local process liveness check per §3.2:
 * process.kill(pid, 0) throws ESRCH ONLY when no such PID exists on this host.
 * EPERM means the process DOES exist under another user -> treat as ALIVE!
 */
export function isLocalPidDead(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (pid === process.pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return false; // Alive
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return true;
    }
    // EPERM or unknown error -> do NOT reclaim
    return false;
  }
}

interface ParsedOwnerName {
  hostKey: string;
  pid: number;
  nonce: string;
}

function parseOwnerFileName(fileName: string): ParsedOwnerName | null {
  const match = /^owner-([0-9a-f]{12})-(\d+)-([0-9a-f]{32})\.json$/.exec(fileName);
  if (!match) return null;
  const pid = Number(match[2]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  return {
    hostKey: match[1],
    pid,
    nonce: match[3],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withInProcessMutex<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = inProcessChains.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => current);
  inProcessChains.set(key, chained);

  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (inProcessChains.get(key) === chained) {
      inProcessChains.delete(key);
    }
  }
}

export async function withDirectoryLock<T>(
  lockDirRaw: string,
  toolName: string,
  fn: () => Promise<T> | T,
  timeoutMs: number = LOCK_TIMEOUT_MS,
): Promise<T> {
  const lockDir = canonicalizeDir(lockDirRaw);
  const activeCtx = lockContextStorage.getStore();
  if (activeCtx && activeCtx.heldLocks.has(lockDir)) {
    // Reentrant within the exact same execution context
    return await fn();
  }

  return await withInProcessMutex(lockDir, async () => {
    const deadline = Date.now() + timeoutMs;
    const pid = process.pid;
    let acquiredOwnerFile: string | null = null;

    while (Date.now() <= deadline) {
      const nonce = crypto.randomBytes(16).toString("hex");
      const ownerFileName = `owner-${LOCAL_HOST_KEY}-${pid}-${nonce}.json`;
      const ownerPath = path.join(lockDir, ownerFileName);

      // Optional empty stale lock directory cleanup after 30s grace period
      try {
        if (fs.existsSync(lockDir)) {
          const stat = fs.statSync(lockDir);
          if (Date.now() - stat.mtimeMs > EMPTY_DIR_GRACE_MS) {
            const existing = fs.readdirSync(lockDir);
            if (existing.length === 0) {
              try {
                fs.rmdirSync(lockDir);
              } catch {
                // Race with concurrent publisher is normal
              }
            }
          }
        }
      } catch {
        // Ignore stat/readdir race before mkdir
      }

      try {
        fs.mkdirSync(lockDir, { recursive: true });
      } catch {
        // Proceed to exclusive file creation check
      }

      let createdByUs = false;
      try {
        const fd = fs.openSync(ownerPath, "wx", 0o644);
        try {
          const body = JSON.stringify(
            {
              host_key: LOCAL_HOST_KEY,
              pid,
              nonce,
              tool: toolName,
              acquired_at: new Date().toISOString(),
            },
            null,
            2,
          );
          fs.writeFileSync(fd, body, "utf-8");
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        createdByUs = true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "ENOENT") {
          throw err;
        }
      }

      if (createdByUs) {
        let entries: string[] | null = null;
        try {
          entries = fs.readdirSync(lockDir);
        } catch {
          entries = null;
        }

        if (entries !== null) {
          const owners = entries.filter((f) => f.startsWith("owner-"));
          if (owners.length === 1 && owners[0] === ownerFileName) {
            acquiredOwnerFile = ownerFileName;
            break;
          }

          // Reclaim provably dead local owners
          for (const other of owners) {
            if (other === ownerFileName) continue;
            const parsed = parseOwnerFileName(other);
            if (
              parsed &&
              parsed.hostKey === LOCAL_HOST_KEY &&
              isLocalPidDead(parsed.pid)
            ) {
              try {
                fs.unlinkSync(path.join(lockDir, other));
              } catch {
                // Another contender may have cleaned it
              }
            }
          }
        }

        // Contended or enumeration failed: withdraw OUR owner file & back off
        try {
          fs.unlinkSync(ownerPath);
        } catch {
          // Ignore ENOENT
        }
        try {
          fs.rmdirSync(lockDir);
        } catch {
          // Ignore ENOTEMPTY / ENOENT
        }
      }

      if (Date.now() >= deadline) {
        break;
      }
      const jitter = Math.floor(Math.random() * 25);
      await sleep(BASE_BACKOFF_MS + jitter);
    }

    if (!acquiredOwnerFile) {
      throw new McpError(
        "LOCKED",
        `Timed out after ${timeoutMs}ms waiting for lock at ${lockDir}.`,
        "Another GUI or MCP operation is currently modifying this workspace. Retry shortly.",
        { lock_dir: lockDir },
      );
    }

    const nextHeld = new Map(activeCtx?.heldLocks ?? []);
    nextHeld.set(lockDir, acquiredOwnerFile);

    try {
      return await lockContextStorage.run({ heldLocks: nextHeld }, async () => {
        return await fn();
      });
    } finally {
      try {
        fs.unlinkSync(path.join(lockDir, acquiredOwnerFile));
      } catch {
        // Ignore ENOENT
      }
      try {
        fs.rmdirSync(lockDir);
      } catch {
        // Ignore ENOTEMPTY / ENOENT
      }
    }
  });
}

export async function withProjectLock<T>(
  projectDir: string,
  toolName: string,
  fn: () => Promise<T> | T,
  timeoutMs: number = LOCK_TIMEOUT_MS,
): Promise<T> {
  const lockDir = path.join(projectDir, ".conlang-maker", "lock");
  return await withDirectoryLock(lockDir, toolName, fn, timeoutMs);
}
