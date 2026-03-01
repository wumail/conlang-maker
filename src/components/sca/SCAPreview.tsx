import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Play, CheckCircle } from "lucide-react";
import { useSCAStore } from "../../store/scaStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useLexiconStore } from "../../store/lexiconStore";
import {
  applySoundChanges,
  buildMacrosFromInventory,
} from "../../utils/scaEngine";
import { BTN_PRIMARY_MD, BTN_SUCCESS, INPUT_MONO, CARD } from "../../lib/ui";

export function SCAPreview() {
  const { t } = useTranslation();
  const { config: scaConfig } = useSCAStore();
  const { config: phonoConfig } = usePhonoStore();
  const { wordsList, upsertWord } = useLexiconStore();
  const [testWord, setTestWord] = useState("");
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [applied, setApplied] = useState(false);

  const macros = useMemo(
    () =>
      buildMacrosFromInventory(
        phonoConfig.phoneme_inventory.consonants,
        phonoConfig.phoneme_inventory.vowels,
        phonoConfig.phonotactics.macros,
      ),
    [phonoConfig],
  );

  const singleResult = useMemo(() => {
    if (!testWord.trim()) return null;
    return applySoundChanges(testWord.trim(), scaConfig.rule_sets, macros);
  }, [testWord, scaConfig.rule_sets, macros]);

  const batchResults = useMemo(() => {
    if (mode !== "batch") return [];
    setApplied(false);
    return wordsList.map((w) => {
      const { result, changelog } = applySoundChanges(
        w.con_word_romanized,
        scaConfig.rule_sets,
        macros,
      );
      return {
        entry_id: w.entry_id,
        original: w.con_word_romanized,
        result,
        changed: changelog.length > 0,
      };
    });
  }, [mode, wordsList, scaConfig.rule_sets, macros]);

  const changedCount = batchResults.filter((r) => r.changed).length;

  const handleBatchApply = () => {
    for (const r of batchResults) {
      if (!r.changed) continue;
      const word = wordsList.find((w) => w.entry_id === r.entry_id);
      if (word) {
        upsertWord({ ...word, con_word_romanized: r.result });
      }
    }
    setApplied(true);
  };

  return (
    <div className={`${CARD} p-6 space-y-4`}>
      <h3 className="font-semibold text-base-content/80">{t("sca.preview")}</h3>

      <div role="tablist" className="tabs tabs-border">
        <button
          role="tab"
          className={`tab ${mode === "single" ? "tab-active" : ""}`}
          onClick={() => setMode("single")}
        >
          {t("sca.singleWord")}
        </button>
        <button
          role="tab"
          className={`tab ${mode === "batch" ? "tab-active" : ""}`}
          onClick={() => setMode("batch")}
        >
          {t("sca.batchPreview")}
        </button>
      </div>

      {mode === "single" && (
        <div className="space-y-3">
          <div className="flex gap-2 items-center">
            <input
              className={`${INPUT_MONO} flex-1`}
              placeholder={t("sca.testWordPlaceholder")}
              value={testWord}
              onChange={(e) => setTestWord(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
            />
            <button className={BTN_PRIMARY_MD} title={t("sca.runPreview")}>
              <Play className="w-4 h-4" />
            </button>
          </div>

          {singleResult && (
            <div className="border border-base-200 rounded-lg p-4 space-y-2 bg-base-50">
              <div className="flex items-center gap-2 text-lg font-mono">
                <span className="text-base-content/60">{testWord}</span>
                <span className="text-base-content/50">→</span>
                <span className="font-bold text-primary">
                  {singleResult.result}
                </span>
              </div>
              {singleResult.changelog.length > 0 ? (
                <div className="space-y-1">
                  {singleResult.changelog.map((step, i) => (
                    <div key={i} className="text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span className="text-base-content/50">
                          {step.before}
                        </span>
                        <span className="text-base-content/50">→</span>
                        <span className="text-success">{step.after}</span>
                        <span className="text-base-content/60 italic">
                          ({step.description})
                        </span>
                      </div>
                      {step.feature_detail && (
                        <div className="ml-4 text-base-content/50">
                          {t("sca.featureDetail")}: {step.feature_detail}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-base-content/50">
                  {t("sca.noChanges")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {mode === "batch" && (
        <div className="border border-base-200 rounded-lg p-4">
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="table table-xs">
              <thead>
                <tr>
                  <th>{t("sca.original")}</th>
                  <th>{t("sca.result")}</th>
                </tr>
              </thead>
              <tbody>
                {batchResults.slice(0, 100).map((r, i) => (
                  <tr key={i} className={r.changed ? "bg-success/5" : ""}>
                    <td className="font-mono text-sm">{r.original}</td>
                    <td className="font-mono text-sm font-bold">
                      {r.changed ? (
                        r.result
                      ) : (
                        <span className="text-base-content/50">{r.result}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {wordsList.length > 100 && (
              <p className="text-xs text-base-content/50 mt-2">
                {t("sca.showingFirst", { count: 100, total: wordsList.length })}
              </p>
            )}
          </div>
          {changedCount > 0 && (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-base-content/60">
                {t("sca.changedCount", { count: changedCount })}
              </span>
              {applied ? (
                <span className="text-success text-sm flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" /> {t("sca.applied")}
                </span>
              ) : (
                <button className={BTN_SUCCESS} onClick={handleBatchApply}>
                  <CheckCircle className="w-4 h-4" /> {t("sca.batchApply")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
