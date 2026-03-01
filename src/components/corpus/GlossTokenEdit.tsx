import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GlossToken } from "../../types";
import { useLexiconStore } from "../../store/lexiconStore";
import {
  INPUT,
  INPUT_MONO,
  BTN_PRIMARY,
  BTN_GHOST,
  BTN_OUTLINE_ERROR,
} from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";

interface GlossTokenEditProps {
  token: GlossToken;
  onSave: (token: GlossToken) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function GlossTokenEdit({
  token,
  onSave,
  onDelete,
  onClose,
}: GlossTokenEditProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<GlossToken>({ ...token });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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
          className={`${INPUT} w-full`}
          value={draft.surface_form}
          onChange={(e) => setDraft({ ...draft, surface_form: e.target.value })}
        />

        {suggestions.length > 0 && !draft.linked_entry_id && (
          <div className="border rounded p-1 space-y-1 max-h-32 overflow-y-auto">
            {suggestions.map((w) => (
              <div
                key={w.entry_id}
                className="text-xs p-1 hover:bg-info/10 cursor-pointer rounded"
                onClick={() => linkEntry(w.entry_id)}
              >
                <span className="font-mono">{w.con_word_romanized}</span>
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
            {
              wordsList.find((w) => w.entry_id === draft.linked_entry_id)
                ?.con_word_romanized
            }
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
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
    </div>
  );
}
