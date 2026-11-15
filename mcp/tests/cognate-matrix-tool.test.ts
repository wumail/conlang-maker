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

interface SeedWordPatch {
  /** 相对于工作区根目录的 NDJSON 路径 */
  file: string;
  entryId: string;
  conceptId: string | null;
  parentEntryId: string | null;
  originType?: string;
}

/** 给夹具词条挂概念 + 词源链接（origin_type 仅在显式传入时改写） */
function seedConceptLinks(workspaceDir: string, patches: SeedWordPatch[]): void {
  for (const patch of patches) {
    const file = path.join(workspaceDir, patch.file);
    if (!fs.existsSync(file)) {
      throw new Error(`seedConceptLinks: missing fixture file ${patch.file}`);
    }
    const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
    let touched = false;
    const next = lines.map((line) => {
      const word = JSON.parse(line) as {
        entry_id: string;
        senses: { concept_id?: string }[];
        etymology: { origin_type?: string; parent_entry_id?: string | null };
      };
      if (word.entry_id !== patch.entryId) return line;
      if (patch.conceptId === null) {
        delete word.senses[0]!.concept_id;
      } else {
        word.senses[0]!.concept_id = patch.conceptId;
      }
      word.etymology.parent_entry_id = patch.parentEntryId;
      if (patch.originType) word.etymology.origin_type = patch.originType;
      touched = true;
      return JSON.stringify(word);
    });
    if (!touched) {
      throw new Error(`seedConceptLinks: entry ${patch.entryId} not found in ${patch.file}`);
    }
    fs.writeFileSync(file, `${next.join("\n")}\n`, "utf-8");
  }
}

/** 基础种子：一个根词 + 两代继承词，全部绑定 stone，用于验证同源归组 */
function baseSeedPatches(): SeedWordPatch[] {
  return [
    { file: "roots/root/lexicon/lexicon_a.ndjson", entryId: "entry_root_apa", conceptId: "stone", parentEntryId: null },
    // 中间代沿用同一 entry_id，但父链接指向根语言；叶子再指向中间代
    { file: "stages/child/lexicon/lexicon_a.ndjson", entryId: "entry_root_apa", conceptId: "stone", parentEntryId: "entry_root_apa", originType: "evolved" },
    { file: "branches/leaf/lexicon/lexicon_a.ndjson", entryId: "entry_leaf_aca", conceptId: "stone", parentEntryId: "entry_root_apa", originType: "evolved" },
  ];
}

