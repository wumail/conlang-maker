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

/** dry_run 预取 CAS 修订号（工具层要求提交时携带 expected_revision）。 */
async function gramRevision(
  client: Client,
  languageId: string,
  preview: Record<string, unknown>,
): Promise<string> {
  const dry = parseToolResult(
    await client.callTool({
      name: "gram_update",
      arguments: { language_id: languageId, dry_run: true, ...preview },
    }),
  );
  expect(dry.isError).toBe(false);
  const revisions = dry.body.base_revisions as Record<string, string>;
  expect(typeof revisions["grammar.json"]).toBe("string");
  return revisions["grammar.json"];
}

function readChildGrammar(workspaceDir: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, "stages/child/grammar.json"), "utf-8"),
  ) as Record<string, unknown>;
}

/** 为 weight_sensitive 重音提供确定性的回退路径（全轻音节 → penultimate）。 */
function seedStress(workspaceDir: string): void {
  const file = path.join(workspaceDir, "stages/child/phonology.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  const phonotactics = (raw.phonotactics ?? {}) as Record<string, unknown>;
  raw.phonotactics = {
    ...phonotactics,
    stress: { position: "weight_sensitive", domain: "word", weight_fallback: "penultimate" },
  };
  fs.writeFileSync(file, JSON.stringify(raw, null, 2), "utf-8");
}

async function createHarness(): Promise<Harness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-phrase-r2-"));
  const workspaceDir = path.join(rootDir, "workspace-basic");
  fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });
  seedStress(workspaceDir);

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
  const client = new Client({ name: "phrase-sandbox-r2-checker", version: "1.0.0" });
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

interface PhraseWordBody {
  gloss: string;
  role: string;
  tags: string[];
  path: string;
  caseTag: string | null;
}

