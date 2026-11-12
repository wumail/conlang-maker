import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const FIXTURE_WORKSPACE = path.join(REPO_ROOT, "tests/fixtures/workspace-basic");
const LIGA_FONT_PATH = path.join(REPO_ROOT, "tests/fixtures/fonts/liga-test.ttf");
const NO_NAMES_FONT_PATH = path.join(REPO_ROOT, "tests/fixtures/fonts/no-names-test.ttf");
const MCP_MAIN_PATH = path.join(REPO_ROOT, "mcp/main.ts");

interface TempTestEnv {
  rootDir: string;
  workspaceDir: string;
  conlangPath: string;
  registryPath: string;
  cleanup: () => void;
}

function createTempWorkspaceEnv(): TempTestEnv {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-mcp-e2e-"));
  const workspaceDir = path.join(rootDir, "workspace-basic");
  fs.cpSync(FIXTURE_WORKSPACE, workspaceDir, { recursive: true });

  const conlangPath = path.join(workspaceDir, "workspace.conlang");
  const registryPath = path.join(rootDir, "registry.json");
  const registry = {
    registry_version: "1.0",
    families: [
      {
        name: "Synthetic-Family",
        conlang_file_path: conlangPath,
        last_opened: 1700000000,
      },
    ],
    active_family_index: 0,
  };
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf-8");

  return {
    rootDir,
    workspaceDir,
    conlangPath,
    registryPath,
    cleanup: () => {
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

async function withStdioMcpClient<T>(
  env: TempTestEnv,
  mode: "read-only" | "write" | "write+destructive",
  fn: (helpers: {
    client: Client;
    callOk: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    callErr: (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ code: string; message: string; details?: Record<string, unknown> }>;
  }) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      MCP_MAIN_PATH,
      "--mode",
      mode,
      "--toolsets",
      "all",
      "--registry",
      env.registryPath,
      "--allow-root",
      env.rootDir,
      "--allow-root",
      path.join(REPO_ROOT, "tests/fixtures/fonts"),
    ],
    cwd: REPO_ROOT,
    stderr: "pipe",
  });

  const client = new Client({ name: "mcp-e2e-suite", version: "1.0.0" });
  await client.connect(transport);

  const callOk = async (
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const res = await client.callTool({ name, arguments: args });
    const first = Array.isArray(res.content) ? res.content[0] : undefined;
    const text =
      first && typeof first === "object" && "text" in first && typeof first.text === "string"
        ? first.text
        : "{}";
    if (res.isError) {
      throw new Error(`Expected ${name} to succeed, got error: ${text}`);
    }
    return JSON.parse(text) as Record<string, unknown>;
  };

  const callErr = async (
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ code: string; message: string; details?: Record<string, unknown> }> => {
    const res = await client.callTool({ name, arguments: args });
    const first = Array.isArray(res.content) ? res.content[0] : undefined;
    const text =
      first && typeof first === "object" && "text" in first && typeof first.text === "string"
        ? first.text
        : "{}";
    expect(res.isError).toBe(true);
    return JSON.parse(text) as {
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };
  };

  try {
    return await fn({ client, callOk, callErr });
  } finally {
    await client.close();
  }
}

