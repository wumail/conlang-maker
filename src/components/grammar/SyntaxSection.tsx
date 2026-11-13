import React from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import {
  AdpositionType,
  ModifierPosition,
  MorphosyntacticAlignment,
  WordOrder,
} from "../../types";
import { SELECT } from "../../lib/ui";

export const SyntaxSection: React.FC = () => {
  const { t } = useTranslation();
  const { config, updateSyntax } = useGrammarStore();

  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-base-content/80 mb-1">
            {t("grammar.wordOrder")}
          </label>
          <select
            value={config.syntax.word_order}
            onChange={(e) =>
              updateSyntax({
                ...config.syntax,
                word_order: e.target.value as WordOrder,
              })
            }
            className={`w-full ${SELECT}`}
          >
            {(["SVO", "SOV", "VSO", "VOS", "OVS", "OSV"] as const).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-base-content/80 mb-1">
            {t("grammar.modifierPos")}
          </label>
          <select
            value={config.syntax.modifier_position}
            onChange={(e) =>
              updateSyntax({
                ...config.syntax,
                modifier_position: e.target.value as ModifierPosition,
              })
            }
            className={`w-full ${SELECT}`}
          >
            <option value="before_head">{t("grammar.beforeHead")}</option>
            <option value="after_head">{t("grammar.afterHead")}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-base-content/80 mb-1">
            {t("grammar.alignment")}
          </label>
          <select
            value={config.syntax.alignment ?? "nom_acc"}
            onChange={(e) =>
              updateSyntax({
                ...config.syntax,
                alignment: e.target.value as MorphosyntacticAlignment,
              })
            }
            className={`w-full ${SELECT}`}
            data-testid="syntax-alignment"
          >
            <option value="nom_acc">{t("grammar.alignNomAcc")}</option>
            <option value="erg_abs">{t("grammar.alignErgAbs")}</option>
            <option value="tripartite">{t("grammar.alignTripartite")}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-base-content/80 mb-1">
            {t("grammar.adpositionType")}
          </label>
          <select
            value={config.syntax.adposition_type}
            onChange={(e) =>
              updateSyntax({
                ...config.syntax,
                adposition_type: e.target.value as AdpositionType,
              })
            }
            className={`w-full ${SELECT}`}
          >
            <option value="preposition">{t("grammar.preposition")}</option>
            <option value="postposition">{t("grammar.postposition")}</option>
          </select>
        </div>
      </div>
    </div>
  );
};
