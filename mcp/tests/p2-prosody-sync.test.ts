/**
 * P2 超音段贯通集成测试（InMemoryTransport）
 *
 * 覆盖三条链路：
 *   1. `phono_update` 能写入 weight_sensitive 重音（Zod schema 不再只接受 initial）
 *   2. `sca_simulate` 透传 prosodyContext，`+stressed` 特征规则随重音位置移动
 *   3. `lex_pull_sync` 透传父语言音系，词形演化结果受重音影响
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

/** a → ɑ / [+stressed]（叶子语言只有 a 一个元音） */
const LEAF_STRESS_RULESET = {
  ruleset_id: "rs_leaf_stress",
  name: "Stressed a backing",
  order: 1,
  rules: [
    {
      rule_id: "rule_leaf_stressed_a",
      description: "a > ɑ / [+stressed]",
      target: "",
      replacement: "",
      context_before: "",
      context_after: "",
      exceptions: [],
      feature_mode: true,
      target_features: { positive: ["vowel", "stressed"], negative: [] },
      replacement_features: { set_features: ["back"], remove_features: ["front"] },
      context_before_features: null,
      context_after_features: null,
    },
  ],
};

/** u → i / [+stressed]（子语言库存量同时含 u 与 i） */
const CHILD_STRESS_RULESET = {
  ruleset_id: "rs_child_stress",
  name: "Stressed u fronting",
  order: 1,
  rules: [
    {
      rule_id: "rule_child_stressed_u",
      description: "u > i / [+stressed]",
      target: "",
      replacement: "",
      context_before: "",
      context_after: "",
      exceptions: [],
      feature_mode: true,
      target_features: { positive: ["vowel", "stressed"], negative: [] },
      replacement_features: {
        set_features: ["front", "unrounded"],
        remove_features: ["back", "rounded"],
      },
      context_before_features: null,
      context_after_features: null,
    },
  ],
};

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function seedChildStressRule(workspaceDir: string): void {
  const file = path.join(workspaceDir, "stages/child/sca_rules.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  raw.rule_sets = [CHILD_STRESS_RULESET];
  writeJson(file, raw);
}

function seedParentWord(workspaceDir: string): void {
  const file = path.join(workspaceDir, "roots/root/lexicon/lexicon_p.ndjson");
  const existing = fs.readFileSync(file, "utf-8");
  const word = {
    entry_id: "entry_root_uku",
    language_id: "lang_root",
    con_word_romanized: "uku",
    phonetic_ipa: "/uku/",
    phonetic_override: false,
    senses: [
      {
        sense_id: "sense_entry_root_uku",
        pos_id: "pos_noun",
        gloss: "smoke",
        definitions: ["Synthetic smoke"],
        examples: [],
      },
    ],
    etymology: {
      origin_type: "a_priori",
      parent_entry_id: null,
      source_language_id: null,
      applied_sound_changes: [],
      semantic_shift_note: "",
    },
    metadata: {
      tags: ["element"],
      created_at: "2026-01-10T08:00:00Z",
      updated_at: "2026-01-15T12:00:00Z",
    },
  };
  const prefix = existing.endsWith("\n") || existing.length === 0 ? existing : `${existing}\n`;
  fs.writeFileSync(file, `${prefix}${JSON.stringify(word)}\n`, "utf-8");
}

async function createHarness(): Promise<Harness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-p2-prosody-"));
  const workspaceDir = path.join(rootDir, "workspace-basic");
  fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });
  seedChildStressRule(workspaceDir);
  seedParentWord(workspaceDir);

  const registryPath = path.join(rootDir, "registry.json");
  writeJson(registryPath, {
    registry_version: "1.0",
    families: [
      {
        name: "Synthetic-Family",
        conlang_file_path: path.join(workspaceDir, "workspace.conlang"),
        last_opened: 1700000000,
      },
    ],
    active_family_index: 0,
  });

  const config = parseConfig(
    [
      "--mode",
      "write",
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
  const client = new Client({ name: "p2-prosody-checker", version: "1.0.0" });
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

async function updateStress(
  harness: Harness,
  language: string,
  stress: Record<string, unknown>,
  operationId: string,
): Promise<Record<string, unknown>> {
  const dry = parseToolResult(
    await harness.client.callTool({
      name: "phono_update",
      arguments: { language, dry_run: true, phonotactics: { stress } },
    }),
  );
  expect(dry.isError).toBe(false);
  const revision = (dry.body.base_revisions as Record<string, string>)["phonology.json"];

  const commit = parseToolResult(
    await harness.client.callTool({
      name: "phono_update",
      arguments: {
        language,
        operation_id: operationId,
        expected_revision: revision,
        phonotactics: { stress },
      },
    }),
  );
  expect(commit.isError).toBe(false);
  return commit.body;
}

function readStress(workspaceDir: string, relPath: string): unknown {
  const file = path.join(workspaceDir, relPath, "phonology.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    phonotactics?: { stress?: unknown };
  };
  return raw.phonotactics?.stress ?? null;
}

async function simulate(
  harness: Harness,
  language: string,
  word: string,
  ruleSets: unknown[],
): Promise<string> {
  const res = parseToolResult(
    await harness.client.callTool({
      name: "sca_simulate",
      arguments: {
        language,
        words: [word],
        input_format: "raw",
        rule_sets: ruleSets,
        include_trace: true,
      },
    }),
  );
  expect(res.isError).toBe(false);
  const results = res.body.results as { input: string; output: string }[];
  expect(results).toHaveLength(1);
  return results[0]!.output;
}

describe("P2 prosody threading", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test("phono_update persists weight_sensitive stress with a fallback", async () => {
    await updateStress(
      harness,
      "lang_leaf",
      { position: "weight_sensitive", domain: "word", weight_fallback: "penultimate" },
      "op_prosody_leaf_ws",
    );

    expect(readStress(harness.workspaceDir, "branches/leaf")).toEqual({
      position: "weight_sensitive",
      domain: "word",
      weight_fallback: "penultimate",
    });
  });

  test("sca_simulate applies +stressed at the penultimate fallback", async () => {
    // "aka" 两个轻音节 → weight_fallback penultimate → 第一个 a 承载重音
    await expect(
      simulate(harness, "lang_leaf", "aka", [LEAF_STRESS_RULESET]),
    ).resolves.toBe("ɑka");
  });

  test("changing stress position moves the conditioned change", async () => {
    await updateStress(
      harness,
      "lang_leaf",
      { position: "ultimate", domain: "word" },
      "op_prosody_leaf_ult",
    );

    await expect(
      simulate(harness, "lang_leaf", "aka", [LEAF_STRESS_RULESET]),
    ).resolves.toBe("akɑ");
  });

  test("lex_pull_sync threads the parent stress context into evolution", async () => {
    // 拉取同步对父语言词形跑子语言音变，超音段环境取自父语言音系
    await updateStress(
      harness,
      "lang_root",
      { position: "weight_sensitive", domain: "word", weight_fallback: "penultimate" },
      "op_prosody_root_ws",
    );

    const dry = parseToolResult(
      await harness.client.callTool({
        name: "lex_pull_sync",
        arguments: {
          language: "lang_child",
          entry_ids: ["entry_root_uku"],
          dry_run: true,
        },
      }),
    );
    expect(dry.isError).toBe(false);
    const revisions = dry.body.base_revisions as Record<string, string>;
    const revision = revisions.lexicon ?? revisions.child_lexicon;

    const commit = parseToolResult(
      await harness.client.callTool({
        name: "lex_pull_sync",
        arguments: {
          language: "lang_child",
          entry_ids: ["entry_root_uku"],
          operation_id: "op_prosody_pull_sync",
          expected_revision: revision,
        },
      }),
    );
    expect(commit.isError).toBe(false);
    expect(commit.body.committed).toBe(true);

    const childBatches = fs
      .readdirSync(path.join(harness.workspaceDir, "stages/child/lexicon"))
      .filter((name) => name.endsWith(".ndjson"));
    const evolved = childBatches
      .flatMap((name) =>
        fs
          .readFileSync(path.join(harness.workspaceDir, "stages/child/lexicon", name), "utf-8")
          .split("\n")
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line) as { entry_id: string; con_word_romanized: string }];
            } catch (err) {
              // fixture 的 lexicon_s.ndjson 尾行故意埋了损坏行，读取层会跳过；此处同样跳过
              console.warn("skip unparsable lexicon line:", (err as Error).message);
              return [];
            }
          }),
      )
      .find((word) => word.entry_id === "entry_root_uku");
    // uku：penultimate 重音落在首音节 → u → i
    expect(evolved?.con_word_romanized).toBe("iku");
  });
});
