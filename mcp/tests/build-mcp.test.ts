import { describe, expect, test } from "bun:test";
import {
  RUST_TO_BUN_TARGETS,
  TARGET_MATRIX,
  detectHostBunTarget,
  resolveSelectedTargets,
  resolveTargetSpecifier,
} from "../../scripts/build-mcp.mjs";

describe("build-mcp target resolution", () => {
  test("maps TAURI_ENV_TARGET_TRIPLE x86_64-apple-darwin on arm64 macOS host to bun-darwin-x64", () => {
    const targets = resolveSelectedTargets({
      argv: [],
      env: {
        TAURI_ENV_TARGET_TRIPLE: "x86_64-apple-darwin",
        TAURI_ENV_PLATFORM: "darwin",
        TAURI_ENV_ARCH: "x86_64",
      },
      platform: "darwin",
      arch: "arm64",
    });

    expect(targets).toEqual(["bun-darwin-x64"]);
    expect(TARGET_MATRIX[targets[0]].rustTriple).toBe("x86_64-apple-darwin");
  });

  test("maps TAURI_ENV_TARGET_TRIPLE universal-apple-darwin to both macOS targets", () => {
    const targets = resolveSelectedTargets({
      argv: [],
      env: {
        TAURI_ENV_TARGET_TRIPLE: "universal-apple-darwin",
        TAURI_ENV_PLATFORM: "darwin",
        TAURI_ENV_ARCH: "universal",
      },
      platform: "darwin",
      arch: "arm64",
    });

    expect(targets).toEqual(["bun-darwin-arm64", "bun-darwin-x64"]);
  });

  test("supports all release matrix Rust triples", () => {
    for (const [triple, expected] of Object.entries(RUST_TO_BUN_TARGETS)) {
      expect(
        resolveSelectedTargets({
          argv: [],
          env: { TAURI_ENV_TARGET_TRIPLE: triple },
          platform: "linux",
          arch: "x64",
        }),
      ).toEqual([...expected]);
    }
  });

  test("prioritizes CLI --target over TAURI_ENV_TARGET_TRIPLE and supports both formats", () => {
    expect(
      resolveSelectedTargets({
        argv: ["--target=bun-darwin-arm64"],
        env: { TAURI_ENV_TARGET_TRIPLE: "x86_64-apple-darwin" },
        platform: "darwin",
        arch: "x64",
      }),
    ).toEqual(["bun-darwin-arm64"]);

    expect(
      resolveSelectedTargets({
        argv: ["--", "--target", "x86_64-pc-windows-msvc"],
        env: { TAURI_ENV_TARGET_TRIPLE: "x86_64-unknown-linux-gnu" },
        platform: "linux",
        arch: "x64",
      }),
    ).toEqual(["bun-windows-x64"]);
  });

  test("supports --all and rejects combining --all with --target", () => {
    expect(
      resolveSelectedTargets({
        argv: ["--all"],
        env: { TAURI_ENV_TARGET_TRIPLE: "x86_64-apple-darwin" },
      }),
    ).toEqual([
      "bun-darwin-arm64",
      "bun-darwin-x64",
      "bun-windows-x64",
      "bun-linux-x64",
    ]);

    expect(() =>
      resolveSelectedTargets({
        argv: ["--all", "--target=bun-darwin-x64"],
        env: {},
      }),
    ).toThrow('Cannot combine "--all" with "--target"');
  });

  test("falls back to CARGO_BUILD_TARGET, TAURI_ENV_PLATFORM+ARCH, then host platform/arch", () => {
    expect(
      resolveSelectedTargets({
        argv: [],
        env: { CARGO_BUILD_TARGET: "x86_64-apple-darwin" },
        platform: "darwin",
        arch: "arm64",
      }),
    ).toEqual(["bun-darwin-x64"]);

    expect(
      resolveSelectedTargets({
        argv: [],
        env: {
          TAURI_ENV_TARGET_TRIPLE: "   ",
          TAURI_ENV_PLATFORM: "darwin",
          TAURI_ENV_ARCH: "x86_64",
        },
        platform: "darwin",
        arch: "arm64",
      }),
    ).toEqual(["bun-darwin-x64"]);

    expect(
      resolveSelectedTargets({
        argv: [],
        env: {},
        platform: "win32",
        arch: "x64",
      }),
    ).toEqual(["bun-windows-x64"]);
  });

  test("throws clear errors on invalid or unsupported targets", () => {
    expect(() =>
      resolveTargetSpecifier("armv7-unknown-linux-gnueabihf", "TAURI_ENV_TARGET_TRIPLE"),
    ).toThrow("Unknown TAURI_ENV_TARGET_TRIPLE");

    expect(() =>
      resolveSelectedTargets({
        argv: ["--target="],
        env: {},
      }),
    ).toThrow('Option "--target=" requires a non-empty value');

    expect(() =>
      resolveSelectedTargets({
        argv: ["--target"],
        env: {},
      }),
    ).toThrow('Option "--target" requires a target value');

    expect(() => detectHostBunTarget("freebsd", "x64")).toThrow(
      "Unsupported host platform/arch: freebsd/x64",
    );
  });
});
