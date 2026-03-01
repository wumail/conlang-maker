import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useLexiconStore } from "../../store/lexiconStore";
import { DEFAULT_LANGUAGE_ID } from "../../constants";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { generateIPA } from "../../utils/ipaGenerator";
import { X, Zap } from "lucide-react";
import {
  SELECT,
  INPUT,
  INPUT_MONO,
  BTN_PRIMARY,
  BTN_GHOST_SQ,
  BADGE,
} from "../../lib/ui";
import { ModalPortal } from "./ModalPortal";

interface QuickEntryProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QuickEntry: React.FC<QuickEntryProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { upsertWord } = useLexiconStore();
  const partsOfSpeech = useGrammarStore((s) => s.config.parts_of_speech);
  const phonoConfig = usePhonoStore((s) => s.config);

  const [word, setWord] = useState("");
  const [gloss, setGloss] = useState("");
  const [posId, setPosId] = useState(partsOfSpeech[0]?.pos_id || "");
  const [savedCount, setSavedCount] = useState(0);

  const wordRef = useRef<HTMLInputElement>(null);
  const glossRef = useRef<HTMLInputElement>(null);
  const posRef = useRef<HTMLSelectElement>(null);

  // Focus word input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => wordRef.current?.focus(), 100);
      setSavedCount(0);
    }
  }, [isOpen]);

  const handleSave = useCallback(() => {
    if (!word.trim()) return;
    const { phonemic } = generateIPA(word, phonoConfig);
    upsertWord({
      entry_id: crypto.randomUUID(),
      language_id: DEFAULT_LANGUAGE_ID,
      con_word_romanized: word.trim(),
      phonetic_ipa: phonemic,
      phonetic_override: false,
      senses: gloss.trim()
        ? [
            {
              sense_id: crypto.randomUUID(),
              pos_id: posId,
              gloss: gloss.trim(),
              definitions: [],
              examples: [],
            },
          ]
        : [],
      etymology: {
        origin_type: "a_priori",
        parent_entry_id: null,
        source_language_id: null,
        applied_sound_changes: [],
        semantic_shift_note: "",
      },
      metadata: {
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    setSavedCount((prev) => prev + 1);
    setWord("");
    setGloss("");
    wordRef.current?.focus();
  }, [word, gloss, posId, phonoConfig, upsertWord]);

  // Handle keyboard navigation: Tab cycles fields, Enter saves
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") {
        onClose();
      }
    },
    [handleSave, onClose],
  );

  if (!isOpen) return null;

  const { phonemic } = word ? generateIPA(word, phonoConfig) : { phonemic: "" };

  return (
    <ModalPortal open={isOpen}>
      <div className="modal modal-open" onClick={onClose}>
        <div
          className="modal-box max-w-md overflow-hidden p-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 bg-base-200/50 border-b border-base-300">
            <div className="flex items-center gap-2">
              <Zap size={18} className="text-amber-500" />
              <h3 className="font-semibold text-base-content">
                {t("quickEntry.title")}
              </h3>
              {savedCount > 0 && (
                <span className={`${BADGE} badge-success`}>+{savedCount}</span>
              )}
            </div>
            <button
              onClick={onClose}
              className={BTN_GHOST_SQ}
              title={t("common.close")}
            >
              <X size={18} />
            </button>
          </div>

          {/* Form */}
          <div className="p-5 space-y-4">
            <p className="text-xs text-base-content/60">
              {t("quickEntry.hint")}
            </p>

            <div>
              <label className="block text-xs font-medium text-base-content/60 mb-1">
                {t("quickEntry.word")}
              </label>
              <input
                ref={wordRef}
                type="text"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                className={`w-full ${INPUT_MONO} input-lg`}
                placeholder={t("quickEntry.wordPlaceholder")}
                autoFocus
              />
              {phonemic && (
                <div className="mt-1 text-sm font-mono text-primary">
                  /{phonemic}/
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="block text-xs font-medium text-base-content/60 mb-1">
                  {t("grammar.pos")}
                </label>
                <select
                  ref={posRef}
                  value={posId}
                  onChange={(e) => setPosId(e.target.value)}
                  className={`w-full ${SELECT}`}
                >
                  <option value="">--</option>
                  {partsOfSpeech.map((p) => (
                    <option key={p.pos_id} value={p.pos_id}>
                      {p.name || p.pos_id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-base-content/60 mb-1">
                  {t("quickEntry.gloss")}
                </label>
                <input
                  ref={glossRef}
                  type="text"
                  value={gloss}
                  onChange={(e) => setGloss(e.target.value)}
                  className={`w-full ${INPUT}`}
                  placeholder={t("quickEntry.glossPlaceholder")}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 p-4 bg-base-200/50 border-t border-base-300">
            <button onClick={onClose} className="btn btn-ghost btn-sm">
              {t("common.close")}
            </button>
            <button
              onClick={handleSave}
              disabled={!word.trim()}
              className={`${BTN_PRIMARY} disabled:opacity-50`}
            >
              {t("quickEntry.save")} (Enter)
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
