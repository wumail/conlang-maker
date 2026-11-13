import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import { applyInflectionTypologyAware } from "../../utils/morphologyEngine";
import { generateIPA } from "../../utils/ipaGenerator";
import { BADGE, INPUT_MONO, SELECT } from "../../lib/ui";

/** 词形构建助手：任选词性 + 维度值，即时回显屈折形式与 IPA */
export function InflectionHelperCard() {
  const { t } = useTranslation();
  const phonoConfig = usePhonoStore((state) => state.config);
  const grammarConfig = useGrammarStore((state) => state.config);

  const [helperWord, setHelperWord] = useState("");
  const [helperPos, setHelperPos] = useState("");
  const [helperDimVals, setHelperDimVals] = useState<Record<string, string>>({});

  const helperDims = grammarConfig.inflection_dimensions.filter((dimension) =>
    dimension.applies_to_pos.includes(helperPos),
  );

  const helperResult = (() => {
    if (!helperWord || !helperPos) return null;
    if (!Object.values(helperDimVals).some((value) => value !== "")) return null;
    const { result, applied } = applyInflectionTypologyAware(
      helperWord,
      "",
      helperPos,
      helperDimVals,
      grammarConfig,
      phonoConfig,
    );
    if (!applied) return null;
    const { phonemic } = generateIPA(result, phonoConfig);
    const matchedRule = grammarConfig.inflection_rules.find(
      (rule) =>
        rule.pos_id === helperPos &&
        !rule.disabled &&
        Object.entries(helperDimVals).every(
          ([key, value]) => rule.dimension_values[key] === value,
        ),
    );
    return { form: result, ipa: phonemic, tag: matchedRule?.tag ?? "" };
  })();

  return (
    <div className="p-4 bg-info/10/50 rounded-md border border-info/20">
      <h3 className="text-sm font-semibold mb-2 text-base-content/80">
        {t("sandbox.inflectionHelper")}
      </h3>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          type="text"
          value={helperWord}
          onChange={(event) => setHelperWord(event.target.value)}
          className={`w-32 ${INPUT_MONO}`}
          placeholder={t("grammar.testWordPlaceholder")}
        />
        <select
          value={helperPos}
          onChange={(event) => {
            setHelperPos(event.target.value);
            setHelperDimVals({});
          }}
          className={`w-32 ${SELECT}`}
        >
          <option value="">--</option>
          {grammarConfig.parts_of_speech.map((pos) => (
            <option key={pos.pos_id} value={pos.pos_id}>
              {pos.name}
            </option>
          ))}
        </select>
        {helperDims.map((dimension) => (
          <select
            key={dimension.dim_id}
            value={helperDimVals[dimension.dim_id] ?? ""}
            onChange={(event) =>
              setHelperDimVals((prev) => ({
                ...prev,
                [dimension.dim_id]: event.target.value,
              }))
            }
            className={`w-28 ${SELECT}`}
          >
            <option value="">{dimension.name}</option>
            {dimension.values.map((value) => (
              <option key={value.val_id} value={value.val_id}>
                {value.name}
              </option>
            ))}
          </select>
        ))}
      </div>
      {helperResult && (
        <div className="flex items-center gap-3">
          <span className="font-mono font-bold text-lg text-primary">
            {helperResult.form}
          </span>
          <span className="font-mono text-sm text-primary">/{helperResult.ipa}/</span>
          <span className={`${BADGE} badge-ghost text-xs`}>{helperResult.tag}</span>
        </div>
      )}
    </div>
  );
}
