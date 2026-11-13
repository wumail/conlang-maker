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
  conlangFilePath: string;
  client: Client;
  cleanup: () => Promise<void>;
}

async function createHarness(): Promise<Harness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-concepts-"));
  const workspaceDir = path.join(rootDir, "workspace-basic");
  fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });
  const conlangFilePath = path.join(workspaceDir, "workspace.conlang");
  const registryPath = path.join(rootDir, "registry.json");
  fs.writeFileSync(
    registryPath,
    JSON.stringify(
      {
        registry_version: "1.0",
        families: [
          { name: "Synthetic-Family", conlang_file_path: conlangFilePath, last_opened: 1700000000 },
        ],
        active_family_index: 0,
      },
      null,
      2,
    ),
    "utf-8",
  );

  const config = parseConfig(
    ["--mode", "write", "--toolsets", "all", "--registry", registryPath, "--allow-root", rootDir],
    {},
  );
  const server = createServer(config);
  const client = new Client({ name: "concept-checker", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    rootDir,
    conlangFilePath,
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

describe("T2.2 concept_list / concept_upsert MCP tools", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test("lists core concepts with Chinese/English search", async () => {
    const res = await harness.client.callTool({
      name: "concept_list",
      arguments: { query: "水" },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);
    expect(body.core_library_size as number).toBeGreaterThanOrEqual(140);
    const concepts = body.concepts as { concept_id: string; gloss_en: string }[];
    expect(concepts[0]).toMatchObject({ concept_id: "water", gloss_en: "water" });
  });

  test("filters by semantic field and standard list", async () => {
    const res = await harness.client.callTool({
      name: "concept_list",
      arguments: { semantic_field: "body", standard_list: "swadesh_100", limit: 200 },
    });
    const { body } = parseToolResult(res);
    const concepts = body.concepts as { semantic_field: string; standard_lists: string[] }[];
    expect(concepts.length).toBeGreaterThan(10);
    expect(concepts.every((c) => c.semantic_field === "body")).toBe(true);
    expect(concepts.every((c) => c.standard_lists.includes("swadesh_100"))).toBe(true);
  });

  test("upserts a custom concept and reports it back in concept_list", async () => {
    const dry = await harness.client.callTool({
      name: "concept_upsert",
      arguments: {
        dry_run: true,
        concepts: [{ concept_id: "bronze", gloss_en: "bronze", gloss_zh: "青铜", semantic_field: "substance" }],
      },
    });
    const dryBody = parseToolResult(dry).body;
    expect(dryBody.dry_run).toBe(true);
    expect(dryBody.created).toEqual(["bronze"]);

    const baseRevisions = dryBody.base_revisions as Record<string, string>;
    const commit = await harness.client.callTool({
      name: "concept_upsert",
      arguments: {
        expected_revision: baseRevisions["workspace.conlang"],
        concepts: [{ concept_id: "bronze", gloss_en: "bronze", gloss_zh: "青铜", semantic_field: "substance" }],
      },
    });
    const commitBody = parseToolResult(commit).body;
    expect(commitBody.committed).toBe(true);
    expect(commitBody.total_custom).toBe(1);

    const listed = await harness.client.callTool({
      name: "concept_list",
      arguments: { query: "青铜", include_core: false },
    });
    const listedBody = parseToolResult(listed).body;
    const concepts = listedBody.concepts as { concept_id: string; source: string }[];
    expect(concepts).toHaveLength(1);
    expect(concepts[0]).toMatchObject({ concept_id: "bronze", source: "custom" });
  });

  test("rejects writes to read-only core concepts", async () => {
    const res = await harness.client.callTool({
      name: "concept_upsert",
      arguments: {
        dry_run: true,
        concepts: [{ concept_id: "water", gloss_en: "hacked" }],
      },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);
    expect(body.rejected).toEqual([
      { concept_id: "water", reason: "core concept is read-only" },
    ]);
  });

  test("deletes a custom concept by id", async () => {
    const dry = await harness.client.callTool({
      name: "concept_upsert",
      arguments: { dry_run: true, delete_ids: ["bronze"] },
    });
    const baseRevisions = parseToolResult(dry).body.base_revisions as Record<string, string>;
    const commit = await harness.client.callTool({
      name: "concept_upsert",
      arguments: {
        expected_revision: baseRevisions["workspace.conlang"],
        delete_ids: ["bronze"],
      },
    });
    const body = parseToolResult(commit).body;
    expect(body.deleted).toEqual(["bronze"]);
    expect(body.total_custom).toBe(0);
  });
});
