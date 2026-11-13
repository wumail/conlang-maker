import { describe, expect, test } from "bun:test";
import { CORE_CONCEPTS, SEMANTIC_FIELDS, getCoreConcept, searchConcepts } from "./core_concepts";

const STANDARD_LISTS = ["swadesh_100", "leipzig_jakarta_100"] as const;

function withList(list: (typeof STANDARD_LISTS)[number]) {
  return CORE_CONCEPTS.filter((concept) => (concept.standard_lists ?? []).includes(list));
}

describe("CORE_CONCEPTS standard-list completeness", () => {
  test("Swadesh-100 has exactly 100 concepts", () => {
    expect(withList("swadesh_100")).toHaveLength(100);
  });

  test("Leipzig-Jakarta-100 has exactly 100 concepts", () => {
    expect(withList("leipzig_jakarta_100")).toHaveLength(100);
  });

  test("concept ids stay unique across the library", () => {
    const ids = CORE_CONCEPTS.map((concept) => concept.concept_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every standard-list concept carries a Concepticon id", () => {
    for (const concept of CORE_CONCEPTS) {
      if ((concept.standard_lists ?? []).length === 0) continue;
      expect(concept.concepticon_id ?? "").not.toBe("");
    }
  });

  test("Concepticon ids are unique (no double-mapping)", () => {
    const ids = CORE_CONCEPTS.map((concept) => concept.concepticon_id).filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("well-known Concepticon anchors match the official numbering", () => {
    expect(getCoreConcept("i")?.concepticon_id).toBe("1209");
    expect(getCoreConcept("water")?.concepticon_id).toBe("948");
    expect(getCoreConcept("fire")?.concepticon_id).toBe("221");
    expect(getCoreConcept("sun")?.concepticon_id).toBe("1343");
    expect(getCoreConcept("name")?.concepticon_id).toBe("1405");
  });

  test("the 14 added Leipzig-Jakarta gaps are present", () => {
    for (const conceptId of [
      "go",
      "you_plural",
      "he",
      "day",
      "year",
      "become",
      "break",
      "cut",
      "dig",
      "tie",
      "jump",
      "wash",
      "cry",
      "hold",
    ]) {
      const concept = getCoreConcept(conceptId);
      expect(concept).toBeDefined();
      expect(concept?.standard_lists ?? []).toContain("leipzig_jakarta_100");
    }
  });

  test("every concept uses a declared semantic field", () => {
    const fields = new Set<string>(SEMANTIC_FIELDS);
    for (const concept of CORE_CONCEPTS) {
      expect(fields.has(concept.semantic_field)).toBe(true);
    }
  });
});

describe("searchConcepts", () => {
  test("matches Chinese gloss, English gloss and id", () => {
    expect(searchConcepts("水")[0]?.concept.concept_id).toBe("water");
    expect(searchConcepts("water")[0]?.concept.concept_id).toBe("water");
    expect(searchConcepts("water")[0]?.matchedOn).toBe("id");
  });

  test("respects semantic-field filtering and limit", () => {
    const hits = searchConcepts("", { field: "nature", limit: 5 });
    expect(hits).toHaveLength(5);
    expect(hits.every((hit) => hit.concept.semantic_field === "nature")).toBe(true);
  });
});
