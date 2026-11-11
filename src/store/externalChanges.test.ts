import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type {
  GrammarConfig,
  GrammarLoadResult,
  WorkspaceConfig,
  WorkspaceLoadResult,
  WriteResult,
} from "../types";
import {
  clearRecordedGuiOperationIds,
  recordGuiOperationId,
  useConflictStore,
} from "./conflictStore";
import { useWorkspaceStore } from "./workspaceStore";
import { useGrammarStore } from "./grammarStore";
import { handleWorkspaceFileChanged } from "../utils/externalChanges";
import { buildMcpCliArgs } from "../components/mcp/McpConfigSnippets";

type InvokeHandler = (
  cmd: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

const hadWindow = "window" in globalThis;
const originalWindow = (globalThis as Record<string, unknown>).window;

function installTauriInvokeMock(handler: InvokeHandler): void {
  const internals = {
    invoke: (cmd: string, args: Record<string, unknown> = {}) =>
      handler(cmd, args),
  };
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = internals;
  (globalThis as Record<string, unknown>).window = {
    __TAURI_INTERNALS__: internals,
    dispatchEvent: () => true,
  };
}

function makeWorkspaceConfig(): WorkspaceConfig {
  return {
    workspace_version: "3.0",
    languages: [
      {
        language_id: "lang_proto",
        name: "Proto",
        path: "proto",
        parent_id: null,
      },
    ],
  };
}

function makeGrammarConfig(
  languageId: string,
  wordOrder: GrammarConfig["syntax"]["word_order"],
  extraTopField?: string,
  extraPosField?: string,
): GrammarConfig {
  const base: GrammarConfig & Record<string, unknown> = {
    language_id: languageId,
    syntax: {
      word_order: wordOrder,
      modifier_position: "before",
      adposition_type: "preposition",
    },
    parts_of_speech: [
      {
        pos_id: "pos_noun",
        name: "Noun",
        gloss_abbr: "N",
        word_pattern: "",
        require_pronounceable: false,
        ...(extraPosField ? { future_pos_meta: extraPosField } : {}),
      } as GrammarConfig["parts_of_speech"][number],
    ],
    inflection_dimensions: [],
    inflection_rules: [],
    derivation_rules: [],
    grammar_manual: [],
    typology: {
      morphological_type: "fusional",
      synthesis_index: 2,
      fusion_index: 2,
      head_marking: "dependent",
      auto_estimated: true,
    },
    affix_slots: [],
    conjugation_classes: [],
    irregular_overrides: [],
  };
  if (extraTopField) {
    base.future_top_flag = extraTopField;
  }
  return base;
}

describe("externalChanges watcher & unknown-field fidelity", () => {
  beforeEach(() => {
    clearRecordedGuiOperationIds();
    useConflictStore.getState().clearAllConflicts();
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    if (hadWindow) {
      (globalThis as Record<string, unknown>).window = originalWindow;
    } else {
      delete (globalThis as Record<string, unknown>).window;
    }
  });

  test("ignores own GUI operationId events without reloading", async () => {
    let grammarLoads = 0;
    installTauriInvokeMock(async (cmd) => {
      if (cmd === "load_workspace_with_revision") {
        const res: WorkspaceLoadResult = {
          config: makeWorkspaceConfig(),
          revision: "ws_rev_1",
        };
        return res;
      }
      if (cmd === "load_grammar_with_revision") {
        grammarLoads += 1;
        const res: GrammarLoadResult = {
          config: makeGrammarConfig("lang_proto", "SVO"),
          revision: "gram_rev_1",
        };
        return res;
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    await useWorkspaceStore.getState().loadWorkspace("/proj/family.conlang");
    await useGrammarStore.getState().loadConfig("/proj", "proto");
    expect(grammarLoads).toBe(1);

    recordGuiOperationId("op_own_gui_1");
    await handleWorkspaceFileChanged({
      project_path: "/proj",
      operation_id: "op_own_gui_1",
      origin: "gui",
      language_path: "proto",
      language_id: "lang_proto",
      kind: "grammar",
      revisions: { grammar: "gram_rev_2" },
      affected_language_ids: ["lang_proto"],
    });

    expect(grammarLoads).toBe(1);
    expect(useConflictStore.getState().conflicts).toHaveLength(0);
  });

  test("silently reloads clean store on external MCP change and preserves unknown fields on subsequent edit", async () => {
    let currentDiskWordOrder: GrammarConfig["syntax"]["word_order"] = "SVO";
    let currentDiskRev = "gram_rev_1";
    let lastSavedConfig: Record<string, unknown> | null = null;

    installTauriInvokeMock(async (cmd, args) => {
      if (cmd === "load_workspace_with_revision") {
        return {
          config: makeWorkspaceConfig(),
          revision: "ws_rev_1",
        } satisfies WorkspaceLoadResult;
      }
      if (cmd === "load_grammar_with_revision") {
        return {
          config: makeGrammarConfig(
            "lang_proto",
            currentDiskWordOrder,
            "keep_top_unknown",
            "keep_pos_unknown",
          ),
          revision: currentDiskRev,
        } satisfies GrammarLoadResult;
      }
      if (cmd === "save_grammar") {
        lastSavedConfig = args.config as Record<string, unknown>;
        currentDiskRev = "gram_rev_3";
        return {
          operation_id: String(args.operationId ?? ""),
          revision: currentDiskRev,
        } satisfies WriteResult;
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    await useWorkspaceStore.getState().loadWorkspace("/proj/family.conlang");
    await useGrammarStore.getState().loadConfig("/proj", "proto");
    expect(useGrammarStore.getState().config.syntax.word_order).toBe("SVO");

    // External MCP update modifies disk to SOV
    currentDiskWordOrder = "SOV";
    currentDiskRev = "gram_rev_2";
    await handleWorkspaceFileChanged({
      project_path: "/proj",
      operation_id: "op_mcp_99",
      origin: "mcp",
      language_path: "proto",
      language_id: "lang_proto",
      kind: "grammar",
      revisions: { grammar: "gram_rev_2" },
      affected_language_ids: ["lang_proto"],
    });

    expect(useGrammarStore.getState().config.syntax.word_order).toBe("SOV");
    expect(useGrammarStore.getState().revision).toBe("gram_rev_2");

    // Subsequent GUI edit updates POS name while preserving unknown fields on both top-level & POS entry
    useGrammarStore.getState().updatePartOfSpeech("pos_noun", {
      pos_id: "pos_noun",
      name: "Substantive",
      gloss_abbr: "N",
      word_pattern: "",
      require_pronounceable: false,
    });
    await useGrammarStore.getState().flushSaves();

    expect(lastSavedConfig).not.toBeNull();
    expect(lastSavedConfig?.future_top_flag).toBe("keep_top_unknown");
    const savedPos = (
      lastSavedConfig?.parts_of_speech as Array<Record<string, unknown>>
    )[0];
    expect(savedPos.name).toBe("Substantive");
    expect(savedPos.future_pos_meta).toBe("keep_pos_unknown");
  });

  test("surfaces conflict modal without overwriting dirty local edits and supports Keep Local / Use Disk", async () => {
    let diskWordOrder: GrammarConfig["syntax"]["word_order"] = "SVO";
    let diskRev = "gram_rev_10";
    let savedExpectedRev = "";

    installTauriInvokeMock(async (cmd, args) => {
      if (cmd === "load_workspace_with_revision") {
        return {
          config: makeWorkspaceConfig(),
          revision: "ws_rev_1",
        } satisfies WorkspaceLoadResult;
      }
      if (cmd === "load_grammar_with_revision") {
        return {
          config: makeGrammarConfig("lang_proto", diskWordOrder),
          revision: diskRev,
        } satisfies GrammarLoadResult;
      }
      if (cmd === "save_grammar") {
        savedExpectedRev = String(args.expectedRevision ?? "");
        diskRev = "gram_rev_12";
        return {
          operation_id: String(args.operationId ?? ""),
          revision: diskRev,
        } satisfies WriteResult;
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    await useWorkspaceStore.getState().loadWorkspace("/proj/family.conlang");
    await useGrammarStore.getState().loadConfig("/proj", "proto");

    // Make local dirty edit (VSO) — debounce timer is now pending
    useGrammarStore.getState().updateSyntax({
      ...useGrammarStore.getState().config.syntax,
      word_order: "VSO",
    });
    expect(useGrammarStore.getState().isDirty("/proj", "proto")).toBe(true);

    // External MCP modifies disk to OSV
    diskWordOrder = "OSV";
    diskRev = "gram_rev_11";
    await handleWorkspaceFileChanged({
      project_path: "/proj",
      operation_id: "op_mcp_conflict",
      origin: "mcp",
      language_path: "proto",
      language_id: "lang_proto",
      kind: "grammar",
      revisions: { grammar: "gram_rev_11" },
      affected_language_ids: ["lang_proto"],
    });

    // Local VSO edit must still be intact, and conflict must be registered!
    expect(useGrammarStore.getState().config.syntax.word_order).toBe("VSO");
    const conflicts = useConflictStore.getState().conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("grammar");
    expect(conflicts[0].diskRevision).toBe("gram_rev_11");

    // Resolve with Keep Local -> saves local VSO against latest diskRev ("gram_rev_11")
    await useConflictStore.getState().resolveKeepLocal(conflicts[0].key);
    expect(savedExpectedRev).toBe("gram_rev_11");
    expect(useConflictStore.getState().conflicts).toHaveLength(0);
    expect(useGrammarStore.getState().revision).toBe("gram_rev_12");
  });

  test("buildMcpCliArgs generates mode, toolsets, and optional --family flags", () => {
    expect(buildMcpCliArgs("read-only", null)).toEqual([
      "--mode",
      "read-only",
      "--toolsets",
      "core,audit,compute",
    ]);
    expect(buildMcpCliArgs("write", "/tmp/elvish.conlang")).toEqual([
      "--mode",
      "write",
      "--toolsets",
      "core,audit,compute,write,evolution",
      "--family",
      "/tmp/elvish.conlang",
    ]);
    expect(buildMcpCliArgs("write+destructive", "")).toEqual([
      "--mode",
      "write+destructive",
      "--toolsets",
      "all",
    ]);
  });
});
