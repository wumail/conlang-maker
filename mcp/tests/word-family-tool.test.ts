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
  client: Client;
  cleanup: () => Promise<void>;
}

/** 在叶子语言里造一个「复合词 ← 词根」的最小 DAG */
function seedComponents(workspaceDir: string): void {
  const file = path.join(workspaceDir, "branches/leaf/lexicon/lexicon_a.ndjson");
  const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
  const next = lines.map((line) => {
    const word = JSON.parse(line) as {
      entry_id: string;
      etymology: {
        origin_type?: string;
        components?: unknown[];
        compounds_stale_digest?: string;
      };
    };
    if (word.entry_id !== "entry_leaf_aca") return line;
    word.etymology.origin_type = "derived";
    word.etymology.components = [
      { entry_id: "entry_leaf_asha", relation: "modifier" },
      { entry_id: "entry_leaf_acha", relation: "head" },
    ];
    // 故意写入过期摘要，用于验证 stale 检测
    word.etymology.compounds_stale_digest = "deadbeef";
    return JSON.stringify(word);
  });
  fs.writeFileSync(file, `${next.join("\n")}\n`, "utf-8");
}

async function createHarness(): Promise<Harness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-wordfamily-"));
  const workspaceDir = path.join(rootDir, "workspace-basic");
  fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });
  seedComponents(workspaceDir);
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
  const client = new Client({ name: "word-family-checker", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    rootDir,
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

describe("T2.4 lex_word_family MCP tool", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test("returns the component tree with relations", async () => {
    const res = await harness.client.callTool({
      name: "lex_word_family",
      arguments: { entry_id: "entry_leaf_aca", language_id: "lang_leaf" },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);
    expect(body.entry_id).toBe("entry_leaf_aca");

    const upstream = body.upstream as { entryId: string; relation: string; missing: boolean }[];
    expect(upstream.map((node) => node.entryId)).toEqual(["entry_leaf_asha", "entry_leaf_acha"]);
    expect(upstream.map((node) => node.relation)).toEqual(["modifier", "head"]);
    expect(upstream.every((node) => !node.missing)).toBe(true);
    expect(body.unresolved_components).toBe(false);
  });

  test("flags a stale digest", async () => {
    const res = await harness.client.callTool({
      name: "lex_word_family",
      arguments: { entry_id: "entry_leaf_aca", language_id: "lang_leaf" },
    });
    const { body } = parseToolResult(res);
    expect(body.stored_digest).toBe("deadbeef");
    expect(body.stale).toBe(true);
    expect(body.digest as string).not.toBe("deadbeef");
    expect((body.digest as string).length).toBe(8);
  });

  test("lists downstream derivatives from the component side", async () => {
    const res = await harness.client.callTool({
      name: "lex_word_family",
      arguments: { entry_id: "entry_leaf_asha", language_id: "lang_leaf" },
    });
    const { body } = parseToolResult(res);
    const downstream = body.downstream as { entryId: string; depth: number }[];
    expect(downstream.map((node) => node.entryId)).toContain("entry_leaf_aca");
    expect(downstream.find((node) => node.entryId === "entry_leaf_aca")?.depth).toBe(1);
  });

  test("detects cycles when testing a candidate component", async () => {
    const res = await harness.client.callTool({
      name: "lex_word_family",
      arguments: {
        entry_id: "entry_leaf_asha",
        language_id: "lang_leaf",
        test_component_id: "entry_leaf_aca",
      },
    });
    const { body } = parseToolResult(res);
    expect(body.would_create_cycle).toBe(true);
  });

  test("rejects unknown entries", async () => {
    const res = await harness.client.callTool({
      name: "lex_word_family",
      arguments: { entry_id: "entry_missing", language_id: "lang_leaf" },
    });
    expect(parseToolResult(res).isError).toBe(true);
  });
});
