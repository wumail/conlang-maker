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

/** 给夹具里的一个根词与一个叶子词挂上同一概念 + 亲子链接，用于验证同源归组 */
function seedConceptLinks(workspaceDir: string): void {
  const patch = (
    file: string,
    entryId: string,
    conceptId: string,
    parentEntryId: string | null,
  ) => {
    const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
    const next = lines.map((line) => {
      const word = JSON.parse(line) as {
        entry_id: string;
        senses: { concept_id?: string }[];
        etymology: { origin_type?: string; parent_entry_id?: string | null };
      };
      if (word.entry_id !== entryId) return line;
      word.senses[0]!.concept_id = conceptId;
      word.etymology.parent_entry_id = parentEntryId;
      if (parentEntryId) word.etymology.origin_type = "evolved";
      return JSON.stringify(word);
    });
    fs.writeFileSync(file, `${next.join("\n")}\n`, "utf-8");
  };

  patch(
    path.join(workspaceDir, "roots/root/lexicon/lexicon_a.ndjson"),
    "entry_root_apa",
    "stone",
    null,
  );
  // 中间代沿用同一 entry_id，但父链接指向根语言；叶子再指向中间代
  patch(
    path.join(workspaceDir, "stages/child/lexicon/lexicon_a.ndjson"),
    "entry_root_apa",
    "stone",
    "entry_root_apa",
  );
  patch(
    path.join(workspaceDir, "branches/leaf/lexicon/lexicon_a.ndjson"),
    "entry_leaf_aca",
    "stone",
    "entry_root_apa",
  );
}

async function createHarness(): Promise<Harness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-cognates-"));
  const workspaceDir = path.join(rootDir, "workspace-basic");
  fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });
  seedConceptLinks(workspaceDir);
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
  const client = new Client({ name: "cognate-checker", version: "1.0.0" });
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

describe("T2.3 family_cognate_matrix MCP tool", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test("returns one row per core concept with a cell per language", async () => {
    const res = await harness.client.callTool({
      name: "family_cognate_matrix",
      arguments: { max_rows: 50 },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);

    const languages = body.languages as { languageId: string; depth: number }[];
    expect(languages.map((lang) => lang.languageId)).toEqual([
      "lang_root",
      "lang_child",
      "lang_leaf",
      "lang_other",
    ]);
    expect(languages.map((lang) => lang.depth)).toEqual([0, 1, 2, 0]);

    const rows = body.rows as { cells: unknown[] }[];
    expect(rows).toHaveLength(50);
    expect(rows[0]?.cells).toHaveLength(4);

    const stats = body.stats as { cellCount: number; conceptCount: number };
    expect(stats.conceptCount).toBe(50);
    expect(stats.cellCount).toBe(stats.conceptCount * 4);
  });

  test("caps oversized payloads instead of dropping the response", async () => {
    const res = await harness.client.callTool({ name: "family_cognate_matrix", arguments: {} });
    const { body } = parseToolResult(res);
    expect(body.truncated).toBe(true);
    expect(body.rows_total_before_truncation as number).toBeGreaterThanOrEqual(140);
  });

  test("groups the inherited pair into a single cognate set", async () => {
    const res = await harness.client.callTool({
      name: "family_cognate_matrix",
      arguments: { concept_ids: ["stone"], only_filled: true },
    });
    const { body } = parseToolResult(res);
    const rows = body.rows as {
      concept_id: string;
      filled: number;
      cognate_set_count: number;
      cells: { languageId: string; kind: string; cognateSetId: string | null; form: string }[];
    }[];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.concept_id).toBe("stone");
    expect(row.filled).toBe(3);
    expect(row.cognate_set_count).toBe(1);
    const byLanguage = new Map(row.cells.map((cell) => [cell.languageId, cell]));
    expect(byLanguage.get("lang_child")?.kind).toBe("inherited");
    expect(byLanguage.get("lang_leaf")?.kind).toBe("inherited");
    expect(byLanguage.get("lang_other")?.kind).toBe("empty");
    for (const languageId of ["lang_root", "lang_child", "lang_leaf"]) {
      expect(byLanguage.get(languageId)?.cognateSetId).toBe("lang_root::entry_root_apa");
    }
  });

  test("only_filled drops concepts with no forms", async () => {
    const res = await harness.client.callTool({
      name: "family_cognate_matrix",
      arguments: { only_filled: true },
    });
    const { body } = parseToolResult(res);
    const rows = body.rows as { concept_id: string }[];
    expect(rows.map((row) => row.concept_id)).toEqual(["stone"]);
  });

  test("restricts to requested languages", async () => {
    const res = await harness.client.callTool({
      name: "family_cognate_matrix",
      arguments: { language_ids: ["lang_leaf"], concept_ids: ["stone"] },
    });
    const { body } = parseToolResult(res);
    const rows = body.rows as { cells: unknown[] }[];
    expect((body.languages as unknown[]).length).toBe(1);
    expect(rows[0]?.cells).toHaveLength(1);
  });
});
