import { useTranslation } from "react-i18next";
import type { WordChangeDetails } from "../../core/engines/wordLifecycle";
import { BADGE } from "../../lib/ui";

export function WordChangeBadges({ changes }: { changes?: WordChangeDetails }) {
  const { t } = useTranslation();
  const labels = {
    segments: t("lexicon.lifecycle.segments"),
    prosody: t("lexicon.lifecycle.prosody"),
    meaning: t("lexicon.lifecycle.meaning"),
    technical: t("lexicon.lifecycle.technical"),
  };
  if (!changes) return null;
  return (
    <>
      {(Object.keys(changes) as (keyof WordChangeDetails)[])
        .filter((key) => changes[key])
        .map((key) => (
          <span key={key} className={`${BADGE} badge-warning`}>
            {labels[key]}
          </span>
        ))}
    </>
  );
}
