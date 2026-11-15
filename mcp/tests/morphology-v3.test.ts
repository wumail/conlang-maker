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

interface SeededEntry {
  entry_id: string;
  word: string;
  gloss: string;
  wordClassId?: string;
  senseClassId?: string;
}

const SEEDED_ENTRIES: SeededEntry[] = [
  { entry_id: "entry_morph_v1", word: "kala", gloss: "run", wordClassId: "class_v1" },
  {
    entry_id: "entry_morph_v2",
    word: "mila",
    gloss: "walk",
    wordClassId: "class_v1",
    senseClassId: "class_v2",
  },
  { entry_id: "entry_morph_plain", word: "nula", gloss: "fly" },
  { entry_id: "entry_morph_irr", word: "tiki", gloss: "dive" },
];

function seedLexicon(workspaceDir: string): void {
  const file = path.join(workspaceDir, "roots/root/lexicon/lexicon_a.ndjson");
  const lines = SEEDED_ENTRIES.map((entry) =>
    JSON.stringify({
      entry_id: entry.entry_id,
      language_id: "lang_root",
      con_word_romanized: entry.word,
      phonetic_ipa: "",
      phonetic_override: false,
      ...(entry.wordClassId ? { inflection_class_id: entry.wordClassId } : {}),
      senses: [
        {
          sense_id: `sense_${entry.entry_id}`,
          pos_id: "pos_verb",
          gloss: entry.gloss,
          definitions: [],
          examples: [],
          ...(entry.senseClassId ? { inflection_class_id: entry.senseClassId } : {}),
        },
      ],
      etymology: {
        origin_type: "a_priori",
        parent_entry_id: null,
        source_language_id: null,
        applied_sound_changes: [],
        semantic_shift_note: "",
      },
      metadata: { tags: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    }),
  );
  fs.appendFileSync(file, `\n${lines.join("\n")}\n`, "utf-8");
}

const GRAMMAR_PATCH = {
  inflection_dimensions: [
    {
      dim_id: "dim_tense",
      name: "Tense",
      applies_to_pos: ["pos_verb"],
      values: [
        { val_id: "val_pst", name: "Past", gloss: "PST" },
        { val_id: "val_prs", name: "Present", gloss: "PRS" },
      ],
    },
    {
      dim_id: "dim_pers",
      name: "Person",
      applies_to_pos: ["pos_verb"],
      values: [
        { val_id: "val_1", name: "First", gloss: "1" },
        { val_id: "val_2", name: "Second", gloss: "2" },
      ],
    },
    {
      dim_id: "dim_num",
      name: "Number",
      applies_to_pos: ["pos_noun"],
      values: [
        { val_id: "val_sg", name: "Singular", gloss: "SG" },
        { val_id: "val_pl", name: "Plural", gloss: "PL" },
      ],
    },
  ],
  inflection_rules: [
    {
      rule_id: "r_gen_pst",
      pos_id: "pos_verb",
      dimension_values: { dim_tense: "val_pst" },
      type: "suffix",
      affix: "an",
      tag: "PST",
      match_regex: ".*",
      disabled: false,
      condition: null,
    },
    {
      rule_id: "r_c1_pst",
      pos_id: "pos_verb",
      dimension_values: { dim_tense: "val_pst" },
      type: "suffix",
      affix: "ek",
      tag: "PST",
      match_regex: ".*",
      disabled: false,
      condition: null,
      conjugation_class_id: "class_v1",
    },
    {
      rule_id: "r_c2_pst",
      pos_id: "pos_verb",
      dimension_values: { dim_tense: "val_pst" },
      type: "suffix",
      affix: "or",
      tag: "PST",
      match_regex: ".*",
      disabled: false,
      condition: null,
      conjugation_class_id: "class_v2",
    },
    {
      rule_id: "r_fused_pst1",
      pos_id: "pos_verb",
      dimension_values: {},
      type: "suffix",
      affix: "inta",
      tag: "PST.1",
      match_regex: ".*",
      disabled: false,
      condition: null,
      fused_dimensions: [{ dim_tense: "val_pst", dim_pers: "val_1" }],
      priority: -1,
    },
    {
      rule_id: "r_conf_a",
      pos_id: "pos_noun",
      dimension_values: { dim_num: "val_pl" },
      type: "suffix",
      affix: "xa",
      tag: "PL",
      match_regex: ".*",
      disabled: false,
      condition: null,
    },
    {
      rule_id: "r_conf_b",
      pos_id: "pos_noun",
      dimension_values: { dim_num: "val_pl" },
      type: "suffix",
      affix: "xb",
      tag: "PL",
      match_regex: ".*",
      disabled: false,
      condition: null,
    },
  ],
  conjugation_classes: [
    {
      class_id: "class_v1",
      name: "First conjugation",
      applies_to_pos: "pos_verb",
      stem_pattern: "",
      rule_ids: ["r_c1_pst"],
    },
    {
      class_id: "class_v2",
      name: "Second conjugation",
      applies_to_pos: "pos_verb",
      stem_pattern: "",
      rule_ids: ["r_c2_pst"],
    },
  ],
  irregular_overrides: [
    {
      entry_id: "entry_morph_irr",
      dimension_values: { dim_tense: "val_pst" },
      surface_form: "toka",
    },
  ],
};

async function createHarness(): Promise<Harness> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-morph-v3-"));
  const workspaceDir = path.join(rootDir, "workspace-basic");
  fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });
  seedLexicon(workspaceDir);

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
  const client = new Client({ name: "morphology-v3-checker", version: "1.0.0" });
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

