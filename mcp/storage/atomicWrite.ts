import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * §3.3 Single-file atomic replace:
 * Writes to <target>.<pid>.<128bit_nonce>.tmp with O_EXCL ("wx"),
 * fsyncs file, renames onto target, and best-effort fsyncs parent directory.
 */
export function atomicWriteFileSync(
  targetPath: string,
  content: Buffer | string,
): void {
  const parentDir = path.dirname(targetPath);
  fs.mkdirSync(parentDir, { recursive: true });

  const bytes =
    typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  const pid = process.pid;

  let tmpPath = "";
  let fd: number | null = null;

  for (let attempt = 0; attempt < 16; attempt++) {
    const nonce = crypto.randomBytes(16).toString("hex");
    const candidate = `${targetPath}.${pid}.${nonce}.tmp`;
    try {
      fd = fs.openSync(candidate, "wx", 0o644);
      tmpPath = candidate;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        continue;
      }
      throw err;
    }
  }

  if (fd === null || !tmpPath) {
    throw new Error(`IO: Failed to allocate unique temp file for ${targetPath}`);
  }

  try {
    let offset = 0;
    while (offset < bytes.length) {
      offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    fs.renameSync(tmpPath, targetPath);
    syncParentDirBestEffort(parentDir);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (closeErr) {
        console.warn("[conlang-mcp] Failed closing temp fd:", closeErr);
      }
    }
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch (unlinkErr) {
      console.warn("[conlang-mcp] Failed cleaning temp file:", unlinkErr);
    }
    throw err;
  }
}

export function syncParentDirBestEffort(dirPath: string): void {
  if (process.platform === "win32") return;
  try {
    const dirFd = fs.openSync(dirPath, "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Some filesystems do not support fsync on directories; best-effort per §3.3
  }
}

