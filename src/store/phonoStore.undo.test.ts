/**
 * phonoStore.undo.test.ts — 音系撤销历史回归测试
 *
 * 覆盖 F1.3：
 *  1. 跨语言切换后，撤销只回退到「当前语言自身」的初始配置（不串台到上一个语言）；
 *  2. 增删规则等离散动作不会被 800ms 输入合并压成一步。
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type {
  AllophonyRule,
  PhonologyConfig,
  PhonologyLoadResult,
} from "../types";
import { clearHistory, inspectHistory, performUndo } from "./undoManager";

const source = readFileSync(new URL("./phonoStore.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const localRequire = createRequire(import.meta.url);

type MockInvokeArgs = Record<string, unknown>;

/** 与 phonoStore.test.ts 相同的隔离加载器：拿到一个独立的 store 实例 */
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
    structuredClone,
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

function allophonyRule(id: string): AllophonyRule {
  return {
    rule_id: id,
    description: id,
    input: "p",
    output: "b",
    context_before: "",
    context_after: "",
  };
}

function loadResult(id: string, consonants: string[]): PhonologyLoadResult {
  const loaded = config(id);
  loaded.phoneme_inventory = { consonants, vowels: [] };
  return {
    config: loaded,
    local_config: loaded,
    effective_config: loaded,
    annotations_source: "none",
    revision: `rev-${id}`,
  };
}

function createLanguageAwareStore() {
  return createStore(async (command, args) => {
    if (command === "load_phonology") {
      const languagePath = String(args.languagePath);
      return loadResult(languagePath, [`${languagePath}-base`]);
    }
    return undefined;
  });
}

beforeEach(() => {
  clearHistory();
});

describe("phonoStore undo: cross-language isolation", () => {
  test("undo on language B restores B's own initial config, never A's snapshot", async () => {
    const store = createLanguageAwareStore();

    await store.getState().loadConfig("project", "lang_a");
    const aInitial = structuredClone(store.getState().localConfig);
    expect(aInitial.phoneme_inventory.consonants).toEqual(["lang_a-base"]);

    store.getState().togglePhoneme("a_only", "consonants");
    expect(store.getState().localConfig.phoneme_inventory.consonants).toEqual([
      "lang_a-base",
      "a_only",
    ]);

    await store.getState().loadConfig("project", "lang_b");
    const bInitial = structuredClone(store.getState().localConfig);
    expect(bInitial.language_id).toBe("lang_b");
    expect(bInitial.phoneme_inventory.consonants).toEqual(["lang_b-base"]);

    store.getState().togglePhoneme("b_only", "consonants");
    expect(store.getState().localConfig.phoneme_inventory.consonants).toEqual([
      "lang_b-base",
      "b_only",
    ]);

    const undone = await performUndo("lang_b");
    expect(undone?.languageId).toBe("lang_b");

    const restored = store.getState().localConfig;
    // 关键断言：前像来自语言 B 自身的初始配置，而不是语言 A
    expect(restored).toEqual(bInitial);
    expect(restored.phoneme_inventory.consonants).toEqual(["lang_b-base"]);
    expect(restored.phoneme_inventory.consonants).not.toContain("a_only");
    expect(restored.phoneme_inventory.consonants).not.toContain(
      "lang_a-base",
    );
  });

  test("language A history is still undoable after switching to B", async () => {
    const store = createLanguageAwareStore();

    await store.getState().loadConfig("project", "lang_a");
    store.getState().togglePhoneme("a_only", "consonants");
    await store.getState().loadConfig("project", "lang_b");
    store.getState().togglePhoneme("b_only", "consonants");

    const undoneA = await performUndo("lang_a");
    expect(undoneA?.languageId).toBe("lang_a");
    // 当前语言仍是 B，A 的撤销不会污染激活语言的本地配置
    expect(store.getState().languagePath).toBe("lang_b");
    expect(store.getState().localConfig.phoneme_inventory.consonants).toEqual([
      "lang_b-base",
      "b_only",
    ]);
  });
});

describe("phonoStore undo: coalescing granularity", () => {
  test("discrete rule insertions are not merged into a single step", async () => {
    const store = createLanguageAwareStore();
    await store.getState().loadConfig("project", "lang_a");

    store.getState().addAllophonyRule(allophonyRule("rule_1"));
    store.getState().addAllophonyRule(allophonyRule("rule_2"));

    const entries = inspectHistory().undo.filter(
      (entry) => entry.domain === "phonology" && entry.languageId === "lang_a",
    );
    expect(entries).toHaveLength(2);
  });

  test("continuous text edits in the same window still merge", async () => {
    const store = createLanguageAwareStore();
    await store.getState().loadConfig("project", "lang_a");

    store.getState().updateSyllableStructure("CVC");
    store.getState().updateSyllableStructure("CVCV");
    store.getState().updateSyllableStructure("CVCVC");

    const entries = inspectHistory().undo.filter(
      (entry) => entry.domain === "phonology" && entry.languageId === "lang_a",
    );
    expect(entries).toHaveLength(1);
  });
});
