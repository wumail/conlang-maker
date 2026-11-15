import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseConfig } from "../config";
import { createServer } from "../server";
import { EXPECTED_77_TOOLS } from "./expected-tools";

export { EXPECTED_77_TOOLS };

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
    expect(EXPECTED_77_TOOLS.length).toBeGreaterThanOrEqual(77);

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
      const expectedSorted = [...EXPECTED_77_TOOLS].sort();

      expect(actualNames).toEqual(expectedSorted);
      expect(tools.length).toBe(EXPECTED_77_TOOLS.length);

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
