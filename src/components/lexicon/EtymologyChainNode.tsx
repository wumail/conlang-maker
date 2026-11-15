/**
 * EtymologyChainNode.tsx — 词源链的单个节点卡片与关系文案
 *
 * 从 EtymologyChainView 拆出，保证两个组件都 ≤300 行；
 * 节点自身只负责展示（步骤徽章 / 语言 / 可点击词形 / 断链 / 借入快照 / 构词成分），
 * 连接线与「继承自 / 借自」关系由父组件绘制。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import type { EtymologyChainNode } from "../../core/engines/etymologyLineage";
import type { SemanticChangeKind } from "../../types";
import { BADGE } from "../../lib/ui";

const STEP_STYLES: Record<EtymologyChainNode["stepKind"], string> = {
  self: "badge-primary",
  inherited: "badge-info",
  borrowed: "badge-warning",
  component: "badge-neutral",
};

const STEP_KEYS: Record<EtymologyChainNode["stepKind"], string> = {
  self: "lexicon.etymologyV3.stepSelf",
  inherited: "lexicon.etymologyV3.stepInherited",
  borrowed: "lexicon.etymologyV3.stepBorrowed",
  component: "lexicon.etymologyV3.stepComponent",
};

/** 连接线上标注的关系：箭头指向来源，故用上一级节点的 stepKind 描述 */
export const RELATION_KEYS: Record<EtymologyChainNode["stepKind"], string> = {
  self: "lexicon.etymologyV3.relSource",
  inherited: "lexicon.etymologyV3.relInherited",
  borrowed: "lexicon.etymologyV3.relBorrowed",
  component: "lexicon.etymologyV3.relComponent",
};

export const SEMANTIC_KIND_KEYS: Record<SemanticChangeKind, string> = {
  unchanged: "lexicon.etymologyV3.kindUnchanged",
  narrowing: "lexicon.etymologyV3.kindNarrowing",
  broadening: "lexicon.etymologyV3.kindBroadening",
  shift: "lexicon.etymologyV3.kindShift",
  metaphor: "lexicon.etymologyV3.kindMetaphor",
  added_sense: "lexicon.etymologyV3.kindAddedSense",
  replaced_sense: "lexicon.etymologyV3.kindReplacedSense",
};

/** 单条链路节点：步骤徽章 + 语言 + 可点击词形 + 断链/音变/语义/借入快照/成分芯片 */
export const ChainNodeRow: React.FC<{
  node: EtymologyChainNode;
  onJump: (target: { languageId: string; entryId: string }) => void;
  isCurrent: boolean;
}> = ({ node, onJump, isCurrent }) => {
  const { t } = useTranslation();
  const snapshot = node.borrowedSnapshot;
  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        node.broken ? "border-error/40 bg-error/5" : "border-base-300 bg-base-100"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`${BADGE} badge-xs ${STEP_STYLES[node.stepKind]}`}>
          {t(STEP_KEYS[node.stepKind])}
        </span>
        <span className="text-[10px] text-base-content/50">{node.languageName}</span>
        {node.broken ? (
          <span className="font-mono text-error">{node.entryId || "?"}</span>
        ) : (
          <button
            type="button"
            disabled={isCurrent}
            className="font-mono text-primary underline-offset-2 hover:underline disabled:no-underline disabled:text-base-content"
            onClick={() => onJump({ languageId: node.languageId, entryId: node.entryId })}
          >
            {node.romanized}
          </button>
        )}
        {node.gloss && <span className="text-base-content/60">{node.gloss}</span>}
        {node.broken && (
          <span className={`${BADGE} badge-error badge-xs`}>{t("lexicon.etymologyV3.brokenLinkBadge")}</span>
        )}
      </div>

      {node.brokenReason && <p className="mt-0.5 text-[10px] text-error">{node.brokenReason}</p>}

      {node.semanticChangeKind && node.semanticChangeKind !== "unchanged" && (
        <p className="mt-0.5 text-[10px] text-base-content/60">
          {t(SEMANTIC_KIND_KEYS[node.semanticChangeKind])}
          {node.semanticShiftNote ? ` · ${node.semanticShiftNote}` : ""}
        </p>
      )}

      {snapshot && (
        <div className="mt-1 rounded bg-warning/10 px-1.5 py-1 text-[10px] text-base-content/70">
          <span className="font-medium">{t("lexicon.etymologyV3.borrowedSnapshotTitle")}:</span>{" "}
          <span className="font-mono">{snapshot.borrowed_form}</span>
          {snapshot.borrowed_gloss ? ` · ${snapshot.borrowed_gloss}` : ""}
          {snapshot.source_language_name ? ` · ${snapshot.source_language_name}` : ""}
          {snapshot.source_family_name ? ` · ${snapshot.source_family_name}` : ""}
          {node.broken && <div>{t("lexicon.etymologyV3.sourceDeletedKeepSnapshot")}</div>}
        </div>
      )}

      {node.components && node.components.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {node.components.map((component, index) => (
            <span
              key={`${component.entryId ?? component.surface}_${index}`}
              className={`${BADGE} badge-outline badge-xs gap-1`}
            >
              {component.entryId ? (
                <button
                  type="button"
                  className={component.broken ? "text-error" : "hover:underline"}
                  onClick={() =>
                    onJump({ languageId: node.languageId, entryId: component.entryId ?? "" })
                  }
                >
                  {component.surface}
                </button>
              ) : (
                <span className="font-mono">{component.surface}</span>
              )}
              {component.gloss ? `·${component.gloss}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
