/**
 * InflectionTest.tsx — 逐规则试算器（Roadmap v3 / Pillar 3）
 *
 * 统一走 `inflectWord`：支持从词典选真实词条（带变位类 / 不规则形式）或手动词干，
 * 每条规则一行结果，点击行展开缺失维度、变位类来源、冲突与逐步推导链。
 */
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { inflectWord } from "../../core/engines/morphologyEngine";
import type { InflectionResult } from "../../types";
import { INPUT_MONO, SELECT, BTN_PRIMARY_MD, BADGE } from "../../lib/ui";
import { ScriptLine } from "../writing/ScriptText";
import { InflectionTracePanel } from "./InflectionTracePanel";

interface TestRow {
  tag: string;
  type: string;
  result: InflectionResult;
}

export const InflectionTest: React.FC = () => {
  const { t } = useTranslation();
  const { config } = useGrammarStore();
  const phonoConfig = usePhonoStore((s) => s.config);
  const words = useLexiconStore((s) => s.wordsList);

  const [testWord, setTestWord] = useState("");
  const [entryId, setEntryId] = useState("");
  const [testPosId, setTestPosId] = useState("");
  const [testRows, setTestRows] = useState<TestRow[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const rules = config.inflection_rules;
  const partsOfSpeech = config.parts_of_speech;
  const posWords = useMemo(
    () => words.filter((word) => word.senses.some((sense) => sense.pos_id === testPosId)),
    [words, testPosId],
  );
  const entry = useMemo(
    () => words.find((word) => word.entry_id === entryId) ?? null,
    [words, entryId],
  );
  const senseId = entry?.senses.find((sense) => sense.pos_id === testPosId)?.sense_id;
  const stem = entry?.con_word_romanized ?? testWord;

  const runTest = () => {
    if (!stem.trim() || !testPosId) return;
    const applicableRules = rules.filter((rule) => rule.pos_id === testPosId && !rule.disabled);
    const rows = applicableRules.map((rule) => ({
      tag: rule.tag,
      type: rule.type,
      result: inflectWord({
        stem,
        posId: testPosId,
        dimensions: rule.dimension_values,
        grammar: config,
        phono: phonoConfig,
        entry,
        senseId,
      }),
    }));
    setTestRows(rows);
    setSelectedIndex(0);
  };

  const current = testRows[selectedIndex];

  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      <p className="text-sm text-base-content/60">{t("grammar.testHint")}</p>
      <div className="flex flex-wrap gap-2">
        <select
          value={testPosId}
          onChange={(e) => {
            setTestPosId(e.target.value);
            setEntryId("");
          }}
          className={SELECT}
        >
          <option value="">{t("grammar.selectPos")}</option>
          {partsOfSpeech.map((p) => (
            <option key={p.pos_id} value={p.pos_id}>
              {p.name || p.pos_id}
            </option>
          ))}
        </select>
        <select
          value={entryId}
          onChange={(e) => setEntryId(e.target.value)}
          className={SELECT}
          disabled={!testPosId}
        >
          <option value="">{t("grammar.testWordPlaceholder")}</option>
          {posWords.map((word) => (
            <option key={word.entry_id} value={word.entry_id}>
              {word.con_word_romanized} · {word.senses[0]?.gloss ?? ""}
            </option>
          ))}
        </select>
        {!entryId && (
          <input
            type="text"
            placeholder={t("grammar.testWordPlaceholder")}
            value={testWord}
            onChange={(e) => setTestWord(e.target.value)}
            className={`flex-1 ${INPUT_MONO}`}
          />
        )}
        <button
          onClick={runTest}
          disabled={!stem.trim() || !testPosId}
          className={`${BTN_PRIMARY_MD}  disabled:opacity-50`}
        >
          {t("grammar.runTest")}
        </button>
      </div>

      {testRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table table-sm table-zebra">
            <thead>
              <tr>
                <th>{t("grammar.tag")}</th>
                <th>{t("grammar.type")}</th>
                <th>{t("grammar.test.output")}</th>
                <th>{"IPA"}</th>
                <th>{t("grammar.morphologyV3.traceTitle")}</th>
              </tr>
            </thead>
            <tbody>
              {testRows.map((row, index) => (
                <tr
                  key={`${row.tag}_${index}`}
                  className={`cursor-pointer ${
                    index === selectedIndex ? "bg-primary/5" : ""
                  }`}
                  onClick={() => setSelectedIndex(index)}
                >
                  <td className="font-mono">{row.tag}</td>
                  <td className="text-xs">{row.type}</td>
                  <td className="font-mono font-bold">
                    {row.result.surface_form}
                    <ScriptLine
                      text={row.result.surface_form}
                      ipa={row.result.phonetic_ipa}
                      className="block text-lg"
                    />
                  </td>
                  <td className="font-mono text-primary">{row.result.phonetic_ipa}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {row.result.conflicts.length > 0 && (
                        <span className={`${BADGE} badge-error badge-xs`}>
                          {t("grammar.morphologyV3.conflictDetected")}
                        </span>
                      )}
                      {row.result.used_irregular && (
                        <span className={`${BADGE} badge-warning badge-xs`}>
                          {t("grammar.morphologyV3.stageIrregular")}
                        </span>
                      )}
                      {row.result.diagnosis.missing_obligatory_dimensions.length > 0 && (
                        <span className={`${BADGE} badge-outline badge-xs`}>
                          {t("grammar.morphologyV3.missingDimensions")}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {current && <InflectionTracePanel result={current.result} />}
    </div>
  );
};