interface HarnessOptions {
  /** 追加 Roadmap v3 种子：derived 创新词、同概念第二候选与工作区 gaps/overrides */
  v3Seed?: boolean;
  mode?: "read-only" | "write";
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-cognates-"));
  const workspaceDir = path.join(rootDir, "workspace-basic");
  fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });

  const patches = baseSeedPatches();
  if (options.v3Seed) {
    // ① 叶语言的 fire 词是本语言共时派生创新（还遗留了脏 parent_entry_id）：
    //    必须归 innovation 且零断链误报
    patches.push({
      file: "branches/leaf/lexicon/lexicon_a.ndjson",
      entryId: "entry_leaf_acha",
      conceptId: "fire",
      parentEntryId: "entry_missing_parent",
      originType: "derived",
    });
    // ② 叶语言追加 stone 的第二候选（a_priori），供人工主词覆盖测试
    const leafFile = path.join(workspaceDir, "branches/leaf/lexicon/lexicon_a.ndjson");
    const extraWord = {
      entry_id: "entry_leaf_aca2",
      language_id: "lang_leaf",
      con_word_romanized: "aca2",
      phonetic_ipa: "/aka2/",
      phonetic_override: false,
      senses: [
        {
          sense_id: "sense_entry_leaf_aca2",
          pos_id: "pos_noun",
          gloss: "stone",
          definitions: [],
          examples: [],
          concept_id: "stone",
        },
      ],
      etymology: {
        origin_type: "a_priori",
        parent_entry_id: null,
        source_language_id: null,
        applied_sound_changes: [],
        semantic_shift_note: "",
      },
      metadata: { tags: [], created_at: "", updated_at: "" },
    };
    fs.appendFileSync(leafFile, `${JSON.stringify(extraWord)}\n`, "utf-8");

    // ③ 工作区写入 lexical_gaps 与 primary_cognate_overrides
    const wsFile = path.join(workspaceDir, "workspace.conlang");
    const ws = JSON.parse(fs.readFileSync(wsFile, "utf-8")) as Record<string, unknown>;
    ws.lexical_gaps = [
      {
        language_id: "lang_other",
        concept_id: "stone",
        status: "periphrastic",
        note: "uses the phrase 'big hard thing'",
      },
    ];
    ws.primary_cognate_overrides = [
      {
        language_id: "lang_leaf",
        concept_id: "stone",
        entry_id: "entry_leaf_aca2",
        sense_id: "sense_entry_leaf_aca2",
        reason: "most frequent in corpus",
      },
    ];
    fs.writeFileSync(wsFile, JSON.stringify(ws, null, 2), "utf-8");
  }
  seedConceptLinks(workspaceDir, patches);

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

  const mode = options.mode ?? "read-only";
  const config = parseConfig(
    ["--mode", mode, "--toolsets", "all", "--registry", registryPath, "--allow-root", rootDir],
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

interface MatrixCell {
  languageId: string;
  entryId: string | null;
  kind: string;
  cognateSetId: string | null;
  form: string;
  variants: number;
  candidates?: Array<{ entryId: string; senseId: string; isPinnedPrimary: boolean }>;
  gap?: { status: string; note?: string };
  primaryReason?: string;
  innovationKind?: string;
  brokenChain?: boolean;
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
    // Roadmap v3：截断前总数与各语言未绑定概念词条数
    expect(body.total_matched_concepts as number).toBeGreaterThanOrEqual(140);
    expect(body.unbound_word_counts).toBeDefined();
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

  test("exposes senses[].concept_id in lex_upsert schema and populates matrix via lex_upsert + lex_pull_sync", async () => {
    const writeRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-cognates-w-"));
    const workspaceDir = path.join(writeRootDir, "workspace-basic");
    fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });
    const registryPath = path.join(writeRootDir, "registry.json");
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        registry_version: "1.0",
        families: [
          {
            name: "Write-Family",
            conlang_file_path: path.join(workspaceDir, "workspace.conlang"),
            last_opened: 1700000000,
          },
        ],
        active_family_index: 0,
      }),
      "utf-8",
    );
    const config = parseConfig(
      ["--mode", "write", "--toolsets", "all", "--registry", registryPath, "--allow-root", writeRootDir],
      {},
    );
    const server = createServer(config);
    const client = new Client({ name: "cognate-writer", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const toolsList = await client.listTools();
      const lexUpsertTool = toolsList.tools.find((t) => t.name === "lex_upsert");
      const schemaJson = JSON.stringify(lexUpsertTool?.inputSchema ?? {});
      expect(schemaJson).toContain("concept_id");

      const dryUpsert = parseToolResult(
        await client.callTool({
          name: "lex_upsert",
          arguments: {
            language_id: "lang_root",
            dry_run: true,
            entries: [
              {
                entry_id: "entry_water_proto",
                con_word_romanized: "pata",
                senses: [{ sense_id: "s_water", gloss: "水, water", concept_id: "water" }],
              },
            ],
          },
        }),
      );
      const rootRev = (dryUpsert.body.base_revisions as { lexicon: string }).lexicon;

      const upsertRes = parseToolResult(
        await client.callTool({
          name: "lex_upsert",
          arguments: {
            language_id: "lang_root",
            operation_id: "op_coin_water",
            expected_revision: rootRev,
            entries: [
              {
                entry_id: "entry_water_proto",
                con_word_romanized: "pata",
                senses: [{ sense_id: "s_water", gloss: "水, water", concept_id: "water" }],
              },
            ],
          },
        }),
      );
      expect(upsertRes.isError).toBe(false);
      const nextRootRev = (upsertRes.body.revisions as { lexicon: string })
        .lexicon;

      const previewSync = parseToolResult(
        await client.callTool({
          name: "lex_pull_sync",
          arguments: {
            language_id: "lang_child",
            dry_run: true,
          },
        }),
      );
      const childRev = (previewSync.body.base_revisions as { lexicon: string })
        .lexicon;

      const syncRes = parseToolResult(
        await client.callTool({
          name: "lex_pull_sync",
          arguments: {
            language_id: "lang_child",
            apply: true,
            operation_id: "op_sync_water",
            expected_revision: childRev,
          },
        }),
      );
      expect(syncRes.isError).toBe(false);

      const matrixRes = parseToolResult(
        await client.callTool({
          name: "family_cognate_matrix",
          arguments: { concept_ids: ["water"] },
        }),
      );
      const row = (
        matrixRes.body.rows as {
          filled: number;
          cognate_set_count: number;
          cells: { languageId: string; kind: string }[];
        }[]
      )[0]!;
      expect(row.filled).toBe(2);
      expect(row.cognate_set_count).toBe(1);
      const childCell = row.cells.find((c) => c.languageId === "lang_child");
      expect(childCell?.kind).toBe("inherited");

      // Unbind concept_id with null
      const unbindRes = parseToolResult(
        await client.callTool({
          name: "lex_upsert",
          arguments: {
            language_id: "lang_root",
            operation_id: "op_unbind_water",
            expected_revision: nextRootRev,
            entries: [
              {
                entry_id: "entry_water_proto",
                con_word_romanized: "pata",
                senses: [{ sense_id: "s_water", gloss: "水, water", concept_id: null }],
              },
            ],
          },
        }),
      );
      expect(unbindRes.isError).toBe(false);
      const afterUnbind = parseToolResult(
        await client.callTool({
          name: "family_cognate_matrix",
          arguments: { concept_ids: ["water"], language_ids: ["lang_root"] },
        }),
      );
      const rootRows = afterUnbind.body.rows as { filled: number }[];
      expect(rootRows[0]?.filled).toBe(0);
    } finally {
      await client.close();
      fs.rmSync(writeRootDir, { recursive: true, force: true });
    }
  });
});

