import { describe, expect, test } from "bun:test";
import type {
  GrammarConfig,
  MorphosyntacticAlignment,
  WordOrder,
} from "../../types";
import {
  assignCaseRoles,
  linearizeClause,
  planToTree,
  resolveCaseDimensionValue,
  type ClauseNode,
} from "./phraseSandbox";

function makeGrammar(options: {
  word_order?: WordOrder;
  modifier_position?: "before_head" | "after_head";
  adposition_type?: "preposition" | "postposition";
  alignment?: MorphosyntacticAlignment;
  withCase?: boolean;
} = {}): GrammarConfig {
  return {
    language_id: "lang",
    syntax: {
      word_order: options.word_order ?? "SVO",
      modifier_position: options.modifier_position ?? "before_head",
      adposition_type: options.adposition_type ?? "postposition",
      alignment: options.alignment ?? "nom_acc",
    },
    parts_of_speech: [
      {
        pos_id: "pos_noun",
        name: "Noun",
        gloss_abbr: "n",
        word_pattern: "",
        requires_definition: true,
        requires_pronunciation: false,
      },
    ],
    inflection_dimensions: options.withCase === false
      ? []
      : [
          {
            dim_id: "dim_case",
            name: "Case",
            applies_to_pos: ["pos_noun"],
            values: [
              { val_id: "val_nom", name: "Nominative", gloss: "NOM" },
              { val_id: "val_acc", name: "Accusative", gloss: "ACC" },
              { val_id: "val_erg", name: "Ergative", gloss: "ERG" },
              { val_id: "val_abs", name: "Absolutive", gloss: "ABS" },
              { val_id: "val_gen", name: "Genitive", gloss: "GEN" },
            ],
          },
        ],
    inflection_rules: [],
    derivation_rules: [],
    grammar_manual: [],
    typology: {
      morphological_type: "agglutinative",
      synthesis_index: 2,
      fusion_index: 1,
      head_marking: "dependent",
      auto_estimated: false,
    },
    affix_slots: [],
    conjugation_classes: [],
    irregular_overrides: [],
  };
}

const transitive: ClauseNode = {
  subject: { head: "dog", determiner: "the", adjectives: ["big"] },
  verb: { gloss: "bite", tam: ["PST"] },
  object: { head: "bone", determiner: "the" },
};

describe("assignCaseRoles", () => {
  test("nom_acc marks S/A nominative and P accusative", () => {
    expect(assignCaseRoles("nom_acc", "S")).toBe("nom");
    expect(assignCaseRoles("nom_acc", "A")).toBe("nom");
    expect(assignCaseRoles("nom_acc", "P")).toBe("acc");
  });

  test("erg_abs marks S/P absolutive and A ergative", () => {
    expect(assignCaseRoles("erg_abs", "S")).toBe("abs");
    expect(assignCaseRoles("erg_abs", "A")).toBe("erg");
    expect(assignCaseRoles("erg_abs", "P")).toBe("abs");
  });

  test("tripartite distinguishes all three", () => {
    expect(assignCaseRoles("tripartite", "S")).toBe("nom");
    expect(assignCaseRoles("tripartite", "A")).toBe("erg");
    expect(assignCaseRoles("tripartite", "P")).toBe("acc");
  });
});

describe("resolveCaseDimensionValue", () => {
  test("matches by gloss when no explicit binding exists", () => {
    const grammar = makeGrammar({ alignment: "erg_abs" });
    expect(resolveCaseDimensionValue(grammar, "erg")).toMatchObject({
      dimId: "dim_case",
      valId: "val_erg",
      gloss: "ERG",
    });
  });

  test("explicit case_gloss_map wins over gloss matching", () => {
    const grammar = makeGrammar();
    grammar.syntax.case_gloss_map = {
      nom: { dim_id: "dim_case", val_id: "val_abs" },
    };
    expect(resolveCaseDimensionValue(grammar, "nom")?.valId).toBe("val_abs");
  });

  test("returns null for isolating languages without case values", () => {
    const grammar = makeGrammar({ withCase: false });
    expect(resolveCaseDimensionValue(grammar, "nom")).toBeNull();
  });
});

