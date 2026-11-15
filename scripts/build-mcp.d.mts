export type BunCompileTarget =
  | "bun-darwin-arm64"
  | "bun-darwin-x64"
  | "bun-windows-x64"
  | "bun-linux-x64";

export type RustSidecarTriple =
  | "aarch64-apple-darwin"
  | "x86_64-apple-darwin"
  | "x86_64-pc-windows-msvc"
  | "x86_64-unknown-linux-gnu";

export interface TargetMatrixEntry {
  rustTriple: RustSidecarTriple;
  ext: "" | ".exe";
}

export const TARGET_MATRIX: Record<BunCompileTarget, TargetMatrixEntry>;

export const RUST_TO_BUN_TARGETS: Record<string, readonly BunCompileTarget[]>;

export interface ResolveSelectedTargetsOptions {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
  platform?: string;
  arch?: string;
}

export function detectHostBunTarget(
  platform?: string,
  arch?: string,
): BunCompileTarget;

export function resolveTargetSpecifier(
  value: string,
  sourceLabel?: string,
): BunCompileTarget[];

export function resolveSelectedTargets(
  options?: ResolveSelectedTargetsOptions,
): BunCompileTarget[];