describe("Roadmap v3 family_cognate_matrix (gaps / overrides / innovation)", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({ v3Seed: true });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test("derived innovation words never report broken parent links", async () => {
    const res = await harness.client.callTool({
      name: "family_cognate_matrix",
      arguments: { concept_ids: ["fire"] },
    });
    const { isError, body } = parseToolResult(res);
    expect(isError).toBe(false);
    const stats = body.stats as { brokenChainCount: number; innovationCount: number };
    expect(stats.brokenChainCount).toBe(0);
    expect(stats.innovationCount).toBe(1);
    const row = (body.rows as { cells: MatrixCell[] }[])[0]!;
    const leafCell = row.cells.find((cell) => cell.languageId === "lang_leaf")!;
    expect(leafCell.kind).toBe("innovation");
    expect(leafCell.innovationKind).toBe("derived");
    expect(leafCell.brokenChain).toBeUndefined();
  });

  test("honours workspace primary_cognate_overrides and exposes sense-level candidates", async () => {
    const res = await harness.client.callTool({
      name: "family_cognate_matrix",
      arguments: { concept_ids: ["stone"] },
    });
    const { body } = parseToolResult(res);
    const row = (body.rows as { cells: MatrixCell[] }[])[0]!;
    const leafCell = row.cells.find((cell) => cell.languageId === "lang_leaf")!;
    expect(leafCell.candidates).toHaveLength(2);
    expect(leafCell.variants).toBe(2);
    // 人工指定的主词（a_priori 的 aca2）覆盖自动排序（evolved 的 aca 应排首位）
    expect(leafCell.entryId).toBe("entry_leaf_aca2");
    expect(leafCell.primaryReason).toBe("manual_override");
    const pinned = leafCell.candidates!.find((c) => c.entryId === "entry_leaf_aca2")!;
    expect(pinned.isPinnedPrimary).toBe(true);
    expect(pinned.senseId).toBe("sense_entry_leaf_aca2");
    expect(
      leafCell.candidates!.find((c) => c.entryId === "entry_leaf_aca")!.isPinnedPrimary,
    ).toBe(false);
    // 其余语言仍是自动排序
    const childCell = row.cells.find((cell) => cell.languageId === "lang_child")!;
    expect(childCell.primaryReason).toBe("auto_rank");
  });

  test("surfaces workspace lexical_gaps on empty cells", async () => {
    const res = await harness.client.callTool({
      name: "family_cognate_matrix",
      arguments: { concept_ids: ["stone"] },
    });
    const { body } = parseToolResult(res);
    const row = (body.rows as { cells: MatrixCell[] }[])[0]!;
    const otherCell = row.cells.find((cell) => cell.languageId === "lang_other")!;
    expect(otherCell.kind).toBe("empty");
    expect(otherCell.gap?.status).toBe("periphrastic");
    expect(otherCell.gap?.note).toBe("uses the phrase 'big hard thing'");
  });

  test("comparison_filter=multi_candidate keeps only rows with competing candidates", async () => {
    const res = await harness.client.callTool({
      name: "family_cognate_matrix",
      arguments: { comparison_filter: "multi_candidate", only_filled: true },
    });
    const { body } = parseToolResult(res);
    const rows = body.rows as { concept_id: string }[];
    expect(rows.map((row) => row.concept_id)).toEqual(["stone"]);
  });
});

