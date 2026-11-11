import React from "react";
import { useTranslation } from "react-i18next";
import type { FontInspection } from "../../types";
import { formatCodepoint } from "../../utils/unicodeBlocks";
import { ScriptPreview } from "./ScriptText";
import {
  BTN_GHOST,
  CARD,
  CARD_BODY,
  SECTION_HEADER,
  TEXTAREA,
} from "../../lib/ui";

export interface MissingCharacterItem {
  character: string;
  codepoint: number;
  word: string;
}

interface FontSampleAndCoverageProps {
  inspection: FontInspection;
  sample: string;
  onSampleChange: (next: string) => void;
  sampleWords: string[];
  fontLoaded: boolean;
  fontLoading: boolean;
  fontError: string | null;
  coverage: MissingCharacterItem[];
}

export const FontSampleAndCoverage: React.FC<FontSampleAndCoverageProps> = ({
  inspection,
  sample,
  onSampleChange,
  sampleWords,
  fontLoaded,
  fontLoading,
  fontError,
  coverage,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <section className={CARD}>
        <div className={`${CARD_BODY} gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className={`${SECTION_HEADER} mb-0.5`}>
                {t("writing.sampleTitle")}
              </h2>
              <p className="text-xs text-base-content/60">
                {t("writing.sampleHint")}
              </p>
            </div>
            <button
              type="button"
              className={BTN_GHOST}
              disabled={sampleWords.length === 0}
              title={
                sampleWords.length === 0
                  ? t("writing.noLexiconWords")
                  : t("writing.fillFromLexicon")
              }
              onClick={() => onSampleChange(sampleWords.slice(0, 24).join(" "))}
              data-testid="writing-fill-lexicon"
            >
              {t("writing.fillFromLexicon")}
            </button>
          </div>

          <textarea
            className={`${TEXTAREA} w-full min-h-24 bg-base-200/30 border-base-300 focus:border-primary focus:outline-none font-mono text-sm leading-relaxed placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:text-base-content/40`}
            value={sample}
            onChange={(event) => onSampleChange(event.target.value)}
            placeholder={t("writing.samplePlaceholder")}
            data-testid="writing-sample"
          />

          {fontLoaded && sample.trim().length > 0 && (
            <div className="rounded-lg border border-base-200 bg-base-200/40 p-3">
              <ScriptPreview text={sample} className="text-2xl" />
            </div>
          )}
        </div>
      </section>

      <section className={CARD} data-testid="writing-coverage">
        <div className={`${CARD_BODY} gap-2.5`}>
          <h2 className={`${SECTION_HEADER} mb-0`}>
            {t("writing.coverageTitle")}
          </h2>
          {!inspection.present ? (
            <p className="text-xs text-base-content/60">
              {t("writing.coverageEmpty")}
            </p>
          ) : inspection.warning || fontError ? (
            <p className="text-xs text-base-content/60">
              {t("writing.coverageUnreadable")}
            </p>
          ) : fontLoading ? (
            <p role="status" className="text-xs text-base-content/60">
              {t("writing.loading")}
            </p>
          ) : coverage.length === 0 ? (
            <p className="text-xs text-success/90 font-medium">
              {t("writing.coverageOk")}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-warning font-medium">
                {t("writing.coverageMissing", { count: coverage.length })}
              </p>
              <ul className="flex flex-wrap gap-2">
                {coverage.slice(0, 24).map((item) => (
                  <li
                    key={item.character}
                    className="rounded-lg border border-base-300 bg-base-200/30 px-2.5 py-1 text-xs flex items-center gap-1.5"
                    data-testid="coverage-missing"
                  >
                    <span className="font-mono text-sm font-medium">
                      {item.character}
                    </span>
                    <span className="font-mono text-[11px] text-base-content/60">
                      {formatCodepoint(item.codepoint)}
                    </span>
                    <span className="text-[11px] text-base-content/50">
                      {t("writing.coverageWord", { word: item.word })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </>
  );
};
