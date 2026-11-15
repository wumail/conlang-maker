/**
 * QuickLexEntryForm.tsx — 收词抽屉的表单区（Roadmap v3 / Pillar 6）
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { Wand2 } from "lucide-react";
import type { PartOfSpeech, PhonologyConfig, Sense, WordEntry } from "../../types";
import { generateIPA } from "../../utils/ipaGenerator";
import { INPUT, INPUT_MONO, SELECT, BTN_LINK } from "../../lib/ui";
import { ScriptPreview } from "../writing/ScriptText";
import type { StemSuggestion } from "./CorpusQuickLexDrawer";

interface QuickLexEntryFormProps {
  mode: "new_sense" | "new_entry";
  lemma: string;
  onLemmaChange: (value: string) => void;
  suggestions: StemSuggestion[];
  onPickStem: (stem: string) => void;
  partsOfSpeech: PartOfSpeech[];
  posId: string;
  onPosChange: (value: string) => void;
  gloss: string;
  onGlossChange: (value: string) => void;
  tagsInput: string;
  onTagsChange: (value: string) => void;
  homographs: WordEntry[];
  onAddSenseTo: (word: WordEntry) => void;
}

export const QuickLexEntryForm: React.FC<QuickLexEntryFormProps> = ({
  mode,
  lemma,
  onLemmaChange,
  suggestions,
  onPickStem,
  partsOfSpeech,
  posId,
  onPosChange,
  gloss,
  onGlossChange,
  tagsInput,
  onTagsChange,
  homographs,
  onAddSenseTo,
}) => {
  const { t } = useTranslation();

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className="mb-1 block text-xs text-base-content/60">{t("corpus.quickLex.lemma")}</label>
        <input
          className={`${INPUT_MONO} w-full`}
          value={lemma}
          onChange={(event) => onLemmaChange(event.target.value)}
        />
        <ScriptPreview text={lemma} className="mt-1 text-lg" />
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-1 rounded border border-warning/40 bg-warning/10 px-2 py-1.5">
          <div className="flex items-center gap-1 text-xs text-base-content/70">
            <Wand2 size={12} /> {t("corpus.quickLex.stemSuggestion")}
          </div>
          <div className="flex flex-wrap gap-1">
            {suggestions.map((suggestion) => (
              <button
                key={`${suggestion.stem}_${suggestion.affix}`}
                type="button"
                className={`${BTN_LINK} font-mono text-xs`}
                onClick={() => onPickStem(suggestion.stem)}
                title={t("corpus.quickLex.stemHint", { affix: suggestion.affix })}
              >
                {suggestion.stem} (−{suggestion.ruleLabel})
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs text-base-content/60">{t("lexicon.pos")}</label>
        <select
          className={`${SELECT} w-full`}
          value={posId}
          onChange={(event) => onPosChange(event.target.value)}
        >
          {partsOfSpeech.map((pos) => (
            <option key={pos.pos_id} value={pos.pos_id}>
              {pos.name || pos.pos_id}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-base-content/60">{t("lexicon.gloss")}</label>
        <input
          className={`${INPUT} w-full`}
          value={gloss}
          placeholder={t("corpus.quickLex.glossPlaceholder")}
          onChange={(event) => onGlossChange(event.target.value)}
        />
      </div>

      {mode === "new_entry" && (
        <div>
          <label className="mb-1 block text-xs text-base-content/60">{t("lexicon.tags")}</label>
          <input
            className={`${INPUT} w-full`}
            value={tagsInput}
            placeholder={t("corpus.quickLex.tagsPlaceholder")}
            onChange={(event) => onTagsChange(event.target.value)}
          />
        </div>
      )}

      {mode === "new_sense" && (
        <div className="space-y-1">
          <p className="text-xs text-base-content/60">{t("corpus.quickLex.pickWord")}</p>
          {homographs.map((word) => (
            <button
              key={word.entry_id}
              type="button"
              className={`${BTN_LINK} mr-1 text-xs`}
              onClick={() => onAddSenseTo(word)}
            >
              {word.con_word_romanized} ({word.senses.length})
            </button>
          ))}
          {homographs.length === 0 && (
            <p className="text-xs text-base-content/50">{t("lexicon.noMatches")}</p>
          )}
        </div>
      )}
    </div>
  );
};

/** 构造全新词条（含可选例句），与抽屉 UI 解耦便于复用 */
export function buildQuickLexEntry(params: {
  lemma: string;
  tags: string[];
  sense: Sense;
  languageId: string;
  phono: PhonologyConfig;
}): WordEntry {
  const now = new Date().toISOString();
  const { phonemic } = generateIPA(params.lemma, params.phono);
  return {
    entry_id: crypto.randomUUID(),
    language_id: params.languageId,
    con_word_romanized: params.lemma,
    phonetic_ipa: phonemic.replace(/^\/|\/$/g, ""),
    phonetic_override: false,
    senses: [params.sense],
    etymology: {
      origin_type: "a_priori",
      parent_entry_id: null,
      source_language_id: null,
      applied_sound_changes: [],
      semantic_shift_note: "",
    },
    metadata: { tags: params.tags, created_at: now, updated_at: now },
    evolution: { is_deprecated: false, deprecated_since_language_id: null },
  };
}
