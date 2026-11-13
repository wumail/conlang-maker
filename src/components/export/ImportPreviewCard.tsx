import { useTranslation } from "react-i18next";
import { FileUp } from "lucide-react";
import type { WordEntry } from "../../types";
import { BTN_GHOST, BTN_SUCCESS, CARD, CARD_BODY } from "../../lib/ui";

export type ConflictStrategy = "keep_both" | "skip" | "overwrite";

interface ImportPreviewCardProps {
  preview: WordEntry[];
  format: string;
  strategy: ConflictStrategy;
  onStrategyChange: (next: ConflictStrategy) => void;
  onClose: () => void;
  onConfirm: () => void;
}

/** CSV 导入预览 + 冲突处理策略 */
export function ImportPreviewCard({
  preview,
  format,
  strategy,
  onStrategyChange,
  onClose,
  onConfirm,
}: ImportPreviewCardProps) {
  const { t } = useTranslation();
  const strategies: { value: ConflictStrategy; label: string }[] = [
    { value: "keep_both", label: t("export.conflictKeepBoth") },
    { value: "skip", label: t("export.conflictSkip") },
    { value: "overwrite", label: t("export.conflictOverwrite") },
  ];

  return (
    <div className={CARD}>
      <div className={`${CARD_BODY} p-4 space-y-3`}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">
            {t("export.importPreview")} ({preview.length} {t("export.entries")})
          </h3>
          <span className="badge badge-sm">{format}</span>
        </div>
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="table table-xs">
            <thead>
              <tr>
                <th>{t("lexicon.word")}</th>
                <th>{"IPA"}</th>
                <th>{t("lexicon.pos")}</th>
                <th>{t("lexicon.gloss")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.slice(0, 30).map((word) => (
                <tr key={word.entry_id}>
                  <td className="font-mono">{word.con_word_romanized}</td>
                  <td className="font-mono text-xs">{word.phonetic_ipa}</td>
                  <td>{word.senses[0]?.pos_id}</td>
                  <td>{word.senses[0]?.gloss}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.length > 30 && (
            <p className="text-xs text-base-content/50 mt-1">
              +{preview.length - 30} {t("common.more")}
            </p>
          )}
        </div>

        <div className="flex items-center gap-4 bg-base-200 p-3 rounded-lg text-sm border border-base-300">
          <span className="font-semibold text-base-content/80">
            {t("export.conflictHandling")}
          </span>
          {strategies.map((option) => (
            <label key={option.value} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="conflict"
                className="radio radio-primary radio-sm"
                checked={strategy === option.value}
                onChange={() => onStrategyChange(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>

        <div className="flex gap-2 justify-end">
          <button className={BTN_GHOST} onClick={onClose}>
            {t("common.close")}
          </button>
          <button className={BTN_SUCCESS} onClick={onConfirm}>
            <FileUp className="w-4 h-4" /> {t("export.confirmImport")}
          </button>
        </div>
      </div>
    </div>
  );
}
