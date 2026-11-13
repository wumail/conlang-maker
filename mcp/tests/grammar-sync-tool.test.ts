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

function seedRules(workspaceDir: string): void {
  const seed = (relPath: string, rules: unknown[]): void => {
    const file = path.join(workspaceDir, relPath);
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    raw.inflection_rules = rules;
    raw.irregular_overrides = [
      { entry_id: "entry_shared", dimension_values: { dim_num: "val_sg" }, surface_form: "apa" },
    ];
    fs.writeFileSync(file, JSON.stringify(raw, null, 2), "utf-8");
  };

  const rule = (id: string, affix: string, tag: string, mutable = true) => ({
    rule_id: id,
    pos_id: "pos_noun",
    dimension_values: { dim_num: `val_${tag.toLowerCase()}` },
    type: "suffix",
    affix,
    tag,
    match_regex: ".*",
    disabled: false,
    condition: null,
    sca_mutable: mutable,
  });

  // 父语言：apa（可音变）与 eba（锁定）
  seed("roots/root/grammar.json", [
    rule("infl_shared_pl", "apa", "PL"),
    rule("infl_shared_du", "eba", "DU", false),
  ]);
  // 子语言 fork 自父语言，规则 id 相同
  seed("stages/child/grammar.json", [
    rule("infl_shared_pl", "apa", "PL"),
    rule("infl_shared_du", "eba", "DU", false),
  ]);
}

function readChildGrammar(workspaceDir: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, "stages/child/grammar.json"), "utf-8"),
  ) as Record<string, unknown>;
}

async function createHarness(mode: string): Promise<Harness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-gramsync-"));
  const workspaceDir = path.join(rootDir, "workspace-basic");
  fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });
  seedRules(workspaceDir);

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
    ["--mode", mode, "--toolsets", "all", "--registry", registryPath, "--allow-root", rootDir],
    {},
  );
  const server = createServer(config);
  const client = new Client({ name: "gram-sync-checker", version: "1.0.0" });
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

describe("T2.6 gram_pull_sync MCP tool", () => {
  let writeHarness: Harness;

  beforeAll(async () => {
    writeHarness = await createHarness("write");
  });

  afterAll(async () => {
    await writeHarness.cleanup();
  });

  test("previews transformed affixes without touching disk", async () => {
    const before = fs.readFileSync(
      path.join(writeHarness.workspaceDir, "stages/child/grammar.json"),
      "utf-8",
    );
    const res = await writeHarness.client.callTool({
      name: "gram_pull_sync",
      arguments: { language_id: "lang_child" },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);
    expect(body.applied).toBe(false);
    expect(body.parent_language_id).toBe("lang_root");

    const rows = body.inflection as { ruleId: string; after: string; status: string }[];
    expect(rows.find((row) => row.ruleId === "infl_shared_pl")).toMatchObject({
      after: "aba",
      status: "apply",
    });
    expect(rows.find((row) => row.ruleId === "infl_shared_du")).toMatchObject({
      status: "locked",
    });

    const irregular = body.irregular as { after: string; status: string }[];
    expect(irregular[0]).toMatchObject({ after: "aba", status: "apply" });

    expect(
      fs.readFileSync(path.join(writeHarness.workspaceDir, "stages/child/grammar.json"), "utf-8"),
    ).toBe(before);
  });

  test("requires operation_id when applying", async () => {
    const res = await writeHarness.client.callTool({
      name: "gram_pull_sync",
      arguments: { language_id: "lang_child", apply: true },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(true);
    expect(JSON.stringify(body)).toContain("operation_id");
  });

  test("applies the plan and preserves unknown fields", async () => {
    const preview = parseToolResult(
      await writeHarness.client.callTool({
        name: "gram_pull_sync",
        arguments: { language_id: "lang_child" },
      }),
    );
    const revision = (preview.body.dependencies as Record<string, string>)["grammar.json"];

    const res = await writeHarness.client.callTool({
      name: "gram_pull_sync",
      arguments: {
        language_id: "lang_child",
        apply: true,
        operation_id: "op-gram-sync-1",
        expected_revision: revision,
      },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);
    expect(body.applied).toBe(true);
    expect(typeof body.revision).toBe("string");

    const stored = readChildGrammar(writeHarness.workspaceDir);
    expect(stored.x_unknown_child_grammar).toBeDefined();
    const rules = stored.inflection_rules as { rule_id: string; affix: string }[];
    expect(rules.find((rule) => rule.rule_id === "infl_shared_pl")?.affix).toBe("aba");
    expect(rules.find((rule) => rule.rule_id === "infl_shared_du")?.affix).toBe("eba");
    const overrides = stored.irregular_overrides as { surface_form: string }[];
    expect(overrides[0]?.surface_form).toBe("aba");
  });

  test("is idempotent: a second apply reports no further changes", async () => {
    const current = JSON.parse(
      fs.readFileSync(path.join(writeHarness.workspaceDir, "stages/child/grammar.json"), "utf-8"),
    ) as Record<string, unknown>;
    const preview = parseToolResult(
      await writeHarness.client.callTool({
        name: "gram_pull_sync",
        arguments: { language_id: "lang_child" },
      }),
    );
    const revision = (preview.body.dependencies as Record<string, string>)["grammar.json"];
    expect(current.language_id).toBe("lang_child");

    const res = await writeHarness.client.callTool({
      name: "gram_pull_sync",
      arguments: {
        language_id: "lang_child",
        apply: true,
        operation_id: "op-gram-sync-2",
        expected_revision: revision,
      },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);
    expect(body.applied).toBe(false);
    const stats = body.stats as { inflectionChanged: number };
    expect(stats.inflectionChanged).toBe(0);
  });
});

describe("T2.6 gram_pull_sync in read-only mode", () => {
  let roHarness: Harness;

  beforeAll(async () => {
    roHarness = await createHarness("read-only");
  });

  afterAll(async () => {
    await roHarness.cleanup();
  });

  test("still previews, but rejects apply with READ_ONLY", async () => {
    const preview = await roHarness.client.callTool({
      name: "gram_pull_sync",
      arguments: { language_id: "lang_child" },
    });
    expect(parseToolResult(preview).isError).toBe(false);

    const applied = await roHarness.client.callTool({
      name: "gram_pull_sync",
      arguments: {
        language_id: "lang_child",
        apply: true,
        operation_id: "op-ro-sync",
        expected_revision: "irrelevant",
      },
    });
    const { isError, body } = parseToolResult(applied);
    expect(isError).toBe(true);
    expect(JSON.stringify(body)).toContain("READ_ONLY");
  });
});
