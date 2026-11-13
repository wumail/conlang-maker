import React from "react";
import { useTranslation } from "react-i18next";
import { usePhonoStore } from "../../store/phonoStore";
import { TOGGLE } from "../../lib/ui";

/** 重音模式：initial / ultimate / penultimate / antepenultimate / weight_sensitive */
export const StressSection: React.FC = () => {
  const { t } = useTranslation();
  const { config, updateStress } = usePhonoStore();
  const stress = config.phonotactics.stress ?? null;
  const enabled = Boolean(stress);

  const patch = (patchValue: Partial<NonNullable<typeof stress>>) => {
    updateStress({
      position: "initial",
      domain: "word",
      ...(stress ?? {}),
      ...patchValue,
    });
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <label className="text-sm font-medium text-base-content/80">
          {t("phonology.phonotactics.stress.title")}
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className={TOGGLE}
            checked={enabled}
            onChange={(event) =>
              updateStress(event.target.checked ? { position: "initial", domain: "word" } : null)
            }
          />
          <span className="text-xs text-base-content/60">{t("phonology.phonotactics.stress.enable")}</span>
        </label>
      </div>

      {enabled && stress && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-base-content/60 mb-1">
              {t("phonology.phonotactics.stress.position")}
            </label>
            <select
              className="select select-bordered select-sm w-full"
              value={stress.position}
              onChange={(event) =>
                patch({ position: event.target.value as typeof stress.position })
              }
            >
              <option value="initial">{t("phonology.phonotactics.stress.initial")}</option>
              <option value="penultimate">
                {t("phonology.phonotactics.stress.penultimate")}
              </option>
              <option value="ultimate">{t("phonology.phonotactics.stress.ultimate")}</option>
              <option value="antepenultimate">
                {t("phonology.phonotactics.stress.antepenultimate")}
              </option>
              <option value="weight_sensitive">
                {t("phonology.phonotactics.stress.weightSensitive")}
              </option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-base-content/60 mb-1">
              {t("phonology.phonotactics.stress.domain")}
            </label>
            <select
              className="select select-bordered select-sm w-full"
              value={stress.domain ?? "word"}
              onChange={(event) =>
                patch({ domain: event.target.value as "word" | "entry" })
              }
            >
              <option value="word">{t("phonology.phonotactics.stress.domainWord")}</option>
              <option value="entry">{t("phonology.phonotactics.stress.domainEntry")}</option>
            </select>
          </div>
          {stress.position === "weight_sensitive" && (
            <div className="col-span-2">
              <label className="block text-xs text-base-content/60 mb-1">
                {t("phonology.phonotactics.stress.fallback")}
              </label>
              <select
                className="select select-bordered select-sm w-full"
                value={stress.weight_fallback ?? "penultimate"}
                onChange={(event) =>
                  patch({
                    weight_fallback: event.target.value as
                      | "initial"
                      | "penultimate"
                      | "antepenultimate",
                  })
                }
              >
                <option value="initial">{t("phonology.phonotactics.stress.initial")}</option>
                <option value="penultimate">
                  {t("phonology.phonotactics.stress.penultimate")}
                </option>
                <option value="antepenultimate">
                  {t("phonology.phonotactics.stress.antepenultimate")}
                </option>
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
