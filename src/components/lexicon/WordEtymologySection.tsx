import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageEntry, OriginType, WordEntry, WordEvolution } from "../../types";
import { INPUT, SELECT, TOGGLE } from "../../lib/ui";

interface WordEtymologySectionProps {
  word: WordEntry;
  evolution: WordEvolution | null;
  evolutionPathWords: string[];
  scaRuleLookup: Map<string, string>;
  workspaceLanguages: LanguageEntry[];
  activeLanguageId: string;
  onChange: (field: keyof WordEntry, value: WordEntry[keyof WordEntry]) => void;
}

/** 词源 / 演化链 / 废弃状态 / 语义迁移备注 */
export const WordEtymologySection: React.FC<WordEtymologySectionProps> = ({
  word,
  evolution,
  evolutionPathWords,
  scaRuleLookup,
  workspaceLanguages,
  activeLanguageId,
  onChange,
}) => {
  const { t } = useTranslation();
  const etymology = word.etymology;

  return (
    <div className="mt-8 pt-4 border-t border-base-300 space-y-3">
      <h3 className="text-sm font-medium text-base-content/70">{t("lexicon.etymology")}</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-base-content/60 mb-1">
            {t("lexicon.originType")}
          </label>
          <select
            value={etymology?.origin_type || "a_priori"}
            onChange={(event) =>
              onChange("etymology", {
                ...etymology,
                origin_type: event.target.value as OriginType,
              })
            }
            className={`w-full ${SELECT}`}
          >
            <option value="a_priori">{t("lexicon.originAPriori")}</option>
            <option value="a_posteriori">{t("lexicon.originAPosteriori")}</option>
            <option value="evolved">{t("lexicon.originEvolved")}</option>
            <option value="borrowed">{t("lexicon.originBorrowed")}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-base-content/60 mb-1">
            {t("lexicon.sourceLanguage")}
          </label>
          <input
            type="text"
            value={etymology?.source_language_id || ""}
            onChange={(event) =>
              onChange("etymology", {
                ...etymology,
                source_language_id: event.target.value || null,
              })
            }
            className={`w-full ${INPUT}`}
            placeholder={t("lexicon.sourceLanguagePlaceholder")}
            readOnly={
              etymology?.origin_type !== "borrowed" && etymology?.origin_type !== "evolved"
            }
          />
        </div>
      </div>

      {(etymology?.origin_type === "evolved" || etymology?.origin_type === "borrowed") &&
        etymology?.parent_entry_id && (
          <div className="bg-base-200/50 border border-base-300 rounded-lg p-3 mt-2">
            <p className="text-xs font-medium text-base-content/60 mb-1">
              {t("lexicon.evolutionPath")}
            </p>
            <div className="flex items-center gap-2 font-mono text-sm flex-wrap">
              {evolutionPathWords.map((pathWord, index) => (
                <Fragment key={`${pathWord}-${index}`}>
                  {index > 0 && <span className="text-base-content/50">→</span>}
                  <span
                    className={
                      index === evolutionPathWords.length - 1
                        ? "font-bold text-primary"
                        : "text-base-content/60 italic"
                    }
                  >
                    {pathWord}
                  </span>
                </Fragment>
              ))}
            </div>
            {etymology.applied_sound_changes && etymology.applied_sound_changes.length > 0 && (
              <div className="mt-2 flex items-center gap-1 flex-wrap">
                {etymology.applied_sound_changes.map((scId, index) => (
                  <span key={index} className="badge badge-xs badge-ghost" title={scId}>
                    {scaRuleLookup.get(scId) || scId.slice(0, 8)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

      <div>
        <label className="block text-xs font-medium text-base-content/60 mb-1">
          {t("lexicon.lifecycle.deprecation")}
        </label>
        <div className="rounded-lg border border-base-300 bg-base-200/50 p-3 space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className={TOGGLE}
              checked={evolution?.is_deprecated ?? false}
              onChange={(event) =>
                onChange("evolution", {
                  ...(word.evolution ?? {}),
                  is_deprecated: event.target.checked,
                  deprecated_since_language_id: event.target.checked
                    ? (evolution?.deprecated_since_language_id ?? activeLanguageId)
                    : null,
                })
              }
            />
            <span>{t("lexicon.lifecycle.markDeprecated")}</span>
          </label>
          {(evolution?.is_deprecated ?? false) && (
            <div>
              <label className="block text-xs font-medium text-base-content/60 mb-1">
                {t("lexicon.lifecycle.deprecatedSince")}
              </label>
              <select
                value={evolution?.deprecated_since_language_id ?? activeLanguageId}
                onChange={(event) =>
                  onChange("evolution", {
                    ...(word.evolution ?? {}),
                    is_deprecated: true,
                    deprecated_since_language_id: event.target.value,
                  })
                }
                className={`w-full ${SELECT}`}
              >
                {workspaceLanguages.map((language) => (
                  <option key={language.language_id} value={language.language_id}>
                    {language.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-base-content/60 mb-1">
          {t("lexicon.semanticShiftNote")}
        </label>
        <input
          type="text"
          value={etymology?.semantic_shift_note || ""}
          onChange={(event) =>
            onChange("etymology", {
              ...etymology,
              semantic_shift_note: event.target.value,
            })
          }
          className={`w-full ${INPUT}`}
          placeholder={t("lexicon.semanticShiftPlaceholder")}
        />
      </div>
    </div>
  );
};