describe("Roadmap v3 Pillar 3 — unified morphology engine over MCP", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  test("gram_update commits the v3 grammar patch through the dry_run CAS flow", async () => {
    const dry = parseToolResult(
      await harness.client.callTool({
        name: "gram_update",
        arguments: {
          language_id: "lang_root",
          dry_run: true,
          ...GRAMMAR_PATCH,
        },
      }),
    );
    expect(dry.isError).toBe(false);
    expect(dry.body.dry_run).toBe(true);
    const baseRevisions = dry.body.base_revisions as Record<string, string>;
    expect(typeof baseRevisions["grammar.json"]).toBe("string");

    const commit = parseToolResult(
      await harness.client.callTool({
        name: "gram_update",
        arguments: {
          language_id: "lang_root",
          operation_id: "op-morph-v3-grammar-1",
          expected_revision: baseRevisions["grammar.json"],
          ...GRAMMAR_PATCH,
        },
      }),
    );
    expect(commit.isError).toBe(false);
    expect(commit.body.committed).toBe(true);
    expect(commit.body.changed).toBe(true);

    const stored = JSON.parse(
      fs.readFileSync(
        path.join(harness.workspaceDir, "roots/root/grammar.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    const rules = stored.inflection_rules as { rule_id: string; priority?: number }[];
    expect(rules.find((r) => r.rule_id === "r_fused_pst1")?.priority).toBe(-1);
    expect(rules.find((r) => r.rule_id === "r_gen_pst")?.priority).toBeUndefined();
  });

  test("gram_inflect resolves word-level conjugation classes without cross-talk", async () => {
    const res = parseToolResult(
      await harness.client.callTool({
        name: "gram_inflect",
        arguments: {
          language_id: "lang_root",
          entry_id: "entry_morph_v1",
          dimension_values: { dim_tense: "val_pst" },
        },
      }),
    );
    expect(res.isError).toBe(false);
    expect(res.body.result).toBe("kalaek");
    expect(res.body.surface_form).toBe("kalaek");
    expect(res.body.applied_rule_ids).toEqual(["r_c1_pst"]);
    expect(res.body.morpheme_break).toBe("kala+ek");
    expect(res.body.used_irregular).toBe(false);

    const diagnosis = res.body.diagnosis as {
      resolved_class_id: string | null;
      resolved_class_source: string;
      missing_obligatory_dimensions: string[];
    };
    expect(diagnosis.resolved_class_id).toBe("class_v1");
    expect(diagnosis.resolved_class_source).toBe("word");
    expect(diagnosis.missing_obligatory_dimensions).toEqual([]);

    const steps = res.body.steps as { stage: string; rule_id?: string }[];
    expect(steps.some((step) => step.stage === "class_select")).toBe(true);
    expect(steps.some((step) => step.stage === "affix" && step.rule_id === "r_c1_pst")).toBe(true);
    expect(steps.at(-1)?.stage).toBe("ipa");

    // 未指定变位类的词条走通用规则，绝不串用其他类的专属规则
    const plain = parseToolResult(
      await harness.client.callTool({
        name: "gram_inflect",
        arguments: {
          language_id: "lang_root",
          entry_id: "entry_morph_plain",
          dimension_values: { dim_tense: "val_pst" },
        },
      }),
    );
    expect(plain.isError).toBe(false);
    expect(plain.body.result).toBe("nulaan");
    expect(plain.body.applied_rule_ids).toEqual(["r_gen_pst"]);
  });

  test("gram_inflect honours sense-level inflection_class_id over the word level", async () => {
    const withSense = parseToolResult(
      await harness.client.callTool({
        name: "gram_inflect",
        arguments: {
          language_id: "lang_root",
          entry_id: "entry_morph_v2",
          sense_id: "sense_entry_morph_v2",
          dimension_values: { dim_tense: "val_pst" },
        },
      }),
    );
    expect(withSense.isError).toBe(false);
    expect(withSense.body.result).toBe("milaor");
    expect(withSense.body.applied_rule_ids).toEqual(["r_c2_pst"]);
    const diagnosis = withSense.body.diagnosis as {
      resolved_class_id: string | null;
      resolved_class_source: string;
    };
    expect(diagnosis.resolved_class_id).toBe("class_v2");
    expect(diagnosis.resolved_class_source).toBe("sense");

    const withoutSense = parseToolResult(
      await harness.client.callTool({
        name: "gram_inflect",
        arguments: {
          language_id: "lang_root",
          entry_id: "entry_morph_v2",
          dimension_values: { dim_tense: "val_pst" },
        },
      }),
    );
    expect(withoutSense.body.result).toBe("milaek");
  });

  test("gram_paradigm honours sense_id and stays identical to gram_inflect", async () => {
    const withSense = parseToolResult(
      await harness.client.callTool({
        name: "gram_paradigm",
        arguments: {
          language_id: "lang_root",
          entry_id: "entry_morph_v2",
          sense_id: "sense_entry_morph_v2",
        },
      }),
    );
    expect(withSense.isError).toBe(false);
    const cells = withSense.body.cells as {
      result: string;
      dimension_values: Record<string, string>;
    }[];
    expect(cells.length).toBeGreaterThan(0);
    // 义项级变位类（class_v2）必须贯穿整张范式表
    expect(cells.every((cell) => cell.result === "milaor")).toBe(true);

    const inflect = parseToolResult(
      await harness.client.callTool({
        name: "gram_inflect",
        arguments: {
          language_id: "lang_root",
          entry_id: "entry_morph_v2",
          sense_id: "sense_entry_morph_v2",
          dimension_values: { dim_tense: "val_pst" },
        },
      }),
    );
    const pstCell = cells.find((cell) => cell.dimension_values.dim_tense === "val_pst");
    expect(pstCell?.result).toBe(inflect.body.result as string);

    // 不传 sense_id → 退回词条级变位类（class_v1），与 gram_inflect 默认行为一致
    const wordLevel = parseToolResult(
      await harness.client.callTool({
        name: "gram_paradigm",
        arguments: { language_id: "lang_root", entry_id: "entry_morph_v2" },
      }),
    );
    const wordLevelCells = wordLevel.body.cells as { result: string }[];
    expect(wordLevelCells.every((cell) => cell.result === "milaek")).toBe(true);
  });

  test("gram_inflect matches fused_dimensions bundles with explicit priority", async () => {
    const res = parseToolResult(
      await harness.client.callTool({
        name: "gram_inflect",
        arguments: {
          language_id: "lang_root",
          word: "nula",
          pos_id: "pos_verb",
          dimension_values: { dim_tense: "val_pst", dim_pers: "val_1" },
        },
      }),
    );
    expect(res.isError).toBe(false);
    expect(res.body.result).toBe("nulainta");
    expect(res.body.applied_rule_ids).toEqual(["r_fused_pst1"]);
    expect(res.body.gloss_labels).toBe("1.PST");
    expect(res.body.morpheme_break).toBe("nula+inta");
  });

  test("gram_inflect reports tied-priority conflicts and picks the lexicographic winner", async () => {
    const res = parseToolResult(
      await harness.client.callTool({
        name: "gram_inflect",
        arguments: {
          language_id: "lang_root",
          word: "pata",
          pos_id: "pos_noun",
          dimension_values: { dim_num: "val_pl" },
        },
      }),
    );
    expect(res.isError).toBe(false);
    expect(res.body.result).toBe("pataxa");
    expect(res.body.applied_rule_ids).toEqual(["r_conf_a"]);

    const conflicts = res.body.conflicts as {
      dimension_key: string;
      candidate_rule_ids: string[];
      winner_rule_id: string;
    }[];
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].candidate_rule_ids).toEqual(["r_conf_a", "r_conf_b"]);
    expect(conflicts[0].winner_rule_id).toBe("r_conf_a");
  });

  test("gram_inflect prefers irregular overrides over every regular path", async () => {
    const res = parseToolResult(
      await harness.client.callTool({
        name: "gram_inflect",
        arguments: {
          language_id: "lang_root",
          entry_id: "entry_morph_irr",
          dimension_values: { dim_tense: "val_pst" },
        },
      }),
    );
    expect(res.isError).toBe(false);
    expect(res.body.result).toBe("toka");
    expect(res.body.used_irregular).toBe(true);
    expect(res.body.applied_rule_ids).toEqual([]);
    const steps = res.body.steps as { stage: string }[];
    expect(steps[0]?.stage).toBe("irregular");
  });

  test("sandbox_translate returns per-token inflection steps and class-aware forms", async () => {
    const res = parseToolResult(
      await harness.client.callTool({
        name: "sandbox_translate",
        arguments: {
          language_id: "lang_root",
          text: "run-PST walk-PST",
        },
      }),
    );
    expect(res.isError).toBe(false);
    expect(res.body.conlang_sentence).toBe("kalaek milaor");

    const tokens = res.body.tokens as {
      conlang: string;
      inflectionSteps?: { stage: string; label?: string }[];
      conflicts?: unknown[];
    }[];
    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.conlang).toBe("kalaek");
    expect(tokens[0]?.inflectionSteps?.some((step) => step.stage === "class_select")).toBe(true);
    expect(tokens[0]?.conflicts).toEqual([]);
    expect(
      tokens[1]?.inflectionSteps?.find((step) => step.stage === "class_select")?.label,
    ).toContain("class_v2 (sense)");
  });
});
