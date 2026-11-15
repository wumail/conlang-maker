import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import { pushUndoEntry } from "../../store/undoManager";
import { isPreviewStale, type BatchDiffRow } from "../../core/workflows/batchPreview";
import { BatchDiffPreviewModal } from "../common/BatchDiffPreviewModal";
import { BTN_PRIMARY, BTN_GHOST, SELECT, INPUT } from "../../lib/ui";
import type { WordEntry } from "../../types";

type SenseScope = "all" | "empty_only" | "first_sense";

interface BatchEditPanelProps {
  selectedIds: Set<string>;
  /** 被当前筛选隐藏、但仍处于选中态的条目数（透传给差异预览弹窗） */
  hiddenSelectedCount?: number;
  onClose: () => void;
}

interface BatchBuildResult {
  words: WordEntry[];
  originals: WordEntry[];
  rows: BatchDiffRow[];
  /** 实际发生变更的义项总数（不是选中词条数） */
  senseCount: number;
}

/** 批量编辑：义项作用范围 + 差异预览 + 单次批量落盘（Roadmap v3 / Pillar 2） */
export const BatchEditPanel: React.FC<BatchEditPanelProps> = ({
  selectedIds,
  hiddenSelectedCount,
  onClose,
}) => {
  const { t } = useTranslation();
  const { wordsMap, importWords, revision, languagePath } = useLexiconStore();
  const partsOfSpeech = useGrammarStore((s) => s.config.parts_of_speech);

  const [posId, setPosId] = useState("");
  const [tagsToAdd, setTagsToAdd] = useState("");
  const [tagsToRemove, setTagsToRemove] = useState("");
  const [scope, setScope] = useState<SenseScope>("all");
  const [preview, setPreview] = useState<{
    base: string;
    words: WordEntry[];
    originals: WordEntry[];
    rows: BatchDiffRow[];
    senseCount: number;
  } | null>(null);

  const hasChanges = Boolean(posId || tagsToAdd.trim() || tagsToRemove.trim());

  const buildBatch = useMemo(
    () => (): BatchBuildResult => {
      const addTags = tagsToAdd.split(",").map((tag) => tag.trim()).filter(Boolean);
      const removeTags = new Set(
        tagsToRemove.split(",").map((tag) => tag.trim()).filter(Boolean),
      );
      const words: WordEntry[] = [];
      const originals: WordEntry[] = [];
      const rows: BatchDiffRow[] = [];
      let senseCount = 0;

      selectedIds.forEach((id) => {
        const word = wordsMap[id];
        if (!word) return;
        let changedSenses = 0;
        const senses = word.senses.map((sense, index) => {
          const targeted =
            scope === "all" ||
            (scope === "first_sense" && index === 0) ||
            (scope === "empty_only" && !sense.pos_id);
          // 未命中范围、未指定新词性、或已是目标词性的义项都不算「实际变更」
          if (!targeted || !posId || sense.pos_id === posId) return sense;
          changedSenses += 1;
          return { ...sense, pos_id: posId };
        });
        const currentTags = new Set(word.metadata?.tags ?? []);
        addTags.forEach((tag) => currentTags.add(tag));
        removeTags.forEach((tag) => currentTags.delete(tag));
        const nextTags = [...currentTags];
        const tagsChanged =
          nextTags.length !== (word.metadata?.tags ?? []).length ||
          nextTags.some((tag) => !(word.metadata?.tags ?? []).includes(tag));

        // 零变更词条不计入 words / rows，也不计入义项统计
        if (changedSenses === 0 && !tagsChanged) return;
        senseCount += changedSenses;
        const updated: WordEntry = {
          ...word,
          senses,
          metadata: { ...word.metadata, tags: nextTags, updated_at: new Date().toISOString() },
        };
        words.push(updated);
        originals.push(word);
        rows.push({
          id: word.entry_id,
          label: word.con_word_romanized,
          sublabel: word.senses[0]?.gloss ?? "",
          before: [
            posId ? (word.senses[0]?.pos_id ?? "—") : "",
            (word.metadata?.tags ?? []).join(","),
          ]
            .filter(Boolean)
            .join(" · "),
          after: [posId ? posId : "", nextTags.join(",")].filter(Boolean).join(" · "),
        });
      });
      return { words, originals, rows, senseCount };
    },
    [selectedIds, wordsMap, posId, tagsToAdd, tagsToRemove, scope],
  );

  const requestPreview = () => {
    const { words, originals, rows, senseCount } = buildBatch();
    if (words.length === 0) return;
    setPreview({ base: revision, words, originals, rows, senseCount });
  };

  const confirm = () => {
    if (!preview || isPreviewStale(preview.base, revision)) return;
    const { words, originals } = preview;
    importWords(words);
    pushUndoEntry({
      languageId: languagePath,
      domain: "lexicon",
      labelKey: "lexicon.batchEdit",
      undo: () => {
        useLexiconStore.getState().importWords(originals);
      },
      redo: () => {
        useLexiconStore.getState().importWords(words);
      },
    });
    setPreview(null);
    onClose();
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 border-t border-base-300 bg-base-100 p-4 shadow-[0_-4px_10px_rgba(0,0,0,0.1)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold">{t("lexicon.batchEdit")}</h3>
        <button type="button" onClick={onClose} className={`${BTN_GHOST} btn-square`}>
          <X size={14} />
        </button>
      </div>

      <div className="mt-2 space-y-3 text-sm">
        <div>
          <label className="mb-1 block text-xs text-base-content/60">
            {t("lexicon.batchV3.scopeLabel")}
          </label>
          <select
            className={`${SELECT} select-sm w-full`}
            value={scope}
            onChange={(event) => setScope(event.target.value as SenseScope)}
          >
            <option value="all">{t("lexicon.batchV3.scopeAllSenses")}</option>
            <option value="empty_only">{t("lexicon.batchV3.scopeEmptyOnly")}</option>
            <option value="first_sense">{t("lexicon.batchV3.scopeFirstSense")}</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-base-content/60">
            {t("lexicon.setPosAll")}
          </label>
          <select
            className={`${SELECT} select-sm w-full`}
            value={posId}
            onChange={(event) => setPosId(event.target.value)}
          >
            <option value="">-- {t("lexicon.noChange")} --</option>
            {partsOfSpeech.map((pos) => (
              <option key={pos.pos_id} value={pos.pos_id}>
                {pos.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-base-content/60">{t("lexicon.addTags")}</label>
          <input
            type="text"
            className={`${INPUT} input-sm w-full`}
            value={tagsToAdd}
            onChange={(event) => setTagsToAdd(event.target.value)}
            placeholder="tag1, tag2"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-base-content/60">
            {t("lexicon.removeTags")}
          </label>
          <input
            type="text"
            className={`${INPUT} input-sm w-full`}
            value={tagsToRemove}
            onChange={(event) => setTagsToRemove(event.target.value)}
            placeholder="tag1, tag2"
          />
        </div>
      </div>

      <div className="mt-4 border-t border-base-200 pt-3">
        <button
          className={`${BTN_PRIMARY} w-full`}
          onClick={requestPreview}
          disabled={!hasChanges}
        >
          <Check size={16} /> {t("common.apply")} ({selectedIds.size})
        </button>
      </div>

      <BatchDiffPreviewModal
        open={Boolean(preview)}
        title={t("lexicon.batchV3.previewTitle")}
        summaryText={t("lexicon.batchV3.affectedSummary", {
          entries: preview?.words.length ?? 0,
          senses: preview?.senseCount ?? 0,
        })}
        hiddenSelectedCount={hiddenSelectedCount}
        staleRevisionDetected={Boolean(preview && isPreviewStale(preview.base, revision))}
        rows={preview?.rows ?? []}
        onRefreshPreview={requestPreview}
        onConfirm={confirm}
        onCancel={() => setPreview(null)}
      />
    </div>
  );
};
