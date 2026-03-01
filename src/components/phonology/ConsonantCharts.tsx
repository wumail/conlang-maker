import React from "react";
import { useTranslation } from "react-i18next";
import {
  PLACES,
  CONSONANT_DATA,
  NON_PULMONIC_DATA,
  CO_ARTICULATED_DATA,
} from "../../data/ipa_data";
import { hasIpaAudio } from "../../utils/ipaAudio";

interface ConsonantChartsProps {
  isConsonantSelected: (p: string) => boolean;
  handleConsonantClick: (phoneme: string) => void;
  handlePlayAudio: (e: React.MouseEvent, phoneme: string) => void;
  setHoveredPhoneme: (p: string | null) => void;
  highlightPair: string | undefined;
}

/** Renders the three IPA consonant tables: pulmonic, non-pulmonic, co-articulated */
export const ConsonantCharts: React.FC<ConsonantChartsProps> = ({
  isConsonantSelected,
  handleConsonantClick,
  handlePlayAudio,
  setHoveredPhoneme,
  highlightPair,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-8">
      {/* Main Pulmonic Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm text-center bg-base-100 border border-base-300">
          <thead>
            <tr>
              <th
                colSpan={13}
                className="p-2 border border-base-300 bg-base-200 text-base-content/70 font-bold text-lg"
              >
                {t("phonology.inventory.ipaConsonants")}
              </th>
            </tr>
            <tr className="bg-base-200 text-base-content/70 font-normal">
              <th
                rowSpan={2}
                className="p-2 border border-base-300 text-right font-normal align-bottom whitespace-pre-wrap"
              >
                {t("phonology.inventory.placeManner")}
              </th>
              <th
                colSpan={3}
                className="p-1 border border-base-300 font-normal"
              >
                {t("phonology.inventory.labial")}
              </th>
              <th
                colSpan={5}
                className="p-1 border border-base-300 font-normal"
              >
                {t("phonology.inventory.coronal")}
              </th>
              <th
                colSpan={2}
                className="p-1 border border-base-300 font-normal"
              >
                {t("phonology.inventory.dorsal")}
              </th>
              <th
                colSpan={2}
                className="p-1 border border-base-300 font-normal"
              >
                {t("phonology.inventory.laryngeal")}
              </th>
            </tr>
            <tr className="bg-base-200 text-base-content/70 font-normal">
              {PLACES.map((place) => (
                <th
                  key={place}
                  className="p-1 border border-base-300 font-normal text-xs whitespace-pre-wrap"
                >
                  {t(`phonology.inventory.places.${place}`).replace("/", "/\n")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CONSONANT_DATA.map((row, idx) => (
              <tr key={idx}>
                <td className="p-2 border border-base-300 bg-base-200 text-base-content/70 text-left whitespace-nowrap">
                  {t(`phonology.inventory.manners.${row.manner}`)}
                </td>
                {row.row.map((cell, i) => {
                  if (cell === null) {
                    return (
                      <td
                        key={i}
                        className="border border-base-300 bg-base-300 min-w-[48px] min-h-[32px]"
                      ></td>
                    );
                  }
                  return (
                    <td
                      key={i}
                      className="border border-base-300 p-1 min-w-[48px] min-h-[32px]"
                    >
                      <div className="flex items-center justify-around gap-2 w-full">
                        <PhonemeCell
                          phoneme={cell[0]}
                          isSelected={isConsonantSelected}
                          onClick={handleConsonantClick}
                          onPlay={handlePlayAudio}
                          highlightPair={highlightPair}
                          onHoverEnter={setHoveredPhoneme}
                          onHoverLeave={() => setHoveredPhoneme(null)}
                          t={t}
                        />
                        <PhonemeCell
                          phoneme={cell[1]}
                          isSelected={isConsonantSelected}
                          onClick={handleConsonantClick}
                          onPlay={handlePlayAudio}
                          highlightPair={highlightPair}
                          onHoverEnter={setHoveredPhoneme}
                          onHoverLeave={() => setHoveredPhoneme(null)}
                          t={t}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Secondary Tables (Non-pulmonic & Co-articulated) */}
      <div className="flex flex-row flex-wrap items-start gap-8">
        <SecondaryTable
          title={t("phonology.inventory.ipaNonPulmonic")}
          data={NON_PULMONIC_DATA}
          isSelected={isConsonantSelected}
          onClick={handleConsonantClick}
          onPlay={handlePlayAudio}
          t={t}
        />
        <SecondaryTable
          title={t("phonology.inventory.ipaCoArticulated")}
          data={CO_ARTICULATED_DATA}
          isSelected={isConsonantSelected}
          onClick={handleConsonantClick}
          onPlay={handlePlayAudio}
          t={t}
          flex="flex-[3]"
        />
      </div>
    </div>
  );
};
interface PhonemeCellProps {
  phoneme: string;
  isSelected: (p: string) => boolean;
  onClick: (p: string) => void;
  onPlay: (e: React.MouseEvent, p: string) => void;
  highlightPair: string | undefined;
  onHoverEnter: (p: string) => void;
  onHoverLeave: () => void;
  t: (key: string, opts?: Record<string, string>) => string;
}

