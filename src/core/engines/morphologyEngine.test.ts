import { describe, expect, test } from "bun:test";
import type { GrammarConfig, PhonologyConfig } from "../../types";
import rawGrammar from "../../../tests/fixtures/workspace-basic/roots/root/grammar.json";
import rawPhonology from "../../../tests/fixtures/workspace-basic/roots/root/phonology.json";
import { generateParadigm } from "./morphologyEngine";

const phono = rawPhonology as PhonologyConfig;

describe("compiled inflection paradigms", () => {
  test("complete forms remain visible when template rules are disabled", () => {
    const grammar = structuredClone(rawGrammar) as GrammarConfig;
    grammar.inflection_rules = grammar.inflection_rules.map((rule) => ({ ...rule, disabled: true }));
    grammar.inflection_dimensions = [{
      dim_id: "case", name: "Case", applies_to_pos: ["noun"],
      values: [{ val_id: "loc", name: "Locative", gloss: "LOC." }],
    }];
    grammar.irregular_overrides = [{
      entry_id: "entry", dimension_values: { case: "loc" }, surface_form: "ma·ala", stem_start: 3,
    }];
    const cells = generateParadigm("ala", "noun", grammar.inflection_rules, phono, { entryId: "entry", grammar });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ result: "ma·ala", stem_start: 3, tag: "LOC" });
    expect(generateParadigm("ala", "verb", [], phono, { entryId: "entry", grammar })).toEqual([]);
    expect(generateParadigm("ala", "noun", [], phono)).toEqual([]);
  });

  test("a partial override overlays regular cells without adding a duplicate pattern row", () => {
    const grammar = structuredClone(rawGrammar) as GrammarConfig;
    grammar.inflection_dimensions = [{ dim_id: "number", name: "Number", applies_to_pos: ["noun"], values: [] }];
    grammar.inflection_rules = [{ ...grammar.inflection_rules[0], pos_id: "noun", dimension_values: { number: "plural" }, disabled: false }];
    grammar.irregular_overrides = [{ entry_id: "entry", dimension_values: {}, surface_form: "irregular", stem_start: 1 }];
    const cells = generateParadigm("ala", "noun", grammar.inflection_rules, phono, { entryId: "entry", grammar });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ result: "irregular", stem_start: 1, dimensionValues: { number: "plural" } });
  });
});
