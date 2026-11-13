import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GlossedLine, GlossToken } from "../../types";
import { useLexiconStore } from "../../store/lexiconStore";
import {
  INPUT,
  INPUT_MONO,
  BTN_PRIMARY,
  BTN_GHOST,
  BTN_OUTLINE_ERROR,
} from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { CorpusQuickLexDrawer } from "./CorpusQuickLexDrawer";
import { BookPlus } from "lucide-react";
import { ScriptLine, ScriptPreview } from "../writing/ScriptText";

interface GlossTokenEditProps {
  token: GlossToken;
  /** 当前行上下文（快建词条抽屉展示用） */
  line?: GlossedLine | null;
  onSave: (token: GlossToken) => void;
  onDelete: () => void;
  onClose: () => void;
  /** 新建词条后由语料页重跑当前句 autoGloss */
  onLexEntryCreated?: () => void;
}

export function GlossTokenEdit({
  token,
  line = null,
  onSave,
  onDelete,
  onClose,
  onLexEntryCreated,
}: GlossTokenEditProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<GlossToken>({ ...token });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showQuickLex, setShowQuickLex] = useState(false);
  const wordsList = useLexiconStore((s) => s.wordsList);

  // Find matching entries for linking
  const suggestions = draft.surface_form
    ? wordsList
      .filter((w) =>
        w.con_word_romanized
          .toLowerCase()
          .startsWith(draft.surface_form.toLowerCase()),
      )
      .slice(0, 5)
    : [];

  const linkEntry = (entryId: string) => {
    const entry = wordsList.find((w) => w.entry_id === entryId);
    if (!entry) return;
    setDraft({
      ...draft,
      linked_entry_id: entryId,
      gloss_labels: draft.gloss_labels || entry.senses[0]?.gloss || "",
      ipa: draft.ipa || entry.phonetic_ipa || "",
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-base-100 rounded-xl shadow-xl p-5 w-96 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-sm">{t("corpus.surfaceForm")}</h3>
        <input
          className={`${INPUT} w-full font-mono`}
          value={draft.surface_form}
          onChange={(e) => setDraft({ ...draft, surface_form: e.target.value })}
        />
        <ScriptPreview text={draft.surface_form} className="text-xl" />

        {suggestions.length > 0 && !draft.linked_entry_id && (
          <div className="border rounded p-1 space-y-1 max-h-32 overflow-y-auto">
            {suggestions.map((w) => (
              <div
                key={w.entry_id}
                className="text-xs p-1 hover:bg-info/10 cursor-pointer rounded"
                onClick={() => linkEntry(w.entry_id)}
              >
                <div className="min-w-0">
                  <span className="font-mono">{w.con_word_romanized}</span>
                  <ScriptLine text={w.con_word_romanized} entryId={w.entry_id} className="ml-2" />
                </div>
                <span className="text-base-content/50 ml-2">
                  {w.senses[0]?.gloss}
                </span>
              </div>
            ))}
          </div>
        )}

        <div>
          <label className="text-xs text-base-content/60">
            {t("corpus.morphemeBreak")}
          </label>
          <input
            className={`${INPUT_MONO} w-full text-sm`}
            placeholder="e.g. lu-PST"
            value={draft.morpheme_break}
            onChange={(e) =>
              setDraft({ ...draft, morpheme_break: e.target.value })
            }
          />
        </div>

        <div>
          <label className="text-xs text-base-content/60">
            {t("corpus.glossLabels")}
          </label>
          <input
            className={`${INPUT} w-full text-sm`}
            placeholder="e.g. shine-PST"
            value={draft.gloss_labels}
            onChange={(e) =>
              setDraft({ ...draft, gloss_labels: e.target.value })
            }
          />
        </div>

        <div>
          <label className="text-xs text-base-content/60">IPA</label>
          <input
            className={`${INPUT_MONO} w-full text-sm`}
            value={draft.ipa}
            onChange={(e) => setDraft({ ...draft, ipa: e.target.value })}
          />
        </div>

        {draft.linked_entry_id && (
          <div className="text-xs text-green-600">
            {t("corpus.linkedEntry")}:{" "}
            {wordsList.find((w) => w.entry_id === draft.linked_entry_id)?.con_word_romanized}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
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
            {t("common.add")}
          </button>
        </div>
      </div>

      <ConfirmModal
        open={showDeleteConfirm}
        title={t("common.delete")}
        message={t("corpus.deleteTokenConfirm", "Are you sure you want to delete this token?")}
        onConfirm={() => {
          onDelete();
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <CorpusQuickLexDrawer
        key={`quicklex_${token.token_id}`}
        open={showQuickLex}
        surfaceForm={draft.surface_form}
        line={line}
        onClose={() => setShowQuickLex(false)}
        onCreated={() => {
          onLexEntryCreated?.();
          onClose();
        }}
      />
    </div>
  );
}
