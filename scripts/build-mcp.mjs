import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "src-tauri", "binaries");

const TARGET_MATRIX = {
  "bun-darwin-arm64": {
    rustTriple: "aarch64-apple-darwin",
    ext: "",
  },
  "bun-darwin-x64": {
    rustTriple: "x86_64-apple-darwin",
    ext: "",
  },
  "bun-windows-x64": {
    rustTriple: "x86_64-pc-windows-msvc",
    ext: ".exe",
  },
  "bun-linux-x64": {
    rustTriple: "x86_64-unknown-linux-gnu",
    ext: "",
  },
};

function detectHostBunTarget() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin" && arch === "arm64") return "bun-darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "bun-darwin-x64";
  if (platform === "win32" && arch === "x64") return "bun-windows-x64";
  if (platform === "linux" && arch === "x64") return "bun-linux-x64";
  throw new Error(`Unsupported host platform/arch: ${platform}/${arch}`);
}

function resolveBunBinary() {
  if (process.versions && process.versions.bun) {
    return process.execPath;
  }
  const candidates = [
    process.env.BUN_INSTALL
      ? path.join(process.env.BUN_INSTALL, "bin", process.platform === "win32" ? "bun.exe" : "bun")
      : "",
    path.join(os.homedir(), ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun"),
    "bun",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "bun" || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "bun";
}

function main() {
  const argv = process.argv.slice(2);
  const buildAll = argv.includes("--all");
  const explicitTargetArg = argv.find((a) => a.startsWith("--target="));

  let selectedTargets;
  if (buildAll) {
    selectedTargets = Object.keys(TARGET_MATRIX);
  } else if (explicitTargetArg) {
    const val = explicitTargetArg.slice("--target=".length);
    if (!TARGET_MATRIX[val]) {
      throw new Error(
        `Unknown --target="${val}". Valid targets: ${Object.keys(TARGET_MATRIX).join(", ")}`,
      );
    }
    selectedTargets = [val];
  } else {
    selectedTargets = [detectHostBunTarget()];
  }

  fs.mkdirSync(outDir, { recursive: true });
  const bunBin = resolveBunBinary();
  const entryPoint = path.join(repoRoot, "mcp", "main.ts");

  for (const bunTarget of selectedTargets) {
    const spec = TARGET_MATRIX[bunTarget];
    const outFile = path.join(
      outDir,
      `conlang-mcp-${spec.rustTriple}${spec.ext}`,
    );
    console.error(`[build-mcp] Compiling ${bunTarget} -> ${path.relative(repoRoot, outFile)} ...`);

    execFileSync(
      bunBin,
      [
        "build",
        entryPoint,
        "--compile",
        "--asset-naming=[name].[ext]",
        `--target=${bunTarget}`,
        `--outfile=${outFile}`,
      ],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );

    if (process.platform !== "win32" && spec.ext === "" && fs.existsSync(outFile)) {
      fs.chmodSync(outFile, 0o755);
    }
    console.error(`[build-mcp] Built ${path.relative(repoRoot, outFile)}`);
  }
}

main();
