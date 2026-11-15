import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import {
  buildSampleGlossInput,
  lookupSandboxWord,
  processSandboxText,
  type SandboxResult,
} from "../../utils/sandbox";
import { BTN_PRIMARY, TEXTAREA } from "../../lib/ui";

/** 标签屈折模式：`gloss-TAG1-TAG2` 逐词翻译 + 三行对齐 */
export function GlossSandboxCard() {
  const { t } = useTranslation();
  const wordsMap = useLexiconStore((state) => state.wordsMap);
  const phonoConfig = usePhonoStore((state) => state.config);
  const grammarConfig = useGrammarStore((state) => state.config);

  const wordCount = Object.keys(wordsMap).length;
  const seedKey = `${grammarConfig.language_id}:${wordCount > 0 ? "loaded" : "empty"}`;
  const lastSeedKeyRef = useRef(seedKey);

  const [inputText, setInputText] = useState(() =>
    wordCount > 0
      ? buildSampleGlossInput(wordsMap, grammarConfig)
      : "[star-PL] shine-PAST in void",
  );
  const [results, setResults] = useState<SandboxResult[]>([]);

  useEffect(() => {
    if (lastSeedKeyRef.current === seedKey) return;
    lastSeedKeyRef.current = seedKey;
    if (wordCount > 0) {
      setInputText(buildSampleGlossInput(wordsMap, grammarConfig));
      setResults([]);
    }
  }, [seedKey, wordCount, wordsMap, grammarConfig]);

  const handleTranslate = (): void => {
    const cleanText = inputText.replace(/[\[\]]/g, "");
    setResults(processSandboxText(cleanText, wordsMap, grammarConfig, phonoConfig));
  };

  return (
    <div>
      <textarea
        value={inputText}
        onChange={(event) => setInputText(event.target.value)}
        className={`w-full ${TEXTAREA} font-mono text-sm`}
        rows={3}
      />
      <button onClick={handleTranslate} className={`mt-2 ${BTN_PRIMARY}`}>
        {t("sandbox.translate")}
      </button>

      {results.length > 0 && (
        <div className="mt-6 p-4 bg-base-200/50 rounded-md border border-base-200">
          <h3 className="text-lg font-semibold mb-4 text-base-content/80">
            {t("sandbox.interlinear")}
          </h3>
          <div className="overflow-x-auto">
            <table className="border-collapse">
              <tbody>
                <tr>
                  {results.map((result, index) => (
                    <td
                      key={index}
                      className="pr-6 pb-0.5 font-bold text-primary text-lg font-mono whitespace-nowrap"
                    >
                      {result.conlang}
                    </td>
                  ))}
                </tr>
                {grammarConfig.typology.morphological_type === "agglutinative" && (
                  <tr>
                    {results.map((result, index) => (
                      <td
                        key={index}
                        className="pr-6 pb-0.5 text-xs text-purple-600 font-mono whitespace-nowrap"
                      >
                        {result.gloss.split("-").join("-")}
                      </td>
                    ))}
                  </tr>
                )}
                <tr>
                  {results.map((result, index) => {
                    const extraLabel =
                      grammarConfig.typology.morphological_type === "isolating"
                        ? (() => {
                            const found = lookupSandboxWord(
                              result.original.split("-")[0],
                              wordsMap,
                            );
                            const fn = found?.word.senses[0]?.grammatical_function;
                            return fn ? ` [${fn}]` : "";
                          })()
                        : "";
                    return (
                      <td
                        key={index}
                        className="pr-6 pb-0.5 text-sm text-base-content/70 font-mono whitespace-nowrap"
                      >
                        {result.gloss}
                        {extraLabel}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  {results.map((result, index) => (
                    <td
                      key={index}
                      className="pr-6 text-sm text-success font-mono whitespace-nowrap"
                    >
                      {result.ipa}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
