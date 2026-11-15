/**
 * CognateCellDrawer.tsx — 同源矩阵单元格候选抽屉（Roadmap v3 / Pillar 5）
 *
 * 完整展示该语言在该概念下的全部候选（含义项、词源类型、标签、废弃状态与主词依据），
 * 并提供四项闭环操作：设为主词 / 恢复自动排序、跳转词条、绑定已有义项、原地新建、
 * 记录词汇空缺状态。
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Link2, Plus, PinOff, Search } from "lucide-react";
import type { CognateMatrixCell, CognateMatrixRow } from "../../core/engines/cognateMatrix";
import type { LexicalGapStatus, WordEntry, WriteResult } from "../../types";
import { invalidateLineageLexicon } from "../../store/lineageLexiconStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { createWordInLanguage } from "../../utils/crossLanguageWord";
import {
  BTN_GHOST,
  BTN_LINK,
  BTN_PRIMARY,
  INPUT,
  SELECT,
} from "../../lib/ui";
import { ModalPortal } from "../common/ModalPortal";
import { CognateCandidateList } from "./CognateCandidateList";

const GAP_OPTIONS: LexicalGapStatus[] = ["unrecorded", "tbd", "periphrastic", "confirmed_absent"];

interface CognateCellDrawerProps {
  open: boolean;
  row: CognateMatrixRow | null;
  cell: CognateMatrixCell | null;
  languageName: string;
  languagePath: string;
  projectPath: string;
  activeLanguageId: string;
  /** 该语言全部词条，用于「绑定已有义项」搜索 */
  words: WordEntry[];
  onClose: () => void;
  onRefresh: () => void;
  onJump: (entryId: string) => void;
}

