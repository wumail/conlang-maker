import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import type { PartOfSpeech, Sense } from "../../types";
import { INPUT, SELECT, TEXTAREA, BTN_ERROR, BTN_LINK } from "../../lib/ui";

interface WordSensesSectionProps {
  senses: Sense[];
  partsOfSpeech: PartOfSpeech[];
  onChangeSense: (index: number, field: keyof Sense, value: Sense[keyof Sense]) => void;
  onAddSense: () => void;
  onRequestDeleteSense: (index: number) => void;
}

/** 多义项编辑区：词性 / 释义 / 定义 / 例句 */
export const WordSensesSection: React.FC<WordSensesSectionProps> = ({
  senses,
  partsOfSpeech,
  onChangeSense,
  onAddSense,
  onRequestDeleteSense,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-base-300 pb-2">
        <h3 className="text-xl font-semibold text-base-content/80">{t("lexicon.senses")}</h3>
        <button onClick={onAddSense} className={BTN_LINK}>
          <Plus size={16} /> {t("lexicon.addMeaning")}
        </button>
      </div>

      {senses.map((sense, index) => (
        <div
          key={index}
          className="p-4 pt-6 border border-base-300 rounded-lg bg-base-200/50 relative group"
        >
          <button
            onClick={() => onRequestDeleteSense(index)}
            className={`${BTN_ERROR} absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity`}
            title={t("lexicon.deleteMeaning")}
          >
            <Trash2 size={16} />
          </button>

          <div className="grid grid-cols-12 gap-4 mb-4">
            <div className="col-span-3">
              <label className="block text-xs font-medium text-base-content/60 mb-1">
                {t("lexicon.pos")}
              </label>
              <select
                value={sense.pos_id ?? ""}
                onChange={(event) => onChangeSense(index, "pos_id", event.target.value)}
                className={`w-full ${SELECT}`}
              >
                <option value="">--</option>
                {partsOfSpeech.map((pos) => (
                  <option key={pos.pos_id} value={pos.pos_id}>
                    {pos.name || pos.pos_id}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-9">
              <label className="block text-xs font-medium text-base-content/60 mb-1">
                {t("lexicon.gloss")}
              </label>
              <input
                type="text"
                value={sense.gloss}
                onChange={(event) => onChangeSense(index, "gloss", event.target.value)}
                className={`w-full ${INPUT}`}
                placeholder={t("lexicon.gloss")}
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-medium text-base-content/60 mb-1">
              {t("lexicon.definitions")}
            </label>
            <textarea
              value={sense.definitions.join("\n")}
              onChange={(event) =>
                onChangeSense(index, "definitions", event.target.value.split("\n"))
              }
              className={`w-full ${TEXTAREA} min-h-[60px]`}
              placeholder={t("lexicon.definitions")}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-base-content/60 mb-1">
              {t("lexicon.examples")}
            </label>
            <textarea
              value={sense.examples.join("\n")}
              onChange={(event) =>
                onChangeSense(index, "examples", event.target.value.split("\n"))
              }
              className={`w-full ${TEXTAREA} min-h-[60px]`}
              placeholder={t("lexicon.examples")}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
