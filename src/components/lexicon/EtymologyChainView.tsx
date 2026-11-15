/**
 * EtymologyChainView.tsx — 可点击词源追溯链（Roadmap v3 / Pillar 1）
 *
 * 展开时按需读取全语系词典（lineageLexiconStore 缓存），调用 buildEtymologyLineage
 * 渲染完整链路：本语言成分直接切换词条，父语/供语词条自动切换语言并定位；
 * 断链显示红色徽章，可一键清除失效引用。
 * 供语词条已删除（快照保留）或快照属于外部项目时，节点降级为不可点击的纯文本行，
 * 只展示柔和的历史快照提示——绝不渲染内部枚举码，也绝不跳到不存在的语言/词条。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, ArrowUp, ChevronDown, ChevronRight, Link2, Unlink } from "lucide-react";
import {
  buildEtymologyLineage,
  type EtymologyChainNode,
} from "../../core/engines/etymologyLineage";
import { useLexiconStore } from "../../store/lexiconStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import {
  getLineageLexicon,
  loadLineageLexicon,
  useLineageLexiconCacheVersion,
} from "../../store/lineageLexiconStore";
import { saveLanguageViewMemory } from "../../lib/languageViewMemory";
import type { Etymology, WordEntry } from "../../types";
import { BADGE, BTN_GHOST, BTN_LINK } from "../../lib/ui";
import { ChainNodeRow } from "./EtymologyChainNode";

interface EtymologyChainViewProps {
  word: WordEntry;
  onChangeEtymology: (next: Etymology) => void;
}

type StepKind = EtymologyChainNode["stepKind"];

/** 供语词条已删 / 属外部项目：快照完整保留，但不是断链，也不可点击 */
const SNAPSHOT_KEPT_REASON = "donor_removed_snapshot_kept";

/** 步骤徽章文案：显式 t() 调用，避免间接键字典让 i18n:check 无法静态识别 */
function stepLabel(t: TFunction, kind: StepKind): string {
  switch (kind) {
    case "self":
      return t("lexicon.etymologyV3.stepSelf");
    case "inherited":
      return t("lexicon.etymologyV3.stepInherited");
    case "borrowed":
      return t("lexicon.etymologyV3.stepBorrowed");
    case "component":
      return t("lexicon.etymologyV3.stepComponent");
  }
}

/** 连接线关系文案：箭头指向来源，用上一级节点的 stepKind 描述 */
function relationLabel(t: TFunction, kind: StepKind): string {
  switch (kind) {
    case "self":
      return t("lexicon.etymologyV3.relSource");
    case "inherited":
      return t("lexicon.etymologyV3.relInherited");
    case "borrowed":
      return t("lexicon.etymologyV3.relBorrowed");
    case "component":
      return t("lexicon.etymologyV3.relComponent");
  }
}

/** 不可达节点（快照仍在）：纯文本行 + 柔和提示，不提供任何点击入口 */
const SnapshotNodeRow: React.FC<{
  node: EtymologyChainNode;
  keptHint: boolean;
}> = ({ node, keptHint }) => {
  const { t } = useTranslation();
  const snapshot = node.borrowedSnapshot;
  return (
    <div className="rounded-md border border-base-300 bg-base-100 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`${BADGE} badge-xs badge-warning`}>
          {stepLabel(t, node.stepKind)}
        </span>
        <span className="text-[10px] text-base-content/50">{node.languageName}</span>
        <span className="font-mono text-base-content/70">{node.romanized || node.entryId}</span>
        {node.gloss && <span className="text-base-content/60">{node.gloss}</span>}
        {keptHint && (
          <span className={`${BADGE} badge-ghost badge-xs`}>
            {t("lexicon.etymologyV3.sourceDeletedKeepSnapshot")}
          </span>
        )}
      </div>
      {snapshot && (
        <p className="mt-0.5 text-[10px] text-base-content/60">
          <span className="font-medium">{t("lexicon.etymologyV3.borrowedSnapshotTitle")}:</span>{" "}
          <span className="font-mono">{snapshot.borrowed_form}</span>
          {snapshot.borrowed_gloss ? ` · ${snapshot.borrowed_gloss}` : ""}
          {snapshot.source_language_name ? ` · ${snapshot.source_language_name}` : ""}
          {snapshot.source_family_name ? ` · ${snapshot.source_family_name}` : ""}
        </p>
      )}
    </div>
  );
};

