import React from "react";
import { useTranslation } from "react-i18next";
import { VOWELS_EXACT } from "../../data/ipa_data";
import { hasIpaAudio } from "../../utils/ipaAudio";
import { LengthVowelTable } from "./LengthVowelTable";

interface VowelChartProps {
  selectedVowels: Set<string>;
  isVowelSelected: (p: string) => boolean;
  handleVowelClick: (phoneme: string) => void;
  handlePlayAudio: (e: React.MouseEvent, phoneme: string) => void;
}

/** Renders the IPA vowel trapezoid chart */
export const VowelChart: React.FC<VowelChartProps> = ({
  selectedVowels,
  isVowelSelected,
  handleVowelClick,
  handlePlayAudio,
}) => {
  const { t } = useTranslation();

  // Row labels at y = 0, 50, 100, 150, 200, 250, 300
  const rowLabels: { key: string; y: number }[] = [
    { key: "close", y: 0 },
    { key: "nearClose", y: 50 },
    { key: "closeMid", y: 100 },
    { key: "mid", y: 150 },
    { key: "openMid", y: 200 },
    { key: "nearOpen", y: 250 },
    { key: "open", y: 300 },
  ];

  // Column header height (text + gap beneath it)
  const COL_HDR_H = 28;

  return (
    <div className="mt-8 max-w-3xl mx-auto border border-base-300 bg-base-200 pr-12 pl-6 pb-12 pt-12 flex flex-col ">
      <div className="text-center text-base-content/70 font-bold mb-6 text-lg">
        {t("phonology.inventory.ipaVowels")}
      </div>

      {/* Column headers */}
      <div
        className="relative text-base-content/70 text-sm left-24"
        style={{ width: "400px", height: `${COL_HDR_H}px` }}
      >
        <span className="absolute left-0 -translate-x-1/2">
          {t("phonology.inventory.front")}
        </span>
        <span className="absolute left-[200px] -translate-x-1/2">
          {t("phonology.inventory.central")}
        </span>
        <span className="absolute left-[400px] -translate-x-1/2">
          {t("phonology.inventory.back")}
        </span>
      </div>

      {/* Flex row: row-labels | chart */}
      <div className="flex justify-center">
        {/* ── Row labels column ── */}
        <div
          className="shrink-0 w-14 mr-3"
          style={{ paddingTop: `${COL_HDR_H}px` }}
        >
          <div className="relative" style={{ height: "300px" }}>
            {rowLabels.map(({ key, y }) => (
              <div
                key={key}
                className="absolute right-4 text-base-content/70 text-sm text-right whitespace-nowrap"
                style={{ top: `${y}px`, transform: "translateY(-50%)" }}
              >
                {t(`phonology.inventory.${key}`)}
              </div>
            ))}
          </div>
        </div>

        {/* ── Chart column ── pl/pr/pb absorb absolute-positioned overflow */}
        <div className="flex flex-col pl-4 pr-8 pb-4 relative top-7">
          {/* Trapezoid area */}
          <div className="relative" style={{ width: "400px", height: "300px" }}>
            {/* SVG Lines */}
            <svg
              className="absolute inset-0 w-full h-full overflow-visible text-base-content"
              preserveAspectRatio="none"
            >
              <line
                x1="0"
                y1="0"
                x2="400"
                y2="0"
                stroke="black"
                strokeWidth="2"
              />
              <line
                x1="200"
                y1="300"
                x2="400"
                y2="300"
                stroke="black"
                strokeWidth="2"
              />
              <line
                x1="0"
                y1="0"
                x2="200"
                y2="300"
                stroke="black"
                strokeWidth="2"
              />
              <line
                x1="400"
                y1="0"
                x2="400"
                y2="300"
                stroke="black"
                strokeWidth="2"
              />
              <line
                x1="200"
                y1="0"
                x2="300"
                y2="300"
                stroke="black"
                strokeWidth="2"
              />
              <line
                x1="66"
                y1="100"
                x2="400"
                y2="100"
                stroke="black"
                strokeWidth="2"
              />
              <line
                x1="133"
                y1="200"
                x2="400"
                y2="200"
                stroke="black"
                strokeWidth="2"
              />
            </svg>

            {/* Vowels */}
            {VOWELS_EXACT.map((v, idx) => (
              <div
                key={idx}
                className="absolute flex items-center justify-center gap-2 bg-base-200 px-1 py-0.5"
                style={{
                  left: `${v.x}px`,
                  top: `${v.y}px`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {v.phonemes.map(
                  (p, i) =>
                    p && (
                      <span
                        key={i}
                        className={`ipa-char group relative flex items-center justify-center text-xl cursor-pointer w-[30px] h-[24px] px-0.5 rounded ${
                          isVowelSelected(p)
                            ? "text-white bg-primary"
                            : "text-primary hover:bg-base-300"
                        }`}
                        onClick={() => handleVowelClick(p)}
                      >
                        {p}
                        {hasIpaAudio(p) && (
                          <span
                            className="absolute -top-1 -right-2 p-1 text-[10px] leading-none opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:scale-125 hover:text-primary transition-all select-none"
                            title={t("phonology.inventory.playAudio", {
                              symbol: p,
                            })}
                            onClick={(e) => handlePlayAudio(e, p)}
                          >
                            ▶
                          </span>
                        )}
                      </span>
                    ),
                )}
              </div>
            ))}
          </div>
          {/* end trapezoid */}
        </div>
        {/* end chart flex-col */}
      </div>
      {/* end flex row */}
      <div className="divider relative top-7"></div>
      {/* Vowel length modifier table */}
      <LengthVowelTable
        selectedVowels={selectedVowels}
        onToggle={handleVowelClick}
      />
    </div>
  );
};
