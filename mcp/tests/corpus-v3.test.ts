/**
 * corpus-v3.test.ts — Roadmap v3 / Pillars 2 & 6 MCP 集成测试
 *
 * 覆盖：corpus_save 写入 token 的 status / linked_sense_id；corpus_auto_gloss 的
 * 三模式（fill_empty 默认 / recompute_auto / reanalyze_selected）均 100% 保留
 * line.translation，且 reanalyze_selected 返回被覆盖的人工 token 预览。
 * 写工具全部走 dry_run → base_revisions → expected_revision 的 CAS 流程。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { LanguageEntry } from "../../src/types";
import { parseConfig } from "../config";
import { createServer } from "../server";
import { readCorpusTextUnlocked } from "../storage/read";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const FIXTURE_WORKSPACE = path.join(REPO_ROOT, "tests/fixtures/workspace-basic");
const CORPUS_ID = "corp_v3_hearth";

interface Harness {
  rootDir: string;
  workspaceDir: string;
  client: Client;
  cleanup: () => Promise<void>;
}

async function createHarness(): Promise<Harness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-corpusv3-"));
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
  const client = new Client({ name: "corpus-v3-checker", version: "1.0.0" });
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

interface CorpusToken {
  token_id: string;
  gloss_labels?: string;
  linked_entry_id?: string;
  linked_sense_id?: string;
  status?: string;
}

interface CorpusLine {
  line_id: string;
  translation: string;
  tokens: CorpusToken[];
}

function readCorpusFromDisk(workspaceDir: string): {
  glossed_lines: CorpusLine[];
} {
  const abs = path.join(workspaceDir, "stages/child/corpus", `${CORPUS_ID}.json`);
  return JSON.parse(fs.readFileSync(abs, "utf-8")) as { glossed_lines: CorpusLine[] };
}

function readRawCorpusLines(
  workspaceDir: string,
  corpusId: string,
): Array<{ tokens: Array<Record<string, unknown>>; translation?: string }> {
  const abs = path.join(workspaceDir, "stages/child/corpus", `${corpusId}.json`);
  const raw = JSON.parse(fs.readFileSync(abs, "utf-8")) as {
    glossed_lines: Array<{ tokens: Array<Record<string, unknown>>; translation?: string }>;
  };
  return raw.glossed_lines;
}

describe("Roadmap v3 / Pillars 2 & 6 — corpus MCP tools", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  async function callOk(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await harness.client.callTool({ name, arguments: args });
    const parsed = parseToolResult(res);
    expect(parsed.isError).toBe(false);
    return parsed.body;
  }

  test("corpus_save round-trips token status and linked_sense_id", async () => {
    const payload = {
      language: "lang_child",
      corpus_id: CORPUS_ID,
      title: "Hearth",
      original_text: "achama sana",
      glossed_lines: [
        {
          line_id: "line_a",
          original: "achama sana",
          translation: "The hearth walks",
          tokens: [
            { token_id: "tok_a1", surface_form: "achama" },
            {
              token_id: "tok_a2",
              surface_form: "sana",
              gloss_labels: "walk(custom)",
              linked_entry_id: "entry_root_sana",
              linked_sense_id: "sense_entry_root_sana",
              status: "edited",
            },
          ],
        },
      ],
    };

    const dry = await callOk("corpus_save", { ...payload, dry_run: true });
    const base = dry.base_revisions as Record<string, string>;
    const committed = await callOk("corpus_save", {
      ...payload,
      operation_id: "op_corpus_v3_save_1",
      expected_revision: base[`corpus/${CORPUS_ID}.json`],
      expected_index_revision: base["corpus_index.json"],
    });
    expect(committed.committed).toBe(true);

    const onDisk = readCorpusFromDisk(harness.workspaceDir);
    expect(onDisk.glossed_lines[0]?.translation).toBe("The hearth walks");
    expect(onDisk.glossed_lines[0]?.tokens[1]).toMatchObject({
      token_id: "tok_a2",
      linked_sense_id: "sense_entry_root_sana",
      status: "edited",
    });
  });

  test("corpus_auto_gloss defaults to fill_empty and keeps translations + manual tokens", async () => {
    const body = await callOk("corpus_auto_gloss", {
      language: "lang_child",
      corpus_id: CORPUS_ID,
    });

    expect(body.mode).toBe("fill_empty");
    expect(body.preview).toBe(true);
    expect(body.replaced_protected_tokens).toEqual([]);

    const lines = body.glossed_lines as CorpusLine[];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.translation).toBe("The hearth walks");
    expect(lines[0]?.tokens[0]).toMatchObject({
      token_id: "tok_a1",
      gloss_labels: "hearth",
      linked_entry_id: "entry_child_achama",
      status: "auto",
    });
    // 人工标注义项绑定原样保留
    expect(lines[0]?.tokens[1]).toMatchObject({
      token_id: "tok_a2",
      gloss_labels: "walk(custom)",
      linked_sense_id: "sense_entry_root_sana",
      status: "edited",
    });
  });

  test("recompute_auto refreshes machine tokens but never verified ones", async () => {
    const update = {
      language: "lang_child",
      corpus_id: CORPUS_ID,
      title: "Hearth",
      original_text: "achama sana",
      glossed_lines: [
        {
          line_id: "line_a",
          original: "achama sana",
          tokens: [
            {
              token_id: "tok_a1",
              surface_form: "achama",
              gloss_labels: "stale-hearth",
              linked_entry_id: "entry_child_achama",
              status: "auto",
            },
            {
              token_id: "tok_a2",
              surface_form: "sana",
              gloss_labels: "walk(verified)",
              linked_entry_id: "entry_root_sana",
              status: "verified",
            },
          ],
        },
      ],
    };
    const dry = await callOk("corpus_save", { ...update, dry_run: true });
    const base = dry.base_revisions as Record<string, string>;
    await callOk("corpus_save", {
      ...update,
      operation_id: "op_corpus_v3_save_2",
      expected_revision: base[`corpus/${CORPUS_ID}.json`],
      expected_index_revision: base["corpus_index.json"],
    });

    const body = await callOk("corpus_auto_gloss", {
      language: "lang_child",
      corpus_id: CORPUS_ID,
      mode: "recompute_auto",
    });
    const lines = body.glossed_lines as CorpusLine[];
    expect(lines[0]?.translation).toBe("The hearth walks");
    expect(lines[0]?.tokens[0]).toMatchObject({
      gloss_labels: "hearth",
      status: "auto",
    });
    expect(lines[0]?.tokens[1]).toMatchObject({
      gloss_labels: "walk(verified)",
      status: "verified",
    });
  });

  test("reanalyze_selected reports replaced manual tokens and preserves translations on commit", async () => {
    const dry = await callOk("corpus_auto_gloss", {
      language: "lang_child",
      corpus_id: CORPUS_ID,
      apply: true,
      dry_run: true,
      mode: "reanalyze_selected",
      selected_line_ids: ["line_a"],
    });
    const base = dry.base_revisions as Record<string, string>;
    expect(dry.dry_run).toBe(true);

    const replaced = dry.replaced_protected_tokens as Array<Record<string, string>>;
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({
      line_id: "line_a",
      token_id: "tok_a2",
      before_gloss: "walk(verified)",
      after_gloss: "walk",
    });
    expect((dry.glossed_lines as CorpusLine[])[0]?.translation).toBe("The hearth walks");

    const committed = await callOk("corpus_auto_gloss", {
      language: "lang_child",
      corpus_id: CORPUS_ID,
      apply: true,
      operation_id: "op_corpus_v3_gloss_1",
      mode: "reanalyze_selected",
      selected_line_ids: ["line_a"],
      expected_revision: base[`corpus/${CORPUS_ID}.json`],
      expected_index_revision: base["corpus_index.json"],
    });
    expect(committed.committed).toBe(true);
    expect(committed.applied).toBe(true);

    const onDisk = readCorpusFromDisk(harness.workspaceDir);
    expect(onDisk.glossed_lines[0]?.tokens[0]).toMatchObject({
      gloss_labels: "hearth",
      status: "auto",
    });
    expect(onDisk.glossed_lines[0]?.tokens[1]).toMatchObject({
      gloss_labels: "walk",
      status: "auto",
    });
  });

  test("apply with reanalyze_selected on an unknown line id leaves the corpus untouched", async () => {
    const body = await callOk("corpus_auto_gloss", {
      language: "lang_child",
      corpus_id: CORPUS_ID,
      mode: "reanalyze_selected",
      selected_line_ids: ["line_missing"],
    });
    const lines = body.glossed_lines as CorpusLine[];
    expect(lines[0]?.tokens[0]?.token_id).toBe("tok_a1");
    expect(lines[0]?.tokens[0]?.gloss_labels).toBe("hearth");
    expect(lines[0]?.tokens[1]?.gloss_labels).toBe("walk");
  });

  // ── P2-10：可选字段可清空 + 读侧路径校验 / null 规整 ─────────────────

  test("corpus_save clears nullable token fields passed as null or empty string", async () => {
    const clearableId = "corp_v3_clearable";
    const create = {
      language: "lang_child",
      corpus_id: clearableId,
      title: "Clearable",
      original_text: "achama",
      glossed_lines: [
        {
          line_id: "line_c1",
          original: "achama",
          translation: "hearth",
          tokens: [
            {
              token_id: "tok_c1",
              surface_form: "achama",
              gloss_labels: "hearth",
              linked_entry_id: "entry_child_achama",
              linked_sense_id: "sense_entry_child_achama",
              status: "verified",
            },
          ],
        },
      ],
    };

    const dryCreate = await callOk("corpus_save", { ...create, dry_run: true });
    const baseCreate = dryCreate.base_revisions as Record<string, string>;
    await callOk("corpus_save", {
      ...create,
      operation_id: "op_corpus_v3_clear_1",
      expected_revision: baseCreate[`corpus/${clearableId}.json`],
      expected_index_revision: baseCreate["corpus_index.json"],
    });

    // null 清空 status，"" 清空 linked_sense_id；未传的 gloss_labels/translation 保持不变
    const patch = {
      language: "lang_child",
      corpus_id: clearableId,
      title: "Clearable",
      glossed_lines: [
        {
          line_id: "line_c1",
          original: "achama",
          tokens: [
            {
              token_id: "tok_c1",
              surface_form: "achama",
              linked_sense_id: "",
              status: null,
            },
          ],
        },
      ],
    };
    const dryPatch = await callOk("corpus_save", { ...patch, dry_run: true });
    const basePatch = dryPatch.base_revisions as Record<string, string>;
    const patched = await callOk("corpus_save", {
      ...patch,
      operation_id: "op_corpus_v3_clear_2",
      expected_revision: basePatch[`corpus/${clearableId}.json`],
      expected_index_revision: basePatch["corpus_index.json"],
    });
    expect(patched.committed).toBe(true);

    const lines = readRawCorpusLines(harness.workspaceDir, clearableId);
    const token = lines[0]?.tokens[0] as Record<string, unknown>;
    expect("linked_sense_id" in token).toBe(false);
    expect("status" in token).toBe(false);
    expect(token.gloss_labels).toBe("hearth");
    expect(lines[0]?.translation).toBe("hearth");

    // 再次写入 status: "verified" 后用空串 "" 同样可清空 status
    const reVerify = {
      ...patch,
      glossed_lines: [
        {
          line_id: "line_c1",
          original: "achama",
          tokens: [{ token_id: "tok_c1", surface_form: "achama", status: "verified" }],
        },
      ],
    };
    const dryRe = await callOk("corpus_save", { ...reVerify, dry_run: true });
    const baseRe = dryRe.base_revisions as Record<string, string>;
    await callOk("corpus_save", {
      ...reVerify,
      operation_id: "op_corpus_v3_clear_3",
      expected_revision: baseRe[`corpus/${clearableId}.json`],
      expected_index_revision: baseRe["corpus_index.json"],
    });
    const clearByEmpty = {
      ...patch,
      glossed_lines: [
        {
          line_id: "line_c1",
          original: "achama",
          tokens: [{ token_id: "tok_c1", surface_form: "achama", status: "" }],
        },
      ],
    };
    const dryEmpty = await callOk("corpus_save", { ...clearByEmpty, dry_run: true });
    const baseEmpty = dryEmpty.base_revisions as Record<string, string>;
    await callOk("corpus_save", {
      ...clearByEmpty,
      operation_id: "op_corpus_v3_clear_4",
      expected_revision: baseEmpty[`corpus/${clearableId}.json`],
      expected_index_revision: baseEmpty["corpus_index.json"],
    });
    const tokenAfterEmpty = readRawCorpusLines(harness.workspaceDir, clearableId)[0]?.tokens[0] as Record<string, unknown>;
    expect("status" in tokenAfterEmpty).toBe(false);
  });

  test("corpus_get strips null optional token fields written by legacy clients", async () => {
    const legacyId = "corp_v3_legacy_null";
    const abs = path.join(harness.workspaceDir, "stages/child/corpus", `${legacyId}.json`);
    fs.writeFileSync(
      abs,
      JSON.stringify(
        {
          corpus_id: legacyId,
          language_id: "lang_child",
          title: "Legacy Null",
          description: "",
          original_text: "achama",
          free_translation: "",
          metadata: { tags: [], created_at: "", updated_at: "" },
          glossed_lines: [
            {
              line_id: "line_n1",
              original: "achama",
              translation: "",
              tokens: [
                {
                  token_id: "tok_n1",
                  surface_form: "achama",
                  morpheme_break: "achama",
                  gloss_labels: "hearth",
                  linked_entry_id: "entry_child_achama",
                  linked_sense_id: null,
                  ipa: "",
                  status: null,
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const body = await callOk("corpus_get", {
      language: "lang_child",
      corpus_id: legacyId,
    });
    const corpus = body.corpus as {
      glossed_lines: Array<{ tokens: Array<Record<string, unknown>> }>;
    };
    const token = corpus.glossed_lines[0]?.tokens[0] as Record<string, unknown>;
    expect("linked_sense_id" in token).toBe(false);
    expect("status" in token).toBe(false);
    expect(token.gloss_labels).toBe("hearth");
  });

  test("readCorpusTextUnlocked rejects path-like or index corpus ids", () => {
    const childLanguage: LanguageEntry = {
      language_id: "lang_child",
      name: "Middle-Synth",
      path: "stages/child",
      parent_id: "lang_root",
    };
    for (const unsafeId of ["", "corpus_index", "corpus_index.json", "..", "../workspace", "a/b"]) {
      expect(() =>
        readCorpusTextUnlocked(harness.workspaceDir, childLanguage, unsafeId),
      ).toThrow();
    }
    expect(() =>
      readCorpusTextUnlocked(harness.workspaceDir, childLanguage, CORPUS_ID),
    ).not.toThrow();
  });

  test("corpus_concordance skips orphan index entries instead of failing", async () => {
    const indexPath = path.join(harness.workspaceDir, "stages/child/corpus/corpus_index.json");
    const entries = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<
      Record<string, unknown>
    >;
    fs.writeFileSync(
      indexPath,
      JSON.stringify(
        [
          ...entries,
          {
            corpus_id: "corp_orphan_missing",
            title: "Ghost",
            description: "",
            metadata: { tags: [], created_at: "", updated_at: "" },
          },
        ],
        null,
        2,
      ),
      "utf-8",
    );

    const body = await callOk("corpus_concordance", {
      language: "lang_child",
      entry_id: "entry_child_achama",
    });
    expect(body.language_id).toBe("lang_child");
    expect(typeof body.total).toBe("number");
    const matches = body.matches as Array<Record<string, unknown>>;
    expect(matches.length).toBeGreaterThan(0);
  });
});
