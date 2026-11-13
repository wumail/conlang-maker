/** 词典侧栏的概念筛选选项：从当前语言已绑定的义项概念去重生成 */
import type { ConceptDefinition, WordEntry } from "../types";
import { getCoreConcept } from "../data/core_concepts";

export interface ConceptOption {
  id: string;
  label: string;
}

/** 统计当前语言实际用到的 concept_id，并按展示名排序 */
export function buildConceptOptions(
  words: readonly WordEntry[],
  customConcepts: readonly ConceptDefinition[] = [],
): ConceptOption[] {
  const ids = new Set<string>();
  for (const word of words) {
    for (const sense of word.senses) {
      if (sense.concept_id) ids.add(sense.concept_id);
    }
  }
  const customById = new Map(customConcepts.map((concept) => [concept.concept_id, concept]));
  const options: ConceptOption[] = [];
  for (const id of ids) {
    const concept = getCoreConcept(id) ?? customById.get(id);
    const label = concept ? concept.gloss_zh || concept.gloss_en : id;
    options.push({ id, label: `${label} (${id})` });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}
