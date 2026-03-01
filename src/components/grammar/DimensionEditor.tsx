import React from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import type { InflectionDimension, DimensionValue } from "../../types";
import { Plus, Trash2 } from "lucide-react";
import {
  INPUT,
  INPUT_MONO,
  BTN_PRIMARY,
  BTN_ERROR,
  BTN_GHOST,
  CHECKBOX,
} from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { EmptyState } from "../common/EmptyState";

export const DimensionEditor: React.FC = () => {
  const { t } = useTranslation();
  const { config, addDimension, updateDimension, deleteDimension } =
    useGrammarStore();
  const dimensions = config.inflection_dimensions;
  const partsOfSpeech = config.parts_of_speech;

  const [confirmDeleteDimId, setConfirmDeleteDimId] = React.useState<
    string | null
  >(null);
  const [confirmDeleteValueId, setConfirmDeleteValueId] = React.useState<{
    dimId: string;
    valId: string;
  } | null>(null);

  const handleAddDimension = () => {
    const dim: InflectionDimension = {
      dim_id: `dim_${crypto.randomUUID().slice(0, 8)}`,
      name: "",
      applies_to_pos: [],
      values: [],
    };
    addDimension(dim);
  };

  const handleUpdateField = (
    dimId: string,
    field: keyof InflectionDimension,
    value: InflectionDimension[keyof InflectionDimension],
  ) => {
    const dim = dimensions.find((d) => d.dim_id === dimId);
    if (!dim) return;
    updateDimension(dimId, { ...dim, [field]: value });
  };

  const handleTogglePos = (dimId: string, posId: string) => {
    const dim = dimensions.find((d) => d.dim_id === dimId);
    if (!dim) return;
    const has = dim.applies_to_pos.includes(posId);
    const updated = has
      ? dim.applies_to_pos.filter((p) => p !== posId)
      : [...dim.applies_to_pos, posId];
    updateDimension(dimId, { ...dim, applies_to_pos: updated });
  };

  const handleAddValue = (dimId: string) => {
    const dim = dimensions.find((d) => d.dim_id === dimId);
    if (!dim) return;
    const val: DimensionValue = {
      val_id: `val_${crypto.randomUUID().slice(0, 8)}`,
      name: "",
      gloss: "",
    };
    updateDimension(dimId, { ...dim, values: [...dim.values, val] });
  };

  const handleUpdateValue = (
    dimId: string,
    valId: string,
    field: keyof DimensionValue,
    value: string,
  ) => {
    const dim = dimensions.find((d) => d.dim_id === dimId);
    if (!dim) return;
    const values = dim.values.map((v) =>
      v.val_id === valId ? { ...v, [field]: value } : v,
    );
    updateDimension(dimId, { ...dim, values });
  };

  const handleDeleteValue = (dimId: string, valId: string) => {
    const dim = dimensions.find((d) => d.dim_id === dimId);
    if (!dim) return;
    updateDimension(dimId, {
      ...dim,
      values: dim.values.filter((v) => v.val_id !== valId),
    });
  };

  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      <div className="flex justify-end items-center">
        <button onClick={handleAddDimension} className={BTN_PRIMARY}>
          <Plus size={16} /> {t("grammar.dimensions.addDimension")}
        </button>
      </div>

      {dimensions.length === 0 && (
        <EmptyState message={t("grammar.dimensions.noDimensions")} />
      )}

      {dimensions.map((dim) => (
        <div
          key={dim.dim_id}
          className="p-4 border border-base-300 rounded-lg bg-base-200/50 space-y-3"
        >
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={dim.name}
              onChange={(e) =>
                handleUpdateField(dim.dim_id, "name", e.target.value)
              }
              className={`flex-1 ${INPUT}`}
              placeholder={t("grammar.dimensions.namePlaceholder")}
            />
            <button
              onClick={() => setConfirmDeleteDimId(dim.dim_id)}
              className={BTN_ERROR}
              title={t("grammar.dimensions.deleteDimension")}
            >
              <Trash2 size={14} />
            </button>
          </div>

          {/* Applies to POS */}
          <div>
            <span className="text-xs font-medium text-base-content/60">
              {t("grammar.dimensions.appliesTo")}
            </span>
            <div className="flex flex-wrap gap-2 mt-1">
              {partsOfSpeech.map((pos) => (
                <label
                  key={pos.pos_id}
                  className="flex items-center gap-1 text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={dim.applies_to_pos.includes(pos.pos_id)}
                    onChange={() => handleTogglePos(dim.dim_id, pos.pos_id)}
                    className={CHECKBOX}
                  />
                  {pos.name || pos.pos_id}
                </label>
              ))}
            </div>
          </div>

          {/* Values */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-base-content/60">
                {t("grammar.dimensions.values")}
              </span>
              <button
                onClick={() => handleAddValue(dim.dim_id)}
                className={BTN_GHOST}
              >
                <Plus size={14} /> {t("grammar.dimensions.addValue")}
              </button>
            </div>
            <div className="space-y-1 mt-1">
              {dim.values.map((val) => (
                <div key={val.val_id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={val.name}
                    onChange={(e) =>
                      handleUpdateValue(
                        dim.dim_id,
                        val.val_id,
                        "name",
                        e.target.value,
                      )
                    }
                    className={`flex-1 ${INPUT}`}
                    placeholder={t("grammar.dimensions.valueName")}
                  />
                  <input
                    type="text"
                    value={val.gloss}
                    onChange={(e) =>
                      handleUpdateValue(
                        dim.dim_id,
                        val.val_id,
                        "gloss",
                        e.target.value,
                      )
                    }
                    className={`w-24 ${INPUT_MONO}`}
                    placeholder={t("grammar.dimensions.valueGloss")}
                  />
                  <button
                    onClick={() =>
                      setConfirmDeleteValueId({
                        dimId: dim.dim_id,
                        valId: val.val_id,
                      })
                    }
                    className={BTN_ERROR}
                    title={t("grammar.dimensions.deleteValue")}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      <ConfirmModal
        open={confirmDeleteDimId !== null}
        title={t("common.delete")}
        message={t(
          "grammar.dimensions.deleteDimensionConfirm",
          "Are you sure you want to delete this dimension?",
        )}
        onConfirm={() => {
          if (confirmDeleteDimId) deleteDimension(confirmDeleteDimId);
          setConfirmDeleteDimId(null);
        }}
        onCancel={() => setConfirmDeleteDimId(null)}
      />

      <ConfirmModal
        open={confirmDeleteValueId !== null}
        title={t("common.delete")}
        message={t(
          "grammar.dimensions.deleteValueConfirm",
          "Are you sure you want to delete this value?",
        )}
        onConfirm={() => {
          if (confirmDeleteValueId) {
            handleDeleteValue(
              confirmDeleteValueId.dimId,
              confirmDeleteValueId.valId,
            );
            setConfirmDeleteValueId(null);
          }
        }}
        onCancel={() => setConfirmDeleteValueId(null)}
      />
    </div>
  );
};
