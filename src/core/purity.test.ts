import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkCorePurity } from "../../scripts/core-purity-check.mjs";

function withTempWorkspace(
  files: Record<string, string>,
  fn: (projectRoot: string) => void,
): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-purity-"));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(tmpDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf-8");
    }
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("core purity check (T1.1)", () => {
  test("passes on actual src/core transitive graph", () => {
    const result = checkCorePurity();
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.checkedFiles.length).toBeGreaterThan(20);
  });

  test("catches direct DOM, browser storage, Blob, and console.log globals", () => {
    withTempWorkspace(
      {
        "src/core/badDom.ts": `
          export function triggerDownload(text: string): HTMLElement {
            console.log(text);
            const blob = new Blob([text]);
            localStorage.setItem("last", String(blob.size));
            return document.createElement("a");
          }
        `,
      },
      (projectRoot) => {
        const result = checkCorePurity({ projectRoot });
        expect(result.ok).toBe(false);
        expect(
          result.violations.some((v: string) => v.includes('"HTMLElement"')),
        ).toBe(true);
        expect(
          result.violations.some((v: string) => v.includes('"console.log"')),
        ).toBe(true);
        expect(
          result.violations.some((v: string) => v.includes('"Blob"')),
        ).toBe(true);
        expect(
          result.violations.some((v: string) => v.includes('"localStorage"')),
        ).toBe(true);
        expect(
          result.violations.some((v: string) => v.includes('"document"')),
        ).toBe(true);
      },
    );
  });

  test("catches transitive @tauri-apps/api import via barrel re-exports", () => {
    withTempWorkspace(
      {
        "src/core/index.ts": `export * from "../data/sub";`,
        "src/data/sub/index.ts": `export { fetchWords } from "../../types/bridge.js";`,
        "src/types/bridge.ts": `
          import { invoke } from "@tauri-apps/api/core";
          export const fetchWords = () => invoke("load_all_words");
        `,
      },
      (projectRoot) => {
        const result = checkCorePurity({ projectRoot });
        expect(result.ok).toBe(false);
        expect(
          result.violations.some(
            (v: string) =>
              v.includes("@tauri-apps/api/core") &&
              v.includes("src/core/index.ts -> src/data/sub/index.ts -> src/types/bridge.ts"),
          ),
        ).toBe(true);
      },
    );
  });

  test("catches dynamic import('react') and forbidden src/utils/* boundary escape", () => {
    withTempWorkspace(
      {
        "src/core/entry.ts": `
          import { helper } from "../utils/helper";
          export async function loadReact() {
            const r = await import("react");
            return [helper(), r];
          }
        `,
        "src/utils/helper.ts": `export const helper = () => 42;`,
      },
      (projectRoot) => {
        const result = checkCorePurity({ projectRoot });
        expect(result.ok).toBe(false);
        expect(
          result.violations.some((v: string) => v.includes('Forbidden package import "react"')),
        ).toBe(true);
        expect(
          result.violations.some((v: string) => v.includes('forbidden directory "src/utils/*"')),
        ).toBe(true);
      },
    );
  });

  test("ignores forbidden words inside comments and string literals and allows console.warn", () => {
    withTempWorkspace(
      {
        "src/core/clean.ts": `
          // window.document and localStorage and @tauri-apps/api and console.log are mentioned here
          export function safeWarn(): string {
            console.warn("window and document are not accessed");
            return "navigator localStorage";
          }
        `,
      },
      (projectRoot) => {
        const result = checkCorePurity({ projectRoot });
        expect(result.ok).toBe(true);
        expect(result.violations).toEqual([]);
      },
    );
  });
});
