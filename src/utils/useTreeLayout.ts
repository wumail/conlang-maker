/**
 * dagre-based auto layout for the language family tree.
 * Converts LanguageEntry[] into ReactFlow nodes + edges with top-to-bottom positioning.
 */
import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { LanguageEntry } from "../types";

/** Data payload attached to every ReactFlow node */
export type TreeNodeData = {
  language: LanguageEntry;
  stats?: { word_count: number; created_at: number | null; updated_at: number | null };
  canDelete: boolean;
  onFork: (parentId: string) => void;
  onSwitch: (languageId: string) => void;
  onDelete: (lang: LanguageEntry) => void;
  [key: string]: unknown;
};

export type TreeFlowNode = Node<TreeNodeData, "treeNode">;

const NODE_WIDTH = 200;
const NODE_HEIGHT = 120;

export function useTreeLayout(
  languages: LanguageEntry[],
  languageStats: Record<string, { word_count: number; created_at: number | null; updated_at: number | null }>,
  callbacks: {
    onFork: (parentId: string) => void;
    onSwitch: (languageId: string) => void;
    onDelete: (lang: LanguageEntry) => void;
  },
): { nodes: TreeFlowNode[]; edges: Edge[] } {
  return useMemo(() => {
    if (languages.length === 0) return { nodes: [], edges: [] };

    // Build dagre graph
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "TB",
      nodesep: 60,
      ranksep: 80,
      marginx: 40,
      marginy: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Collect children count for canDelete check
    const childCount = new Map<string, number>();
    for (const lang of languages) {
      if (lang.parent_id) {
        childCount.set(lang.parent_id, (childCount.get(lang.parent_id) ?? 0) + 1);
      }
    }

    for (const lang of languages) {
      g.setNode(lang.language_id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }

    const edges: Edge[] = [];
    for (const lang of languages) {
      if (lang.parent_id) {
        const edgeId = `e-${lang.parent_id}-${lang.language_id}`;
        g.setEdge(lang.parent_id, lang.language_id);
        edges.push({
          id: edgeId,
          source: lang.parent_id,
          target: lang.language_id,
          style: { strokeWidth: 2 },
        });
      }
    }

    dagre.layout(g);

    const nodes: TreeFlowNode[] = languages.map((lang) => {
      const pos = g.node(lang.language_id);
      const hasChildren = (childCount.get(lang.language_id) ?? 0) > 0;
      const canDelete = !hasChildren && languages.length > 1;
      return {
        id: lang.language_id,
        type: "treeNode",
        position: {
          x: pos.x - NODE_WIDTH / 2,
          y: pos.y - NODE_HEIGHT / 2,
        },
        data: {
          language: lang,
          stats: languageStats[lang.language_id],
          canDelete,
          onFork: callbacks.onFork,
          onSwitch: callbacks.onSwitch,
          onDelete: callbacks.onDelete,
        },
      };
    });

    return { nodes, edges };
  }, [languages, languageStats, callbacks]);
}
