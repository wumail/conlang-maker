import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Check } from "lucide-react";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import { BTN_PRIMARY, BTN_GHOST, SELECT, INPUT } from "../../lib/ui";

interface BatchEditPanelProps {
    selectedIds: Set<string>;
    onClose: () => void;
}

export const BatchEditPanel: React.FC<BatchEditPanelProps> = ({ selectedIds, onClose }) => {
    const { t } = useTranslation();
    const { wordsMap, upsertWord } = useLexiconStore();
    const partsOfSpeech = useGrammarStore((s) => s.config.parts_of_speech);

    const [posId, setPosId] = useState("");
    const [tagsToAdd, setTagsToAdd] = useState("");
    const [tagsToRemove, setTagsToRemove] = useState("");

    const handleApply = () => {
        selectedIds.forEach((id) => {
            const word = wordsMap[id];
            if (!word) return;

            let updated = { ...word };

            // Apply POS change to all senses
            if (posId) {
                updated.senses = updated.senses.map((sense) => ({
                    ...sense,
                    pos_id: posId,
                }));
            }

            // Add & Remove Tags
            let currentTags = new Set(updated.metadata?.tags || []);

            if (tagsToAdd.trim()) {
                const toAdd = tagsToAdd.split(",").map(t => t.trim()).filter(Boolean);
                toAdd.forEach(t => currentTags.add(t));
            }

            if (tagsToRemove.trim()) {
                const toRemove = tagsToRemove.split(",").map(t => t.trim()).filter(Boolean);
                toRemove.forEach(t => currentTags.delete(t));
            }

            updated.metadata = {
                ...updated.metadata,
                tags: Array.from(currentTags),
                updated_at: new Date().toISOString()
            };

            upsertWord(updated);
        });

        // Optionally auto-close upon successful apply, or leave open for chained edits
        onClose();
    };

    return (
        <div className="absolute inset-x-0 bottom-0 bg-base-100 border-t shadow-[0_-4px_10px_rgba(0,0,0,0.1)] border-base-300 p-4 z-10 animate-in slide-in-from-bottom-5">
            <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm">{t("lexicon.batchEdit")}</h3>
                <button onClick={onClose} className={BTN_GHOST + " btn-sm btn-square"}>
                    <X size={14} />
                </button>
            </div>

            <div className="space-y-3 mt-2 text-sm">
                {/* Set Part of Speech */}
                <div>
                    <label className="block text-xs text-base-content/60 mb-1">{t("lexicon.setPosAll")}</label>
                    <select
                        className={`${SELECT} select-sm w-full`}
                        value={posId}
                        onChange={e => setPosId(e.target.value)}
                    >
                        <option value="">-- {t("lexicon.noChange")} --</option>
                        {partsOfSpeech.map(p => (
                            <option key={p.pos_id} value={p.pos_id}>{p.name}</option>
                        ))}
                    </select>
                </div>

                {/* Add Tags */}
                <div>
                    <label className="block text-xs text-base-content/60 mb-1">{t("lexicon.addTags")}</label>
                    <input
                        type="text"
                        className={`${INPUT} input-sm w-full`}
                        value={tagsToAdd}
                        onChange={e => setTagsToAdd(e.target.value)}
                        placeholder="tag1, tag2"
                    />
                </div>

                {/* Remove Tags */}
                <div>
                    <label className="block text-xs text-base-content/60 mb-1">{t("lexicon.removeTags")}</label>
                    <input
                        type="text"
                        className={`${INPUT} input-sm w-full`}
                        value={tagsToRemove}
                        onChange={e => setTagsToRemove(e.target.value)}
                        placeholder="tag1, tag2"
                    />
                </div>
            </div>

            <div className="mt-4 pt-3 border-t border-base-200">
                <button
                    className={`${BTN_PRIMARY} w-full`}
                    onClick={handleApply}
                    disabled={!posId && !tagsToAdd.trim() && !tagsToRemove.trim()}
                >
                    <Check size={16} /> {t("common.apply")} ({selectedIds.size})
                </button>
            </div>
        </div>
    );
};
