import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { ScriptLine } from "../writing/ScriptText";

export interface EvolutionChainEntry {
  languageId: string;
  languageName: string;
  romanized: string;
  ipa: string;
}

interface EvolutionChainCardsProps {
  chain: EvolutionChainEntry[];
  appliedSoundChanges?: string[];
  scaRuleLookup?: Map<string, string>;
}

/** 富信息演化链：每代祖先展示 语言名 + 罗马字 + /IPA/ + 本族文字 */
export const EvolutionChainCards: React.FC<EvolutionChainCardsProps> = ({
  chain,
  appliedSoundChanges,
  scaRuleLookup,
}) => {
  const { t } = useTranslation();
  if (chain.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-base-content/60">{t("lexicon.evolutionPath")}</p>
      <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
        {chain.map((entry, index) => {
          const isCurrent = index === chain.length - 1;
          return (
            <div key={`${entry.languageId}_${index}`} className="flex items-center gap-1.5">
              {index > 0 && <ArrowRight size={14} className="shrink-0 text-base-content/40" />}
              <div
                className={`min-w-[7.5rem] rounded-lg border px-2.5 py-1.5 ${
                  isCurrent
                    ? "border-primary/60 bg-primary/10"
                    : "border-base-300 bg-base-100"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide text-base-content/50 truncate">
                  {entry.languageName}
                </div>
                <div
                  className={`font-mono text-sm truncate ${
                    isCurrent ? "font-bold text-primary" : "text-base-content/80"
                  }`}
                  title={entry.romanized}
                >
                  {entry.romanized}
                </div>
                {entry.ipa && (
                  <div className="font-mono text-[11px] text-success truncate">/{entry.ipa}/</div>
                )}
                <ScriptLine
                  text={entry.romanized}
                  className="block text-lg leading-tight truncate"
                />
              </div>
            </div>
          );
        })}
      </div>

      {appliedSoundChanges && appliedSoundChanges.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {appliedSoundChanges.map((ruleId, index) => (
            <span key={`${ruleId}_${index}`} className="badge badge-xs badge-ghost" title={ruleId}>
              {scaRuleLookup?.get(ruleId) || ruleId.slice(0, 8)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
