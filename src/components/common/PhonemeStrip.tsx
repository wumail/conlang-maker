import React from "react";
import { useTranslation } from "react-i18next";

interface PhonemeStripProps {
    /** Consonant phonemes */
    consonants: string[];
    /** Vowel phonemes */
    vowels: string[];
    /** Whether a target input field is currently focused */
    isActive: boolean;
    /** Called when a phoneme button is clicked (only fires if isActive) */
    onInsert: (phoneme: string) => void;
    /** Tooltip when active */
    activeTooltip?: string;
    /** Tooltip when inactive */
    inactiveTooltip?: string;
}

/**
 * Clickable phoneme inventory strip with consonant/vowel grouping.
 * Used in RomanizationEditor (RuleTable) and PhonotacticsEditor for quick phoneme insertion.
 */
export const PhonemeStrip: React.FC<PhonemeStripProps> = ({
    consonants,
    vowels,
    isActive,
    onInsert,
    activeTooltip,
    inactiveTooltip,
}) => {
    const { t } = useTranslation();

    if (consonants.length === 0 && vowels.length === 0) return null;

    const resolvedActiveTooltip =
        activeTooltip ?? t("phonology.romanization.clickToInsert");
    const resolvedInactiveTooltip =
        inactiveTooltip ?? t("phonology.romanization.focusFirst");

    const btnClass = (active: boolean) =>
        `font-mono text-xs border border-base-300 rounded px-1.5 py-0.5 transition-colors ${active
            ? "bg-base-100 text-primary hover:bg-info/10 cursor-pointer"
            : "bg-base-200 text-base-content/50 cursor-default"
        }`;

    const renderGroup = (label: string, phonemes: string[]) => {
        if (phonemes.length === 0) return null;
        return (
            <>
                <span className="text-xs text-base-content/60 self-center mr-1">
                    {label}:
                </span>
                {phonemes.map((p) => (
                    <button
                        key={p}
                        onClick={() => {
                            if (isActive) onInsert(p);
                        }}
                        className={btnClass(isActive)}
                        title={isActive ? resolvedActiveTooltip : resolvedInactiveTooltip}
                    >
                        {p}
                    </button>
                ))}
            </>
        );
    };

    return (
        <div className="flex flex-wrap flex-col gap-1 p-2 rounded text-sm">
            <div>{renderGroup(t("phonology.phonotactics.inventoryConsonants"), consonants)}</div>
            <div>{renderGroup(t("phonology.phonotactics.inventoryVowels"), vowels)}</div>
        </div>
    );
};
