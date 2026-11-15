import { useTranslation } from "react-i18next";
import { WordEntry } from "../../types";
import { BADGE } from "../../lib/ui";
import { ScriptLine } from "../writing/ScriptText";

interface WordPopoverProps {
  entry: WordEntry;
  position: { x: number; y: number };
}

export function WordPopover({ entry, position }: WordPopoverProps) {
  const { t } = useTranslation();

  return (
    <div
      className="pointer-events-none fixed z-50 max-h-[60vh] w-64 overflow-hidden rounded-lg border border-base-300 bg-base-100 p-3 text-xs shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="min-w-0">
          <div className="font-semibold truncate">{entry.con_word_romanized}</div>
          <ScriptLine text={entry.con_word_romanized} entryId={entry.entry_id} className="block text-lg leading-tight" />
        </div>
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
