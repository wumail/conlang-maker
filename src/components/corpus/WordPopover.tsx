import { useTranslation } from "react-i18next";
import { WordEntry } from "../../types";
import { BADGE } from "../../lib/ui";

interface WordPopoverProps {
  entry: WordEntry;
  position: { x: number; y: number };
}

export function WordPopover({ entry, position }: WordPopoverProps) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg p-3 w-64 text-xs pointer-events-none"
      style={{ left: position.x, top: position.y + 20 }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold">{entry.con_word_romanized}</span>
        {entry.phonetic_ipa && (
          <span className="text-base-content/50 font-mono">
            /{entry.phonetic_ipa}/
          </span>
        )}
      </div>

      {entry.senses.length > 0 && (
        <ul className="space-y-0.5">
          {entry.senses.slice(0, 3).map((s, i) => (
            <li key={i} className="flex gap-1">
              {s.pos_id && (
                <span className={`${BADGE} badge-outline`}>{s.pos_id}</span>
              )}
              <span className="text-base-content/70">{s.gloss}</span>
            </li>
          ))}
          {entry.senses.length > 3 && (
            <li className="text-base-content/50">
              +{entry.senses.length - 3} {t("corpus.moreSenses")}
            </li>
          )}
        </ul>
      )}

      {entry.etymology.semantic_shift_note && (
        <div className="mt-1 text-base-content/50 truncate">
          {entry.etymology.semantic_shift_note}
        </div>
      )}
    </div>
  );
}
