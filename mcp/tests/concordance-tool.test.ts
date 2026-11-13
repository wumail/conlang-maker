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

async function createHarness(): Promise<Harness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-concordance-"));
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
  const client = new Client({ name: "concordance-checker", version: "1.0.0" });
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

describe("T1.2 corpus_concordance MCP tool", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test("resolves an entry by id and returns its corpus occurrences", async () => {
    const res = await harness.client.callTool({
      name: "corpus_concordance",
      arguments: { entry_id: "entry_leaf_acha", language_id: "lang_leaf" },
    });
    const { isError, body } = parseToolResult(res);

    expect(isError).toBe(false);
    expect(body.entry_id).toBe("entry_leaf_acha");
    expect(body.corpus_texts_scanned).toBe(1);
    expect(body.total).toBe(1);

    const matches = body.matches as {
      textId: string;
      lineId: string;
      title: string;
      matchedTokenSurface: string;
      freeTranslation: string;
    }[];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      textId: "corp_leaf_1",
      lineId: "line_leaf_1",
      title: "Song of Ember",
      matchedTokenSurface: "acha",
      freeTranslation: "Fire and wind.",
    });
  });

  test("resolves the entry from word_romanized when no id is given", async () => {
    const res = await harness.client.callTool({
      name: "corpus_concordance",
      arguments: { word_romanized: "asha", language_id: "lang_leaf" },
    });
    const { isError, body } = parseToolResult(res);

    expect(isError).toBe(false);
    expect(body.entry_id).toBe("entry_leaf_asha");
    expect(body.total).toBe(1);
  });

  test("returns an empty result for an entry with no corpus occurrences", async () => {
    const res = await harness.client.callTool({
      name: "corpus_concordance",
      arguments: { entry_id: "entry_leaf_deseret", language_id: "lang_leaf" },
    });
    const { isError, body } = parseToolResult(res);

    expect(isError).toBe(false);
    expect(body.total).toBe(0);
    expect(body.matches).toEqual([]);
  });

  test("rejects calls without an entry selector", async () => {
    const res = await harness.client.callTool({
      name: "corpus_concordance",
      arguments: { language_id: "lang_leaf" },
    });
    const { isError, body } = parseToolResult(res);

    expect(isError).toBe(true);
    expect(body.code).toBe("VALIDATION");
  });

  test("reports NOT_FOUND for an unknown entry id", async () => {
    const res = await harness.client.callTool({
      name: "corpus_concordance",
      arguments: { entry_id: "entry_missing", language_id: "lang_leaf" },
    });
    const { isError, body } = parseToolResult(res);

    expect(isError).toBe(true);
    expect(body.code).toBe("NOT_FOUND");
  });
});
