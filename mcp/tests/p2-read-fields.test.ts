import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { LanguageEntry } from "../../src/types";
import {
  normalizeWordEntryFromRaw,
  readGrammarUnlocked,
  readWorkspaceUnlocked,
} from "../storage/read";

const language: LanguageEntry = {
  language_id: "lang_root",
  name: "Root",
  path: "roots/root",
  parent_id: null,
};

let projectDir: string;

beforeAll(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-p2-read-"));
  fs.mkdirSync(path.join(projectDir, "roots", "root"), { recursive: true });
});

afterAll(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

function wordRaw(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    entry_id: "entry_1",
    language_id: "lang_root",
    con_word_romanized: "kata",
    phonetic_ipa: "kata",
    phonetic_override: false,
    senses: [
      {
        sense_id: "sense_1",
        pos_id: "noun",
        gloss: "stone",
        definitions: [],
        examples: [],
        ...(overrides.sense as Record<string, unknown> | undefined),
      },
    ],
    etymology: {
      origin_type: "a_priori",
      parent_entry_id: null,
      source_language_id: null,
      applied_sound_changes: [],
      semantic_shift_note: "",
      ...(overrides.etymology as Record<string, unknown> | undefined),
    },
    metadata: { tags: [], created_at: "", updated_at: "" },
  };
}

describe("T2.1 MCP read layer: P2 optional fields", () => {
  test("drops null concept_id but keeps a bound concept", () => {
    const legacy = normalizeWordEntryFromRaw(wordRaw({ sense: { concept_id: null } }), "lang_root");
    expect("concept_id" in legacy.senses[0]!).toBe(false);

    const bound = normalizeWordEntryFromRaw(
      wordRaw({ sense: { concept_id: "CONCEPT_WATER" } }),
      "lang_root",
    );
    expect(bound.senses[0]!.concept_id).toBe("CONCEPT_WATER");
  });

  test("drops empty compound components and null digests", () => {
    const legacy = normalizeWordEntryFromRaw(
      wordRaw({ etymology: { components: [], compounds_stale_digest: null } }),
      "lang_root",
    );
    expect("components" in legacy.etymology).toBe(false);
    expect("compounds_stale_digest" in legacy.etymology).toBe(false);

    const compound = normalizeWordEntryFromRaw(
      wordRaw({
        etymology: {
          components: [{ entry_id: "entry_a", relation: "root" }],
          compounds_stale_digest: "digest",
        },
      }),
      "lang_root",
    );
    expect(compound.etymology.components).toHaveLength(1);
    expect(compound.etymology.compounds_stale_digest).toBe("digest");
  });

  test("readGrammarUnlocked only emits morphophonology_rules when non-empty", () => {
    const grammarPath = path.join(projectDir, "roots", "root", "grammar.json");
    fs.writeFileSync(grammarPath, JSON.stringify({ language_id: "lang_root" }), "utf-8");
    const legacy = readGrammarUnlocked(projectDir, language);
    expect("morphophonology_rules" in legacy.config).toBe(false);

    fs.writeFileSync(
      grammarPath,
      JSON.stringify({
        language_id: "lang_root",
        syntax: { word_order: "SOV", alignment: "erg_abs" },
        morphophonology_rules: [{ rule_id: "mph_1", priority: 1, target: "t", replacement: "d" }],
      }),
      "utf-8",
    );
    const withRules = readGrammarUnlocked(projectDir, language);
    expect(withRules.config.morphophonology_rules?.[0]?.rule_id).toBe("mph_1");
    expect(withRules.config.syntax.alignment).toBe("erg_abs");
  });

  test("readWorkspaceUnlocked strips an empty custom_concepts array", () => {
    const conlangPath = path.join(projectDir, "family.conlang");
    fs.writeFileSync(
      conlangPath,
      JSON.stringify({ workspace_version: "3.0", languages: [language], custom_concepts: [] }),
      "utf-8",
    );
    const legacy = readWorkspaceUnlocked(conlangPath);
    expect("custom_concepts" in legacy.config).toBe(false);

    fs.writeFileSync(
      conlangPath,
      JSON.stringify({
        workspace_version: "3.0",
        languages: [language],
        custom_concepts: [
          {
            concept_id: "CUSTOM_MONTH",
            gloss_en: "month",
            gloss_zh: "月",
            semantic_field: "calendar",
          },
        ],
      }),
      "utf-8",
    );
    const withConcepts = readWorkspaceUnlocked(conlangPath);
    expect(withConcepts.config.custom_concepts?.[0]?.concept_id).toBe("CUSTOM_MONTH");
  });
});
