import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseConfig } from "../config";
import { createServer } from "../server";

export const EXPECTED_76_TOOLS: readonly string[] = [
  // §5.1 System & Family (14)
  "server_info",
  "family_list",
  "family_get_tree",
  "language_fork",
  "language_update",
  "language_delete",
  "language_trash_list",
  "language_restore",
  "family_register",
  "family_unregister",
  "family_set_active",
  "project_create",
  "project_copy",
  "lexicon_migrate_inherited_links",
  // §5.2 Phonology & Romanization (11)
  "phono_get",
  "romanization_get",
  "romanization_analyze",
  "phono_to_ipa",
  "phono_tokenize",
  "phono_update",
  "romanization_upsert_rules",
  "romanization_delete_rules",
  "romanization_map_upsert",
  "phono_presets_list",
  "phono_apply_preset",
  // §5.3 Writing & Fonts (11)
  "font_list",
  "font_inspect",
  "font_shape",
  "font_audit_coverage",
  "font_audit_family",
  "font_import",
  "font_import_batch",
  "font_clear",
  "glyph_annotations_upsert",
  "glyph_annotations_delete",
  "glyph_annotations_sync_parent",
  // §5.4 Lexicon (11)
  "lex_search",
  "lex_get",
  "lex_stats",
  "lex_quality_check",
  "lex_upsert",
  "lex_delete",
  "lex_regenerate_ipa",
  "lex_parent_diff",
  "lex_pull_sync",
  "lex_borrow",
  "lex_import_csv",
  // §5.5 Wordgen (2)
  "wordgen_generate",
  "wordgen_swadesh_gaps",
  // §5.6 Grammar & Sandbox (7)
  "gram_get",
  "gram_inflect",
  "gram_paradigm",
  "gram_derive",
  "gram_analyze_typology",
  "sandbox_translate",
  "gram_update",
  // §5.7 SCA (6)
  "sca_get",
  "sca_simulate",
  "sca_parse_rules_text",
  "sca_feature_query",
  "sca_update",
  "sca_export_rules_text",
  // §5.8 Corpus (5)
  "corpus_list",
  "corpus_get",
  "corpus_save",
  "corpus_delete",
  "corpus_auto_gloss",
  // §5.9 Export & Import (5)
  "export_llm_brief",
  "export_workspace_bundle",
  "export_csv",
  "export_dic",
  "import_workspace_bundle",
  // §5.10 Snapshots (4)
  "snapshot_list",
  "snapshot_create",
  "snapshot_rollback",
  "snapshot_diff",
] as const;

export const EXPECTED_RESOURCE_TEMPLATES: readonly string[] = [
  "conlang://{family_id}/tree",
  "conlang://{family_id}/{language_id}/brief",
  "conlang://{family_id}/{language_id}/phonology",
  "conlang://{family_id}/{language_id}/romanization",
  "conlang://{family_id}/{language_id}/grammar",
  "conlang://{family_id}/{language_id}/sca",
  "conlang://{family_id}/{language_id}/font",
  "conlang://{family_id}/{language_id}/lexicon/{entry_id}",
  "conlang://{family_id}/{language_id}/corpus/{corpus_id}",
] as const;

export const EXPECTED_PROMPTS: readonly string[] = [
  "audit_font_coverage",
  "review_romanization",
  "design_sound_changes",
  "lexicon_cleanup",
] as const;

describe("T4.9 PRD Coverage Matrix (76 Tools, 10 Resources, 4 Prompts & Annotations)", () => {
  test("exposes all 76 PRD tools, 10 conlang:// resources, and 4 prompts with valid annotations", async () => {
    expect(EXPECTED_76_TOOLS.length).toBe(76);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-matrix-"));
    const tempRegistry = path.join(tmpDir, "registry.json");
    const config = parseConfig(
      ["--mode", "write+destructive", "--toolsets", "all", "--registry", tempRegistry],
      {},
    );
    const server = createServer(config);
    const client = new Client({ name: "matrix-checker", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const { tools } = await client.listTools();
      const actualNames = tools.map((t) => t.name).sort();
      const expectedSorted = [...EXPECTED_76_TOOLS].sort();

      expect(actualNames).toEqual(expectedSorted);
      expect(tools.length).toBe(76);

      const byName = new Map(tools.map((t) => [t.name, t]));
      for (const tool of tools) {
        expect(tool.annotations).toBeDefined();
        expect(tool.annotations?.openWorldHint).toBe(false);
        expect(typeof tool.description).toBe("string");
        expect((tool.description ?? "").length).toBeGreaterThan(5);
      }

      // Verify read-only annotations
      for (const roName of [
        "server_info",
        "family_list",
        "family_get_tree",
        "phono_get",
        "romanization_get",
        "romanization_analyze",
        "font_audit_coverage",
        "font_audit_family",
        "lex_search",
        "gram_get",
        "sca_simulate",
        "corpus_list",
        "snapshot_list",
      ]) {
        const t = byName.get(roName)!;
        expect(t.annotations?.readOnlyHint).toBe(true);
        expect(t.annotations?.destructiveHint).toBe(false);
      }

      // Verify destructive annotations
      for (const destrName of [
        "language_delete",
        "language_restore",
        "corpus_delete",
        "import_workspace_bundle",
        "snapshot_rollback",
      ]) {
        const t = byName.get(destrName)!;
        expect(t.annotations?.readOnlyHint).toBe(false);
        expect(t.annotations?.destructiveHint).toBe(true);
      }

      // Verify write annotations
      for (const writeName of [
        "language_fork",
        "phono_update",
        "font_import",
        "lex_upsert",
        "gram_update",
        "sca_update",
        "corpus_save",
        "snapshot_create",
      ]) {
        const t = byName.get(writeName)!;
        expect(t.annotations?.readOnlyHint).toBe(false);
      }

      // Verify 10 Resources (1 static + 9 URI templates)
      const { resources } = await client.listResources();
      const staticUris = resources.map((r) => r.uri);
      expect(staticUris).toContain("conlang://families");

      const { resourceTemplates } = await client.listResourceTemplates();
      const templateUris = resourceTemplates.map((rt) => rt.uriTemplate).sort();
      expect(templateUris).toEqual([...EXPECTED_RESOURCE_TEMPLATES].sort());
      expect(resources.length + resourceTemplates.length).toBe(10);

      // Verify 4 Prompts
      const { prompts } = await client.listPrompts();
      const promptNames = prompts.map((p) => p.name).sort();
      expect(promptNames).toEqual([...EXPECTED_PROMPTS].sort());
    } finally {
      await client.close();
      await server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("filters registered tools according to --toolsets", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-matrix-filter-"));
    const tempRegistry = path.join(tmpDir, "registry.json");
    const config = parseConfig(
      ["--mode", "read-only", "--toolsets", "audit", "--registry", tempRegistry],
      {},
    );
    const server = createServer(config);
    const client = new Client({ name: "filter-checker", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("font_audit_coverage");
      expect(names).toContain("font_audit_family");
      expect(names).not.toContain("project_create");
      expect(names).not.toContain("import_workspace_bundle");
    } finally {
      await client.close();
      await server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