describe("Roadmap v3 concept_upsert (aliases / merge / gaps / overrides)", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness({ mode: "write" });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  async function call(name: string, args: Record<string, unknown>) {
    return parseToolResult(await harness.client.callTool({ name, arguments: args }));
  }

  test("creates aliased custom concepts, merges atomically and rewrites bindings", async () => {
    // 1. 建两个自定义概念（其中一个带 aliases）
    const dryCreate = await call("concept_upsert", {
      dry_run: true,
      concepts: [
        { concept_id: "custom_flame_a", gloss_en: "flame", gloss_zh: "火苗", aliases: ["blaze"] },
        { concept_id: "custom_flame_b", gloss_en: "big flame", gloss_zh: "大火" },
      ],
    });
    const wsRev1 = (dryCreate.body.base_revisions as Record<string, string>)[
      "workspace.conlang"
    ];
    const createRes = await call("concept_upsert", {
      operation_id: "op_create_flames",
      expected_revision: wsRev1,
      concepts: [
        { concept_id: "custom_flame_a", gloss_en: "flame", gloss_zh: "火苗", aliases: ["blaze"] },
        { concept_id: "custom_flame_b", gloss_en: "big flame", gloss_zh: "大火" },
      ],
    });
    expect(createRes.isError).toBe(false);

    // 2. concept_list 按 alias 检索得到该概念
    const listByAlias = await call("concept_list", { query: "blaze" });
    const aliasesHits = listByAlias.body.concepts as { concept_id: string }[];
    expect(aliasesHits.map((c) => c.concept_id)).toContain("custom_flame_a");

    // 3. 在 lang_root 写一个绑定 custom_flame_a 的词条
    const dryLex = await call("lex_upsert", {
      language_id: "lang_root",
      dry_run: true,
      entries: [
        {
          entry_id: "entry_flame_word",
          con_word_romanized: "fajra",
          senses: [{ sense_id: "s_flame", gloss: "火苗", concept_id: "custom_flame_a" }],
        },
      ],
    });
    const lexRev = (dryLex.body.base_revisions as { lexicon: string }).lexicon;
    const lexRes = await call("lex_upsert", {
      language_id: "lang_root",
      operation_id: "op_flame_word",
      expected_revision: lexRev,
      entries: [
        {
          entry_id: "entry_flame_word",
          con_word_romanized: "fajra",
          senses: [{ sense_id: "s_flame", gloss: "火苗", concept_id: "custom_flame_a" }],
        },
      ],
    });
    expect(lexRes.isError).toBe(false);

    // 4. 原子合并 custom_flame_a → custom_flame_b（dry-run 拿基线修订）
    const dryMerge = await call("concept_upsert", {
      dry_run: true,
      concepts: [{ concept_id: "custom_flame_b" }],
      merge_from_id: "custom_flame_a",
    });
    expect(dryMerge.isError).toBe(false);
    const merged = dryMerge.body.merged as {
      source_concept_id: string;
      target_concept_id: string;
      rebound_senses: number;
      affected_languages: string[];
    };
    expect(merged.rebound_senses).toBe(1);
    expect(merged.affected_languages).toEqual(["lang_root"]);
    const baseRevs = dryMerge.body.base_revisions as Record<string, string>;
    expect(baseRevs["lexicon:lang_root"]).toBeDefined();

    const mergeRes = await call("concept_upsert", {
      operation_id: "op_merge_flames",
      expected_revision: baseRevs["workspace.conlang"],
      expected_lexicon_revisions: { lang_root: baseRevs["lexicon:lang_root"] },
      concepts: [{ concept_id: "custom_flame_b" }],
      merge_from_id: "custom_flame_a",
    });
    expect(mergeRes.isError).toBe(false);
    expect((mergeRes.body.merged as { rebound_senses: number }).rebound_senses).toBe(1);

    // 5. 概念表：源概念删除、别名并入目标
    const listAfter = await call("concept_list", { query: "flame", include_core: false });
    const customIds = (listAfter.body.concepts as { concept_id: string; aliases?: string[] }[])
      .map((c) => c.concept_id);
    expect(customIds).toContain("custom_flame_b");
    expect(customIds).not.toContain("custom_flame_a");
    const target = (listAfter.body.concepts as { concept_id: string; aliases?: string[] }[]).find(
      (c) => c.concept_id === "custom_flame_b",
    )!;
    expect(target.aliases).toEqual(["blaze"]);

    // 6. 词典义项已重写到目标概念（通过同源矩阵验证）
    const matrixRes = await call("family_cognate_matrix", {
      concept_ids: ["custom_flame_b"],
    });
    const row = (matrixRes.body.rows as { filled: number; cells: MatrixCell[] }[])[0]!;
    expect(row.filled).toBe(1);
    const rootCell = row.cells.find((cell) => cell.languageId === "lang_root")!;
    expect(rootCell.entryId).toBe("entry_flame_word");
    expect(rootCell.candidates?.[0]?.senseId).toBe("s_flame");
  });

  test("writes lexical_gaps and primary_cognate_overrides and feeds them back into the matrix", async () => {
    // 建一个绑定词条 + gaps/overrides
    const dryLex = await call("lex_upsert", {
      language_id: "lang_child",
      dry_run: true,
      entries: [
        {
          entry_id: "entry_child_hold",
          con_word_romanized: "hola",
          senses: [{ sense_id: "s_hold", gloss: "握", concept_id: "hold" }],
        },
      ],
    });
    const lexRev = (dryLex.body.base_revisions as { lexicon: string }).lexicon;
    const lexRes = await call("lex_upsert", {
      language_id: "lang_child",
      operation_id: "op_child_hold",
      expected_revision: lexRev,
      entries: [
        {
          entry_id: "entry_child_hold",
          con_word_romanized: "hola",
          senses: [{ sense_id: "s_hold", gloss: "握", concept_id: "hold" }],
        },
      ],
    });
    expect(lexRes.isError).toBe(false);

    const dryWrite = await call("concept_upsert", {
      dry_run: true,
      lexical_gaps: [
        { language_id: "lang_other", concept_id: "hold", status: "confirmed_absent", note: "uses verb phrase" },
      ],
      primary_cognate_overrides: [
        { language_id: "lang_child", concept_id: "hold", entry_id: "entry_child_hold", sense_id: "s_hold", reason: "only candidate" },
      ],
    });
    const wsRev = (dryWrite.body.base_revisions as Record<string, string>)["workspace.conlang"];
    const writeRes = await call("concept_upsert", {
      operation_id: "op_gap_override",
      expected_revision: wsRev,
      lexical_gaps: [
        { language_id: "lang_other", concept_id: "hold", status: "confirmed_absent", note: "uses verb phrase" },
      ],
      primary_cognate_overrides: [
        { language_id: "lang_child", concept_id: "hold", entry_id: "entry_child_hold", sense_id: "s_hold", reason: "only candidate" },
      ],
    });
    expect(writeRes.isError).toBe(false);
    expect((writeRes.body.lexical_gaps as { upserted: number }).upserted).toBe(1);
    expect((writeRes.body.primary_cognate_overrides as { upserted: number }).upserted).toBe(1);

    const matrixRes = await call("family_cognate_matrix", {
      concept_ids: ["hold"],
    });
    const row = (matrixRes.body.rows as { cells: MatrixCell[] }[])[0]!;
    const otherCell = row.cells.find((cell) => cell.languageId === "lang_other")!;
    expect(otherCell.gap?.status).toBe("confirmed_absent");
    const childCell = row.cells.find((cell) => cell.languageId === "lang_child")!;
    expect(childCell.entryId).toBe("entry_child_hold");
    expect(childCell.primaryReason).toBe("manual_override");

    // 移除 gap 后矩阵不再携带
    const dryRemove = await call("concept_upsert", {
      dry_run: true,
      remove_lexical_gaps: [{ language_id: "lang_other", concept_id: "hold" }],
    });
    const wsRev2 = (dryRemove.body.base_revisions as Record<string, string>)["workspace.conlang"];
    const removeRes = await call("concept_upsert", {
      operation_id: "op_remove_gap",
      expected_revision: wsRev2,
      remove_lexical_gaps: [{ language_id: "lang_other", concept_id: "hold" }],
    });
    expect(removeRes.isError).toBe(false);
    expect((removeRes.body.lexical_gaps as { removed: number }).removed).toBe(1);

    const matrixAfter = await call("family_cognate_matrix", {
      concept_ids: ["hold"],
    });
    const rowAfter = (matrixAfter.body.rows as { cells: MatrixCell[] }[])[0]!;
    expect(rowAfter.cells.find((cell) => cell.languageId === "lang_other")!.gap).toBeUndefined();
  });

  test("rejects merging into a read-only core concept or a missing source", async () => {
    const badTarget = await call("concept_upsert", {
      concepts: [{ concept_id: "water", gloss_en: "water" }],
      merge_from_id: "custom_flame_b",
    });
    expect(badTarget.isError).toBe(true);

    const badSource = await call("concept_upsert", {
      concepts: [{ concept_id: "custom_flame_b" }],
      merge_from_id: "custom_nonexistent",
    });
    expect(badSource.isError).toBe(true);
  });
});