describe("linearizeClause — alignment × order × modifier position", () => {
  const orders: WordOrder[] = ["SVO", "SOV", "VSO"];
  const positions = ["before_head", "after_head"] as const;

  for (const order of orders) {
    for (const position of positions) {
      test(`${order} / ${position} / nom_acc`, () => {
        const plan = linearizeClause(
          transitive,
          makeGrammar({ word_order: order, modifier_position: position }),
        );
        expect(plan.caseTags).toEqual({ S: "NOM", A: "NOM", P: "ACC" });
        expect(plan.warnings).toHaveLength(0);

        const glosses = plan.words.map((word) => word.gloss);
        const subjectPart = ["the", "big", "dog"];
        const objectPart = ["the", "bone"];
        const subject = position === "before_head" ? subjectPart : ["dog", "big", "the"];
        const object = position === "before_head" ? objectPart : ["bone", "the"];
        const expected: Record<WordOrder, string[]> = {
          SVO: [...subject, "bite", ...object],
          SOV: [...subject, ...object, "bite"],
          VSO: ["bite", ...subject, ...object],
          VOS: ["bite", ...object, ...subject],
          OVS: [...object, "bite", ...subject],
          OSV: [...object, ...subject, "bite"],
        };
        expect(glosses).toEqual(expected[order]);
      });
    }
  }

  test("erg_abs assigns ABS to S and P, ERG to A", () => {
    const plan = linearizeClause(
      transitive,
      makeGrammar({ alignment: "erg_abs" }),
    );
    expect(plan.caseTags).toEqual({ S: "ABS", A: "ERG", P: "ABS" });
    const a = plan.words.find((word) => word.path === "subject");
    const p = plan.words.find((word) => word.path === "object");
    expect(a?.caseTag).toBe("ERG");
    expect(p?.caseTag).toBe("ABS");
  });

  test("intransitive clauses use S only", () => {
    const plan = linearizeClause(
      { subject: { head: "dog" }, verb: { gloss: "sleep" } },
      makeGrammar({ alignment: "erg_abs" }),
    );
    expect(plan.words.map((word) => word.gloss)).toEqual(["dog", "sleep"]);
    expect(plan.words[0]?.caseTag).toBe("ABS");
    expect(plan.caseTags.P).toBeNull();
  });

  test("case is attached to nominal heads only, never to modifiers", () => {
    const plan = linearizeClause(
      {
        subject: { head: "dog", determiner: "the", adjectives: ["big"] },
        verb: { gloss: "bite" },
        object: { head: "bone", possessor: { head: "wolf" } },
      },
      makeGrammar(),
    );
    const withCase = plan.words.filter((word) => word.caseTag !== null);
    expect(withCase.map((word) => word.gloss)).toEqual(["dog", "wolf", "bone"]);
    expect(plan.words.find((word) => word.gloss === "the")?.caseTag).toBeNull();
    expect(plan.words.find((word) => word.gloss === "big")?.caseTag).toBeNull();
    const possessor = plan.words.find((word) => word.role === "POSS");
    expect(possessor?.caseTag).toBe("GEN");
  });
});

describe("linearizeClause — modifier ownership", () => {
  test("each NP keeps its own adjectives (old sandbox bug)", () => {
    const plan = linearizeClause(
      {
        subject: { head: "dog", adjectives: ["big", "angry"] },
        verb: { gloss: "chase" },
        object: { head: "cat", adjectives: ["small"] },
      },
      makeGrammar({ word_order: "SOV" }),
    );
    expect(plan.words.map((word) => [word.gloss, word.path])).toEqual([
      ["big", "subject.adj[0]"],
      ["angry", "subject.adj[1]"],
      ["dog", "subject"],
      ["small", "object.adj[0]"],
      ["cat", "object"],
      ["chase", "verb"],
    ]);
  });

  test("nested PP keeps its own object and adposition", () => {
    const plan = linearizeClause(
      {
        subject: { head: "dog" },
        verb: { gloss: "sleep" },
        obliques: [
          {
            adposition: "in",
            object: {
              head: "house",
              pp: { adposition: "near", object: { head: "river" } },
            },
          },
        ],
      },
      makeGrammar({ adposition_type: "postposition" }),
    );
    expect(plan.words.map((word) => word.gloss)).toEqual([
      "dog",
      "sleep",
      "house",
      "river",
      "near",
      "in",
    ]);
  });

  test("prepositions precede their object", () => {
    const plan = linearizeClause(
      {
        subject: { head: "dog" },
        verb: { gloss: "sleep" },
        obliques: [{ adposition: "in", object: { head: "house" } }],
      },
      makeGrammar({ adposition_type: "preposition" }),
    );
    expect(plan.words.map((word) => word.gloss)).toEqual([
      "dog",
      "sleep",
      "in",
      "house",
    ]);
  });
});

describe("linearizeClause — diagnostics", () => {
  test("warns when no case dimension exists", () => {
    const plan = linearizeClause(
      transitive,
      makeGrammar({ withCase: false }),
    );
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("No case dimension");
    expect(plan.words.every((word) => word.caseTag === null)).toBe(true);
  });

  test("gloss line joins tags with hyphens", () => {
    const plan = linearizeClause(
      { subject: { head: "dog" }, verb: { gloss: "sleep", tam: ["PST"] } },
      makeGrammar(),
    );
    expect(plan.glossLine).toBe("dog-NOM sleep-PST");
  });

  test("steps describe alignment and order", () => {
    const plan = linearizeClause(transitive, makeGrammar({ word_order: "SOV" }));
    expect(plan.steps.some((step) => step.includes("Order SOV"))).toBe(true);
    expect(plan.steps.some((step) => step.includes("A → NOM"))).toBe(true);
  });
});

describe("planToTree", () => {
  test("nests subject modifiers under the subject node", () => {
    const plan = linearizeClause(transitive, makeGrammar());
    const tree = planToTree(transitive, plan);
    expect(tree.label).toBe("Clause (nom_acc)");
    const subject = tree.children[0]!;
    expect(subject.label).toBe("Subject: dog");
    expect(subject.children.map((child) => child.label)).toEqual([
      "dog-NOM",
      "big",
      "the",
    ]);
    expect(tree.children.some((child) => child.label === "Object: bone")).toBe(true);
  });
});
