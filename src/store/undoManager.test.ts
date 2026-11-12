import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearHistory,
  getUndoState,
  inspectHistory,
  performRedo,
  performUndo,
  pushUndoEntry,
} from "./undoManager";

function record(
  log: string[],
  label: string,
  options: { languageId?: string; coalesceKey?: string; timestamp?: number } = {},
): void {
  pushUndoEntry({
    languageId: options.languageId ?? "lang_a",
    domain: "lexicon",
    labelKey: label,
    coalesceKey: options.coalesceKey,
    timestamp: options.timestamp,
    undo: () => {
      log.push(`undo:${label}`);
    },
    redo: () => {
      log.push(`redo:${label}`);
    },
  });
}

// 与其他测试文件共享模块级栈，测试前后都清空以保证隔离
beforeEach(() => {
  clearHistory();
});

afterEach(() => {
  clearHistory();
});

describe("undoManager: basic stack behaviour", () => {
  test("pushes entries and exposes the top label", () => {
    const log: string[] = [];
    record(log, "lexicon.edit");
    const state = getUndoState();
    expect(state.canUndo).toBe(true);
    expect(state.canRedo).toBe(false);
    expect(state.undoLabelKey).toBe("lexicon.edit");
    expect(state.undoCount).toBe(1);
  });

  test("undo then redo replays both closures", async () => {
    const log: string[] = [];
    record(log, "first");
    record(log, "second");

    const undone = await performUndo();
    expect(undone?.labelKey).toBe("second");
    expect(log).toEqual(["undo:second"]);
    expect(getUndoState().canRedo).toBe(true);

    const redone = await performRedo();
    expect(redone?.labelKey).toBe("second");
    expect(log).toEqual(["undo:second", "redo:second"]);
    expect(getUndoState().canRedo).toBe(false);
  });

  test("a new action truncates the redo branch", async () => {
    const log: string[] = [];
    record(log, "first");
    record(log, "second");
    await performUndo();
    record(log, "third");

    expect(getUndoState().canRedo).toBe(false);
    const labels = inspectHistory().undo.map((entry) => entry.labelKey);
    expect(labels).toEqual(["first", "third"]);
  });

  test("returns null when there is nothing to undo or redo", async () => {
    expect(await performUndo()).toBeNull();
    expect(await performRedo()).toBeNull();
  });
});

describe("undoManager: input coalescing", () => {
  test("merges same-key edits inside the 800ms window into one step", async () => {
    const log: string[] = [];
    record(log, "typing", { coalesceKey: "lex:entry_01:romanized", timestamp: 1_000_000 });
    record(log, "typing", { coalesceKey: "lex:entry_01:romanized", timestamp: 1_000_500 });
    record(log, "typing", { coalesceKey: "lex:entry_01:romanized", timestamp: 1_000_700 });

    expect(inspectHistory().undo).toHaveLength(1);
    await performUndo();
    // 前像固定在连击之前的那一步，因此只回放一次
    expect(log).toEqual(["undo:typing"]);
  });

  test("does not merge outside the window or for different keys", () => {
    const log: string[] = [];
    record(log, "typing", { coalesceKey: "lex:a", timestamp: 1_000_000 });
    record(log, "typing", { coalesceKey: "lex:a", timestamp: 1_001_000 });
    expect(inspectHistory().undo).toHaveLength(2);

    record(log, "typing", { coalesceKey: "lex:b", timestamp: 1_001_100 });
    expect(inspectHistory().undo).toHaveLength(3);
  });

  test("never merges entries from different languages", () => {
    const log: string[] = [];
    record(log, "typing", { coalesceKey: "lex:a", languageId: "lang_a", timestamp: 1_000_000 });
    record(log, "typing", { coalesceKey: "lex:a", languageId: "lang_b", timestamp: 1_000_100 });
    expect(inspectHistory().undo).toHaveLength(2);
  });
});

describe("undoManager: language isolation and capacity", () => {
  test("undo only touches the active language when filtered", async () => {
    const log: string[] = [];
    record(log, "a1", { languageId: "lang_a" });
    record(log, "b1", { languageId: "lang_b" });

    const undone = await performUndo("lang_a");
    expect(undone?.labelKey).toBe("a1");
    expect(log).toEqual(["undo:a1"]);
    expect(inspectHistory().undo.map((entry) => entry.labelKey)).toEqual(["b1"]);

    expect(await performUndo("lang_a")).toBeNull();
  });

  test("redo also respects the language filter", async () => {
    const log: string[] = [];
    record(log, "a1", { languageId: "lang_a" });
    record(log, "b1", { languageId: "lang_b" });
    await performUndo("lang_a");
    await performUndo("lang_b");

    const redone = await performRedo("lang_a");
    expect(redone?.labelKey).toBe("a1");
  });

  test("keeps at most 100 entries, evicting the oldest", () => {
    const log: string[] = [];
    for (let index = 0; index < 105; index += 1) {
      record(log, `step-${index}`, { timestamp: 1_000_000 + index * 10_000 });
    }
    const { undo } = inspectHistory();
    expect(undo).toHaveLength(100);
    expect(undo[0]!.labelKey).toBe("step-5");
    expect(undo[99]!.labelKey).toBe("step-104");
  });

  test("clearHistory resets both stacks and state", () => {
    const log: string[] = [];
    record(log, "one");
    clearHistory();
    expect(getUndoState()).toMatchObject({
      canUndo: false,
      canRedo: false,
      undoCount: 0,
      redoCount: 0,
    });
  });
});
