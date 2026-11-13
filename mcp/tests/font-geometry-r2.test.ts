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
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-geometry-r2-"));
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
    [
      "--mode",
      "read-only",
      "--toolsets",
      "all",
      "--registry",
      registryPath,
      "--allow-root",
      rootDir,
    ],
    {},
  );
  const server = createServer(config);
  const client = new Client({ name: "font-geometry-r2-checker", version: "1.0.0" });
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

interface DistributionView {
  count: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
}

interface GeometryRowView {
  gid: number;
  glyphKind: string;
  codepoints: number[];
  inkMinX: number;
  inkMaxX: number;
  advanceWidth: number;
  opticalGapX: number | null;
  issues: { kind: string }[];
}

describe("F3.2 / F3.3 font_audit_geometry（第二轮）", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test("returns width_stats and the three classified outlier arrays", async () => {
    const res = await harness.client.callTool({
      name: "font_audit_geometry",
      arguments: { language_id: "lang_child", glyph_limit: 40, max_rows: 40 },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);

    const widthStats = body.width_stats as Record<string, DistributionView | null>;
    expect(Object.keys(widthStats).sort()).toEqual([
      "base_advance_ratio",
      "lsb",
      "mark_advance_ratio",
      "rsb",
    ]);
    for (const value of Object.values(widthStats)) {
      if (value === null) continue;
      expect(typeof value.count).toBe("number");
      expect(value.count).toBeGreaterThan(0);
      expect(Number.isFinite(value.mean)).toBe(true);
      expect(value.min).toBeLessThanOrEqual(value.max);
      expect(value.stdDev).toBeGreaterThanOrEqual(0);
    }

    for (const key of [
      "baseline_outliers",
      "optical_gap_outliers",
      "stem_weight_outliers",
    ] as const) {
      expect(Array.isArray(body[key])).toBe(true);
    }

    const summary = body.summary as {
      mark_pairs: number;
      annotation_pairs: number;
      audited_glyphs: number;
    };
    expect(typeof summary.mark_pairs).toBe("number");
    expect(typeof summary.annotation_pairs).toBe("number");
    expect(summary.audited_glyphs).toBeGreaterThan(0);

    const rows = body.rows as GeometryRowView[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(["base", "vowel", "carrier", "mark", "punctuation"]).toContain(row.glyphKind);
    }
    // fixture 里 U+0061 标注为 vowel：必须按标注分类，而不是按 Unicode 组合区段
    const annotated = rows.find((row) => row.codepoints.includes(0x61));
    if (annotated) {
      expect(annotated.glyphKind).toBe("vowel");
      expect(annotated.issues.map((issue) => issue.kind)).not.toContain(
        "ascender_misaligned",
      );
    }
  });

  test("reads annotations for an explicit font_path audit", async () => {
    const fontPath = path.join(harness.workspaceDir, "roots/root/font.ttf");
    const res = await harness.client.callTool({
      name: "font_audit_geometry",
      arguments: {
        font_path: fontPath,
        language_id: "lang_child",
        glyph_limit: 20,
        max_rows: 20,
      },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);
    const widthStats = body.width_stats as Record<string, DistributionView | null>;
    expect(widthStats).toBeDefined();
    const rows = body.rows as GeometryRowView[];
    const annotated = rows.find((row) => row.codepoints.includes(0x61));
    if (annotated) {
      expect(annotated.glyphKind).toBe("vowel");
    }
  });

  test("keeps the outlier arrays consistent with row issue kinds", async () => {
    const res = await harness.client.callTool({
      name: "font_audit_geometry",
      arguments: { language_id: "lang_child", glyph_limit: 40, max_rows: 200 },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);

    const baseline = body.baseline_outliers as { gid: number; issues: { kind: string }[] }[];
    const optical = body.optical_gap_outliers as { gid: number; issues: { kind: string }[] }[];
    const stem = body.stem_weight_outliers as { gid: number; issues: { kind: string }[] }[];

    for (const item of baseline) {
      expect(
        item.issues.every((issue) =>
          ["ascender_misaligned", "baseline_drift"].includes(issue.kind),
        ),
      ).toBe(true);
    }
    for (const item of optical) {
      expect(
        item.issues.every((issue) =>
          ["mark_gap_too_large", "mark_gap_too_small"].includes(issue.kind),
        ),
      ).toBe(true);
    }
    for (const item of stem) {
      expect(
        item.issues.every((issue) =>
          ["stem_too_thin", "weight_uneven"].includes(issue.kind),
        ),
      ).toBe(true);
    }
  });
});
