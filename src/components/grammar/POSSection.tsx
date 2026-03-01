import React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import { PartOfSpeech } from "../../types";
import { Plus, Trash2, GripVertical } from "lucide-react";
import {
  INPUT,
  INPUT_MONO,
  BTN_PRIMARY,
  BTN_ERROR,
  CHECKBOX,
} from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { EmptyState } from "../common/EmptyState";
import {
  useDragReorder,
  DndContext,
  closestCenter,
  SortableContext,
  verticalListSortingStrategy,
} from "../../utils/useDragReorder";
import { SortableItem } from "../common/SortableItem";

const emptyPOS = (): PartOfSpeech => ({
  pos_id: `pos_${crypto.randomUUID().slice(0, 8)}`,
  name: "",
  gloss_abbr: "",
  word_pattern: "",
  requires_definition: false,
  requires_pronunciation: false,
});

export const POSSection: React.FC = () => {
  const { t } = useTranslation();
  const {
    config,
    addPartOfSpeech,
    updatePartOfSpeech,
    deletePartOfSpeech,
    setPartsOfSpeech,
  } = useGrammarStore();
  const partsOfSpeech = config.parts_of_speech;
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { sensors, onDragEnd } = useDragReorder(
    partsOfSpeech,
    setPartsOfSpeech,
    (p) => p.pos_id,
  );

  const handleAddPOS = () => {
    addPartOfSpeech(emptyPOS());
  };

  const handlePOSChange = (
    posId: string,
    field: keyof PartOfSpeech,
    value: PartOfSpeech[keyof PartOfSpeech],
  ) => {
    const pos = partsOfSpeech.find((p) => p.pos_id === posId);
    if (!pos) return;
    updatePartOfSpeech(posId, { ...pos, [field]: value });
  };

  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      <div className="flex justify-end items-center">
        <button onClick={handleAddPOS} className={BTN_PRIMARY}>
          <Plus size={16} /> {t("grammar.addPos")}
        </button>
      </div>

      {partsOfSpeech.length === 0 && (
        <EmptyState message={t("grammar.noPos")} />
      )}

      {partsOfSpeech.length > 0 && (
        <div className="grid grid-cols-12 gap-2 text-xs font-medium text-base-content/60 px-1 pl-7">
          <div className="col-span-3">{t("grammar.posName")}</div>
          <div className="col-span-2">{t("grammar.glossAbbr")}</div>
          <div className="col-span-3">{t("grammar.wordPattern")}</div>
          <div className="col-span-2">{t("grammar.reqDef")}</div>
          <div className="col-span-1">{t("grammar.reqPron")}</div>
          <div className="col-span-1"></div>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={partsOfSpeech.map((p) => p.pos_id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {partsOfSpeech.map((pos) => (
              <SortableItem
                key={pos.pos_id}
                id={pos.pos_id}
                className="flex items-center gap-2 p-2 bg-base-200/50 rounded-lg border border-base-200"
              >
                {({ listeners, attributes }) => (
                  <>
                    <span
                      {...listeners}
                      {...attributes}
                      className="cursor-grab"
                    >
                      <GripVertical
                        size={16}
                        className="text-base-content/30 shrink-0"
                      />
                    </span>
                    <div className="grid grid-cols-12 gap-2 items-center flex-1">
                      <input
                        type="text"
                        value={pos.name}
                        onChange={(e) =>
                          handlePOSChange(pos.pos_id, "name", e.target.value)
                        }
                        className={`col-span-3 ${INPUT}`}
                        placeholder={t("grammar.posNamePlaceholder")}
                      />
                      <input
                        type="text"
                        value={pos.gloss_abbr}
                        onChange={(e) =>
                          handlePOSChange(
                            pos.pos_id,
                            "gloss_abbr",
                            e.target.value,
                          )
                        }
                        className={`col-span-2 ${INPUT_MONO}`}
                        placeholder="n, v, adj..."
                      />
                      <input
                        type="text"
                        value={pos.word_pattern}
                        onChange={(e) =>
                          handlePOSChange(
                            pos.pos_id,
                            "word_pattern",
                            e.target.value,
                          )
                        }
                        className={`col-span-3 ${INPUT_MONO}`}
                        placeholder={t("grammar.wordPatternPlaceholder")}
                      />
                      <div className="col-span-2 flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={pos.requires_definition}
                          onChange={(e) =>
                            handlePOSChange(
                              pos.pos_id,
                              "requires_definition",
                              e.target.checked,
                            )
                          }
                          className={CHECKBOX}
                        />
                      </div>
                      <div className="col-span-1 flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={pos.requires_pronunciation}
                          onChange={(e) =>
                            handlePOSChange(
                              pos.pos_id,
                              "requires_pronunciation",
                              e.target.checked,
                            )
                          }
                          className={CHECKBOX}
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          onClick={() => setDeleteTarget(pos.pos_id)}
                          className={BTN_ERROR}
                          title={t("grammar.deletePos")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </SortableItem>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <ConfirmModal
        open={!!deleteTarget}
        title={t("grammar.deletePos")}
        message={t("grammar.deletePosConfirm")}
        onConfirm={() => {
          if (deleteTarget) deletePartOfSpeech(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
