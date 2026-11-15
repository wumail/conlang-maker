import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Trash2, X } from "lucide-react";
import type {
  InflectionDimension,
  IrregularOverride,
  WordEntry,
} from "../../types";
import {
  BADGE,
  BTN_ERROR,
  BTN_GHOST,
  BTN_GHOST_SQ,
  INPUT,
  INPUT_MONO,
  SELECT,
} from "../../lib/ui";

export interface IrregularOverrideRowProps {
  override: IrregularOverride;
  entry: WordEntry | undefined;
  applicableDims: InflectionDimension[];
  hasStress: boolean;
  isPickerOpen: boolean;
  pickerQuery: string;
  candidateWords: WordEntry[];
  onTogglePicker: () => void;
  onPickerQueryChange: (query: string) => void;
  onSelectEntry: (entryId: string) => void;
  onSurfaceFormChange: (surfaceForm: string) => void;
  onStemStartChange: (stemStart: number) => void;
  onDimValChange: (dimId: string, valId: string) => void;
  onRequestDelete: () => void;
}

export const IrregularOverrideRow: React.FC<IrregularOverrideRowProps> = ({
  override,
  entry,
  applicableDims,
  hasStress,
  isPickerOpen,
  pickerQuery,
  candidateWords,
  onTogglePicker,
  onPickerQueryChange,
  onSelectEntry,
  onSurfaceFormChange,
  onStemStartChange,
  onDimValChange,
  onRequestDelete,
}) => {
  const { t } = useTranslation();
  const surfaceForm = override.surface_form ?? "";
  const surfaceCodepoints = Array.from(surfaceForm).length;
  const dimValues = override.dimension_values ?? {};
  const primaryGloss = entry?.senses[0]?.gloss ?? "";

  return (
    <div className="p-3.5 rounded-lg bg-base-200/50 border border-base-200 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onTogglePicker}
          className={`${BTN_GHOST} w-64 justify-between border border-base-300 bg-base-100 font-normal`}
        >
          <span className="truncate text-left">
            {entry ? (
              <>
                <span className="font-mono font-semibold">
                  {entry.con_word_romanized}
                </span>
                {primaryGloss ? (
                  <span className="text-base-content/60"> ({primaryGloss})</span>
                ) : null}
              </>
            ) : override.entry_id ? (
              <span className="font-mono text-warning">{override.entry_id}</span>
            ) : (
              <span className="text-base-content/50">
                {t("typology.selectEntry")}
              </span>
            )}
          </span>
          <ChevronDown size={14} className="shrink-0 text-base-content/50" />
        </button>

        {entry && (
          <span className={`${BADGE} badge-ghost font-mono`}>
            {entry.con_word_romanized}
          </span>
        )}

        <span className="text-base-content/50">→</span>

        <input
          type="text"
          value={surfaceForm}
          onChange={(e) => onSurfaceFormChange(e.target.value)}
          className={`w-44 ${INPUT_MONO} input-sm`}
          placeholder={t("typology.surfaceFormPlaceholder")}
        />

        {hasStress && (
          <label className="flex items-center gap-2 text-xs">
            {t("typology.stemStart")}
            <input
              type="number"
              min={0}
              max={surfaceCodepoints}
              step={1}
              value={override.stem_start ?? 0}
              className={`w-20 ${INPUT_MONO} input-sm`}
              onChange={(event) => {
                const offset = Number(event.target.value);
                if (
                  Number.isInteger(offset) &&
                  offset >= 0 &&
                  offset <= surfaceCodepoints
                ) {
                  onStemStartChange(offset);
                }
              }}
            />
          </label>
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={onRequestDelete}
          className={BTN_ERROR}
          title={t("typology.deleteOverride")}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {isPickerOpen && (
        <div className="rounded-md border border-base-300 bg-base-100 p-2 space-y-1.5 max-w-md">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              autoFocus
              value={pickerQuery}
              onChange={(e) => onPickerQueryChange(e.target.value)}
              className={`${INPUT} input-sm flex-1 text-xs`}
              placeholder={t("typology.searchEntry")}
            />
            <button
              type="button"
              onClick={onTogglePicker}
              className={BTN_GHOST_SQ}
              title={t("common.close")}
            >
              <X size={14} />
            </button>
          </div>
          <div className="max-h-44 overflow-y-auto divide-y divide-base-200 text-xs">
            {candidateWords.length === 0 ? (
              <p className="py-2 px-1 text-base-content/50">
                {t("commandPalette.noResults")}
              </p>
            ) : (
              candidateWords.map((w) => (
                <button
                  key={w.entry_id}
                  type="button"
                  onClick={() => onSelectEntry(w.entry_id)}
                  className={`w-full text-left px-2 py-1.5 hover:bg-base-200 flex items-center justify-between gap-2 ${
                    w.entry_id === override.entry_id ? "bg-primary/10 text-primary" : ""
                  }`}
                >
                  <span className="font-mono font-medium truncate">
                    {w.con_word_romanized}
                  </span>
                  <span className="text-base-content/60 truncate">
                    {w.senses[0]?.gloss ?? ""}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {applicableDims.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-1">
          {applicableDims.map((dim) => (
            <div key={dim.dim_id} className="flex items-center gap-1">
              <span className="text-xs text-base-content/60">{dim.name}:</span>
              <select
                value={dimValues[dim.dim_id] ?? ""}
                onChange={(e) => onDimValChange(dim.dim_id, e.target.value)}
                className={`w-32 ${SELECT} select-sm text-xs`}
              >
                <option value="">--</option>
                {(dim.values ?? []).map((v) => (
                  <option key={v.val_id} value={v.val_id}>
                    {v.name} ({v.gloss})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
