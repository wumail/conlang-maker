import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const root = process.cwd();

const packageJsonPath = path.join(root, "package.json");
const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");
const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");

function bumpPatch(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(
      `[version:update] Unsupported version format: ${version}. Expected MAJOR.MINOR.PATCH`,
    );
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]) + 1;
  return `${major}.${minor}.${patch}`;
}

function isValidVersion(version) {
  return /^(\d+)\.(\d+)\.(\d+)$/.test(version);
}

function checkStagedChanges() {
  const stagedFiles = execSync("git diff --cached --name-only", {
    cwd: root,
    encoding: "utf-8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (stagedFiles.length === 0) {
    throw new Error("[version:update] No staged changes found. Please stage your changes first.");
  }

  try {
    execSync("git diff --cached --check", { cwd: root, stdio: "pipe" });
  } catch {
    throw new Error("[version:update] Staged changes have formatting/conflict issues. Please fix them first.");
  }

  return stagedFiles;
}

function updateVersions(nextVersion) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  packageJson.version = nextVersion;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf-8");

  const cargoToml = fs.readFileSync(cargoTomlPath, "utf-8");
  const cargoUpdated = cargoToml.replace(
    /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
    `$1${nextVersion}$3`,
  );

  if (cargoToml === cargoUpdated) {
    throw new Error("[version:update] Failed to update version in src-tauri/Cargo.toml");
  }

  fs.writeFileSync(cargoTomlPath, cargoUpdated, "utf-8");

  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
  tauriConf.version = nextVersion;
  fs.writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`, "utf-8");
}

async function main() {
  execSync("npm run version:check", { cwd: root, stdio: "inherit" });

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const currentVersion = packageJson.version;
  const nextVersion = bumpPatch(currentVersion);

  const rl = createInterface({ input, output });
  const answer = await rl.question(
    `[version:update] Current: ${currentVersion}, suggested next: ${nextVersion}. Update? (yes/no/custom version, default yes): `,
  );
  rl.close();

  const raw = answer.trim();
  const normalized = raw.toLowerCase();
  if (normalized === "no" || normalized === "n") {
    console.log("[version:update] Aborted by user.");
    return;
  }

  let targetVersion = nextVersion;
  if (raw && normalized !== "yes" && normalized !== "y") {
    if (!isValidVersion(raw)) {
      throw new Error(
        `[version:update] Invalid version: ${raw}. Expected format MAJOR.MINOR.PATCH`,
      );
    }
    targetVersion = raw;
  }

  checkStagedChanges();

  updateVersions(targetVersion);
  execSync(`git add "${packageJsonPath}" "${cargoTomlPath}" "${tauriConfPath}"`, {
    cwd: root,
    stdio: "inherit",
  });

  execSync("npm run version:check", { cwd: root, stdio: "inherit" });

  console.log(`[version:update] Version updated to ${targetVersion}.`);
  console.log(`[version:update] Suggested commit command: git commit -m \"chore(release): v${targetVersion}\"`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
