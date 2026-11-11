import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type {
  PhonologyConfig,
  PhonologyLoadResult,
  WriteResult,
} from "../types";

const source = readFileSync(new URL("./phonoStore.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const localRequire = createRequire(import.meta.url);

type MockInvokeArgs = Record<string, unknown>;

function createStore(
  invoke: (command: string, args: MockInvokeArgs) => Promise<unknown>,
) {
  const module = { exports: {} as typeof import("./phonoStore") };
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === "@tauri-apps/api/core") return { invoke };
      if (name === "../constants") return { DEFAULT_LANGUAGE_ID: "test" };
      return localRequire(name);
    },
    setTimeout: (callback: () => void) => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearTimeout: (id: number) => timers.delete(id),
  });
  return module.exports.usePhonoStore;
}

function config(id: string): PhonologyConfig {
  return {
    language_id: id,
    phoneme_inventory: { consonants: [], vowels: [] },
    romanization_maps: [],
    glyph_annotations: [],
    phonotactics: {
      macros: {},
      syllable_structure: "CV",
      blacklist_patterns: [],
      vowel_harmony: { enabled: false, group_a: [], group_b: [] },
      tone_system: { enabled: false, tones: [] },
    },
    allophony_rules: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

interface SavedPhonologyArgs {
  projectPath: string;
  languagePath: string;
  config: PhonologyConfig;
  expectedRevision?: string;
  operationId: string;
}

describe("phonology persistence", () => {
  test("pending saves are isolated by project and language", async () => {
    const saved: SavedPhonologyArgs[] = [];
    const store = createStore(async (command, args) => {
      if (command === "save_phonology") {
        saved.push(args as unknown as SavedPhonologyArgs);
      }
      return undefined;
    });
    for (const [project, language] of [
      ["one", "a"],
      ["one", "b"],
      ["two", "b"],
    ]) {
      store.setState({
        projectPath: project,
        languagePath: language,
        config: config(language),
      });
      store.getState().saveConfig();
    }
    await store.getState().flushSaves();
    expect(saved.map((item) => [item.projectPath, item.languagePath])).toEqual([
      ["one", "a"],
      ["one", "b"],
      ["two", "b"],
    ]);
  });

  test("setGlyphAnnotations updates state and persists annotations", async () => {
    const saved: SavedPhonologyArgs[] = [];
    const store = createStore(async (command, args) => {
      if (command === "save_phonology") {
        saved.push(args as unknown as SavedPhonologyArgs);
      }
      return undefined;
    });
    store.setState({
      projectPath: "project",
      languagePath: "a",
      config: config("a"),
    });
    store.getState().setGlyphAnnotations([
      { codepoint: 0xe700, label: "s", kind: "base", phonemes: ["s", "a"] },
    ]);
    await store.getState().flushSaves();
    expect(store.getState().config.glyph_annotations).toEqual([
      { codepoint: 0xe700, label: "s", kind: "base", phonemes: ["s", "a"] },
    ]);
    expect(saved[0].config.glyph_annotations).toHaveLength(1);
  });

  test("ordinary child phonology edits do NOT persist inherited parent glyph_annotations", async () => {
    const saved: SavedPhonologyArgs[] = [];
    const store = createStore(async (command, args) => {
      if (command === "load_phonology") {
        const localChild = config("child");
        localChild.glyph_annotations = [];
        const effectiveChild = config("child");
        effectiveChild.glyph_annotations = [
          { codepoint: 0xe701, label: "pa", kind: "base", phonemes: ["p", "a"] },
        ];
        return {
          config: effectiveChild,
          local_config: localChild,
          effective_config: effectiveChild,
          annotations_source: "inherited",
          annotations_owner_id: "lang_parent",
          revision: "rev_child_1",
          effective_revision: "eff_1",
          dependencies: { "child/phonology.json": "rev_child_1" },
          legacy_fields_present: true,
        } satisfies PhonologyLoadResult;
      }
      if (command === "save_phonology") {
        saved.push(args as unknown as SavedPhonologyArgs);
        return {
          operation_id: String(args.operationId),
          revision: "rev_child_2",
        } satisfies WriteResult;
      }
      return undefined;
    });

    await store.getState().loadConfig("project", "child_dir");
    expect(store.getState().annotationsSource).toBe("inherited");
    expect(store.getState().annotationsOwnerId).toBe("lang_parent");
    expect(store.getState().legacyFieldsPresent).toBe(true);
    // Read consumers see effectiveConfig (inherited annotations visible)
    expect(store.getState().config.glyph_annotations).toHaveLength(1);
    expect(store.getState().localConfig.glyph_annotations).toEqual([]);

    // Ordinary edit: toggle phoneme
    store.getState().togglePhoneme("p", "consonants");
    expect(store.getState().config.glyph_annotations).toHaveLength(1);
    expect(store.getState().localConfig.glyph_annotations).toEqual([]);

    await store.getState().flushSaves();
    expect(saved).toHaveLength(1);
    expect(saved[0].expectedRevision).toBe("rev_child_1");
    expect(saved[0].config.phoneme_inventory.consonants).toEqual(["p"]);
    expect(saved[0].config.glyph_annotations).toEqual([]);
    expect(store.getState().revision).toBe("rev_child_2");
    expect(store.getState().legacyFieldsPresent).toBe(false);

    // Explicit localization: localizeInheritedAnnotations copies into localConfig
    store.getState().localizeInheritedAnnotations();
    expect(store.getState().annotationsSource).toBe("local");
    expect(store.getState().localConfig.glyph_annotations).toHaveLength(1);
    await store.getState().flushSaves();
    expect(saved).toHaveLength(2);
    expect(saved[1].expectedRevision).toBe("rev_child_2");
    expect(saved[1].config.glyph_annotations).toHaveLength(1);
  });

  test("unknown extra fields survive load and update across top-level and nested rules", async () => {
    const saved: SavedPhonologyArgs[] = [];
    const store = createStore(async (command, args) => {
      if (command === "load_phonology") {
        const rawWithExtras = {
          ...config("proto"),
          custom_top_extra: "preserve_me",
          romanization_maps: [
            {
              map_id: "m1",
              name: "Default",
              is_default: true,
              custom_map_extra: 42,
              rules: [
                {
                  rule_id: "r1",
                  input: "sh",
                  output_phoneme: "ʃ",
                  context_before: "",
                  context_after: "",
                  custom_rule_extra: { note: "keep" },
                },
              ],
            },
          ],
        } as unknown as PhonologyConfig;
        return {
          config: rawWithExtras,
          local_config: rawWithExtras,
          effective_config: rawWithExtras,
          annotations_source: "none",
          revision: "rev1",
        } satisfies PhonologyLoadResult;
      }
      if (command === "save_phonology") {
        saved.push(args as unknown as SavedPhonologyArgs);
      }
      return undefined;
    });

    await store.getState().loadConfig("project", "proto");
    store.getState().updateRomanizationMap("m1", {
      map_id: "m1",
      name: "Renamed Map",
      is_default: true,
      rules: [
        {
          rule_id: "r1",
          input: "sj",
          output_phoneme: "ʃ",
          context_before: "",
          context_after: "",
        },
      ],
    });
    await store.getState().flushSaves();

    const written = saved[0].config as unknown as Record<string, unknown>;
    expect(written.custom_top_extra).toBe("preserve_me");
    const maps = written.romanization_maps as Array<Record<string, unknown>>;
    expect(maps[0].custom_map_extra).toBe(42);
    expect(maps[0].name).toBe("Renamed Map");
    const rules = maps[0].rules as Array<Record<string, unknown>>;
    expect(rules[0].input).toBe("sj");
    expect(rules[0].custom_rule_extra).toEqual({ note: "keep" });
  });

  test("switching languages flushes edits before loading next language", async () => {
    const calls: string[] = [];
    const store = createStore(async (command, args) => {
      const langPath = String(args.languagePath);
      calls.push(`${command}:${langPath}`);
      const loaded = config(langPath);
      loaded.phoneme_inventory = { consonants: ["p", "t"], vowels: ["a"] };
      return { config: loaded, revision: "1" } satisfies PhonologyLoadResult;
    });
    store.setState({
      projectPath: "project",
      languagePath: "a",
      config: config("a"),
    });
    store.getState().saveConfig();
    await store.getState().loadConfig("project", "b");
    expect(calls).toEqual(["save_phonology:a", "load_phonology:b"]);
    expect(store.getState().languagePath).toBe("b");
    expect(store.getState().config.phoneme_inventory).toEqual({
      consonants: ["p", "t"],
      vowels: ["a"],
    });
  });

  test("stale responses never replace the current language", async () => {
    const a = deferred<PhonologyLoadResult>();
    const b = deferred<PhonologyLoadResult>();
    const store = createStore(async (_, args) =>
      args.languagePath === "a" ? a.promise : b.promise,
    );
    const loadA = store.getState().loadConfig("project", "a");
    await tick();
    await tick();
    const loadB = store.getState().loadConfig("project", "b");
    await tick();
    await tick();
    b.resolve({ config: config("b"), revision: "2" });
    await loadB;
    a.resolve({ config: config("a"), revision: "1" });
    await loadA;
    expect(store.getState().config.language_id).toBe("b");
    expect(store.getState().languagePath).toBe("b");
  });

  test("failed writes remain available for retry and reuse the same operationId", async () => {
    const opIds: string[] = [];
    let attempts = 0;
    const store = createStore(async (command, args) => {
      if (command === "save_phonology") {
        opIds.push(String(args.operationId));
        if (++attempts === 1) throw new Error("disk unavailable");
      }
      return undefined;
    });
    store.setState({
      projectPath: "project",
      languagePath: "a",
      config: config("a"),
    });
    store.getState().saveConfig();
    await expect(store.getState().flushSaves()).rejects.toThrow(
      "disk unavailable",
    );
    expect(store.getState().saveError).toContain("disk unavailable");
    await store.getState().flushSaves();
    expect(attempts).toBe(2);
    expect(opIds[0]).toBeTruthy();
    expect(opIds[1]).toBe(opIds[0]);
    expect(store.getState().saveError).toBeNull();
  });

  test("a failed older write cannot requeue over a successful newer snapshot", async () => {
    const first = deferred<void>();
    const saved: string[] = [];
    const store = createStore(async (_, args) => {
      const cfg = args.config as PhonologyConfig;
      saved.push(cfg.language_id);
      if (saved.length === 1) return first.promise;
      return undefined;
    });
    store.setState({
      projectPath: "project",
      languagePath: "a",
      config: config("old"),
    });
    store.getState().saveConfig();
    const oldSave = store.getState().flushSaves().catch(() => {});
    await tick();
    await tick();
    store.setState({ config: config("new") });
    store.getState().saveConfig();
    const newSave = store.getState().flushSaves();
    first.reject(new Error("first failure"));
    await Promise.all([oldSave, newSave]);
    await store.getState().flushSaves();
    expect(saved).toEqual(["old", "new"]);
    expect(store.getState().saveError).toBeNull();
  });
});
