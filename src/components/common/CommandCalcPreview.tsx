import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePhonoStore } from "../../store/phonoStore";
import { useSCAStore } from "../../store/scaStore";
import { generateIPATraced } from "../../utils/ipaGenerator";
import { buildMacrosFromInventory, applySoundChanges } from "../../utils/scaEngine";
import { tokenizePhonemes } from "../../core/engines/phonemeTokenizer";
import { formatSyllables, syllabify } from "../../core/engines/syllabifier";
import { BADGE } from "../../lib/ui";
import { ScriptPreview } from "../writing/ScriptText";

interface CommandCalcPreviewProps {
  word: string;
}

const PROSODY = /[ˈˌ.\u002D\u2010-\u2015\s/[\]]/g;

interface CalcRow {
  labelKey: string;
  value: string;
  mono?: boolean;
}

/** `= <词形>` 即时演算：分词 → IPA → 音节切分 → 本族字 → SCA 推演 */
export const CommandCalcPreview: React.FC<CommandCalcPreviewProps> = ({ word }) => {
  const { t } = useTranslation();
  const phonoConfig = usePhonoStore((s) => s.config);
  const scaConfig = useSCAStore((s) => s.config);

  const calc = useMemo(() => {
    const trimmed = word.trim();
    if (!trimmed) return null;

    const traced = generateIPATraced(trimmed, phonoConfig);
    const allPhonemes = [
      ...phonoConfig.phoneme_inventory.consonants,
      ...phonoConfig.phoneme_inventory.vowels,
    ];
    const phonemeString = traced.phonemic.replace(PROSODY, "");
    const tokens = phonemeString ? tokenizePhonemes(phonemeString, allPhonemes) : [];
    const syllabification = syllabify(tokens, phonoConfig.phonotactics, phonoConfig.phoneme_inventory);
    const macros = buildMacrosFromInventory(
      phonoConfig.phoneme_inventory.consonants,
      phonoConfig.phoneme_inventory.vowels,
      phonoConfig.phonotactics.macros,
    );
    const sca = applySoundChanges(trimmed, scaConfig.rule_sets, macros);

    return {
      tokens,
      phonemic: traced.phonemic,
      surface: traced.surface,
      syllabification,
      sca,
      hasScaRules: scaConfig.rule_sets.some((ruleSet) => ruleSet.rules.length > 0),
    };
  }, [word, phonoConfig, scaConfig]);

  if (!calc) {
    return (
      <p className="px-4 py-6 text-sm text-base-content/50">
        {t("commandPalette.calcHint")}
      </p>
    );
  }

  const rows: CalcRow[] = [
    { labelKey: "commandPalette.calcTokens", value: calc.tokens.join(" · "), mono: true },
    { labelKey: "commandPalette.calcPhonemic", value: calc.phonemic || "—", mono: true },
    { labelKey: "commandPalette.calcSurface", value: calc.surface || "—", mono: true },
    {
      labelKey: "commandPalette.calcSyllables",
      value: calc.syllabification.valid
        ? `${formatSyllables(calc.syllabification.syllables)}  [${calc.syllabification.syllables
            .map((syllable) => (syllable.weight === "heavy" ? "H" : "L"))
            .join("")}]`
        : t("commandPalette.calcInvalid", {
            index: calc.syllabification.failedAtTokenIndex ?? 0,
          }),
      mono: true,
    },
  ];

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`${BADGE} badge-sm badge-ghost`}>{t("commandPalette.calcBadge")}</span>
        <span className="font-mono text-sm truncate">{word.trim()}</span>
      </div>

      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
        {rows.map((row) => (
          <div key={row.labelKey} className="contents">
            <span className="text-base-content/50">{t(row.labelKey)}</span>
            <span className={`truncate ${row.mono ? "font-mono" : ""}`} title={row.value}>
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <div className="rounded border border-base-300 bg-base-200/40 px-2 py-1">
        <div className="text-[10px] uppercase tracking-wide text-base-content/50">
          {t("commandPalette.calcScript")}
        </div>
        <ScriptPreview text={word.trim()} className="text-xl leading-tight" />
      </div>

      {calc.hasScaRules && (
        <div className="rounded border border-base-300 bg-base-200/40 px-2 py-1">
          <div className="text-[10px] uppercase tracking-wide text-base-content/50">
            {t("commandPalette.calcSca")}
          </div>
          <div className="font-mono text-sm">
            {word.trim()} → <span className="text-primary">{calc.sca.result}</span>
            {calc.sca.changelog.length > 0 && (
              <span className="ml-2 text-xs text-base-content/50">
                {t("commandPalette.calcScaSteps", { count: calc.sca.changelog.length })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