const PhonemeCell: React.FC<PhonemeCellProps> = ({
  phoneme,
  isSelected,
  onClick,
  onPlay,
  highlightPair,
  onHoverEnter,
  onHoverLeave,
  t,
}) => (
  <span
    className={`ipa-char group relative flex items-center justify-center text-base cursor-pointer w-[30px] h-[24px] px-0.5 rounded ${
      phoneme && isSelected(phoneme)
        ? "text-white bg-primary"
        : phoneme
          ? "text-primary hover:bg-base-300"
          : "text-primary"
    } ${phoneme && phoneme === highlightPair ? "ring-2 ring-amber-400" : ""}`}
    onClick={() => onClick(phoneme)}
    onMouseEnter={() => phoneme && onHoverEnter(phoneme)}
    onMouseLeave={onHoverLeave}
  >
    {phoneme}
    {phoneme && hasIpaAudio(phoneme) && (
      <span
        className="absolute -top-1.5 -right-2 p-1 text-[10px] leading-none opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:scale-125 hover:text-primary transition-all select-none"
        title={t("phonology.inventory.playAudio", { symbol: phoneme })}
        onClick={(e) => onPlay(e, phoneme)}
      >
        ▶
      </span>
    )}
  </span>
);
interface SecondaryTableProps {
  title: string;
  data: typeof NON_PULMONIC_DATA;
  isSelected: (p: string) => boolean;
  onClick: (p: string) => void;
  onPlay: (e: React.MouseEvent, p: string) => void;
  t: (key: string, opts?: Record<string, string>) => string;
  flex?: string;
}

const SecondaryTable: React.FC<SecondaryTableProps> = ({
  title,
  data,
  isSelected,
  onClick,
  onPlay,
  t,
  flex = "flex-[4]",
}) => (
  <div className={`overflow-x-auto ${flex}`}>
    <table className="w-full border-collapse text-sm text-center bg-base-100 border border-base-300">
      <thead>
        <tr>
          <th
            colSpan={2}
            className="p-2 border border-base-300 bg-base-200 text-base-content/70 font-bold text-lg"
          >
            {title}
          </th>
        </tr>
      </thead>
      <tbody>
        {data.map((row, idx) => (
          <tr key={idx}>
            <td className="p-2 border border-base-300 bg-base-200 text-base-content/70 text-right whitespace-nowrap font-normal w-[30%]">
              {t(`phonology.inventory.categories.${row.category}`)}{" "}
              {row.subcategory
                ? t(`phonology.inventory.subcategories.${row.subcategory}`)
                : ""}
            </td>
            <td className="border border-base-300 p-2 min-w-[48px] min-h-[32px] text-left">
              <div className="flex flex-wrap items-center gap-2 w-full">
                {row.phonemes.map((phoneme, i) => (
                  <span
                    key={i}
                    className={`ipa-char group relative flex items-center justify-center text-lg cursor-pointer w-[30px] h-[24px] px-1 rounded ${
                      phoneme && isSelected(phoneme)
                        ? "text-white bg-primary"
                        : phoneme
                          ? "text-primary hover:bg-base-300"
                          : "text-primary"
                    }`}
                    onClick={() => onClick(phoneme)}
                  >
                    {phoneme}
                    {phoneme && hasIpaAudio(phoneme) && (
                      <span
                        className="absolute -top-1 -right-2 p-1 text-[10px] leading-none opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:scale-125 hover:text-primary transition-all select-none"
                        title={t("phonology.inventory.playAudio", {
                          symbol: phoneme,
                        })}
                        onClick={(e) => onPlay(e, phoneme)}
                      >
                        ▶
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
