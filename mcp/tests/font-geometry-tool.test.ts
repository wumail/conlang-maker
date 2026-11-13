import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseConfig } from "../config";
import { createServer } from "../server";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const FIXTURE_WORKSPACE = path.join(REPO_ROOT, "tests/fixtures/workspace-basic");

interface Harness {
  rootDir: string;
  workspaceDir: string;
  client: Client;
  cleanup: () => Promise<void>;
}

async function createHarness(): Promise<Harness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-geometry-"));
  const workspaceDir = path.join(rootDir, "workspace-basic");
  fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });

  const registryPath = path.join(rootDir, "registry.json");
  fs.writeFileSync(
    registryPath,
    JSON.stringify(
      {
        registry_version: "1.0",
        families: [
          {
            name: "Synthetic-Family",
            conlang_file_path: path.join(workspaceDir, "workspace.conlang"),
            last_opened: 1700000000,
          },
        ],
        active_family_index: 0,
      },
      null,
      2,
    ),
    "utf-8",
  );

  const config = parseConfig(
    ["--mode", "read-only", "--toolsets", "all", "--registry", registryPath, "--allow-root", rootDir],
    {},
  );
  const server = createServer(config);
  const client = new Client({ name: "font-geometry-checker", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    rootDir,
    workspaceDir,
    client,
    cleanup: async () => {
      await client.close();
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

function parseToolResult(res: Awaited<ReturnType<Client["callTool"]>>): {
  isError: boolean;
  body: Record<string, unknown>;
} {
  const first = Array.isArray(res.content) ? res.content[0] : undefined;
  const text =
    first && typeof first === "object" && "text" in first && typeof first.text === "string"
      ? first.text
      : "{}";
  return { isError: Boolean(res.isError), body: JSON.parse(text) as Record<string, unknown> };
}

describe("T3.1 font_audit_geometry MCP tool", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test("audits an inherited font and returns metric bands", async () => {
    const res = await harness.client.callTool({
      name: "font_audit_geometry",
      arguments: { language_id: "lang_child", glyph_limit: 40, max_rows: 40 },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);

    const font = body.font as { upem: number; glyph_count: number; sha256: string };
    expect(font.upem).toBeGreaterThan(0);
    expect(font.glyph_count).toBeGreaterThan(0);
    expect(font.sha256.length).toBe(64);

    const metrics = body.metrics as { upm: number; ascender: number; capHeight: number };
    expect(metrics.upm).toBe(font.upem);
    expect(metrics.ascender).toBeGreaterThan(0);
    expect(metrics.capHeight).toBeGreaterThan(0);

    const summary = body.summary as {
      analyzedCount: number;
      issueCounts: Record<string, number>;
      audited_glyphs: number;
    };
    expect(summary.audited_glyphs).toBeGreaterThan(0);
    expect(summary.analyzedCount).toBe(summary.audited_glyphs);
    expect(Object.keys(summary.issueCounts).sort()).toEqual([
      "ascender_misaligned",
      "baseline_drift",
      "mark_gap_too_large",
      "mark_gap_too_small",
      "stem_too_thin",
      "weight_uneven",
    ]);

    const rows = body.rows as {
      gid: number;
      yMax: number;
      yMin: number;
      mainYMin: number;
      leftSideBearing: number;
      issues: { kind: string }[];
    }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.yMax).toBeGreaterThanOrEqual(rows[0]?.yMin ?? 0);
    expect(typeof rows[0]?.leftSideBearing).toBe("number");
    expect(Array.isArray(rows[0]?.issues)).toBe(true);
  });

  test("supports an explicit font_path and flag filtering", async () => {
    const fontPath = path.join(harness.workspaceDir, "roots/root/font.ttf");
    const res = await harness.client.callTool({
      name: "font_audit_geometry",
      arguments: { font_path: fontPath, glyph_limit: 30, only_flagged: true, max_rows: 10 },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);
    const rows = body.rows as { issues: unknown[] }[];
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows.every((row) => row.issues.length > 0)).toBe(true);
    const summary = body.summary as { returned_rows: number; truncated: boolean };
    expect(summary.returned_rows).toBe(rows.length);
    expect(typeof summary.truncated).toBe("boolean");
  });

  test("returns NO_FONT for a language without any font in its ancestry", async () => {
    const res = await harness.client.callTool({
      name: "font_audit_geometry",
      arguments: { language_id: "lang_other" },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(true);
    expect(JSON.stringify(body)).toContain("NO_FONT");
  });
});