export const CognateCellDrawer: React.FC<CognateCellDrawerProps> = ({
  open,
  row,
  cell,
  languageName,
  languagePath,
  projectPath,
  activeLanguageId,
  words,
  onClose,
  onRefresh,
  onJump,
}) => {
  const { t } = useTranslation();
  const { setPrimaryCognateOverride: setPrimaryOverride, removePrimaryCognateOverride: removePrimaryOverride, upsertLexicalGap } =
    useWorkspaceStore();
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [newForm, setNewForm] = useState("");
  const [gapStatus, setGapStatus] = useState<LexicalGapStatus>("tbd");
  const [gapNote, setGapNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 词汇空缺状态标签：显式逐项 t() 调用，避免间接 key 字典漏掉静态校验 */
  const gapStatusLabel = (status: LexicalGapStatus): string => {
    switch (status) {
      case "unrecorded":
        return t("lexicon.conceptsV3.gapUnrecorded");
      case "tbd":
        return t("lexicon.conceptsV3.gapTbd");
      case "periphrastic":
        return t("lexicon.conceptsV3.gapPeriphrastic");
      case "confirmed_absent":
        return t("lexicon.conceptsV3.gapConfirmedAbsent");
    }
  };

  const languageId = cell?.languageId ?? "";
  const conceptId = row?.conceptId ?? "";
  const candidates = useMemo(() => cell?.candidates ?? [], [cell]);

  const bindableWords = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return words
      .filter(
        (word) =>
          word.con_word_romanized.toLowerCase().includes(needle) ||
          word.senses.some((sense) => sense.gloss.toLowerCase().includes(needle)),
      )
      .slice(0, 8);
  }, [words, search]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** 把已有词条的某个义项绑定到当前概念（跨语言时直接写盘） */
  const bindExisting = (word: WordEntry, senseId: string) =>
    run(async () => {
      const updated: WordEntry = {
        ...word,
        senses: word.senses.map((sense) =>
          sense.sense_id === senseId ? { ...sense, concept_id: conceptId } : sense,
        ),
        metadata: { ...word.metadata, updated_at: new Date().toISOString() },
      };
      if (languageId === activeLanguageId) {
        useLexiconStore.getState().upsertWord(updated);
        await useLexiconStore.getState().flushSaves();
      } else {
        await invoke<WriteResult>("save_word", {
          projectPath,
          languagePath,
          word: updated,
          oldRomanized: null,
          expectedRevision: null,
          operationId: null,
        });
      }
      invalidateLineageLexicon(projectPath, languagePath);
      setSearch("");
    });

  const createWord = () =>
    run(async () => {
      if (!newForm.trim()) return;
      await createWordInLanguage({
        projectPath,
        languagePath,
        languageId,
        romanized: newForm.trim(),
        conceptId,
        gloss: row?.glossZh || row?.glossEn || newForm.trim(),
      });
      setNewForm("");
    });

  const saveGap = () =>
    run(async () => {
      upsertLexicalGap({
        language_id: languageId,
        concept_id: conceptId,
        status: gapStatus,
        note: gapNote.trim() || undefined,
        updated_at: new Date().toISOString(),
      });
    });

  return (
    <ModalPortal open={open && Boolean(row && cell)}>
      <div className="modal modal-open z-[1100]">
        <div className="modal-backdrop" onClick={onClose} />
        <div className="modal-box max-w-2xl">
          <h3 className="text-lg font-bold">
            {t("cognates.v3.candidatesDrawerTitle", { concept: row?.glossZh || row?.glossEn || conceptId })}
          </h3>
          <p className="mt-0.5 text-xs text-base-content/50">
            {languageName} · <span className="font-mono">{conceptId}</span>
          </p>

          <div className="mt-3">
            <CognateCandidateList
              candidates={candidates}
              busy={busy}
              onJump={onJump}
              onSetPrimary={(candidate) =>
                void run(async () => {
                  setPrimaryOverride({
                    language_id: languageId,
                    concept_id: conceptId,
                    entry_id: candidate.entryId,
                    sense_id: candidate.senseId,
                    reason: reason.trim() || undefined,
                  });
                })
              }
            />
          </div>

          <div className="mt-2 flex items-center gap-2">
            <input
              className={`${INPUT} h-8 flex-1 text-xs`}
              placeholder={t("cognates.v3.primaryReasonPlaceholder")}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <button
              type="button"
              className={`${BTN_GHOST} text-[11px]`}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  removePrimaryOverride(languageId, conceptId);
                })
              }
            >
              <PinOff size={11} /> {t("cognates.v3.clearPrimary")}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-base-content/40">{t("cognates.v3.defaultPrimaryRule")}</p>

          <div className="mt-3 space-y-2 rounded border border-base-300 p-2">
            <div className="flex items-center gap-1 text-xs font-medium text-base-content/70">
              <Link2 size={12} /> {t("cognates.v3.bindExistingWord")}
            </div>
            <div className="relative">
              <Search size={12} className="absolute left-2 top-2.5 text-base-content/40" />
              <input
                className={`${INPUT} h-8 w-full pl-7 text-xs`}
                placeholder={t("common.search")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {bindableWords.map((word) => (
              <div key={word.entry_id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-mono">{word.con_word_romanized}</span>
                <span className="flex flex-wrap gap-1">
                  {word.senses.map((sense) => (
                    <button key={sense.sense_id} type="button" className={`${BTN_LINK} text-[10px]`} disabled={busy} onClick={() => bindExisting(word, sense.sense_id)}>
                      {sense.gloss || sense.sense_id}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <input className={`${INPUT} h-8 flex-1 text-xs`} placeholder={t("cognates.v3.createWordHere")} value={newForm} onChange={(event) => setNewForm(event.target.value)} />
            <button type="button" className={BTN_PRIMARY} disabled={busy || !newForm.trim()} onClick={() => void createWord()}>
              <Plus size={12} /> {t("common.add")}
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <select className={`${SELECT} select-xs w-40 text-xs`} value={gapStatus} onChange={(event) => setGapStatus(event.target.value as LexicalGapStatus)}>
              {GAP_OPTIONS.map((status) => (
                <option key={status} value={status}>{gapStatusLabel(status)}</option>
              ))}
            </select>
            <input
              className={`${INPUT} h-8 flex-1 text-xs`}
              placeholder={t("lexicon.conceptsV3.gapNotePlaceholder")}
              value={gapNote}
              onChange={(event) => setGapNote(event.target.value)}
            />
            <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => void saveGap()}>
              {t("common.save")}
            </button>
          </div>

          {error && <p className="mt-2 text-xs text-error">{error}</p>}

          <div className="modal-action">
            <button type="button" className={BTN_GHOST} onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
