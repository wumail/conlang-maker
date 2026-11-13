import { useTranslation } from "react-i18next";
import type { LanguageEntry, OriginType, WordEntry, WordEvolution } from "../../types";
import { INPUT, SELECT, TOGGLE } from "../../lib/ui";
import { WordComponentsEditor } from "./WordComponentsEditor";
import { WordFamilyPanel } from "./WordFamilyPanel";

interface WordEtymologySectionProps {
  word: WordEntry;
  evolution: WordEvolution | null;
  workspaceLanguages: LanguageEntry[];
  activeLanguageId: string;
  onChange: (field: keyof WordEntry, value: WordEntry[keyof WordEntry]) => void;
  /** 词族/构词成分解析所需的全部词条 */
  wordsMap: Record<string, WordEntry>;
  onNavigate: (entryId: string) => void;
}

/** 词源 / 演化链 / 废弃状态 / 语义迁移备注 */
export const WordEtymologySection: React.FC<WordEtymologySectionProps> = ({
  word,
  evolution,
  workspaceLanguages,
  activeLanguageId,
  onChange,
  wordsMap,
  onNavigate,
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

      <WordComponentsEditor word={word} wordsMap={wordsMap} onChange={onChange} />

      <WordFamilyPanel word={word} wordsMap={wordsMap} onNavigate={onNavigate} />

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
