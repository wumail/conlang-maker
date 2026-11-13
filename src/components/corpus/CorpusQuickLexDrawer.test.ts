import { describe, expect, test } from "bun:test";
import { suggestStems } from "./CorpusQuickLexDrawer";

describe("suggestStems", () => {
  const rules = [
    { affix: "lar", tag: "PL", type: "suffix" },
    { affix: "da", tag: "LOC", type: "suffix" },
    { affix: "ka", tag: "PST", type: "suffix", disabled: true },
    { affix: "un", tag: "NEG", type: "prefix" },
  ];

  test("strips every matching enabled suffix", () => {
    const result = suggestStems("katalar", rules);
    expect(result.map((item) => item.stem)).toEqual(["kata"]);
    expect(result[0]).toMatchObject({ affix: "lar", ruleLabel: "PL" });
  });

  test("ignores disabled suffix rules and prefixes", () => {
    const result = suggestStems("kataka", rules);
    expect(result).toEqual([]);
  });

  test("never suggests an empty stem", () => {
    expect(suggestStems("lar", rules)).toEqual([]);
    expect(suggestStems("", rules)).toEqual([]);
  });

  test("caps suggestions at three entries", () => {
    const many = ["a", "b", "c", "d"].map((affix) => ({
      affix,
      tag: affix.toUpperCase(),
      type: "suffix",
    }));
    expect(suggestStems("katamana", many).length).toBeLessThanOrEqual(3);
  });
});
