import React from "react";
import { useTranslation } from "react-i18next";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import { useCorpusStore } from "../../store/corpusStore";
import {
  ChartBar,
  BookA,
  AudioLines,
  Bookmark,
  ScrollText,
} from "lucide-react";

export const ProjectStats: React.FC = () => {
  const { t } = useTranslation();

  const wordsCount = useLexiconStore((s) => s.wordsList.length);
  const consonantsCount = usePhonoStore(
    (s) => s.config.phoneme_inventory.consonants.length,
  );
  const vowelsCount = usePhonoStore(
    (s) => s.config.phoneme_inventory.vowels.length,
  );
  const phonemesCount = consonantsCount + vowelsCount;
  const posCount = useGrammarStore((s) => s.config.parts_of_speech.length);
  const corpusCount = useCorpusStore((s) => s.index.length);

  return (
    <div className="flex items-center justify-end h-7 px-3 bg-base-200 border-t border-base-content/10 text-[11px] text-base-content/60 select-none shrink-0 overflow-hidden">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5" title={t("nav.statistics")}>
          <ChartBar className="w-3.5 h-3.5" />
          <span className="font-medium hidden sm:inline">
            {t("nav.statistics")}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <BookA className="w-3 h-3 opacity-70" />
          <span>
            {wordsCount} {t("nav.statWords")}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <AudioLines className="w-3 h-3 opacity-70" />
          <span>
            {phonemesCount} {t("nav.statPhonemes")}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Bookmark className="w-3 h-3 opacity-70" />
          <span>
            {posCount} {t("nav.statPOS")}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <ScrollText className="w-3 h-3 opacity-70" />
          <span>
            {corpusCount} {t("nav.statCorpus")}
          </span>
        </div>
      </div>
    </div>
  );
};
