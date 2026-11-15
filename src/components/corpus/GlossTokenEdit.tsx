import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { BookPlus, ExternalLink, Lock, Unlock } from "lucide-react";
import type { GlossedLine, GlossToken, GlossTokenStatus } from "../../types";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useCorpusStore } from "../../store/corpusStore";
import { rankTokenCandidates } from "../../core/workflows/autoGloss";
import {
  INPUT,
  INPUT_MONO,
  BTN_PRIMARY,
  BTN_GHOST,
  BTN_OUTLINE_ERROR,
  BTN_LINK,
  BADGE,
} from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { ModalPortal } from "../common/ModalPortal";
import { CorpusQuickLexDrawer } from "./CorpusQuickLexDrawer";
import { ScriptLine, ScriptPreview } from "../writing/ScriptText";

interface GlossTokenEditProps {
  token: GlossToken;
  line?: GlossedLine | null;
  onSave: (token: GlossToken) => void;
  onDelete: () => void;
  onClose: () => void;
  onLexEntryCreated?: () => void;
}

/** token 编辑弹窗：多候选消歧（数字键 1..9）+ 手工编辑 + verified 锁定 */
export function GlossTokenEdit({
  token,
  line = null,
  onSave,
  onDelete,
  onClose,
  onLexEntryCreated,
}: GlossTokenEditProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<GlossToken>({ ...token });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showQuickLex, setShowQuickLex] = useState(false);
  const wordsList = useLexiconStore((s) => s.wordsList);
  const grammar = useGrammarStore((s) => s.config);
  const phono = usePhonoStore((s) => s.config);

  const candidates = useMemo(
    () => rankTokenCandidates(draft.surface_form, wordsList, grammar, phono).slice(0, 9),
    [draft.surface_form, wordsList, grammar, phono],
  );

  const applyCandidate = useCallback((index: number) => {
    const candidate = candidates[index];
    if (!candidate) return false;
    setDraft((prev) => ({
      ...prev,
      morpheme_break: candidate.morpheme_break,
      gloss_labels: candidate.gloss_labels,
      linked_entry_id: candidate.entry_id,
      linked_sense_id: candidate.sense_id,
      ipa: candidate.ipa,
      status: "verified",
    }));
    return true;
  }, [candidates]);

  useEffect(() => {
    // 子弹窗打开时不抢数字键
    if (showQuickLex || showDeleteConfirm) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const target = event.target;
      // 输入框 / 文本域 / 下拉框 / 富文本里打字时，数字键必须原样输入
      const editing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (editing) return;
      const index = Number.parseInt(event.key, 10);
      if (!Number.isFinite(index) || index < 1 || index > 9) return;
      if (!applyCandidate(index - 1)) return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyCandidate, showQuickLex, showDeleteConfirm]);

  /** 语料侧写入：收词绑定 / 解绑回滚属于组合撤销的一步，不再压入独立 corpus undo 记录 */
  const persistBinding = useCallback(
    (next: GlossToken) => {
      setDraft(next);
      const store = useCorpusStore.getState();
      const corpus = store.activeCorpus;
      const lineId = line?.line_id;
      if (!corpus || !lineId) return;
      const targetLine = corpus.glossed_lines.find((item) => item.line_id === lineId);
      if (!targetLine) return;
      store.updateGlossedLine(
        lineId,
        {
          ...targetLine,
          tokens: targetLine.tokens.map((item) =>
            item.token_id === next.token_id ? next : item,
          ),
        },
        { skipHistory: true },
      );
    },
    [line?.line_id],
  );

  const update = (patch: Partial<GlossToken>) =>
    setDraft((prev) => ({ ...prev, ...patch, status: "edited" as GlossTokenStatus }));

  const openEntry = () => {
    if (!draft.linked_entry_id) return;
    useLexiconStore.getState().setActiveWordId(draft.linked_entry_id);
    navigate("/lexicon");
  };

  /** 状态徽章显式走 t()，避免把内部枚举码（auto/edited/verified）直接裸露给用户 */
  const statusLabel = draft.status === "verified"
    ? t("corpus.v3.statusVerified")
    : draft.status === "edited"
      ? t("corpus.v3.statusEdited")
      : draft.status === "auto" ? t("corpus.v3.statusAuto") : "—";

  return (
    <ModalPortal open>
      <div className="modal modal-open" onClick={onClose}>
        <div
          className="modal-box w-[28rem] max-w-full space-y-3"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("corpus.surfaceForm")}</h3>
            <div className="flex items-center gap-1">
              <span className={`${BADGE} badge-ghost badge-xs`}>{statusLabel}</span>
              <button
                type="button"
                className={BTN_GHOST}
                title={draft.status === "verified" ? t("corpus.unlockToken") : t("corpus.lockToken")}
                onClick={() =>
                  setDraft({
                    ...draft,
                    status: draft.status === "verified" ? "edited" : "verified",
                  })
                }
              >
                {draft.status === "verified" ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
            </div>
          </div>

          <input
            className={`${INPUT} w-full font-mono`}
            value={draft.surface_form}
            onChange={(event) => update({ surface_form: event.target.value })}
          />
          <ScriptPreview text={draft.surface_form} className="text-xl" />

          {candidates.length > 0 && (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded border border-base-300 p-1">
              <div className="px-1 text-[10px] text-base-content/50">
                {t("corpus.candidatesHint")}
              </div>
              {candidates.map((candidate, index) => (
                <button
                  key={candidate.candidate_id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-info/10"
                  onClick={() => applyCandidate(index)}
                >
                  <span className="w-3 font-mono text-base-content/40">{index + 1}</span>
                  <span className="font-mono">{candidate.morpheme_break}</span>
                  <span className="text-primary">{candidate.gloss_labels}</span>
                  <span className="text-base-content/50">{candidate.romanized}</span>
                  <span className="ml-auto text-base-content/40">
                    {Math.round(candidate.confidence * 100)}%
                  </span>
                </button>
              ))}
            </div>
          )}

          <div>
            <label className="text-xs text-base-content/60">{t("corpus.morphemeBreak")}</label>
            <input
              className={`${INPUT_MONO} w-full text-sm`}
              placeholder="lu-PST"
              value={draft.morpheme_break}
              onChange={(event) => update({ morpheme_break: event.target.value })}
            />
          </div>

          <div>
            <label className="text-xs text-base-content/60">{t("corpus.glossLabels")}</label>
            <input
              className={`${INPUT} w-full text-sm`}
              placeholder="lu-PST"
              value={draft.gloss_labels}
              onChange={(event) => update({ gloss_labels: event.target.value })}
            />
          </div>

          <div>
            <label className="text-xs text-base-content/60">IPA</label>
            <input
              className={`${INPUT_MONO} w-full text-sm`}
              value={draft.ipa}
              onChange={(event) => update({ ipa: event.target.value })}
            />
          </div>

          {draft.linked_entry_id && (
            <div className="flex items-center gap-2 text-xs text-success">
              <ScriptLine
                text={wordsList.find((w) => w.entry_id === draft.linked_entry_id)?.con_word_romanized ?? ""}
                entryId={draft.linked_entry_id}
              />
              <button type="button" className={`${BTN_LINK} text-[11px]`} onClick={openEntry}>
                <ExternalLink size={11} /> {t("cognates.v3.bindExistingWord")}
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            {!draft.linked_entry_id && (
              <button className={BTN_GHOST} onClick={() => setShowQuickLex(true)}>
                <BookPlus size={14} /> {t("corpus.quickLex.entry")}
              </button>
            )}
            <button className={BTN_OUTLINE_ERROR} onClick={() => setShowDeleteConfirm(true)}>
              {t("common.delete")}
            </button>
            <button className={BTN_GHOST} onClick={onClose}>
              {t("common.close")}
            </button>
            <button className={BTN_PRIMARY} onClick={() => onSave(draft)}>
              {t("common.save")}
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={showDeleteConfirm}
        title={t("common.delete")}
        message={t("corpus.deleteTokenConfirm")}
        onConfirm={onDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <CorpusQuickLexDrawer
        key={`quicklex_${token.token_id}`}
        open={showQuickLex}
        surfaceForm={draft.surface_form}
        line={line}
        token={draft}
        onClose={() => setShowQuickLex(false)}
        onBindToken={(entryId, senseId) => {
          const liveLine = line?.line_id
            ? useCorpusStore.getState().activeCorpus?.glossed_lines.find((l) => l.line_id === line.line_id)
            : undefined;
          const base = liveLine?.tokens.find((tItem) => tItem.token_id === token.token_id) ?? draft;
          const next: GlossToken = entryId
            ? { ...base, linked_entry_id: entryId, linked_sense_id: senseId || undefined, status: "verified" }
            : { ...base, linked_entry_id: "", linked_sense_id: undefined, status: "auto" };
          persistBinding(next);
          if (entryId) onClose();
        }}
        onCreated={() => {
          onLexEntryCreated?.();
          onClose();
        }}
      />
    </ModalPortal>
  );
}
