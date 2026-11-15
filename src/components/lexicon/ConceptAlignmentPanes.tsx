/**
 * ConceptAlignmentPanes.tsx — 概念对齐两个页签的展示层（Roadmap v3 / Pillar 4）
 */
import React from "react";
import { useTranslation } from "react-i18next";
import type { ConceptSenseCandidate } from "../../core/workflows/conceptMigration";
import type { ConceptDefinition } from "../../types";
import { BADGE, BTN_GHOST, CHECKBOX, INPUT, SELECT } from "../../lib/ui";

interface AlignmentSuggestionsPaneProps {
  concepts: ConceptDefinition[];
  suggestions: Record<string, Record<string, ConceptSenseCandidate[]>>;
  selected: Set<string>;
  onToggle: (key: string, checked: boolean) => void;
  bindKey: (candidate: ConceptSenseCandidate, conceptId: string) => string;
  languageName: (languageId: string) => string;
}

export const AlignmentSuggestionsPane: React.FC<AlignmentSuggestionsPaneProps> = ({
  concepts,
  suggestions,
  selected,
  onToggle,
  bindKey,
  languageName,
}) => {
  const { t } = useTranslation();
  if (concepts.length === 0) {
    return <p className="text-xs text-base-content/50">{t("lexicon.concept.empty")}</p>;
  }

  return (
    <div className="mt-3 max-h-[56vh] space-y-2 overflow-y-auto">
      {concepts.map((concept) => {
        const flat = Object.values(suggestions[concept.concept_id] ?? {}).flat();
        if (flat.length === 0) return null;
        return (
          <div key={concept.concept_id} className="rounded border border-base-300 p-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
              <span>{concept.gloss_zh || concept.gloss_en}</span>
              <span className="font-mono text-[10px] text-base-content/40">{concept.concept_id}</span>
            </div>
            <div className="space-y-1">
              {flat.map((candidate) => {
                const key = bindKey(candidate, concept.concept_id);
                const bound = candidate.matchReason === "already_bound";
                return (
                  <label key={key} className="flex items-center gap-2 text-xs text-base-content/70">
                    <input
                      type="checkbox"
                      className={CHECKBOX}
                      disabled={bound}
                      checked={bound || selected.has(key)}
                      onChange={(event) => onToggle(key, event.target.checked)}
                    />
                    <span className="w-24 truncate">{languageName(candidate.languageId)}</span>
                    <span className="font-mono">{candidate.romanized}</span>
                    <span>{candidate.gloss}</span>
                    <span className={`${BADGE} badge-ghost badge-xs`}>{candidate.matchReason}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface CustomConceptManagerPaneProps {
  concepts: ConceptDefinition[];
  mergeTarget: Record<string, string>;
  onMergeTargetChange: (conceptId: string, targetId: string) => void;
  onMerge: (concept: ConceptDefinition) => void;
  onEdit: (concept: ConceptDefinition, name: string, aliases: string) => void;
}

export const CustomConceptManagerPane: React.FC<CustomConceptManagerPaneProps> = ({
  concepts,
  mergeTarget,
  onMergeTargetChange,
  onMerge,
  onEdit,
}) => {
  const { t } = useTranslation();

  return (
    <div className="mt-3 max-h-[56vh] space-y-2 overflow-y-auto">
      {concepts.map((concept) => (
        <div key={concept.concept_id} className="rounded border border-base-300 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${INPUT} input-xs w-40 text-xs`}
              defaultValue={concept.gloss_zh}
              onBlur={(event) =>
                onEdit(concept, event.target.value, (concept.aliases ?? []).join(","))
              }
            />
            <input
              className={`${INPUT} input-xs flex-1 text-xs`}
              placeholder={t("lexicon.conceptsV3.aliases")}
              defaultValue={(concept.aliases ?? []).join(",")}
              onBlur={(event) => onEdit(concept, concept.gloss_zh, event.target.value)}
            />
            <select
              className={`${SELECT} select-xs w-32 text-xs`}
              value={mergeTarget[concept.concept_id] ?? ""}
              onChange={(event) => onMergeTargetChange(concept.concept_id, event.target.value)}
            >
              <option value="">{t("lexicon.conceptsV3.mergeInto")}</option>
              {concepts
                .filter((other) => other.concept_id !== concept.concept_id)
                .map((other) => (
                  <option key={other.concept_id} value={other.concept_id}>
                    {other.gloss_zh || other.gloss_en}
                  </option>
                ))}
            </select>
            <button type="button" className={`${BTN_GHOST} text-[11px]`} onClick={() => onMerge(concept)}>
              {t("lexicon.conceptsV3.mergeInto")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
