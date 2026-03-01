import React from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import {
  generateDerivedWords,
  DerivedWordPreview,
} from "../../utils/derivationEngine";
import type { DerivationRule, WordEntry } from "../../types";
import { DEFAULT_LANGUAGE_ID } from "../../constants";
import { Plus, Trash2, Sparkles, Info, GripVertical } from "lucide-react";
import {
  INPUT,
  INPUT_MONO,
  SELECT,
  BTN_PRIMARY,
  BTN_SUCCESS,
  BTN_ERROR,
  TEXTAREA,
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

export const DerivationEditor: React.FC = () => {
  const { t } = useTranslation();
  const {
    config,
    addDerivation,
    updateDerivation,
    deleteDerivation,
    setDerivations,
  } = useGrammarStore();
  const { wordsMap, upsertWord } = useLexiconStore();
  const phonoConfig = usePhonoStore((s) => s.config);
  const rules = config.derivation_rules;
  const partsOfSpeech = config.parts_of_speech;

  const [previewRuleId, setPreviewRuleId] = React.useState<string | null>(null);
  const [previews, setPreviews] = React.useState<DerivedWordPreview[]>([]);
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);
  const { sensors, onDragEnd } = useDragReorder(
    rules,
    setDerivations,
    (r) => r.rule_id,
  );

  const handleAdd = () => {
    const rule: DerivationRule = {
      rule_id: crypto.randomUUID(),
      name: "",
      source_pos_id: partsOfSpeech[0]?.pos_id ?? "",
      target_pos_id: partsOfSpeech[0]?.pos_id ?? "",
      type: "suffix",
      affix: "",
      condition: null,
      semantic_note: "",
    };
    addDerivation(rule);
  };

  const handleChange = (
    ruleId: string,
    field: keyof DerivationRule,
    value: DerivationRule[keyof DerivationRule],
  ) => {
    const rule = rules.find((r) => r.rule_id === ruleId);
    if (!rule) return;
    updateDerivation(ruleId, { ...rule, [field]: value });
  };

  const generatePreview = (rule: DerivationRule) => {
    const sourceWords = Object.values(wordsMap).filter((w) =>
      w.senses.some((s) => s.pos_id === rule.source_pos_id),
    );
    const results = generateDerivedWords(sourceWords, rule, phonoConfig);
    setPreviews(results);
    setPreviewRuleId(rule.rule_id);
  };

  const importDerived = (rule: DerivationRule) => {
    previews.forEach((p) => {
      const entry: WordEntry = {
        entry_id: crypto.randomUUID(),
        language_id: DEFAULT_LANGUAGE_ID,
        con_word_romanized: p.derived,
        phonetic_ipa: p.ipa,
        phonetic_override: false,
        senses: [
          {
            sense_id: crypto.randomUUID(),
            pos_id: rule.target_pos_id,
            gloss: `${p.source.senses[0]?.gloss ?? ""} (derived)`,
            definitions: [],
            examples: [],
          },
        ],
        etymology: {
          origin_type: "derived",
          parent_entry_id: p.source.entry_id,
          source_language_id: null,
          applied_sound_changes: [],
          semantic_shift_note: rule.semantic_note,
        },
        metadata: {
          tags: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };
      upsertWord(entry);
    });
    setPreviews([]);
    setPreviewRuleId(null);
  };

  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      <div className="flex justify-end items-center">
        <button
          onClick={handleAdd}
          className={BTN_PRIMARY}
          disabled={partsOfSpeech.length === 0}
        >
          <Plus size={16} /> {t("grammar.derivation.addRule")}
        </button>
      </div>

      {partsOfSpeech.length === 0 && (
        <div className="flex items-center gap-2 p-3 bg-info/10 border border-primary/30 rounded-lg text-sm text-primary">
          <Info size={16} /> {t("typology.noPosHint")}
        </div>
      )}

      {rules.length === 0 && (
        <EmptyState message={t("grammar.derivation.noRules")} />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={rules.map((r) => r.rule_id)}
          strategy={verticalListSortingStrategy}
        >
          {rules.map((rule) => (
            <SortableItem
              key={rule.rule_id}
              id={rule.rule_id}
              className="p-4 border border-base-300 rounded-lg bg-base-200/50 space-y-3"
            >
              {({ listeners, attributes }) => (
                <>
                  <div className="flex items-center gap-3">
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
                    <input
                      type="text"
                      value={rule.name}
                      onChange={(e) =>
                        handleChange(rule.rule_id, "name", e.target.value)
                      }
                      className={`flex-1 ${INPUT}`}
                      placeholder={t("grammar.derivation.namePlaceholder")}
                    />
                    <button
                      onClick={() => setDeleteTarget(rule.rule_id)}
                      className={BTN_ERROR}
                      title={t("grammar.derivation.deleteRule")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs text-base-content/60">
                        {t("grammar.derivation.sourcePos")}
                      </label>
                      <select
                        value={rule.source_pos_id}
                        onChange={(e) =>
                          handleChange(
                            rule.rule_id,
                            "source_pos_id",
                            e.target.value,
                          )
                        }
                        className={`w-full ${SELECT}`}
                      >
                        {partsOfSpeech.map((p) => (
                          <option key={p.pos_id} value={p.pos_id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-base-content/60">
                        {t("grammar.derivation.targetPos")}
                      </label>
                      <select
                        value={rule.target_pos_id}
                        onChange={(e) =>
                          handleChange(
                            rule.rule_id,
                            "target_pos_id",
                            e.target.value,
                          )
                        }
                        className={`w-full ${SELECT}`}
                      >
                        {partsOfSpeech.map((p) => (
                          <option key={p.pos_id} value={p.pos_id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-base-content/60">
                        {t("grammar.type")}
                      </label>
                      <select
                        value={rule.type}
                        onChange={(e) =>
                          handleChange(rule.rule_id, "type", e.target.value)
                        }
                        className={`w-full ${SELECT}`}
                      >
                        <option value="suffix">{t("grammar.suffix")}</option>
                        <option value="prefix">{t("grammar.prefix")}</option>
                        <option value="infix">{t("grammar.infix")}</option>
                        <option value="circumfix">
                          {t("grammar.circumfix")}
                        </option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-base-content/60">
                        {t("grammar.affix")}
                      </label>
                      <input
                        type="text"
                        value={rule.affix}
                        onChange={(e) =>
                          handleChange(rule.rule_id, "affix", e.target.value)
                        }
                        className={`w-full ${INPUT_MONO}`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-base-content/60">
                      {t("grammar.derivation.semanticNote")}
                    </label>
                    <textarea
                      value={rule.semantic_note}
                      onChange={(e) =>
                        handleChange(
                          rule.rule_id,
                          "semantic_note",
                          e.target.value,
                        )
                      }
                      className={`w-full ${TEXTAREA} min-h-[40px]`}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => generatePreview(rule)}
                      className={BTN_PRIMARY}
                    >
                      <Sparkles size={14} /> {t("grammar.derivation.preview")}
                    </button>
                    {previewRuleId === rule.rule_id && previews.length > 0 && (
                      <button
                        onClick={() => importDerived(rule)}
                        className={BTN_SUCCESS}
                      >
                        {t("grammar.derivation.import")} ({previews.length})
                      </button>
                    )}
                  </div>
                  {previewRuleId === rule.rule_id && previews.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="table table-sm table-zebra">
                        <thead>
                          <tr>
                            <th>{t("lexicon.word")}</th>
                            <th>→</th>
                            <th>{"IPA"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previews.slice(0, 20).map((p) => (
                            <tr key={p.source.entry_id}>
                              <td className="font-mono">
                                {p.source.con_word_romanized}
                              </td>
                              <td className="font-mono font-bold">
                                {p.derived}
                              </td>
                              <td className="font-mono text-primary">
                                {p.ipa}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </SortableItem>
          ))}
        </SortableContext>
      </DndContext>

      <ConfirmModal
        open={!!deleteTarget}
        title={t("grammar.derivation.deleteRule")}
        message={t("grammar.derivation.deleteRuleConfirm")}
        onConfirm={() => {
          if (deleteTarget) deleteDerivation(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
