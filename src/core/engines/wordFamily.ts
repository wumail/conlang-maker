/**
 * wordFamily.ts — DAG 多词素构词图谱
 *
 * 词条的 `etymology.components` 描述共时构词（`[日] + [月] → 明`）。因为成分
 * 可以再有自己的成分，整体构成一张有向无环图（DAG）；本模块提供环检测、
 * 读音摘要与词族图谱三件事。
 */
import type { MorphemeComponent, WordEntry } from "../../types";

export interface WordFamilyNode {
  entryId: string;
  form: string;
  ipa: string;
  relation: MorphemeComponent["relation"];
  /** 真实词条缺失（引用悬空）时的占位标记 */
  missing: boolean;
  children: WordFamilyNode[];
}

export interface WordFamilyDescendant {
  entryId: string;
  form: string;
  depth: number;
  /** 直接成分关系（对更深层后代取最近一级） */
  relation: MorphemeComponent["relation"];
}

export interface WordFamilyGraph {
  rootId: string;
  rootForm: string;
  upstream: WordFamilyNode[];
  downstream: WordFamilyDescendant[];
  /** 上游 + 下游去重后的词条数（不含自身） */
  size: number;
}

function componentsOf(word: WordEntry | undefined): MorphemeComponent[] {
  return word?.etymology?.components ?? [];
}

/**
 * 若把 `targetComponentId` 加为 `entryId` 的成分，是否会形成环。
 *
 * 判据：从 `targetComponentId` 出发沿成分边能否回到 `entryId`（含自指）。
 */
export function wouldIntroduceCycle(
  entryId: string,
  targetComponentId: string,
  wordsMap: Record<string, WordEntry>,
): boolean {
  if (entryId === targetComponentId) return true;

  const stack = [targetComponentId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === entryId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const component of componentsOf(wordsMap[current])) {
      if (component.entry_id) stack.push(component.entry_id);
    }
  }
  return false;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 计算成分读音摘要。
 *
 * 摘要覆盖「顺序 + 关系 + 成分词形 + IPA」，因此上游改字形或改读音都会让
 * 摘要变化，从而触发 `staleCompound` 质检。
 */
export function computeComponentsDigest(
  components: readonly MorphemeComponent[],
  wordsMap: Record<string, WordEntry>,
): string {
  if (components.length === 0) return "";
  const payload = components
    .map((component) => {
      if (component.entry_id) {
        const word = wordsMap[component.entry_id];
        const form = word?.con_word_romanized ?? "";
        const ipa = word?.phonetic_ipa ?? "";
        return `${component.relation}|${component.entry_id}|${form}|${ipa}`;
      }
      if (component.derivation_rule_id) {
        return `${component.relation}|rule:${component.derivation_rule_id}|${
          component.surface_override ?? ""
        }`;
      }
      return `${component.relation}|surface:${component.surface_override ?? ""}`;
    })
    .join("‖");
  return fnv1a(payload);
}

function buildUpstream(
  entryId: string,
  wordsMap: Record<string, WordEntry>,
  visited: Set<string>,
): WordFamilyNode[] {
  const word = wordsMap[entryId];
  return componentsOf(word).map((component) => {
    const id = component.entry_id ?? "";
    const childWord = id ? wordsMap[id] : undefined;
    const missing = Boolean(id) && !childWord;
    const alreadySeen = id ? visited.has(id) : false;
    if (id && !alreadySeen) visited.add(id);
    return {
      entryId: id || component.derivation_rule_id || "surface",
      form:
        childWord?.con_word_romanized ??
        component.surface_override ??
        (id ? `?${id}` : "(surface)"),
      ipa: childWord?.phonetic_ipa ?? "",
      relation: component.relation,
      missing,
      children:
        id && !alreadySeen && childWord
          ? buildUpstream(id, wordsMap, visited)
          : [],
    };
  });
}

/**
 * 词族图谱：上游成分树 + 下游全部派生/复合子孙。
 *
 * 下游按 `components` 反向索引后 BFS，深度取最短层级。
 */
export function getWordFamilyGraph(
  entryId: string,
  wordsMap: Record<string, WordEntry>,
): WordFamilyGraph {
  const root = wordsMap[entryId];
  const visited = new Set<string>([entryId]);
  const upstream = buildUpstream(entryId, wordsMap, visited);

  const parents = new Map<string, { word: WordEntry; relation: MorphemeComponent["relation"] }[]>();
  for (const word of Object.values(wordsMap)) {
    for (const component of componentsOf(word)) {
      if (!component.entry_id) continue;
      const list = parents.get(component.entry_id) ?? [];
      list.push({ word, relation: component.relation });
      parents.set(component.entry_id, list);
    }
  }

  const downstream: WordFamilyDescendant[] = [];
  const seen = new Set<string>([entryId]);
  let frontier: { id: string; depth: number; relation: MorphemeComponent["relation"] }[] = [
    { id: entryId, depth: 0, relation: "root" },
  ];

  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const child of parents.get(node.id) ?? []) {
        if (seen.has(child.word.entry_id)) continue;
        seen.add(child.word.entry_id);
        downstream.push({
          entryId: child.word.entry_id,
          form: child.word.con_word_romanized,
          depth: node.depth + 1,
          relation: child.relation,
        });
        next.push({
          id: child.word.entry_id,
          depth: node.depth + 1,
          relation: child.relation,
        });
      }
    }
    frontier = next;
  }

  const upstreamIds = new Set<string>();
  const walk = (nodes: WordFamilyNode[]) => {
    for (const node of nodes) {
      if (node.entryId && node.entryId !== entryId) upstreamIds.add(node.entryId);
      walk(node.children);
    }
  };
  walk(upstream);

  return {
    rootId: entryId,
    rootForm: root?.con_word_romanized ?? "",
    upstream,
    downstream: downstream.sort((a, b) => a.depth - b.depth || a.form.localeCompare(b.form)),
    size: upstreamIds.size + downstream.length,
  };
}

/** 供质检使用的「成分是否可解析」判定 */
export function hasUnresolvedComponents(
  word: WordEntry,
  wordsMap: Record<string, WordEntry>,
): boolean {
  return componentsOf(word).some(
    (component) => component.entry_id && !wordsMap[component.entry_id],
  );
}
