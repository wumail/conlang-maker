import React from "react";
import { useTranslation } from "react-i18next";
import { Info, Plus } from "lucide-react";
import { useGrammarStore } from "../../store/grammarStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import {
  generateDerivedWords,
  type DerivedWordPreview,
} from "../../utils/derivationEngine";
import type { DerivationRule, WordEntry } from "../../types";
import { DEFAULT_LANGUAGE_ID } from "../../constants";
import { BTN_PRIMARY } from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { EmptyState } from "../common/EmptyState";
import {
  useDragReorder,
  DndContext,
  closestCenter,
  SortableContext,
  verticalListSortingStrategy,
} from "../../utils/useDragReorder";
import { DerivationRuleCard } from "./DerivationRuleCard";

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
  const [selectedPreviewIds, setSelectedPreviewIds] = React.useState<
    Set<string>
  >(new Set());
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
      sca_mutable: false,
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
    const results = generateDerivedWords(
      sourceWords,
      rule,
      phonoConfig,
      config.morphophonology_rules ?? [],
    );
    setPreviews(results);
    setPreviewRuleId(rule.rule_id);
    setSelectedPreviewIds(new Set(results.map((p) => p.source.entry_id)));
  };

  const importDerived = (rule: DerivationRule) => {
    const toImport = previews.filter((p) =>
      selectedPreviewIds.has(p.source.entry_id),
    );
    toImport.forEach((p) => {
      const entry: WordEntry = {
        entry_id: crypto.randomUUID(),
        language_id: config.language_id || DEFAULT_LANGUAGE_ID,
        con_word_romanized: p.derived,
        phonetic_ipa: p.ipa,
        phonetic_override: false,
        senses: [
          {
            sense_id: crypto.randomUUID(),
            pos_id: rule.target_pos_id,
            gloss: `${p.source.senses[0]?.gloss ?? ""} (${t("lexicon.originDerived")})`,
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
    setSelectedPreviewIds(new Set());
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
            <DerivationRuleCard
              key={rule.rule_id}
              rule={rule}
              partsOfSpeech={partsOfSpeech}
              isPreviewActive={previewRuleId === rule.rule_id}
              previews={previews}
              selectedPreviewIds={selectedPreviewIds}
              onChange={handleChange}
              onRequestDelete={setDeleteTarget}
              onGeneratePreview={generatePreview}
              onImportDerived={importDerived}
              onSetSelectedPreviewIds={setSelectedPreviewIds}
            />
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
