import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { generateIPA } from "../../utils/ipaGenerator";
import { applyInflection } from "../../utils/morphologyEngine";
import { INPUT_MONO, SELECT, BTN_PRIMARY_MD } from "../../lib/ui";

interface TestResult {
  tag: string;
  type: string;
  output: string;
  ipa: string;
  applied: boolean;
  reason: string;
}

export const InflectionTest: React.FC = () => {
  const { t } = useTranslation();
  const { config } = useGrammarStore();
  const phonoConfig = usePhonoStore((s) => s.config);

  const [testWord, setTestWord] = useState("");
  const [testPosId, setTestPosId] = useState("");
  const [testResults, setTestResults] = useState<TestResult[]>([]);

  const rules = config.inflection_rules;
  const partsOfSpeech = config.parts_of_speech;

  const runTest = () => {
    if (!testWord || !testPosId) return;
    const applicableRules = rules.filter(
      (r) => r.pos_id === testPosId && !r.disabled,
    );
    const results = applicableRules.map((rule) => {
      const { result, applied, log } = applyInflection(
        testWord,
        rule,
        phonoConfig,
      );
      const { phonemic } = generateIPA(result, phonoConfig);

      return {
        tag: rule.tag,
        type: rule.type,
        output: result,
        ipa: phonemic,
        applied,
        reason: log,
      };
    });
    setTestResults(results);
  };

  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      <p className="text-sm text-base-content/60">{t("grammar.testHint")}</p>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder={t("grammar.testWordPlaceholder")}
          value={testWord}
          onChange={(e) => setTestWord(e.target.value)}
          className={`flex-1 ${INPUT_MONO}`}
        />
        <select
          value={testPosId}
          onChange={(e) => setTestPosId(e.target.value)}
          className={`${SELECT}`}
        >
          <option value="">{t("grammar.selectPos")}</option>
          {partsOfSpeech.map((p) => (
            <option key={p.pos_id} value={p.pos_id}>
              {p.name || p.pos_id}
            </option>
          ))}
        </select>
        <button
          onClick={runTest}
          disabled={!testWord || !testPosId}
          className={`${BTN_PRIMARY_MD}  disabled:opacity-50`}
        >
          {t("grammar.runTest")}
        </button>
      </div>

      {testResults.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table table-sm table-zebra">
            <thead>
              <tr>
                <th>{t("grammar.tag")}</th>
                <th>{t("grammar.type")}</th>
                <th>{t("grammar.test.output")}</th>
                <th>{"IPA"}</th>
                <th>{t("grammar.test.detail")}</th>
              </tr>
            </thead>
            <tbody>
              {testResults.map((r, i) => (
                <tr
                  key={i}
                  className={r.applied ? "bg-success/10" : "opacity-60"}
                >
                  <td className="font-mono">{r.tag}</td>
                  <td className="text-xs">{r.type}</td>
                  <td className="font-mono font-bold">{r.output}</td>
                  <td className="font-mono text-primary">{r.ipa}</td>
                  <td className="text-xs max-w-xs">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