describe("MCP End-to-End Stdio Integration Suite (All Tool Domains, Resources & Prompts)", () => {
  test(
    "1. read-only mode: read/compute/audit/export tools, 10 resources, 4 prompts, and READ_ONLY gate",
    async () => {
      const env = createTempWorkspaceEnv();
      try {
        await withStdioMcpClient(env, "read-only", async ({ client, callOk, callErr }) => {
          // System & Family
          const info = await callOk("server_info");
          expect(info.mode).toBe("read-only");
          expect(typeof info.version).toBe("string");

          const famList = await callOk("family_list");
          const families = famList.families as Array<Record<string, unknown>>;
          expect(families.length).toBe(1);
          const familyId = families[0].family_id as string;
          expect(/^[0-9a-f]{8}$/.test(familyId)).toBe(true);

          const tree = await callOk("family_get_tree", { include_word_counts: true });
          expect(Array.isArray(tree.languages)).toBe(true);
          expect((tree.languages as unknown[]).length).toBe(4);

          // Phonology & Romanization
          const phonoRoot = await callOk("phono_get", { language: "lang_root" });
          expect(phonoRoot.language_id).toBe("lang_root");
          expect(typeof phonoRoot.revision).toBe("string");

          const romGet = await callOk("romanization_get", { language: "lang_root" });
          expect(Array.isArray(romGet.romanization_maps)).toBe(true);

          const romAnalyze = await callOk("romanization_analyze", { language: "lang_root" });
          expect(romAnalyze.summary).toBeDefined();

          const toIpa = await callOk("phono_to_ipa", {
            language: "lang_root",
            texts: ["pata", "shata"],
            include_trace: true,
          });
          const ipaItems = toIpa.results as Array<Record<string, unknown>>;
          expect(ipaItems.length).toBe(2);
          const firstTrace = ipaItems[0].trace as Record<string, unknown>;
          expect(Array.isArray(firstTrace.segments)).toBe(true);

          const tok = await callOk("phono_tokenize", {
            language: "lang_root",
            text: "shata",
            input_mode: "romanized",
          });
          expect(tok.results).toBeDefined();

          const presets = await callOk("phono_presets_list");
          expect(Array.isArray(presets.presets)).toBe(true);
          expect((presets.presets as unknown[]).length).toBeGreaterThan(0);

          // Fonts & Coverage Audit
          const fontList = await callOk("font_list");
          const fontEntries = fontList.languages as Array<Record<string, unknown>>;
          expect(fontEntries.length).toBe(4);
          const childFontStatus = fontEntries.find((e) => e.language_id === "lang_child");
          expect(childFontStatus?.status).toBe("inherited");
          const otherFontStatus = fontEntries.find((e) => e.language_id === "lang_other");
          expect(otherFontStatus?.status).toBe("none");

          const fontInspect = await callOk("font_inspect", { language: "lang_root" });
          expect(typeof fontInspect.glyph_count).toBe("number");

          const noNamesInspect = await callOk("font_inspect", {
            font_path: NO_NAMES_FONT_PATH,
          });
          expect(noNamesInspect.glyph_names_reliable).toBe(false);

          const shaped = await callOk("font_shape", {
            font_path: LIGA_FONT_PATH,
            texts: ["ch", "pa"],
          });
          expect(Array.isArray(shaped.results)).toBe(true);

          const noFontErr = await callErr("font_audit_coverage", {
            language: "lang_other",
          });
          expect(noFontErr.code).toBe("NO_FONT");

          const covRoot = await callOk("font_audit_coverage", {
            language: "lang_root",
            residual_glyph_pattern: "^roman\\.",
          });
          expect(
            (covRoot.language as Record<string, unknown>).language_id,
          ).toBe("lang_root");
          expect(covRoot.summary).toBeDefined();

          const covNoNames = await callOk("font_audit_coverage", {
            language: "lang_root",
            font_path: NO_NAMES_FONT_PATH,
            residual_glyph_pattern: "^roman\\.",
          });
          expect(Array.isArray(covNoNames.checks_not_evaluated)).toBe(true);
          expect(
            (
              covNoNames.checks_not_evaluated as Array<Record<string, unknown>>
            ).some((item) => String(item.check ?? "").includes("residual")),
          ).toBe(true);

          const famAudit = await callOk("font_audit_family");
          expect(Array.isArray(famAudit.per_language)).toBe(true);
          expect(famAudit.by_font).toBeDefined();

          // Lexicon, Wordgen, Grammar, Sandbox, SCA, Corpus, Snapshots, Exports
          const lexPage1 = await callOk("lex_search", {
            language: "lang_root",
            limit: 1,
            fields: ["entry_id", "con_word_romanized"],
          });
          const page1Items = lexPage1.items as Array<Record<string, unknown>>;
          expect(page1Items.length).toBe(1);
          expect(Object.keys(page1Items[0]).sort()).toEqual([
            "con_word_romanized",
            "entry_id",
          ]);
          if (typeof lexPage1.next_cursor === "string") {
            const lexPage2 = await callOk("lex_search", {
              language: "lang_root",
              limit: 1,
              cursor: lexPage1.next_cursor,
            });
            expect((lexPage2.items as unknown[]).length).toBe(1);
          }

          const ipaFuzzy = await callOk("lex_search", {
            language: "lang_root",
            mode: "ipa_fuzzy",
            ipa_query: "pata",
            ipa_threshold: 0.4,
          });
          expect((ipaFuzzy.items as unknown[]).length).toBeGreaterThan(0);

          const lexGet = await callOk("lex_get", {
            language: "lang_root",
            entry_ids: ["entry_root_pata"],
          });
          expect((lexGet.items as unknown[]).length).toBe(1);

          const lexStats = await callOk("lex_stats", { language: "lang_root" });
          expect(typeof lexStats.total_entries_in_lexicon).toBe("number");

          const qc = await callOk("lex_quality_check", { language: "lang_root" });
          expect(qc.summary).toBeDefined();

          const wg = await callOk("wordgen_generate", {
            language: "lang_root",
            count: 5,
            seed: 42,
          });
          expect(Array.isArray(wg.candidates ?? wg.words)).toBe(true);

          const swadesh = await callOk("wordgen_swadesh_gaps", {
            language: "lang_root",
          });
          expect(typeof swadesh.covered_count).toBe("number");

          const gram = await callOk("gram_get", { language: "lang_root" });
          expect(gram.language_id).toBe("lang_root");

          const inflected = await callOk("gram_inflect", {
            language: "lang_root",
            word: "pata",
            pos_id: "pos_noun",
            dimension_values: { dim_num: "val_pl" },
          });
          expect(inflected).toBeDefined();

          const paradigm = await callOk("gram_paradigm", {
            language: "lang_root",
            word: "pata",
            pos_id: "pos_noun",
          });
          expect(paradigm).toBeDefined();

          const derived = await callOk("gram_derive", {
            language: "lang_root",
            rule_id: "deriv_root_n2v",
            entry_ids: ["entry_root_pata"],
          });
          expect(derived).toBeDefined();

          const typo = await callOk("gram_analyze_typology", {
            language: "lang_root",
          });
          expect(typo).toBeDefined();

          const translated = await callOk("sandbox_translate", {
            language: "lang_root",
            text: "hand see",
          });
          expect(translated).toBeDefined();

          const scaGet = await callOk("sca_get", { language: "lang_child" });
          expect(scaGet.language_id).toBe("lang_child");

          const scaParsed = await callOk("sca_parse_rules_text", {
            text: "p > b / V _ V",
          });
          expect(Array.isArray(scaParsed.rules)).toBe(true);

          const scaSim = await callOk("sca_simulate", {
            language: "lang_root",
            words: ["apa"],
            input_format: "ipa",
            rules_text: "p > b / a _ a",
            include_trace: true,
          });
          expect(scaSim.results).toBeDefined();

          const rawSca = await callOk("sca_simulate", {
            language: "lang_root",
            words: ["xa"],
            input_format: "raw",
            rules_text: "x > s",
          });
          expect(rawSca.input_format).toBe("raw");
          const rawScaRows = rawSca.results as Array<{ input: string; output: string }>;
          expect(rawScaRows[0].input).toBe("xa");
          expect(rawScaRows[0].output).toBe("sa");

          const phonemicSca = await callOk("sca_simulate", {
            language: "lang_root",
            words: ["xa"],
            input_format: "romanized",
            rules_text: "x > s",
          });
          const phonemicScaRows = phonemicSca.results as Array<{ input: string; output: string }>;
          expect(phonemicScaRows[0].input).toBe("/ʃa/");
          expect(phonemicScaRows[0].output).toBe("/ʃa/");

          const rawParentSca = await callOk("sca_simulate", {
            language: "lang_child",
            source: "parent_lexicon",
            input_format: "raw",
          });
          for (const row of rawParentSca.results as Array<{ input: string; romanized: string }>) {
            expect(row.input).toBe(row.romanized);
          }

          const inlineRawSca = await callOk("sca_simulate", {
            words: ["/xa/"],
            input_format: "raw",
            rules_text: "x > s",
          });
          const inlineRawScaRows = inlineRawSca.results as Array<{ input: string; output: string }>;
          expect(inlineRawScaRows[0].input).toBe("/xa/");
          expect(inlineRawScaRows[0].output).toBe("/sa/");

          const scaFeat = await callOk("sca_feature_query", { phoneme: "p" });
          expect(scaFeat).toBeDefined();

          const scaExp = await callOk("sca_export_rules_text", {
            language: "lang_child",
          });
          expect(typeof scaExp.text).toBe("string");

          const corpList = await callOk("corpus_list", { language: "lang_leaf" });
          expect((corpList.items as unknown[]).length).toBeGreaterThanOrEqual(1);

          const corpGet = await callOk("corpus_get", {
            language: "lang_leaf",
            corpus_id: "corp_leaf_1",
          });
          expect(corpGet.corpus).toBeDefined();

          const snaps = await callOk("snapshot_list");
          expect(Array.isArray(snaps.snapshots)).toBe(true);

          const trashList = await callOk("language_trash_list");
          expect(Array.isArray(trashList.items)).toBe(true);

          const brief = await callOk("export_llm_brief", {
            language: "lang_root",
            include_sca: true,
            include_corpus: true,
            include_family: true,
          });
          expect(typeof brief.markdown).toBe("string");

          const csvExp = await callOk("export_csv", { language: "lang_root" });
          expect(typeof csvExp.csv).toBe("string");
          expect((csvExp.csv as string).includes("entry_root_pata")).toBe(true);

          const dicExp = await callOk("export_dic", { language: "lang_root" });
          expect(typeof dicExp.dic).toBe("string");
          expect(typeof dicExp.aff).toBe("string");

          const bundleExp = await callOk("export_workspace_bundle", {
            include_inline_bundle: true,
          });
          expect(bundleExp.bundle_version).toBe(2);
          expect(bundleExp.language_count).toBe(4);

          // Read all 10 conlang:// resources
          for (const uri of [
            "conlang://families",
            `conlang://${familyId}/tree`,
            `conlang://${familyId}/lang_root/brief`,
            `conlang://${familyId}/lang_root/phonology`,
            `conlang://${familyId}/lang_root/romanization`,
            `conlang://${familyId}/lang_root/grammar`,
            `conlang://${familyId}/lang_child/sca`,
            `conlang://${familyId}/lang_root/font`,
            `conlang://${familyId}/lang_root/lexicon/entry_root_pata`,
            `conlang://${familyId}/lang_leaf/corpus/corp_leaf_1`,
          ]) {
            const r = await client.readResource({ uri });
            expect(r.contents.length).toBeGreaterThan(0);
          }

          // Read all 4 prompts
          const p1 = await client.getPrompt({
            name: "audit_font_coverage",
            arguments: { language: "lang_root" },
          });
          expect(p1.messages.length).toBeGreaterThan(0);
          const p2 = await client.getPrompt({
            name: "review_romanization",
            arguments: { language: "lang_root" },
          });
          expect(p2.messages.length).toBeGreaterThan(0);
          const p3 = await client.getPrompt({
            name: "design_sound_changes",
            arguments: { parent: "lang_root", child: "lang_child" },
          });
          expect(p3.messages.length).toBeGreaterThan(0);
          const p4 = await client.getPrompt({
            name: "lexicon_cleanup",
            arguments: { language: "lang_root" },
          });
          expect(p4.messages.length).toBeGreaterThan(0);

          // READ_ONLY enforcement
          const roErr = await callErr("lex_upsert", {
            language: "lang_root",
            dry_run: true,
            entries: [
              {
                con_word_romanized: "paka",
                senses: [{ pos_id: "pos_noun", gloss: "rock" }],
              },
            ],
          });
          expect(roErr.code).toBe("READ_ONLY");
        });
      } finally {
        env.cleanup();
      }
    },
    30000,
  );

  test(
    "2. write mode allows dry_run preview but enforces DESTRUCTIVE_DISABLED on commit",
    async () => {
      const env = createTempWorkspaceEnv();
      try {
        await withStdioMcpClient(env, "write", async ({ callOk, callErr }) => {
          const preview = await callOk("language_delete", {
            language: "lang_leaf",
            dry_run: true,
          });
          expect(preview.dry_run).toBe(true);

          const delErr = await callErr("language_delete", {
            language: "lang_leaf",
            confirm: true,
            operation_id: "op_blocked_lang_del",
            expected_revision: (preview.base_revisions as Record<string, string>).workspace,
          });
          expect(delErr.code).toBe("DESTRUCTIVE_DISABLED");

          const corpDelErr = await callErr("corpus_delete", {
            language: "lang_leaf",
            corpus_id: "corp_leaf_1",
            confirm: true,
            operation_id: "op_blocked_corp_del",
            expected_revision: "missing",
          });
          expect(corpDelErr.code).toBe("DESTRUCTIVE_DISABLED");
        });
      } finally {
        env.cleanup();
      }
    },
    15000,
  );

  test(
    "3. write+destructive mode: full write, legacy archive, snapshots, bundle import, trash/restore & unknown-field preservation",
    async () => {
      const env = createTempWorkspaceEnv();
      try {
        await withStdioMcpClient(
          env,
          "write+destructive",
          async ({ callOk, callErr }) => {
            // Capture cursor BEFORE lexicon mutation to test cursor CONFLICT after write
            const initialSearch = await callOk("lex_search", {
              language: "lang_root",
              limit: 1,
            });
            const staleCursor = initialSearch.next_cursor as string | undefined;

            // Validation rejects empty gloss
            const emptyGlossErr = await callErr("lex_upsert", {
              language: "lang_root",
              dry_run: true,
              entries: [
                {
                  con_word_romanized: "paka",
                  senses: [{ pos_id: "pos_noun", gloss: "   " }],
                },
              ],
            });
            expect(emptyGlossErr.code).toBe("VALIDATION");

            // Dry-run -> commit lex_upsert in lexicon_p.ndjson (alongside entry_root_pata with x_unknown_word_sentinel)
            const lexDry = await callOk("lex_upsert", {
              language: "lang_root",
              dry_run: true,
              entries: [
                {
                  entry_id: "entry_root_paka_new",
                  con_word_romanized: "paka",
                  senses: [
                    {
                      pos_id: "pos_noun",
                      gloss: "stone",
                      definitions: ["Hard stone"],
                    },
                  ],
                },
              ],
            });
            const lexBaseRevs = lexDry.base_revisions as Record<string, string>;
            const lexCommit = await callOk("lex_upsert", {
              language: "lang_root",
              operation_id: "op_lex_upsert_1",
              expected_revision: lexBaseRevs.lexicon,
              entries: [
                {
                  entry_id: "entry_root_paka_new",
                  con_word_romanized: "paka",
                  senses: [
                    {
                      pos_id: "pos_noun",
                      gloss: "stone",
                      definitions: ["Hard stone"],
                    },
                  ],
                },
              ],
            });
            expect(lexCommit.committed).toBe(true);

            // Sibling unknown field must remain intact on disk!
            const pBucketRaw = fs.readFileSync(
              path.join(env.workspaceDir, "roots/root/lexicon/lexicon_p.ndjson"),
              "utf-8",
            );
            expect(pBucketRaw.includes('"x_unknown_word_sentinel"')).toBe(true);

            // Stale cursor now fails with CONFLICT
            if (staleCursor) {
              const cursorErr = await callErr("lex_search", {
                language: "lang_root",
                limit: 1,
                cursor: staleCursor,
              });
              expect(cursorErr.code).toBe("CONFLICT");
            }

            // lex_regenerate_ipa & lex_delete (missing confirm -> VALIDATION, then confirm: true)
            const regenDry = await callOk("lex_regenerate_ipa", {
              language: "lang_root",
              dry_run: true,
            });
            const regenRevs = regenDry.base_revisions as Record<string, string>;
            await callOk("lex_regenerate_ipa", {
              language: "lang_root",
              operation_id: "op_lex_regen_1",
              expected_revision: regenRevs.lexicon,
              expected_phonology_revision: regenRevs["phonology.json"],
            });

            const missingConfirmErr = await callErr("lex_delete", {
              language: "lang_root",
              operation_id: "op_lex_del_bad",
              entry_ids: ["entry_root_paka_new"],
            });
            expect(missingConfirmErr.code).toBe("VALIDATION");

            const lexDelDry = await callOk("lex_delete", {
              language: "lang_root",
              dry_run: true,
              confirm: true,
              entry_ids: ["entry_root_paka_new"],
            });
            await callOk("lex_delete", {
              language: "lang_root",
              operation_id: "op_lex_del_1",
              expected_revision: (lexDelDry.base_revisions as Record<string, string>).lexicon,
              confirm: true,
              entry_ids: ["entry_root_paka_new"],
            });

            // phono_update on lang_child: archives legacy writing fields while keeping font status 'inherited'
            const phonoDry = await callOk("phono_update", {
              language: "lang_child",
              dry_run: true,
              phonotactics: { syllable_structure: "CVC" },
              font_features: ["ss01=1"],
              font_input: { phonemes: { "ʃ": "a" }, vowels: [], multigraphs: [], separator: "·" },
            });
            const phonoRev = (phonoDry.base_revisions as Record<string, string>)[
              "phonology.json"
            ];
            const phonoCommit = await callOk("phono_update", {
              language: "lang_child",
              operation_id: "op_phono_child_1",
              expected_revision: phonoRev,
              phonotactics: { syllable_structure: "CVC" },
              font_features: ["ss01=1"],
              font_input: { phonemes: { "ʃ": "a" }, vowels: [], multigraphs: [], separator: "·" },
            });
            expect(phonoCommit.committed).toBe(true);
            const languageShape = await callOk("font_shape", {
              language: "lang_child", text: "sh", input_mode: "language",
            });
            const languageRows = languageShape.results as Array<{ original_input: string; font_input: string; has_notdef: boolean }>;
            expect(languageRows[0].original_input).toBe("sh");
            expect(languageRows[0].font_input).toBe("a");
            expect(languageRows[0].has_notdef).toBe(false);
            expect((languageShape.layout as Record<string, unknown>).features_source).toBe("language_config");
            const fontSettings = await callOk("phono_get", { language: "lang_child", sections: ["font"] });
            expect((fontSettings.local_config as Record<string, unknown>).font_features).toEqual(["ss01=1"]);
            const legacyDir = path.join(
              env.workspaceDir,
              "stages/child/.conlang-maker/legacy",
            );
            expect(fs.existsSync(legacyDir)).toBe(true);
            expect(fs.readdirSync(legacyDir).length).toBeGreaterThanOrEqual(1);

            const fontListAfterPhono = await callOk("font_list");
            const childFontAfter = (
              fontListAfterPhono.languages as Array<Record<string, unknown>>
            ).find((l) => l.language_id === "lang_child");
            expect(childFontAfter?.status).toBe("inherited");

            // romanization_upsert_rules & romanization_delete_rules & romanization_map_upsert & phono_apply_preset
            const romUpDry = await callOk("romanization_upsert_rules", {
              language: "lang_other",
              dry_run: true,
              rules: [
                {
                  rule_id: "r_other_z",
                  input: "z",
                  output_phoneme: "s",
                },
              ],
            });
            const romUpCommit = await callOk("romanization_upsert_rules", {
              language: "lang_other",
              operation_id: "op_rom_up_1",
              expected_revision: (romUpDry.base_revisions as Record<string, string>)[
                "phonology.json"
              ],
              rules: [
                {
                  rule_id: "r_other_z",
                  input: "z",
                  output_phoneme: "s",
                },
              ],
            });
            expect(romUpCommit.committed).toBe(true);

            await callOk("romanization_delete_rules", {
              language: "lang_other",
              operation_id: "op_rom_del_1",
              expected_revision: romUpCommit.revision,
              rule_ids: ["r_other_z"],
            });

            const mapDry = await callOk("romanization_map_upsert", {
              language: "lang_other",
              dry_run: true,
              map_id: "map_alt",
              name: "Alt Orthography",
              is_default: false,
            });
            const mapCommit = await callOk("romanization_map_upsert", {
              language: "lang_other",
              operation_id: "op_map_up_1",
              expected_revision: (mapDry.base_revisions as Record<string, string>)[
                "phonology.json"
              ],
              map_id: "map_alt",
              name: "Alt Orthography",
              is_default: false,
            });
            expect(mapCommit.committed).toBe(true);

            const presets = await callOk("phono_presets_list");
            const firstPresetId = (presets.presets as Array<Record<string, unknown>>)[0]
              .id as string;
            await callOk("phono_apply_preset", {
              language: "lang_other",
              operation_id: "op_preset_1",
              expected_revision: mapCommit.revision,
              preset_id: firstPresetId,
              merge_mode: "union",
            });

            // glyph_annotations_upsert / delete / sync_parent + font_import / font_import_batch / font_clear
            const gaDry = await callOk("glyph_annotations_upsert", {
              language: "lang_root",
              dry_run: true,
              annotations: [{ codepoint: 0x0070, label: "glyph_p" }],
            });
            const gaCommit = await callOk("glyph_annotations_upsert", {
              language: "lang_root",
              operation_id: "op_ga_up_1",
              expected_revision: (gaDry.base_revisions as Record<string, string>)[
                "phonology.json"
              ],
              annotations: [{ codepoint: 0x0070, label: "glyph_p" }],
            });
            expect(gaCommit.committed).toBe(true);

            const syncDry = await callOk("glyph_annotations_sync_parent", {
              language: "lang_child",
              dry_run: true,
            });
            await callOk("glyph_annotations_sync_parent", {
              language: "lang_child",
              operation_id: "op_ga_sync_1",
              expected_revision: (syncDry.base_revisions as Record<string, string>)[
                "phonology.json"
              ],
            });

            await callOk("glyph_annotations_delete", {
              language: "lang_root",
              operation_id: "op_ga_del_1",
              expected_revision: gaCommit.revision,
              codepoints: [0x0070],
            });

            const fiDry = await callOk("font_import", {
              language: "lang_other",
              source_path: LIGA_FONT_PATH,
              dry_run: true,
            });
            const fiCommit = await callOk("font_import", {
              language: "lang_other",
              source_path: LIGA_FONT_PATH,
              operation_id: "op_font_imp_1",
              expected_revision: (fiDry.base_revisions as Record<string, string>).font,
            });
            expect(fiCommit.committed).toBe(true);

            const fibDry = await callOk("font_import_batch", {
              dry_run: true,
              imports: [{ language: "lang_child", source_path: LIGA_FONT_PATH }],
            });
            await callOk("font_import_batch", {
              operation_id: "op_font_batch_1",
              expected_revisions: fibDry.base_revisions,
              imports: [{ language: "lang_child", source_path: LIGA_FONT_PATH }],
            });

            await callOk("font_clear", {
              language: "lang_other",
              operation_id: "op_font_clear_1",
              expected_revision: fiCommit.revision,
              confirm: true,
            });

            // gram_update & sca_update
            const gramDry = await callOk("gram_update", {
              language: "lang_other",
              dry_run: true,
              syntax: { word_order: "VSO" },
            });
            await callOk("gram_update", {
              language: "lang_other",
              operation_id: "op_gram_1",
              expected_revision: (gramDry.base_revisions as Record<string, string>)[
                "grammar.json"
              ],
              syntax: { word_order: "VSO" },
            });

            const scaDry = await callOk("sca_update", {
              language: "lang_other",
              dry_run: true,
              from_text: { text: "p > b / a _ a", ruleset_name: "Lenition" },
            });
            await callOk("sca_update", {
              language: "lang_other",
              operation_id: "op_sca_1",
              expected_revision: (scaDry.base_revisions as Record<string, string>)[
                "sca_rules.json"
              ],
              from_text: { text: "p > b / a _ a", ruleset_name: "Lenition" },
            });

            // corpus_save -> corpus_auto_gloss -> corpus_delete
            const corpDry = await callOk("corpus_save", {
              language: "lang_root",
              dry_run: true,
              corpus_id: "corp_root_new",
              title: "Dawn",
              original_text: "pata pita",
              free_translation: "Hand sees.",
            });
            const corpBase = corpDry.base_revisions as Record<string, string>;
            const corpSaved = await callOk("corpus_save", {
              language: "lang_root",
              operation_id: "op_corp_save_1",
              expected_revision: corpBase["corpus/corp_root_new.json"],
              expected_index_revision: corpBase["corpus_index.json"],
              corpus_id: "corp_root_new",
              title: "Dawn",
              original_text: "pata pita",
              free_translation: "Hand sees.",
            });
            expect(corpSaved.committed).toBe(true);

            const agDry = await callOk("corpus_auto_gloss", {
              language: "lang_root",
              corpus_id: "corp_root_new",
              apply: true,
              dry_run: true,
            });
            const agBase = agDry.base_revisions as Record<string, string>;
            await callOk("corpus_auto_gloss", {
              language: "lang_root",
              operation_id: "op_corp_ag_1",
              corpus_id: "corp_root_new",
              apply: true,
              expected_revision: agBase["corpus/corp_root_new.json"],
              expected_index_revision: agBase["corpus_index.json"],
            });

            const cdDry = await callOk("corpus_delete", {
              language: "lang_root",
              corpus_id: "corp_root_new",
              confirm: true,
              dry_run: true,
            });
            const cdBase = cdDry.base_revisions as Record<string, string>;
            await callOk("corpus_delete", {
              language: "lang_root",
              operation_id: "op_corp_del_1",
              corpus_id: "corp_root_new",
              confirm: true,
              expected_revision: cdBase["corpus/corp_root_new.json"],
              expected_index_revision: cdBase["corpus_index.json"],
            });

            // lex_parent_diff, lex_pull_sync, lex_borrow, lex_import_csv, lexicon_migrate_inherited_links
            const pDiff = await callOk("lex_parent_diff", {
              language: "lang_child",
            });
            expect(pDiff.summary).toBeDefined();

            const pullDry = await callOk("lex_pull_sync", {
              language: "lang_child",
              dry_run: true,
            });
            await callOk("lex_pull_sync", {
              language: "lang_child",
              operation_id: "op_pull_1",
              base_revisions: pullDry.base_revisions,
            });

            const borrowDry = await callOk("lex_borrow", {
              language: "lang_other",
              source_language: "lang_root",
              entry_ids: ["entry_root_pata"],
              dry_run: true,
            });
            await callOk("lex_borrow", {
              language: "lang_other",
              source_language: "lang_root",
              entry_ids: ["entry_root_pata"],
              operation_id: "op_borrow_1",
              expected_revision: (borrowDry.base_revisions as Record<string, string>).lexicon,
            });

            const csvImpDry = await callOk("lex_import_csv", {
              language: "lang_other",
              csv_text: "word,gloss,pos\nsata,star,pos_noun\n",
              dry_run: true,
            });
            await callOk("lex_import_csv", {
              language: "lang_other",
              csv_text: "word,gloss,pos\nsata,star,pos_noun\n",
              operation_id: "op_csv_imp_1",
              expected_revision: (csvImpDry.base_revisions as Record<string, string>).lexicon,
            });

            const migDry = await callOk("lexicon_migrate_inherited_links", {
              dry_run: true,
            });
            await callOk("lexicon_migrate_inherited_links", {
              operation_id: "op_mig_1",
              expected_revisions: migDry.base_revisions,
            });

            // language_fork -> cycle rejection -> language_delete -> language_trash_list -> language_restore
            const forkDry = await callOk("language_fork", {
              parent: "lang_child",
              new_name: "Sister-Synth",
              new_id: "lang_sister",
              new_path: "branches/sister",
              dry_run: true,
            });
            const forkCommit = await callOk("language_fork", {
              parent: "lang_child",
              new_name: "Sister-Synth",
              new_id: "lang_sister",
              new_path: "branches/sister",
              operation_id: "op_fork_1",
              expected_revision: (forkDry.base_revisions as Record<string, string>).workspace,
            });
            expect(forkCommit.committed).toBe(true);

            const cycleErr = await callErr("language_update", {
              language: "lang_root",
              parent_id: "lang_leaf",
              dry_run: true,
            });
            expect(cycleErr.code).toBe("VALIDATION");

            const langDelCommit = await callOk("language_delete", {
              language: "lang_sister",
              confirm: true,
              operation_id: "op_lang_del_1",
              expected_revision: forkCommit.revision,
            });
            const trashId = langDelCommit.trash_id as string;
            expect(typeof trashId).toBe("string");

            const trashAfterDel = await callOk("language_trash_list");
            expect(
              (trashAfterDel.items as Array<Record<string, unknown>>).some(
                (t) => t.trash_id === trashId,
              ),
            ).toBe(true);

            const restoreCommit = await callOk("language_restore", {
              trash_id: trashId,
              confirm: true,
              operation_id: "op_lang_restore_1",
              expected_revision: langDelCommit.revision,
            });
            expect(restoreCommit.committed).toBe(true);

            // snapshot_create -> snapshot_diff -> snapshot_rollback
            const snapCreated = await callOk("snapshot_create", {
              scope: "grammar",
              language: "lang_other",
              description: "Before VOS change",
              operation_id: "op_snap_create_1",
            });
            const snapId = snapCreated.snapshot_id as string;
            expect(typeof snapId).toBe("string");

            const gramDry2 = await callOk("gram_update", {
              language: "lang_other",
              dry_run: true,
              syntax: { word_order: "VOS" },
            });
            await callOk("gram_update", {
              language: "lang_other",
              operation_id: "op_gram_2",
              expected_revision: (gramDry2.base_revisions as Record<string, string>)[
                "grammar.json"
              ],
              syntax: { word_order: "VOS" },
            });

            const snapDiff = await callOk("snapshot_diff", {
              snapshot_id: snapId,
              language: "lang_other",
            });
            expect((snapDiff.diff as Record<string, unknown>).snapshot_id).toBe(snapId);

            const rbDry = await callOk("snapshot_rollback", {
              snapshot_id: snapId,
              language: "lang_other",
              confirm: true,
              dry_run: true,
            });
            await callOk("snapshot_rollback", {
              snapshot_id: snapId,
              language: "lang_other",
              confirm: true,
              operation_id: "op_snap_rb_1",
              expected_revisions: rbDry.base_revisions,
            });

            const gramAfterRb = await callOk("gram_get", { language: "lang_other" });
            expect(
              ((gramAfterRb.config as Record<string, unknown>).syntax as Record<string, unknown>)
                .word_order,
            ).toBe("VSO");

            // project_create, project_copy, export_workspace_bundle -> import_workspace_bundle, family_register/set_active/unregister
            const bundlePath = path.join(env.rootDir, "exported.conlangbundle.json");
            await callOk("export_workspace_bundle", {
              output_path: bundlePath,
              overwrite: true,
            });
            expect(fs.existsSync(bundlePath)).toBe(true);

            const newProjDir = path.join(env.rootDir, "created-proj");
            const projCreated = await callOk("project_create", {
              target_dir: newProjDir,
              name: "Created-Family",
              register: true,
              set_active: false,
              operation_id: "op_proj_create_1",
            });
            expect(projCreated.committed ?? projCreated.created).toBeTruthy();

            const copyProjDir = path.join(env.rootDir, "copied-proj");
            const projCopied = await callOk("project_copy", {
              target_dir: copyProjDir,
              new_name: "Copied-Family",
              register: true,
              set_active: false,
              operation_id: "op_proj_copy_1",
            });
            const copiedFamilyId = projCopied.family_id as string;
            expect(typeof copiedFamilyId).toBe("string");

            // Import bundle into copied-proj
            const impDry = await callOk("import_workspace_bundle", {
              family: copiedFamilyId,
              bundle_path: bundlePath,
              confirm: true,
              dry_run: true,
            });
            const impCommit = await callOk("import_workspace_bundle", {
              family: copiedFamilyId,
              bundle_path: bundlePath,
              confirm: true,
              operation_id: "op_imp_bundle_1",
              expected_revision: (impDry.base_revisions as Record<string, string>).workspace,
            });
            expect(impCommit.committed).toBe(true);

            // Registry management: set_active -> unregister -> register
            const famListNow = await callOk("family_list");
            const regRev1 = famListNow.registry_revision as string;
            const setAct = await callOk("family_set_active", {
              family: copiedFamilyId,
              operation_id: "op_fam_active_1",
              expected_revision: regRev1,
            });
            const unreg = await callOk("family_unregister", {
              family: copiedFamilyId,
              confirm: true,
              operation_id: "op_fam_unreg_1",
              expected_revision: setAct.registry_revision ?? setAct.revision,
            });
            await callOk("family_register", {
              conlang_file_path: projCopied.conlang_file_path as string,
              name: "Re-Registered-Family",
              set_active: false,
              operation_id: "op_fam_reg_1",
              expected_revision: unreg.registry_revision ?? unreg.revision,
            });
          },
        );
      } finally {
        env.cleanup();
      }
    },
    45000,
  );
});
