/**
 * SaveStatusPill.tsx — 全局保存状态胶囊（Roadmap v3 / Pillar 7）
 *
 * 聚合 6 个业务 Store 的 dirty、冲突数量与 saveStatusTracker 快照，
 * 显示 Saved / Saving… / Save failed · Retry / Conflict。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Loader2, RotateCw } from "lucide-react";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import { useSCAStore } from "../../store/scaStore";
import { useCorpusStore } from "../../store/corpusStore";
import { useWorkspaceStore, flushAllDomainStores } from "../../store/workspaceStore";
import { useConflictStore } from "../../store/conflictStore";
import {
  clearSaveError,
  useSaveStatusSnapshot,
} from "../../store/saveStatusTracker";
import { BTN_GHOST_SQ } from "../../lib/ui";

export const SaveStatusPill: React.FC = () => {
  const { t } = useTranslation();
  const status = useSaveStatusSnapshot();
  const dirtyLexicon = useLexiconStore((s) => s.dirty);
  const dirtyPhono = usePhonoStore((s) => s.dirty);
  const dirtyGrammar = useGrammarStore((s) => s.dirty);
  const dirtySca = useSCAStore((s) => s.dirty);
  const dirtyCorpus = useCorpusStore((s) => s.dirty);
  const dirtyWorkspace = useWorkspaceStore((s) => s.dirty);
  const conflicts = useConflictStore((s) => s.conflicts.length);
  const saving =
    status.saving ||
    dirtyLexicon ||
    dirtyPhono ||
    dirtyGrammar ||
    dirtySca ||
    dirtyCorpus ||
    dirtyWorkspace;

  const retry = () => {
    clearSaveError();
    void flushAllDomainStores().catch((err) => console.warn("Retry flush failed:", err));
  };

  if (status.lastError) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-error/15 px-2 py-0.5 text-[11px] text-error">
        <AlertTriangle size={11} />
        {t("nav.saveStatus.failedRetry")}
        <button type="button" className={BTN_GHOST_SQ} title={t("nav.saveStatus.failedRetry")} onClick={retry}>
          <RotateCw size={11} />
        </button>
      </span>
    );
  }

  if (conflicts > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning-content">
        <AlertTriangle size={11} />
        {t("nav.saveStatus.conflict")} ({conflicts})
      </span>
    );
  }

  if (saving) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-base-200 px-2 py-0.5 text-[11px] text-base-content/60">
        <Loader2 size={11} className="animate-spin" />
        {t("nav.saveStatus.saving")}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success">
      <Check size={11} />
      {t("nav.saveStatus.saved")}
    </span>
  );
};
