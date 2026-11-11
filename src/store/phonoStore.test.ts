import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { PhonologyConfig } from "../types";

const source = readFileSync(new URL("./phonoStore.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const localRequire = createRequire(import.meta.url);

function createStore(invoke: (command: string, args: any) => Promise<unknown>) {
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

describe("phonology persistence", () => {
  test("pending saves are isolated by project and language", async () => {
    const saved: any[] = [];
    const store = createStore(async (command, args) => {
      if (command === "save_phonology") saved.push(args);
    });
    for (const [project, language] of [
      ["one", "a"],
      ["one", "b"],
      ["two", "b"],
    ]) {
      store.setState({ projectPath: project, languagePath: language, config: config(language) });
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
    const saved: any[] = [];
    const store = createStore(async (command, args) => {
      if (command === "save_phonology") saved.push(args);
    });
    store.setState({ projectPath: "project", languagePath: "a", config: config("a") });
    store.getState().setGlyphAnnotations([
      { codepoint: 0xe700, label: "s", kind: "base", phonemes: ["s", "a"] },
    ]);
    await store.getState().flushSaves();
    expect(store.getState().config.glyph_annotations).toEqual([
      { codepoint: 0xe700, label: "s", kind: "base", phonemes: ["s", "a"] },
    ]);
    expect(saved[0].config.glyph_annotations).toHaveLength(1);
  });

  test("switching languages flushes edits before loading next language", async () => {
    const calls: string[] = [];
    const store = createStore(async (command, args) => {
      calls.push(`${command}:${args.languagePath}`);
      return config(args.languagePath);
    });
    store.setState({ projectPath: "project", languagePath: "a", config: config("a") });
    store.getState().saveConfig();
    await store.getState().loadConfig("project", "b");
    expect(calls).toEqual(["save_phonology:a", "load_phonology:b"]);
    expect(store.getState().languagePath).toBe("b");
  });

  test("stale responses never replace the current language", async () => {
    const a = deferred<PhonologyConfig>();
    const b = deferred<PhonologyConfig>();
    const store = createStore(async (_, args) =>
      args.languagePath === "a" ? a.promise : b.promise,
    );
    const loadA = store.getState().loadConfig("project", "a");
    await tick();
    await tick();
    const loadB = store.getState().loadConfig("project", "b");
    await tick();
    await tick();
    b.resolve(config("b"));
    await loadB;
    a.resolve(config("a"));
    await loadA;
    expect(store.getState().config.language_id).toBe("b");
    expect(store.getState().languagePath).toBe("b");
  });

  test("failed writes remain available for retry", async () => {
    let attempts = 0;
    const store = createStore(async () => {
      if (++attempts === 1) throw new Error("disk unavailable");
    });
    store.setState({ projectPath: "project", languagePath: "a", config: config("a") });
    store.getState().saveConfig();
    await expect(store.getState().flushSaves()).rejects.toThrow("disk unavailable");
    expect(store.getState().saveError).toContain("disk unavailable");
    await store.getState().flushSaves();
    expect(attempts).toBe(2);
    expect(store.getState().saveError).toBeNull();
  });

  test("a failed older write cannot requeue over a successful newer snapshot", async () => {
    const first = deferred<void>();
    const saved: string[] = [];
    const store = createStore(async (_, args) => {
      saved.push(args.config.language_id);
      if (saved.length === 1) return first.promise;
    });
    store.setState({ projectPath: "project", languagePath: "a", config: config("old") });
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
