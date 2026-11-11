import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MISSING_REVISION = "missing";

export function sha256FullHex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function sha256Prefix16(data: Buffer | string): string {
  return sha256FullHex(data).slice(0, 16);
}

/**
 * §3.4 Single file revision: raw file bytes SHA-256 first 16 lowercase hex chars,
 * or "missing" when the file does not exist.
 */
export function computeFileRevision(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return MISSING_REVISION;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return MISSING_REVISION;
  }
  const bytes = fs.readFileSync(filePath);
  return sha256Prefix16(bytes);
}

/**
 * §3.4 Lexicon composite revision: sort lexicon_*.ndjson filenames by ASCII byte order;
 * if none exist -> "missing"; else hash "<filename>:<file_rev>\n" sequence.
 */
export function computeLexiconRevision(lexiconDir: string): string {
  if (!fs.existsSync(lexiconDir)) {
    return MISSING_REVISION;
  }
  const entries = fs
    .readdirSync(lexiconDir)
    .filter((f) => f.startsWith("lexicon_") && f.endsWith(".ndjson"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (entries.length === 0) {
    return MISSING_REVISION;
  }

  let sequence = "";
  for (const file of entries) {
    const fileRev = computeFileRevision(path.join(lexiconDir, file));
    sequence += `${file}:${fileRev}\n`;
  }
  return sha256Prefix16(Buffer.from(sequence, "utf-8"));
}

/**
 * Registry / Family ID: first 8 hex chars of SHA-256 of canonical absolute path.
 */
export function computeFamilyId(conlangFilePath: string): string {
  const resolved = canonicalizeConlangPath(conlangFilePath);
  return sha256FullHex(Buffer.from(resolved, "utf-8")).slice(0, 8);
}

export function canonicalizeConlangPath(filePath: string): string {
  const abs = path.resolve(filePath);
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
