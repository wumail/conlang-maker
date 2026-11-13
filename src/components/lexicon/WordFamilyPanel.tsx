import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, GitBranch } from "lucide-react";
import type { WordEntry } from "../../types";
import {
  getWordFamilyGraph,
  type WordFamilyNode,
} from "../../core/engines/wordFamily";
import { BADGE, BTN_LINK } from "../../lib/ui";
import { useCompoundRelationLabels } from "../../lib/labelMaps";

interface WordFamilyPanelProps {
  word: WordEntry;
  wordsMap: Record<string, WordEntry>;
  onNavigate: (entryId: string) => void;
}

function UpstreamTree({
  nodes,
  depth,
  onNavigate,
  relationLabel,
}: {
  nodes: WordFamilyNode[];
  depth: number;
  onNavigate: (entryId: string) => void;
  relationLabel: (relation: string) => string;
}) {
  return (
    <ul className={depth > 0 ? "ml-3 border-l border-base-300 pl-2" : ""}>
      {nodes.map((node, index) => (
        <li key={`${node.entryId}_${index}`} className="py-0.5">
          <button
            type="button"
            disabled={node.missing}
            onClick={() => !node.missing && onNavigate(node.entryId)}
            className={`inline-flex items-center gap-1 text-xs ${
              node.missing ? "text-error/70" : "hover:text-primary"
            }`}
            title={node.missing ? node.form : `${node.form} /${node.ipa}/`}
          >
            <GitBranch size={11} className="text-base-content/40" />
            <span className="font-mono">{node.form}</span>
            <span className={`${BADGE} badge-xs badge-ghost`}>
              {relationLabel(node.relation)}
            </span>
            {node.missing && <span className="text-[10px]">missing</span>}
          </button>
          {node.children.length > 0 && (
            <UpstreamTree
              nodes={node.children}
              depth={depth + 1}
              onNavigate={onNavigate}
              relationLabel={relationLabel}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** 词族面板：上游构词成分树 + 下游派生/复合子孙 */
export const WordFamilyPanel: React.FC<WordFamilyPanelProps> = ({
  word,
  wordsMap,
  onNavigate,
}) => {
  const { t } = useTranslation();
  const relationLabels = useCompoundRelationLabels();
  const graph = useMemo(() => getWordFamilyGraph(word.entry_id, wordsMap), [word.entry_id, wordsMap]);
  const relationLabel = (relation: string) => relationLabels[relation] ?? relation;

  if (graph.upstream.length === 0 && graph.downstream.length === 0) return null;

  return (
    <div className="rounded-lg border border-base-300 bg-base-200/40 p-2.5 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-base-content/70">
        <GitBranch size={13} />
        {t("lexicon.family.title")}
        <span className="text-[10px] font-normal text-base-content/40">
          {t("lexicon.family.size", { count: graph.size })}
        </span>
      </div>

      {graph.upstream.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] text-base-content/50">{t("lexicon.family.upstream")}</p>
          <UpstreamTree
            nodes={graph.upstream}
            depth={0}
            onNavigate={onNavigate}
            relationLabel={relationLabel}
          />
        </div>
      )}

      {graph.downstream.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] text-base-content/50">{t("lexicon.family.downstream")}</p>
          <div className="flex flex-wrap gap-1">
            {graph.downstream.map((node) => (
              <button
                key={node.entryId}
                type="button"
                onClick={() => onNavigate(node.entryId)}
                className={`${BTN_LINK} rounded border border-base-300 bg-base-100 px-1.5 py-0.5 text-xs`}
                title={t("lexicon.family.depthHint", { depth: node.depth })}
              >
                <ChevronRight size={10} className="text-base-content/40" />
                <span className="font-mono">{node.form}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
