import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "src-tauri", "binaries");

export const TARGET_MATRIX = {
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

export const RUST_TO_BUN_TARGETS = {
  ...Object.fromEntries(
    Object.entries(TARGET_MATRIX).map(([bunTarget, spec]) => [
      spec.rustTriple,
      [bunTarget],
    ]),
  ),
  "universal-apple-darwin": ["bun-darwin-arm64", "bun-darwin-x64"],
};

const HOST_PLATFORM_ARCH_MAP = {
  "darwin/arm64": "bun-darwin-arm64",
  "darwin/x64": "bun-darwin-x64",
  "win32/x64": "bun-windows-x64",
  "linux/x64": "bun-linux-x64",
};

const TAURI_ENV_TO_BUN_TARGETS = {
  "darwin/aarch64": ["bun-darwin-arm64"],
  "darwin/arm64": ["bun-darwin-arm64"],
  "darwin/x86_64": ["bun-darwin-x64"],
  "darwin/x64": ["bun-darwin-x64"],
  "darwin/universal": ["bun-darwin-arm64", "bun-darwin-x64"],
  "macos/aarch64": ["bun-darwin-arm64"],
  "macos/x86_64": ["bun-darwin-x64"],
  "windows/x86_64": ["bun-windows-x64"],
  "windows/x64": ["bun-windows-x64"],
  "win32/x86_64": ["bun-windows-x64"],
  "win32/x64": ["bun-windows-x64"],
  "linux/x86_64": ["bun-linux-x64"],
  "linux/x64": ["bun-linux-x64"],
};

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Detect the Bun compile target matching the current host platform/arch.
 *
 * @param {string} [platform]
 * @param {string} [arch]
 * @returns {keyof typeof TARGET_MATRIX}
 */
export function detectHostBunTarget(
  platform = process.platform,
  arch = process.arch,
) {
  const key = `${platform}/${arch}`;
  if (hasOwn(HOST_PLATFORM_ARCH_MAP, key)) {
    return HOST_PLATFORM_ARCH_MAP[key];
  }
  throw new Error(`Unsupported host platform/arch: ${platform}/${arch}`);
}

/**
 * Resolve either a Bun target name (e.g. `bun-darwin-x64`) or a Rust/Tauri
 * target triple (e.g. `x86_64-apple-darwin`, `universal-apple-darwin`) into
 * one or more Bun compile targets.
 *
 * @param {string} value
 * @param {string} [sourceLabel]
 * @returns {Array<keyof typeof TARGET_MATRIX>}
 */
export function resolveTargetSpecifier(value, sourceLabel = "target") {
  const normalized = value.trim();
  if (hasOwn(TARGET_MATRIX, normalized)) {
    return [normalized];
  }
  if (hasOwn(RUST_TO_BUN_TARGETS, normalized)) {
    return [...RUST_TO_BUN_TARGETS[normalized]];
  }
  const validTargets = [
    ...Object.keys(TARGET_MATRIX),
    ...Object.keys(RUST_TO_BUN_TARGETS),
  ];
  throw new Error(
    `Unknown ${sourceLabel} "${value}". Valid targets: ${validTargets.join(", ")}`,
  );
}

function parseExplicitTargetArg(argv) {
  let targetValue;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg.startsWith("--target=")) {
      const value = arg.slice("--target=".length).trim();
      if (!value) {
        throw new Error('Option "--target=" requires a non-empty value.');
      }
      targetValue = value;
    } else if (arg === "--target") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error('Option "--target" requires a target value.');
      }
      targetValue = next.trim();
      i += 1;
    }
  }
  return targetValue;
}

/**
 * Resolve which Bun sidecar targets should be built.
 * Precedence: `--all` -> `--target` -> `TAURI_ENV_TARGET_TRIPLE` ->
 * `CARGO_BUILD_TARGET` -> `TAURI_ENV_PLATFORM`+`TAURI_ENV_ARCH` -> host platform/arch.
 *
 * @param {object} [options]
 * @param {readonly string[]} [options.argv]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {string} [options.platform]
 * @param {string} [options.arch]
 * @returns {Array<keyof typeof TARGET_MATRIX>}
 */
export function resolveSelectedTargets(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;

  const buildAll = argv.includes("--all");
  const explicitTarget = parseExplicitTargetArg(argv);

  if (buildAll && explicitTarget) {
    throw new Error('Cannot combine "--all" with "--target".');
  }
  if (buildAll) {
    return Object.keys(TARGET_MATRIX);
  }
  if (explicitTarget) {
    return resolveTargetSpecifier(explicitTarget, "CLI --target");
  }

  const tauriTriple = env.TAURI_ENV_TARGET_TRIPLE?.trim();
  if (tauriTriple) {
    return resolveTargetSpecifier(tauriTriple, "TAURI_ENV_TARGET_TRIPLE");
  }

  const cargoTarget = env.CARGO_BUILD_TARGET?.trim();
  if (cargoTarget) {
    return resolveTargetSpecifier(cargoTarget, "CARGO_BUILD_TARGET");
  }

  const tauriPlatform = env.TAURI_ENV_PLATFORM?.trim();
  const tauriArch = env.TAURI_ENV_ARCH?.trim();
  if (tauriPlatform && tauriArch) {
    const key = `${tauriPlatform}/${tauriArch}`;
    if (hasOwn(TAURI_ENV_TO_BUN_TARGETS, key)) {
      return [...TAURI_ENV_TO_BUN_TARGETS[key]];
    }
    throw new Error(
      `Unsupported TAURI_ENV_PLATFORM/TAURI_ENV_ARCH: ${key}`,
    );
  }

  return [detectHostBunTarget(platform, arch)];
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
  const selectedTargets = resolveSelectedTargets();

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

const isDirectExecution = (() => {
  if (!process.argv[1]) return false;
  try {
    const selfPath = fileURLToPath(import.meta.url);
    const entryPath = path.resolve(process.argv[1]);
    if (!fs.existsSync(entryPath)) return false;
    return fs.realpathSync(selfPath) === fs.realpathSync(entryPath);
  } catch (err) {
    console.warn("[build-mcp] Failed to determine execution entry:", err);
    return false;
  }
})();

if (isDirectExecution) {
  main();
}
