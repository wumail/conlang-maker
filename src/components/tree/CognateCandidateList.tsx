/**
 * CognateCandidateList.tsx — 单元格候选词列表（Roadmap v3 / Pillar 5）
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Pin } from "lucide-react";
import type { CognateCellCandidate } from "../../core/engines/cognateMatrix";
import { BTN_GHOST, BTN_LINK, BADGE } from "../../lib/ui";

interface CognateCandidateListProps {
  candidates: CognateCellCandidate[];
  busy: boolean;
  onSetPrimary: (candidate: CognateCellCandidate) => void;
  onJump: (entryId: string) => void;
}

export const CognateCandidateList: React.FC<CognateCandidateListProps> = ({
  candidates,
  busy,
  onSetPrimary,
  onJump,
}) => {
  const { t } = useTranslation();

  if (candidates.length === 0) {
    return <p className="text-xs text-base-content/50">{t("cognate.empty")}</p>;
  }

  return (
    <ul className="max-h-56 space-y-1.5 overflow-y-auto">
      {candidates.map((candidate) => (
        <li
          key={`${candidate.entryId}_${candidate.senseId}`}
          className="rounded border border-base-300 bg-base-100 px-2 py-1.5"
        >
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-mono text-sm">{candidate.romanized}</span>
            {candidate.ipa && (
              <span className="font-mono text-[10px] text-base-content/50">{candidate.ipa}</span>
            )}
            <span className="text-base-content/60">{candidate.senseGloss}</span>
            {candidate.isPinnedPrimary && (
              <span className={`${BADGE} badge-primary badge-xs`}>
                {t("cognates.v3.setPrimary")}
              </span>
            )}
            {candidate.isDeprecated && (
              <span className={`${BADGE} badge-ghost badge-xs`}>
                {t("lexicon.filtersV3.quickDeprecated")}
              </span>
            )}
            {candidate.tags.map((tag) => (
              <span key={tag} className={`${BADGE} badge-outline badge-xs`}>
                {tag}
              </span>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <button
              type="button"
              className={`${BTN_LINK} text-[11px]`}
              disabled={busy}
              onClick={() => onSetPrimary(candidate)}
            >
              <Pin size={11} /> {t("cognates.v3.setPrimary")}
            </button>
            <button
              type="button"
              className={`${BTN_GHOST} text-[11px]`}
              onClick={() => onJump(candidate.entryId)}
            >
              <ArrowRight size={11} /> {t("common.more")}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
};
