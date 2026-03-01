import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const packageJsonPath = path.join(root, "package.json");
const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");
const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const packageVersion = packageJson.version;

const cargoToml = fs.readFileSync(cargoTomlPath, "utf-8");
const cargoPackageSection = cargoToml.match(/\[package\]([\s\S]*?)(\n\[|$)/);
if (!cargoPackageSection) {
  console.error("[version-check] Could not find [package] section in Cargo.toml");
  process.exit(1);
}
const cargoVersionMatch = cargoPackageSection[1].match(/\nversion\s*=\s*"([^"]+)"/);
if (!cargoVersionMatch) {
  console.error("[version-check] Could not find package.version in Cargo.toml");
  process.exit(1);
}
const cargoVersion = cargoVersionMatch[1];

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
const tauriVersion = tauriConf.version;

const versions = {
  "package.json": packageVersion,
  "src-tauri/Cargo.toml": cargoVersion,
  "src-tauri/tauri.conf.json": tauriVersion,
};

const uniqueVersions = new Set(Object.values(versions));
if (uniqueVersions.size !== 1) {
  console.error("[version-check] Version mismatch detected:");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  - ${file}: ${version}`);
  }
  process.exit(1);
}

console.log(`[version-check] OK: all versions are ${packageVersion}`);
