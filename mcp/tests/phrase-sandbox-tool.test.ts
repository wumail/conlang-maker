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

function seedGrammar(workspaceDir: string, relPath: string, alignment: string): void {
  const file = path.join(workspaceDir, relPath);
  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  raw.syntax = {
    ...(raw.syntax as Record<string, unknown>),
    word_order: "SOV",
    modifier_position: "before_head",
    adposition_type: "postposition",
    alignment,
  };
  raw.inflection_dimensions = [
    {
      dim_id: "dim_case",
      name: "Case",
      applies_to_pos: ["pos_noun"],
      values: [
        { val_id: "val_nom", name: "Nominative", gloss: "NOM" },
        { val_id: "val_acc", name: "Accusative", gloss: "ACC" },
        { val_id: "val_erg", name: "Ergative", gloss: "ERG" },
        { val_id: "val_abs", name: "Absolutive", gloss: "ABS" },
      ],
    },
  ];
  fs.writeFileSync(file, JSON.stringify(raw, null, 2), "utf-8");
}

async function createHarness(): Promise<Harness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-phrase-"));
  const workspaceDir = path.join(rootDir, "workspace-basic");
  fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });
  seedGrammar(workspaceDir, "stages/child/grammar.json", "nom_acc");
  seedGrammar(workspaceDir, "branches/leaf/grammar.json", "erg_abs");

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
  const client = new Client({ name: "phrase-sandbox-checker", version: "1.0.0" });
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

const clause = {
  subject: { head: "dog", determiner: "the", adjectives: ["big"] },
  verb: { gloss: "bite", tam: ["PST"] },
  object: { head: "bone" },
};

describe("T3.3 sandbox_translate clause tree", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test("linearizes a nom_acc SOV clause and reports the phrase plan", async () => {
    const res = await harness.client.callTool({
      name: "sandbox_translate",
      arguments: { language_id: "lang_child", clause },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);

    const phrase = body.phrase as {
      alignment: string;
      case_tags: Record<string, string>;
      words: { gloss: string; path: string }[];
      steps: string[];
      warnings: string[];
    };
    expect(phrase.alignment).toBe("nom_acc");
    expect(phrase.case_tags).toEqual({ S: "NOM", A: "NOM", P: "ACC" });
    expect(phrase.words.map((word) => word.gloss)).toEqual([
      "the",
      "big",
      "dog",
      "bone",
      "bite",
    ]);
    expect(phrase.words.at(-1)?.path).toBe("verb");
    expect(phrase.warnings).toHaveLength(0);
    expect(phrase.steps.some((step) => step.includes("Order SOV"))).toBe(true);
  });

  test("honours erg_abs on the leaf language", async () => {
    const res = await harness.client.callTool({
      name: "sandbox_translate",
      arguments: { language_id: "lang_leaf", clause },
    });
    const { body } = parseToolResult(res);
    const phrase = body.phrase as {
      alignment: string;
      case_tags: Record<string, string>;
    };
    expect(phrase.alignment).toBe("erg_abs");
    expect(phrase.case_tags).toEqual({ S: "ABS", A: "ERG", P: "ABS" });
  });

  test("keeps nested PP objects in place", async () => {
    const res = await harness.client.callTool({
      name: "sandbox_translate",
      arguments: {
        language_id: "lang_child",
        clause: {
          subject: { head: "dog" },
          verb: { gloss: "sleep" },
          obliques: [
            {
              adposition: "in",
              object: { head: "house", pp: { adposition: "near", object: { head: "river" } } },
            },
          ],
        },
      },
    });
    const { body } = parseToolResult(res);
    const phrase = body.phrase as { words: { gloss: string }[] };
    expect(phrase.words.map((word) => word.gloss)).toEqual([
      "dog",
      "sleep",
      "house",
      "river",
      "near",
      "in",
    ]);
  });

  test("rejects an empty request", async () => {
    const res = await harness.client.callTool({
      name: "sandbox_translate",
      arguments: { language_id: "lang_child" },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(true);
    expect(JSON.stringify(body)).toContain("VALIDATION");
  });
});
