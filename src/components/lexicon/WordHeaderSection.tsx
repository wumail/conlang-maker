import { useTranslation } from "react-i18next";
import { Trash2, Lock, Unlock, Tag } from "lucide-react";
import type { ConjugationClass, WordEntry } from "../../types";
import type { WordLifecycleFlags } from "../../utils/wordLifecycle";
import { BTN_GHOST_SQ, BADGE, SELECT } from "../../lib/ui";
import { TagsInput } from "../common/TagsInput";
import { ScriptPreview } from "../writing/ScriptText";
import { WordChangeBadges } from "./WordChangeBadges";

interface WordHeaderSectionProps {
  word: WordEntry;
  surface: string;
  lifecycleFlags: WordLifecycleFlags | null;
  allTags: string[];
  onChange: (field: keyof WordEntry, value: WordEntry[keyof WordEntry]) => void;
  onTagsChange: (tags: string[]) => void;
  onRequestDelete: () => void;
  /** 变位类（融合语且有变位类时显示词条级选择） */
  conjugationClasses?: readonly ConjugationClass[];
}

/** 词头区：词形 / 本族文字预览 / IPA 与手改开关 / 生命周期徽章 / 标签 */
export const WordHeaderSection: React.FC<WordHeaderSectionProps> = ({
  word,
  surface,
  lifecycleFlags,
  allTags,
  onChange,
  onTagsChange,
  onRequestDelete,
  conjugationClasses = [],
}) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex justify-between items-start mb-6">
        <div className="flex-1">
          <input
            type="text"
            value={word.con_word_romanized}
            onChange={(event) => onChange("con_word_romanized", event.target.value)}
            className="text-4xl font-bold border-b-2 border-transparent hover:border-base-300 focus:border-primary outline-none w-full bg-transparent"
            placeholder={t("lexicon.word")}
          />
          <ScriptPreview
            text={word.con_word_romanized}
            entryId={word.entry_id}
            className="text-3xl leading-tight mt-1"
          />
          <div className="flex items-center gap-2 mt-2 text-base-content/60">
            <span className="font-mono text-lg">
              {word.phonetic_override ? (
                <input
                  type="text"
                  value={word.phonetic_ipa}
                  onChange={(event) => onChange("phonetic_ipa", event.target.value)}
                  className="border-b border-base-300 outline-none bg-transparent"
                />
              ) : (
                word.phonetic_ipa || (
                  <span className="text-base-content/30 italic text-sm">
                    {t("lexicon.autoGenHint")}
                  </span>
                )
              )}
            </span>
            {surface && (
              <span className="font-mono text-base text-success">{surface}</span>
            )}
            <button
              onClick={() => onChange("phonetic_override", !word.phonetic_override)}
              className={BTN_GHOST_SQ}
              title={
                word.phonetic_override ? t("lexicon.unlockAuto") : t("lexicon.lockManual")
              }
            >
              {word.phonetic_override ? <Unlock size={16} /> : <Lock size={16} />}
            </button>
          </div>
          {conjugationClasses.length > 0 && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-base-content/60">{t("lexicon.table.inflectionClass")}</span>
              <select
                className={`${SELECT} select-xs`}
                value={word.inflection_class_id ?? ""}
                onChange={(event) =>
                  onChange("inflection_class_id", event.target.value || undefined)
                }
              >
                <option value="">—</option>
                {conjugationClasses.map((cls) => (
                  <option key={cls.class_id} value={cls.class_id}>
                    {cls.name || cls.class_id}
                  </option>
                ))}
              </select>
            </div>
          )}
          {lifecycleFlags &&
            (lifecycleFlags.isNew ||
              lifecycleFlags.isDeprecated ||
              lifecycleFlags.isChanged) && (
              <div className="flex flex-wrap gap-1 mt-2">
                {lifecycleFlags.isNew && (
                  <span className={`${BADGE} badge-success`}>
                    {t("lexicon.lifecycle.added")}
                  </span>
                )}
                {lifecycleFlags.isDeprecated && (
                  <span className={`${BADGE} badge-error`}>
                    {t("lexicon.lifecycle.deprecated")}
                  </span>
                )}
                {lifecycleFlags.isChanged && (
                  <WordChangeBadges changes={lifecycleFlags.changes} />
                )}
              </div>
            )}
        </div>
        <button
          onClick={onRequestDelete}
          className="btn btn-ghost btn-square text-error"
          title={t("lexicon.deleteWord")}
        >
          <Trash2 size={20} />
        </button>
      </div>

      <div className="mb-6 flex items-baseline gap-2">
        <Tag size={14} className="text-base-content/50 shrink-0 relative top-1" />
        <TagsInput
          tags={word.metadata?.tags ?? []}
          onChange={onTagsChange}
          placeholder={t("lexicon.tagsPlaceholder")}
          allTags={allTags}
        />
      </div>
    </>
  );
};
