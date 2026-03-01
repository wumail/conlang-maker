import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Check, CheckSquare, Square } from "lucide-react";
import { PartOfSpeech } from "../../types";
import { INPUT, SELECT, BTN_SUCCESS, BTN_ERROR } from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";

export interface CandidateWord {
  id: string;
  word: string;
  ipa: string;
  selected: boolean;
  swadeshConcept?: string;
  posId?: string;
}

interface CandidateTableProps {
  candidates: CandidateWord[];
  useSwadesh: boolean;
  partsOfSpeech: PartOfSpeech[];
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onUpdate: (
    id: string,
    field: keyof CandidateWord,
    value: CandidateWord[keyof CandidateWord],
  ) => void;
  onRemove: (id: string) => void;
  onImport: () => void;
}

/** Candidate word table with select/import controls */
export const CandidateTable: React.FC<CandidateTableProps> = ({
  candidates,
  useSwadesh,
  partsOfSpeech,
  onToggleSelect,
  onToggleAll,
  onUpdate,
  onRemove,
  onImport,
}) => {
  const { t } = useTranslation();
  const selectedCount = candidates.filter((c) => c.selected).length;
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleAll}
            className="flex items-center gap-1 text-sm text-base-content/70 hover:text-base-content"
          >
            {candidates.every((c) => c.selected) ? (
              <CheckSquare size={14} />
            ) : (
              <Square size={14} />
            )}
            {t("wordgen.selectAll")}
          </button>
          <span className="text-xs text-base-content/50">
            {selectedCount} / {candidates.length} {t("wordgen.selected")}
          </span>
        </div>
        <button
          onClick={onImport}
          disabled={selectedCount === 0}
          className={`${BTN_SUCCESS} disabled:opacity-50`}
        >
          <Plus size={14} /> {t("wordgen.import")} ({selectedCount})
        </button>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-12 gap-2 text-xs font-medium text-base-content/60 px-1 mb-1">
        <div className="col-span-1"></div>
        <div className="col-span-3">{t("wordgen.word")}</div>
        <div className="col-span-2">IPA</div>
        {useSwadesh && <div className="col-span-3">{t("wordgen.concept")}</div>}
        <div className={useSwadesh ? "col-span-2" : "col-span-4"}>
          {t("grammar.pos")}
        </div>
        <div className="col-span-1"></div>
      </div>

      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {candidates.map((c) => (
          <div
            key={c.id}
            className={`grid grid-cols-12 gap-2 items-center p-1.5 rounded border ${c.selected
              ? "bg-info/10 border-primary/30"
              : "bg-base-200/50 border-base-200"
              }`}
          >
            <div className="col-span-1 flex justify-center">
              <button
                onClick={() => onToggleSelect(c.id)}
                className="text-base-content/50 hover:text-primary"
                title={t("wordgen.selectCandidate")}
              >
                {c.selected ? (
                  <Check size={14} className="text-primary" />
                ) : (
                  <Square size={14} />
                )}
              </button>
            </div>
            <div className="col-span-3 font-mono text-sm font-bold">
              {c.word}
            </div>
            <div className="col-span-2 font-mono text-sm text-primary">
              {c.ipa}
            </div>
            {useSwadesh && (
              <input
                type="text"
                value={c.swadeshConcept || ""}
                onChange={(e) =>
                  onUpdate(c.id, "swadeshConcept", e.target.value)
                }
                className={`col-span-3 ${INPUT}`}
                placeholder={t("wordgen.concept")}
              />
            )}
            <select
              value={c.posId || ""}
              onChange={(e) => onUpdate(c.id, "posId", e.target.value)}
              className={`${useSwadesh ? "col-span-2" : "col-span-4"} ${SELECT}`}
            >
              <option value="">--</option>
              {partsOfSpeech.map((p) => (
                <option key={p.pos_id} value={p.pos_id}>
                  {p.name || p.pos_id}
                </option>
              ))}
            </select>
            <div className="col-span-1 flex justify-end">
              <button
                onClick={() => setConfirmDeleteId(c.id)}
                className={BTN_ERROR}
                title={t("wordgen.deleteCandidate")}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmModal
        open={confirmDeleteId !== null}
        title={t("common.delete")}
        message={t("wordgen.deleteCandidateConfirm", "Are you sure you want to delete this candidate?")}
        onConfirm={() => {
          if (confirmDeleteId !== null) {
            onRemove(confirmDeleteId);
          }
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  );
};
