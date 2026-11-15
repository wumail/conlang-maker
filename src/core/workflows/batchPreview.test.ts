import { describe, expect, test } from "bun:test";
import { buildDiffRows, isPreviewStale, summarizeImpact } from "./batchPreview";

describe("buildDiffRows (Roadmap v3 W4)", () => {
  test("keeps only rows whose value actually changes", () => {
    const rows = buildDiffRows([
      {
        id: "sense_1",
        label: "kata",
        sublabel: "sense 1",
        before: "stone",
        after: "rock",
      },
      {
        id: "sense_2",
        label: "kata",
        sublabel: "sense 2",
        before: "weight",
        after: "weight",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: "sense_1",
      label: "kata",
      sublabel: "sense 1",
      before: "stone",
      after: "rock",
    });
  });

  test("keeps warnings attached to changed rows", () => {
    const rows = buildDiffRows([
      {
        id: "tok_1",
        label: "kata → katta",
        before: "stone",
        after: "stone-PL",
        warning: "overwrites verified token",
      },
    ]);
    expect(rows[0]?.warning).toBe("overwrites verified token");
  });

  test("returns an empty preview when nothing changes", () => {
    expect(
      buildDiffRows([
        { id: "a", label: "a", before: "", after: "" },
        { id: "b", label: "b", before: "x", after: "x" },
      ]),
    ).toEqual([]);
  });
});

describe("isPreviewStale (Roadmap v3 W4)", () => {
  test("detects revision drift between preview snapshot and current store", () => {
    expect(isPreviewStale("rev_a", "rev_b")).toBe(true);
    expect(isPreviewStale("rev_a", "rev_a")).toBe(false);
  });

  test("treats unknown revisions as not stale instead of blocking the user", () => {
    expect(isPreviewStale(null, "rev_b")).toBe(false);
    expect(isPreviewStale("rev_a", undefined)).toBe(false);
    expect(isPreviewStale("", "")).toBe(false);
  });
});

describe("summarizeImpact (Roadmap v3 W4)", () => {
  test("normalises missing corpus hits to zero", () => {
    expect(summarizeImpact({ affectedEntries: 3, affectedSenses: 5 })).toEqual({
      entries: 3,
      senses: 5,
      corpusHits: 0,
    });
  });

  test("passes through corpus hit counts for the delete confirmation dialog", () => {
    expect(
      summarizeImpact({ affectedEntries: 1, affectedSenses: 2, corpusHits: 7 }),
    ).toEqual({ entries: 1, senses: 2, corpusHits: 7 });
  });
});