export const EtymologyChainView: React.FC<EtymologyChainViewProps> = ({
  word,
  onChangeEtymology,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const languages = useWorkspaceStore((s) => s.config.languages);
  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const conlangFilePath = useWorkspaceStore((s) => s.conlangFilePath);
  const setActiveLanguage = useWorkspaceStore((s) => s.setActiveLanguage);
  const currentWords = useLexiconStore((s) => s.wordsMap);
  const setActiveWordId = useLexiconStore((s) => s.setActiveWordId);
  const cacheVersion = useLineageLexiconCacheVersion();

  // 展开后按需预热其余语言词典（缓存层自带并发去重）
  useEffect(() => {
    if (!expanded || !projectPath) return;
    for (const language of languages) {
      if (language.language_id === activeLanguageId) continue;
      void loadLineageLexicon(projectPath, language.path);
    }
  }, [expanded, projectPath, languages, activeLanguageId]);

  const wordsByLanguage = useMemo(() => {
    const map: Record<string, Record<string, WordEntry>> = {
      [activeLanguageId]: currentWords,
    };
    // 折叠状态只需当前语言词典，避免无谓的全语系快照遍历
    if (!expanded || !projectPath) return map;
    for (const language of languages) {
      if (language.language_id === activeLanguageId) continue;
      const snapshot = getLineageLexicon(projectPath, language.path);
      if (snapshot) map[language.language_id] = snapshot.wordsById;
    }
    return map;
    // cacheVersion 参与依赖：缓存加载完成/失效后重建索引
  }, [expanded, languages, activeLanguageId, currentWords, projectPath, cacheVersion]);

  const lineage = useMemo(() => {
    if (!expanded) {
      return { nodes: [], hasBrokenLinks: false, brokenLinks: [] };
    }
    return buildEtymologyLineage({ word, activeLanguageId, languages, wordsByLanguage });
  }, [expanded, word, activeLanguageId, languages, wordsByLanguage]);

  /** 跳转前校验：目标语言必须属本工作区，且目标词条确实存在于已加载词典 */
  const isReachable = (target: { languageId: string; entryId: string }): boolean => {
    if (!target.entryId) return false;
    const knownLanguage =
      target.languageId === activeLanguageId ||
      languages.some((language) => language.language_id === target.languageId);
    if (!knownLanguage) return false;
    const dict = wordsByLanguage[target.languageId];
    return dict ? Boolean(dict[target.entryId]) : true;
  };

  const jumpTo = (target: { languageId: string; entryId: string }): void => {
    // 断链成分 / 已删供语 / 外部项目快照：一律不跳转，避免落到空页面
    if (!isReachable(target)) return;
    if (target.languageId === activeLanguageId) {
      if (target.entryId !== word.entry_id) setActiveWordId(target.entryId);
      return;
    }
    // 记住目标语言的落点，切换后由 App 的视图记忆恢复逻辑选中该词
    saveLanguageViewMemory(target.languageId, { activeWordId: target.entryId });
    setActiveLanguage(target.languageId);
  };

  const clearBrokenRefs = (): void => {
    const missingComponentIds = new Set(
      lineage.brokenLinks
        .filter((link) => link.kind === "component")
        .map((link) => link.missingId),
    );
    const parentBroken = lineage.brokenLinks.some((link) => link.kind === "parent");
    onChangeEtymology({
      ...word.etymology,
      parent_entry_id: parentBroken ? null : word.etymology.parent_entry_id,
      components: (word.etymology.components ?? []).filter(
        (component) => !component.entry_id || !missingComponentIds.has(component.entry_id),
      ),
    });
  };

  return (
    <div className="rounded-lg border border-base-300 bg-base-200/30">
      <button
        type="button"
        className={`${BTN_GHOST} w-full justify-between`}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="flex items-center gap-1.5 text-xs font-medium">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Link2 size={13} />
          {t("lexicon.etymologyV3.lineageTitle")}
        </span>
        {lineage.hasBrokenLinks && (
          <span className={`${BADGE} badge-error badge-xs`}>{t("lexicon.etymologyV3.brokenLinkBadge")}</span>
        )}
      </button>

      {expanded && (
        <div className="space-y-1.5 border-t border-base-300 px-2 py-2">
          {lineage.hasBrokenLinks && (
            <div className="flex items-center gap-2 rounded border border-error/40 bg-error/10 px-2 py-1 text-[11px]">
              <AlertTriangle size={12} className="shrink-0 text-error" />
              <span className="flex-1 text-error">
                {t("lexicon.etymologyV3.brokenLinkBadge")}:{" "}
                {lineage.brokenLinks.map((link) => link.missingId).join(", ")}
              </span>
              <button type="button" className={`${BTN_LINK} text-[11px]`} onClick={clearBrokenRefs}>
                <Unlink size={11} /> {t("lexicon.etymologyV3.clearBrokenRef")}
              </button>
            </div>
          )}

          <div className="flex items-center gap-1 text-[10px] text-base-content/50">
            <ArrowUp size={11} className="text-primary" />
            {t("lexicon.etymologyV3.chainDirectionHint")}
          </div>

          <ol className="relative">
            {lineage.nodes.map((node, index) => {
              const next = lineage.nodes[index + 1];
              // 构词成分是分支节点：只有它的下一级仍是成分时才连线，避免把无关祖先画成来源
              const source =
                next && (node.stepKind !== "component" || next.stepKind === "component")
                  ? next
                  : undefined;
              const snapshotKept = node.brokenReason === SNAPSHOT_KEPT_REASON;
              const externalSnapshot = Boolean(
                conlangFilePath &&
                  node.borrowedSnapshot?.source_conlang_path &&
                  node.borrowedSnapshot.source_conlang_path !== conlangFilePath,
              );
              // 断链节点由 ChainNodeRow 渲染为纯文本；快照仍在的不可达节点渲染为纯文本行
              const textOnly = !node.broken && (snapshotKept || externalSnapshot);
              return (
                <li
                  key={`${node.stepKind}_${node.languageId}_${node.entryId}_${index}`}
                  className="relative pb-1 pl-6"
                >
                  {source && (
                    <span
                      className="absolute bottom-0 left-[9px] top-5 w-px bg-base-300"
                      aria-hidden
                    />
                  )}
                  <span
                    className={`absolute left-[4px] top-2.5 h-2.5 w-2.5 rounded-full border-2 ${
                      node.stepKind === "self"
                        ? "border-primary bg-primary"
                        : "border-primary/70 bg-base-100"
                    }`}
                    aria-hidden
                  />
                  {textOnly ? (
                    <SnapshotNodeRow node={node} keptHint={snapshotKept} />
                  ) : (
                    <ChainNodeRow
                      // 内部枚举码不外泄：断链原因只以徽章呈现
                      node={node.brokenReason ? { ...node, brokenReason: undefined } : node}
                      onJump={jumpTo}
                      isCurrent={node.stepKind === "self"}
                    />
                  )}
                  {source && (
                    <div className="flex flex-wrap items-center gap-1 py-0.5 pl-1 text-[10px] text-base-content/50">
                      <ArrowUp size={11} className="shrink-0 text-primary" />
                      <span>{relationLabel(t, source.stepKind)}</span>
                      {node.appliedSoundChanges && node.appliedSoundChanges.length > 0 && (
                        <span className="truncate font-mono">
                          · {node.appliedSoundChanges.join(" → ")}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
};
