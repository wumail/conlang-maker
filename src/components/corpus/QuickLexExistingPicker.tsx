/**
 * QuickLexExistingPicker.tsx — 「关联已有义项」搜索面板（Roadmap v3 / Pillar 6）
 */
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import type { WordEntry } from "../../types";
import { INPUT, BTN_LINK, BADGE } from "../../lib/ui";

interface QuickLexExistingPickerProps {
  words: WordEntry[];
  onPick: (word: WordEntry, senseId: string) => void;
}

export const QuickLexExistingPicker: React.FC<QuickLexExistingPickerProps> = ({ words, onPick }) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const results = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return words
      .filter(
        (word) =>
          word.con_word_romanized.toLowerCase().includes(needle) ||
          word.senses.some((sense) => sense.gloss.toLowerCase().includes(needle)),
      )
      .slice(0, 8);
  }, [words, search]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={12} className="absolute left-2 top-2.5 text-base-content/40" />
        <input
          className={`${INPUT} h-8 w-full pl-7 text-xs`}
          placeholder={t("common.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {results.map((word) => (
        <div key={word.entry_id} className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate font-mono">{word.con_word_romanized}</span>
          <span className="flex flex-wrap gap-1">
            {word.senses.map((sense) => (
              <button
                key={sense.sense_id}
                type="button"
                className={`${BTN_LINK} text-[10px]`}
                onClick={() => onPick(word, sense.sense_id)}
              >
                {sense.gloss || sense.sense_id}
              </button>
            ))}
          </span>
        </div>
      ))}
      {search.trim() && results.length === 0 && (
        <p className="text-xs text-base-content/50">{t("lexicon.noMatches")}</p>
      )}
      <p className={`${BADGE} badge-ghost badge-xs`}>{t("corpus.quickLex.existingHint")}</p>
    </div>
  );
};
