import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearRecordedGuiOperationIds,
  computeJsonDiffSummary,
  generateOperationId,
  isConflictError,
  isOwnGuiOperationId,
  mergeById,
  recordGuiOperationId,
  useConflictStore,
} from "./conflictStore";

describe("conflictStore and unknown-field helpers", () => {
  beforeEach(() => {
    clearRecordedGuiOperationIds();
    useConflictStore.getState().clearAllConflicts();
  });

  test("tracks GUI operationIds and ignores unknown or empty IDs", () => {
    const opId = generateOperationId();
    expect(opId.length).toBeGreaterThan(8);
    expect(isOwnGuiOperationId(opId)).toBe(false);

    recordGuiOperationId(opId);
    expect(isOwnGuiOperationId(opId)).toBe(true);
    expect(isOwnGuiOperationId(null)).toBe(false);
    expect(isOwnGuiOperationId(undefined)).toBe(false);
    expect(isOwnGuiOperationId("external-mcp-op")).toBe(false);
  });

  test("detects CONFLICT: prefixed backend errors", () => {
    expect(
      isConflictError("CONFLICT: expected rev_a, found rev_b on phonology.json"),
    ).toBe(true);
    expect(
      isConflictError(new Error("CONFLICT: revision mismatch")),
    ).toBe(true);
    expect(isConflictError("IO error: permission denied")).toBe(false);
  });

  test("mergeById preserves unknown extra fields on matched items", () => {
    interface ItemWithId {
      id: string;
      label: string;
    }
    const existing = [
      { id: "a", label: "Old A", future_mcp_flag: 42 } as ItemWithId & {
        future_mcp_flag: number;
      },
      { id: "b", label: "Old B" },
    ];
    const incoming: ItemWithId[] = [
      { id: "a", label: "New A" },
      { id: "c", label: "New C" },
    ];
    const merged = mergeById(existing, incoming, "id");
    expect(merged).toHaveLength(2);
    expect(
      (merged[0] as unknown as Record<string, unknown>).future_mcp_flag,
    ).toBe(42);
    expect(merged[0].label).toBe("New A");
    expect(merged[1]).toEqual({ id: "c", label: "New C" });
  });

  test("computeJsonDiffSummary reports top-level changed keys and JSON previews", () => {
    const diff = computeJsonDiffSummary(
      { inventory: ["p", "t"], notes: "local", unchanged: 1 },
      { inventory: ["p", "t", "k"], notes: "disk", unchanged: 1 },
    );
    expect(diff.changedFields).toEqual(["inventory", "notes"]);
    expect(diff.localPreview).toContain('"notes": "local"');
    expect(diff.diskPreview).toContain('"notes": "disk"');
  });

  test("useConflictStore resolves Keep Local and Use Disk actions cleanly", async () => {
    let keptLocalWithRev = "";
    let usedDisk = 0;

    useConflictStore.getState().upsertConflict(
      {
        key: "phonology:/proj:child",
        kind: "phonology",
        projectPath: "/proj",
        languagePath: "child",
        languageId: "lang_child",
        corpusId: null,
        origin: "mcp",
        diskRevision: "rev_2",
        reason: "CONFLICT",
        changedFields: ["phonotactics"],
        localPreview: "{}",
        diskPreview: "{}",
      },
      {
        keepLocal: async (diskRevision) => {
          keptLocalWithRev = diskRevision;
        },
        useDisk: async () => {
          usedDisk += 1;
        },
      },
    );

    expect(useConflictStore.getState().conflicts).toHaveLength(1);
    await useConflictStore.getState().resolveKeepLocal("phonology:/proj:child");
    expect(keptLocalWithRev).toBe("rev_2");
    expect(usedDisk).toBe(0);
    expect(useConflictStore.getState().conflicts).toHaveLength(0);

    useConflictStore.getState().upsertConflict(
      {
        key: "lexicon:/proj:child",
        kind: "lexicon",
        projectPath: "/proj",
        languagePath: "child",
        languageId: "lang_child",
        corpusId: null,
        origin: "external",
        diskRevision: "rev_4",
        reason: "CONFLICT",
        changedFields: ["modified_words"],
        localPreview: "{}",
        diskPreview: "{}",
      },
      {
        keepLocal: async (diskRevision) => {
          keptLocalWithRev = diskRevision;
        },
        useDisk: async () => {
          usedDisk += 1;
        },
      },
    );

    await useConflictStore.getState().resolveUseDisk("lexicon:/proj:child");
    expect(usedDisk).toBe(1);
    expect(useConflictStore.getState().conflicts).toHaveLength(0);
  });
});
