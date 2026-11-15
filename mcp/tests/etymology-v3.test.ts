/**
 * etymology-v3.test.ts — Roadmap v3 / Pillar 1 MCP 集成测试
 *
 * 覆盖：lex_upsert 写 compound + semantic_change_kind / lex_borrow 写完整
 * borrowed_source 快照（parent_entry_id: null）/ lex_etymology_lineage 返回
 * 完整链路 / 供语词条删除后快照仍可读 / 继承断链定位 /
 * 可选字段显式置空（null、""）不被合并复活 / 来源类型离开 borrowed 后自动清除快照。
 * 写工具全部走 dry_run → base_revisions → expected_revision 的 CAS 流程。
 */
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
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-etymv3-"));
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
    ["--mode", "write", "--toolsets", "all", "--registry", registryPath, "--allow-root", rootDir],
    {},
  );
  const server = createServer(config);
  const client = new Client({ name: "etymology-v3-checker", version: "1.0.0" });
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

/** 直接从磁盘上某语言的词典中移除一个词条（模拟供语词条被删除） */
function removeEntryFromDisk(workspaceDir: string, langPath: string, entryId: string): void {
  const lexDir = path.join(workspaceDir, langPath, "lexicon");
  for (const fname of fs.readdirSync(lexDir).filter((f) => f.endsWith(".ndjson"))) {
    const abs = path.join(lexDir, fname);
    const lines = fs.readFileSync(abs, "utf-8").split("\n").filter(Boolean);
    const kept = lines.filter((line) => {
      const word = JSON.parse(line) as { entry_id: string };
      return word.entry_id !== entryId;
    });
    if (kept.length !== lines.length) {
      fs.writeFileSync(abs, kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf-8");
    }
  }
}

interface LineageNode {
  stepKind: string;
  languageId: string;
  entryId: string;
  romanized: string;
  broken: boolean;
  brokenReason?: string;
  borrowedSnapshot?: Record<string, string>;
  components?: Array<{
    relation: string;
    entryId?: string;
    derivationRuleId?: string;
    surface: string;
    gloss?: string;
    broken: boolean;
  }>;
}

describe("Roadmap v3 / Pillar 1 — etymology MCP tools", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test("lex_upsert writes a compound entry and lex_etymology_lineage resolves components", async () => {
    const compoundEntry = {
      entry_id: "entry_leaf_compound_ashakasa",
      con_word_romanized: "ashakasa",
      senses: [{ pos_id: "pos_noun", gloss: "smoke house" }],
      etymology: {
        origin_type: "compound",
        parent_entry_id: null,
        source_language_id: null,
        semantic_change_kind: "metaphor",
        components: [
          { entry_id: "entry_leaf_asha", relation: "root" },
          { entry_id: "entry_leaf_acha", relation: "head" },
          { relation: "affix", derivation_rule_id: "rule_dim", surface_override: "-ka" },
        ],
      },
    };

    const dry = await harness.client.callTool({
      name: "lex_upsert",
      arguments: { language_id: "lang_leaf", dry_run: true, entries: [compoundEntry] },
    });
    const dryBody = parseToolResult(dry).body;
    expect(dryBody.dry_run).toBe(true);

    const commit = await harness.client.callTool({
      name: "lex_upsert",
      arguments: {
        language_id: "lang_leaf",
        operation_id: "op_etymv3_compound_1",
        expected_revision: (dryBody.base_revisions as Record<string, string>).lexicon,
        entries: [compoundEntry],
      },
    });
    const commitBody = parseToolResult(commit).body;
    expect(commitBody.committed).toBe(true);
    expect(commitBody.added).toBe(1);

    // lex_search 的 origin_type 过滤已支持 "compound"
    const search = await harness.client.callTool({
      name: "lex_search",
      arguments: { language_id: "lang_leaf", origin_type: "compound" },
    });
    const searchItems = parseToolResult(search).body.items as { entry_id: string }[];
    expect(searchItems.map((item) => item.entry_id)).toContain("entry_leaf_compound_ashakasa");

    const lineage = await harness.client.callTool({
      name: "lex_etymology_lineage",
      arguments: {
        language_id: "lang_leaf",
        entry_id: "entry_leaf_compound_ashakasa",
      },
    });
    const body = parseToolResult(lineage).body;
    expect(body.has_broken_links).toBe(false);
    expect(body.broken_links).toEqual([]);
    const nodes = body.nodes as LineageNode[];
    expect(nodes.map((node) => [node.stepKind, node.entryId])).toEqual([
      ["self", "entry_leaf_compound_ashakasa"],
      ["component", "entry_leaf_asha"],
      ["component", "entry_leaf_acha"],
    ]);
    expect(nodes[0]!.components).toEqual([
      { relation: "root", entryId: "entry_leaf_asha", surface: "asha", gloss: "smoke", broken: false },
      { relation: "head", entryId: "entry_leaf_acha", surface: "acha", gloss: "fire", broken: false },
      { relation: "affix", derivationRuleId: "rule_dim", surface: "-ka", broken: false },
    ]);
  });

  test("lex_borrow writes parent_entry_id: null plus a full borrowed_source snapshot", async () => {
    const borrowArgs = {
      language_id: "lang_leaf",
      source_language: "lang_root",
      entry_ids: ["entry_root_sula"],
      source_sense_id: "sense_entry_root_sula",
      source_family_path: "/projects/other/workspace.conlang",
      semantic_shift_note: "religious sense only",
      tags: ["loanword"],
    };

    const dry = await harness.client.callTool({
      name: "lex_borrow",
      arguments: { ...borrowArgs, dry_run: true },
    });
    const dryBody = parseToolResult(dry).body;
    const baseRevisions = dryBody.base_revisions as Record<string, string>;

    const commit = await harness.client.callTool({
      name: "lex_borrow",
      arguments: {
        ...borrowArgs,
        operation_id: "op_etymv3_borrow_1",
        expected_revision: baseRevisions.lexicon,
      },
    });
    const commitBody = parseToolResult(commit).body;
    expect(commitBody.committed).toBe(true);
    const borrowed = (commitBody.borrowed as { target_entry_id: string; source_entry_id: string }[])[0]!;
    expect(borrowed.source_entry_id).toBe("entry_root_sula");

    // 落盘校验：parent_entry_id 必须为 null，快照完整
    const got = await harness.client.callTool({
      name: "lex_get",
      arguments: { language_id: "lang_leaf", entry_ids: [borrowed.target_entry_id] },
    });
    const item = (parseToolResult(got).body.items as { etymology: Record<string, unknown> }[])[0]!;
    expect(item.etymology.origin_type).toBe("borrowed");
    expect(item.etymology.parent_entry_id).toBeNull();
    expect(item.etymology.borrowed_source).toEqual({
      source_conlang_path: "/projects/other/workspace.conlang",
      source_language_id: "lang_root",
      source_language_name: "Proto-Synth",
      source_entry_id: "entry_root_sula",
      source_sense_id: "sense_entry_root_sula",
      borrowed_form: "sula",
      borrowed_ipa: "/sula/",
      borrowed_gloss: "moon",
    });
  });

  test("lex_etymology_lineage walks the borrowed chain and keeps the snapshot after donor deletion", async () => {
    // 借词使用新生成的 entry_id，从词典里按 origin_type 定位它
    const search = await harness.client.callTool({
      name: "lex_search",
      arguments: { language_id: "lang_leaf", origin_type: "borrowed" },
    });
    const items = parseToolResult(search).body.items as { entry_id: string }[];
    expect(items).toHaveLength(1);
    const loanId = items[0]!.entry_id;

    // 供语词条存在：borrowed 节点关联实时状态
    const before = await harness.client.callTool({
      name: "lex_etymology_lineage",
      arguments: { language_id: "lang_leaf", entry_id: loanId },
    });
    const beforeBody = parseToolResult(before).body;
    expect(beforeBody.has_broken_links).toBe(false);
    const beforeNodes = beforeBody.nodes as LineageNode[];
    expect(beforeNodes.map((node) => node.stepKind)).toEqual(["self", "borrowed"]);
    expect(beforeNodes[1]).toMatchObject({
      languageId: "lang_root",
      entryId: "entry_root_sula",
      romanized: "sula",
      broken: false,
    });
    expect(beforeNodes[1]!.borrowedSnapshot?.source_sense_id).toBe("sense_entry_root_sula");

    // 模拟供语词条被删除：快照仍完整可读，不算断链
    removeEntryFromDisk(harness.workspaceDir, "roots/root", "entry_root_sula");

    const after = await harness.client.callTool({
      name: "lex_etymology_lineage",
      arguments: { language_id: "lang_leaf", entry_id: loanId },
    });
    const afterBody = parseToolResult(after).body;
    expect(afterBody.has_broken_links).toBe(false);
    expect(afterBody.broken_links).toEqual([]);
    const afterNodes = afterBody.nodes as LineageNode[];
    expect(afterNodes).toHaveLength(2);
    expect(afterNodes[1]).toMatchObject({
      stepKind: "borrowed",
      broken: false,
      brokenReason: "donor_removed_snapshot_kept",
      romanized: "sula",
    });
    expect(afterNodes[1]!.borrowedSnapshot).toMatchObject({
      source_language_name: "Proto-Synth",
      source_entry_id: "entry_root_sula",
      borrowed_form: "sula",
      borrowed_gloss: "moon",
    });
  });

  test("lex_etymology_lineage walks the evolved chain and locates broken parent links", async () => {
    // 既有 fixture：lang_child entry_root_acika 演化自 lang_root entry_root_acika
    const ok = await harness.client.callTool({
      name: "lex_etymology_lineage",
      arguments: { language_id: "lang_child", entry_id: "entry_root_acika" },
    });
    const okBody = parseToolResult(ok).body;
    expect(okBody.has_broken_links).toBe(false);
    const okNodes = okBody.nodes as LineageNode[];
    expect(okNodes.map((node) => [node.stepKind, node.entryId])).toEqual([
      ["self", "entry_root_acika"],
      ["inherited", "entry_root_acika"],
    ]);
    expect(okNodes[1]).toMatchObject({ languageId: "lang_root", romanized: "acika" });

    // 断链：parent_entry_id 指向不存在的词条
    const brokenEntry = {
      entry_id: "entry_leaf_broken_evolved",
      con_word_romanized: "akikav",
      senses: [{ pos_id: "pos_noun", gloss: "dry river" }],
      etymology: {
        origin_type: "evolved",
        parent_entry_id: "entry_ghost",
        source_language_id: "lang_child",
        applied_sound_changes: ["rule_x"],
        semantic_change_kind: "narrowing",
      },
    };
    const dry = await harness.client.callTool({
      name: "lex_upsert",
      arguments: { language_id: "lang_leaf", dry_run: true, entries: [brokenEntry] },
    });
    const dryBody = parseToolResult(dry).body;
    await harness.client.callTool({
      name: "lex_upsert",
      arguments: {
        language_id: "lang_leaf",
        operation_id: "op_etymv3_broken_1",
        expected_revision: (dryBody.base_revisions as Record<string, string>).lexicon,
        entries: [brokenEntry],
      },
    });

    const broken = await harness.client.callTool({
      name: "lex_etymology_lineage",
      arguments: { language_id: "lang_leaf", entry_id: "entry_leaf_broken_evolved" },
    });
    const brokenBody = parseToolResult(broken).body;
    expect(brokenBody.has_broken_links).toBe(true);
    expect(brokenBody.broken_links).toEqual([
      { kind: "parent", missingId: "entry_ghost", languageId: "lang_child" },
    ]);
    const brokenNodes = brokenBody.nodes as LineageNode[];
    expect(brokenNodes[1]).toMatchObject({
      stepKind: "inherited",
      broken: true,
      brokenReason: "missing_parent_entry",
    });
  });

  test("lex_borrow rejects a source_sense_id missing from the donor entry", async () => {
    const res = await harness.client.callTool({
      name: "lex_borrow",
      arguments: {
        language_id: "lang_leaf",
        source_language: "lang_root",
        entry_ids: ["entry_root_apa"],
        source_sense_id: "sense_missing",
        dry_run: true,
      },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(true);
    expect(body.code).toBe("NOT_FOUND");
  });

  test("lex_upsert clears optional fields passed as null or empty string", async () => {
    const entryId = "entry_leaf_clearable_fields";
    const senseId = "sense_entry_leaf_clearable_fields";
    const createPayload = {
      entry_id: entryId,
      con_word_romanized: "mirak",
      inflection_class_id: "class_noun_i",
      senses: [
        {
          sense_id: senseId,
          pos_id: "pos_noun",
          gloss: "harbor",
          usage_note: "formal register",
          inflection_class_id: "class_noun_ii",
        },
      ],
      etymology: {
        origin_type: "derived",
        semantic_change_kind: "narrowing",
        components: [{ entry_id: "entry_leaf_asha", relation: "root" }],
      },
    };

    const dryCreate = await harness.client.callTool({
      name: "lex_upsert",
      arguments: { language_id: "lang_leaf", dry_run: true, entries: [createPayload] },
    });
    const createRevision = (parseToolResult(dryCreate).body.base_revisions as Record<string, string>)
      .lexicon;
    const created = await harness.client.callTool({
      name: "lex_upsert",
      arguments: {
        language_id: "lang_leaf",
        operation_id: "op_etymv3_clear_create",
        expected_revision: createRevision,
        entries: [createPayload],
      },
    });
    expect(parseToolResult(created).body.committed).toBe(true);

    // 显式置空：义项用法说明（null）、义项变位类（""）、词条默认变位类（null）、语义变化分类（""）
    const clearPayload = {
      entry_id: entryId,
      con_word_romanized: "mirak",
      inflection_class_id: null,
      senses: [
        {
          sense_id: senseId,
          pos_id: "pos_noun",
          gloss: "harbor",
          usage_note: null,
          inflection_class_id: "",
        },
      ],
      etymology: { semantic_change_kind: "" },
    };
    const dryClear = await harness.client.callTool({
      name: "lex_upsert",
      arguments: { language_id: "lang_leaf", dry_run: true, entries: [clearPayload] },
    });
    const clearRevision = (parseToolResult(dryClear).body.base_revisions as Record<string, string>)
      .lexicon;
    const cleared = await harness.client.callTool({
      name: "lex_upsert",
      arguments: {
        language_id: "lang_leaf",
        operation_id: "op_etymv3_clear_update",
        expected_revision: clearRevision,
        entries: [clearPayload],
      },
    });
    expect(parseToolResult(cleared).body.updated).toBe(1);

    interface ClearedItem {
      inflection_class_id?: string;
      senses: Record<string, unknown>[];
      etymology: Record<string, unknown>;
    }
    const got = await harness.client.callTool({
      name: "lex_get",
      arguments: { language_id: "lang_leaf", entry_ids: [entryId] },
    });
    const item = (parseToolResult(got).body.items as ClearedItem[])[0]!;
    expect(item.inflection_class_id).toBeUndefined();
    expect(item.senses[0]!.usage_note).toBeUndefined();
    expect(item.senses[0]!.inflection_class_id).toBeUndefined();
    expect(item.etymology.semantic_change_kind).toBeUndefined();
    // 未传的字段必须保留原值，不能被这次「置空」连带清掉
    expect(item.etymology.origin_type).toBe("derived");
    expect((item.etymology.components as unknown[]).length).toBe(1);

    // 落盘不得留下 null 占位（undefined 只是合并期的覆盖标记）
    const bucketPath = path.join(
      harness.workspaceDir,
      "branches/leaf/lexicon/lexicon_m.ndjson",
    );
    const line = fs
      .readFileSync(bucketPath, "utf-8")
      .split("\n")
      .find((raw) => raw.includes(entryId));
    expect(line).toBeDefined();
    expect(line).not.toContain('"usage_note":null');
    expect(line).not.toContain('"semantic_change_kind":null');
    expect(line).not.toContain('"inflection_class_id":null');
  });

  test("lex_upsert drops borrowed_source when origin_type leaves borrowed", async () => {
    const entryId = "entry_leaf_loan_reorigin";
    const senseId = "sense_entry_leaf_loan_reorigin";
    const loanPayload = {
      entry_id: entryId,
      con_word_romanized: "sulako",
      senses: [{ sense_id: senseId, pos_id: "pos_noun", gloss: "moonshine" }],
      etymology: {
        origin_type: "borrowed",
        parent_entry_id: null,
        source_language_id: "lang_root",
        borrowed_source: {
          source_conlang_path: "/projects/other/workspace.conlang",
          source_language_id: "lang_root",
          source_entry_id: "entry_root_sula",
          borrowed_form: "sula",
          borrowed_gloss: "moon",
        },
      },
    };

    const dryLoan = await harness.client.callTool({
      name: "lex_upsert",
      arguments: { language_id: "lang_leaf", dry_run: true, entries: [loanPayload] },
    });
    const loanRevision = (parseToolResult(dryLoan).body.base_revisions as Record<string, string>)
      .lexicon;
    await harness.client.callTool({
      name: "lex_upsert",
      arguments: {
        language_id: "lang_leaf",
        operation_id: "op_etymv3_reorigin_create",
        expected_revision: loanRevision,
        entries: [loanPayload],
      },
    });

    // 改回 a_priori 且不传新快照：旧 borrowed_source 必须被清除
    const reoriginPayload = {
      entry_id: entryId,
      con_word_romanized: "sulako",
      senses: [{ sense_id: senseId, pos_id: "pos_noun", gloss: "moonshine" }],
      etymology: { origin_type: "a_priori", source_language_id: null },
    };
    const dryReorigin = await harness.client.callTool({
      name: "lex_upsert",
      arguments: { language_id: "lang_leaf", dry_run: true, entries: [reoriginPayload] },
    });
    const reoriginRevision = (
      parseToolResult(dryReorigin).body.base_revisions as Record<string, string>
    ).lexicon;
    await harness.client.callTool({
      name: "lex_upsert",
      arguments: {
        language_id: "lang_leaf",
        operation_id: "op_etymv3_reorigin_update",
        expected_revision: reoriginRevision,
        entries: [reoriginPayload],
      },
    });

    const got = await harness.client.callTool({
      name: "lex_get",
      arguments: { language_id: "lang_leaf", entry_ids: [entryId] },
    });
    const item = (
      parseToolResult(got).body.items as { etymology: Record<string, unknown> }[]
    )[0]!;
    expect(item.etymology.origin_type).toBe("a_priori");
    expect(item.etymology.borrowed_source).toBeUndefined();
  });
});