describe("F4.3 + F2.4 — phrase sandbox round 2", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test("gram_update persists morphophonology_rules and gram_inflect applies them", async () => {
    const rules = [
      {
        rule_id: "mp_suffix_lenis",
        description: "suffix t → s after a vowel across the morpheme boundary",
        priority: 10,
        target: "t",
        replacement: "s",
        context_before: "V +",
        context_after: "",
        feature_mode: false,
        target_features: null,
        replacement_features: null,
        context_before_features: null,
        context_after_features: null,
      },
    ];

    const update = parseToolResult(
      await harness.client.callTool({
        name: "gram_update",
        arguments: {
          language_id: "lang_child",
          operation_id: "op-phrase-r2-mp-1",
          expected_revision: await gramRevision(harness.client, "lang_child", {
            morphophonology_rules: rules,
          }),
          morphophonology_rules: rules,
        },
      }),
    );
    expect(update.isError).toBe(false);

    const stored = readChildGrammar(harness.workspaceDir);
    const storedRules = stored.morphophonology_rules as {
      rule_id: string;
      target: string;
      replacement: string;
      priority: number;
      description: string;
    }[];
    expect(storedRules).toHaveLength(1);
    expect(storedRules[0]).toMatchObject({
      rule_id: "mp_suffix_lenis",
      target: "t",
      replacement: "s",
      priority: 10,
      description: "suffix t → s after a vowel across the morpheme boundary",
    });
    // 未知字段与既有段落必须保持原样
    expect(stored.x_unknown_child_grammar).toBeDefined();

    const inflect = parseToolResult(
      await harness.client.callTool({
        name: "gram_inflect",
        arguments: {
          language_id: "lang_child",
          word: "taka",
          pos_id: "pos_noun",
          rule_id: "infl_child_pl",
          dimension_values: { dim_num: "val_pl" },
        },
      }),
    );
    expect(inflect.isError).toBe(false);
    // 词干 "taka" + 词缀 "ta" → 跨边界 t → s；weight_sensitive 全轻音节回退 penultimate
    expect(inflect.body.result).toBe("takasa");
    expect(String(inflect.body.phonemic_ipa)).toContain("taˈkasa");
  });

  test("sandbox_translate honours NP number and clause polarity", async () => {
    const current = parseToolResult(
      await harness.client.callTool({
        name: "gram_get",
        arguments: { language_id: "lang_child" },
      }),
    );
    expect(current.isError).toBe(false);
    const config = current.body.config as {
      inflection_dimensions: unknown[];
      inflection_rules: unknown[];
    };

    const dimensions = [
      ...config.inflection_dimensions,
      {
        dim_id: "dim_case",
        name: "Case",
        applies_to_pos: ["pos_noun"],
        values: [
          { val_id: "val_nom", name: "Nominative", gloss: "NOM" },
          { val_id: "val_acc", name: "Accusative", gloss: "ACC" },
        ],
      },
      {
        dim_id: "dim_polarity",
        name: "Polarity",
        applies_to_pos: ["pos_verb"],
        values: [
          { val_id: "val_aff", name: "Affirmative", gloss: "AFF" },
          { val_id: "val_neg", name: "Negative", gloss: "NEG" },
        ],
      },
    ];
    const rules = [
      ...config.inflection_rules,
      {
        rule_id: "infl_child_neg",
        pos_id: "pos_verb",
        dimension_values: { dim_polarity: "val_neg" },
        type: "suffix",
        affix: "ul",
        tag: "NEG",
        match_regex: ".*",
        disabled: false,
        condition: null,
      },
    ];

    const update = parseToolResult(
      await harness.client.callTool({
        name: "gram_update",
        arguments: {
          language_id: "lang_child",
          operation_id: "op-phrase-r2-polarity-1",
          expected_revision: await gramRevision(harness.client, "lang_child", {
            inflection_dimensions: dimensions,
            inflection_rules: rules,
          }),
          inflection_dimensions: dimensions,
          inflection_rules: rules,
        },
      }),
    );
    expect(update.isError).toBe(false);

    const translated = parseToolResult(
      await harness.client.callTool({
        name: "sandbox_translate",
        arguments: {
          language_id: "lang_child",
          clause: {
            subject: { head: "dog", determiner: "the", number: "SG" },
            verb: { gloss: "bite", tam: ["PST"] },
            object: { head: "bone", number: "PL" },
            polarity: "negative",
          },
        },
      }),
    );
    expect(translated.isError).toBe(false);

    const phrase = translated.body.phrase as {
      alignment: string;
      head_marking: string;
      case_tags: Record<string, string | null>;
      words: PhraseWordBody[];
      steps: string[];
    };
    expect(phrase.alignment).toBe("nom_acc");
    expect(phrase.head_marking).toBe("dependent");
    expect(phrase.case_tags).toMatchObject({ A: "NOM", P: "ACC" });

    const subject = phrase.words.find((word) => word.path === "subject");
    expect(subject?.tags).toEqual(["NOM", "SG"]);
    expect(subject?.caseTag).toBe("NOM");

    const object = phrase.words.find((word) => word.path === "object");
    expect(object?.tags).toEqual(["ACC", "PL"]);

    const verb = phrase.words.find((word) => word.path === "verb");
    expect(verb?.tags).toEqual(["PST", "NEG"]);
    expect(phrase.steps.some((step) => step.includes("Negative polarity"))).toBe(true);
    // 标签化对齐行走 input_gloss（= phrase.glossLine）；gloss_sentence 是既有裸 gloss 契约
    expect(String(translated.body.input_gloss)).toContain("bite-PST-NEG");
  });

  test("gram_update accepts syntax alignment and case_gloss_map", async () => {
    const syntaxPatch = {
      alignment: "erg_abs",
      case_gloss_map: {
        nom: { dim_id: "dim_num", val_id: "val_sg" },
      },
    };
    const update = parseToolResult(
      await harness.client.callTool({
        name: "gram_update",
        arguments: {
          language_id: "lang_child",
          operation_id: "op-phrase-r2-syntax-1",
          expected_revision: await gramRevision(harness.client, "lang_child", {
            syntax: syntaxPatch,
          }),
          syntax: syntaxPatch,
        },
      }),
    );
    expect(update.isError).toBe(false);

    const stored = readChildGrammar(harness.workspaceDir);
    const syntax = stored.syntax as {
      alignment?: string;
      case_gloss_map?: Record<string, { dim_id: string; val_id: string }>;
      word_order?: string;
    };
    expect(syntax.alignment).toBe("erg_abs");
    expect(syntax.case_gloss_map?.nom).toEqual({ dim_id: "dim_num", val_id: "val_sg" });
    // 既有语序字段未被覆盖
    expect(typeof syntax.word_order).toBe("string");
  });
});
