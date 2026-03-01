/**
 * LengthVowelTable — 元音长度修饰表格
 *
 * 显示当前已选元音的长音 (ː) 和半长音 (ˑ) 变体，
 * 作为独立表格附加在元音梯形图下方。
 */
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { VOWELS_EXACT } from "../../data/ipa_data";

/** 提取 VOWELS_EXACT 中所有非空基础元音 */
const ALL_BASE_VOWELS: string[] = VOWELS_EXACT.flatMap((v) =>
  v.phonemes.filter((p) => p !== ""),
);

interface LengthVowelTableProps {
  selectedVowels: Set<string>;
  onToggle: (phoneme: string) => void;
}

export const LengthVowelTable: React.FC<LengthVowelTableProps> = ({
  selectedVowels,
  onToggle,
}) => {
  const { t } = useTranslation();

  /** 只显示当前已被选中的基础元音的长/半长变体 */
  const rows = useMemo(() => {
    return ALL_BASE_VOWELS.filter((base) => selectedVowels.has(base)).map(
      (base) => ({
        base,
        long: `${base}ː`,
        halfLong: `${base}ˑ`,
      }),
    );
  }, [selectedVowels]);

  if (rows.length === 0) return null;

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-base-content/70 mb-1">
        {t("phonology.inventory.vowelLength")}
      </h3>
      <p className="text-xs text-base-content/50 mb-3">
        {t("phonology.inventory.vowelLengthHint")}
      </p>

      <div className="overflow-x-auto">
        <table className="table table-sm table-zebra border border-base-200">
          <thead>
            <tr className="text-xs">
              <th className="w-20" />
              {rows.map((r) => (
                <th
                  key={r.base}
                  className="text-center ipa-char text-base font-normal"
                >
                  {r.base}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Long row */}
            <tr>
              <td className="text-xs font-medium text-base-content/60">
                {t("phonology.inventory.long")} (ː)
              </td>
              {rows.map((r) => {
                const sel = selectedVowels.has(r.long);
                return (
                  <td key={r.long} className="text-center">
                    <button
                      onClick={() => onToggle(r.long)}
                      className={`ipa-char text-lg w-[30px] h-[24px] rounded cursor-pointer transition-colors ${
                        sel
                          ? "text-white bg-primary"
                          : "text-primary hover:bg-base-300"
                      }`}
                      title={t("phonology.inventory.toggleLongVowel")}
                    >
                      {r.long}
                    </button>
                  </td>
                );
              })}
            </tr>
            {/* Half-long row */}
            <tr>
              <td className="text-xs font-medium text-base-content/60">
                {t("phonology.inventory.halfLong")} (ˑ)
              </td>
              {rows.map((r) => {
                const sel = selectedVowels.has(r.halfLong);
                return (
                  <td key={r.halfLong} className="text-center">
                    <button
                      onClick={() => onToggle(r.halfLong)}
                      className={`ipa-char text-lg w-[30px] h-[24px] rounded cursor-pointer transition-colors ${
                        sel
                          ? "text-white bg-primary"
                          : "text-primary hover:bg-base-300"
                      }`}
                      title={t("phonology.inventory.toggleHalfLongVowel")}
                    >
                      {r.halfLong}
                    </button>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
