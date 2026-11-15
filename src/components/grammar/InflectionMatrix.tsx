/**
 * InflectionMatrix.tsx — 统一形态引擎驱动的维度交叉矩阵（Roadmap v3 / Pillar 3）
 *
 * 试算对象可以是词典中的真实词条（带变位类 / 不规则形式 / 义项级覆盖），
 * 也可以是手动输入词干；点击任意单元格展示该类推导的完整诊断与逐步链。
 */
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useLexiconStore } from "../../store/lexiconStore";
import {
  inflectWord,
  resolveEntryConjugationClass,
} from "../../core/engines/morphologyEngine";
import type { InflectionResult } from "../../types";
import { SELECT, INPUT_MONO, BADGE } from "../../lib/ui";
import { ScriptLine } from "../writing/ScriptText";
import { InflectionTracePanel } from "./InflectionTracePanel";

export const InflectionMatrix: React.FC = () => {
  const { t } = useTranslation();
  const { config } = useGrammarStore();
  const phonoConfig = usePhonoStore((s) => s.config);
  const words = useLexiconStore((s) => s.wordsList);
  const { parts_of_speech, inflection_dimensions, inflection_rules, conjugation_classes } = config;

  const [posId, setPosId] = useState(parts_of_speech[0]?.pos_id ?? "");
  const [entryId, setEntryId] = useState("");
  const [manualStem, setManualStem] = useState("");
  const [picked, setPicked] = useState<{
    dimensions: Record<string, string>;
    result: InflectionResult;
  } | null>(null);

  const dims = useMemo(
    () => inflection_dimensions.filter((d) => d.applies_to_pos.includes(posId)),
    [inflection_dimensions, posId],
  );
  const posRules = useMemo(
    () => inflection_rules.filter((r) => r.pos_id === posId && !r.disabled),
    [inflection_rules, posId],
  );
  const posWords = useMemo(
    () => words.filter((word) => word.senses.some((sense) => sense.pos_id === posId)),
    [words, posId],
  );
  const entry = useMemo(
    () => words.find((word) => word.entry_id === entryId) ?? null,
    [words, entryId],
  );
  const senseId = entry?.senses.find((sense) => sense.pos_id === posId)?.sense_id;
  const stem = entry?.con_word_romanized ?? manualStem;
  const resolvedClass = useMemo(
    () =>
      resolveEntryConjugationClass(
        entry,
        posId,
        conjugation_classes ?? [],
        senseId,
      ),
    [entry, posId, conjugation_classes, senseId],
  );
  const dimensionLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const dim of dims) {
      for (const value of dim.values) {
        labels[`${dim.dim_id}:${value.val_id}`] =
          `${dim.name}: ${value.name}${value.gloss ? ` (${value.gloss})` : ""}`;
      }
    }
    return labels;
  }, [dims]);

  const inflect = (combo: Record<string, string>): InflectionResult | null => {
    if (!stem.trim()) return null;
    return inflectWord({
      stem,
      posId,
      dimensions: combo,
      grammar: config,
      phono: phonoConfig,
      entry,
      senseId,
    });
  };

  const renderCell = (combo: Record<string, string>) => {
    const result = inflect(combo);
    if (!result) return <span className="text-base-content/30">—</span>;
    const selected =
      picked && JSON.stringify(picked.dimensions) === JSON.stringify(combo);
    return (
      <button
        type="button"
        className={`w-full rounded px-1 py-0.5 text-center hover:bg-primary/10 ${
          selected ? "bg-primary/10 ring-1 ring-primary/40" : ""
        }`}
        onClick={() => setPicked({ dimensions: combo, result })}
      >
        <span className="font-mono text-sm font-bold">{result.surface_form}</span>
        <ScriptLine text={result.surface_form} ipa={result.phonetic_ipa} className="block text-lg" />
        <span className="block font-mono text-xs text-primary">{result.phonetic_ipa}</span>
      </button>
    );
  };

  const dim0 = dims[0];
  const dim1 = dims[1];

  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      {parts_of_speech.length === 0 ? (
        <p className="text-sm text-base-content/50 italic">{t("typology.noPosHint")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select value={posId} onChange={(e) => setPosId(e.target.value)} className={SELECT}>
              {parts_of_speech.map((p) => (
                <option key={p.pos_id} value={p.pos_id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              value={entryId}
              onChange={(e) => setEntryId(e.target.value)}
              className={SELECT}
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
                value={manualStem}
                onChange={(e) => setManualStem(e.target.value)}
                className={`w-40 ${INPUT_MONO}`}
                placeholder={t("grammar.testWordPlaceholder")}
              />
            )}
            <span className="text-xs text-base-content/50">
              {dims.length} {t("grammar.dimensions.title")} · {posRules.length} {t("grammar.title")}
            </span>
            <span className={`${BADGE} badge-outline badge-sm`}>
              {t("grammar.morphologyV3.resolvedClass")}:{" "}
              {resolvedClass.classId ?? t("grammar.morphologyV3.classSourceNone")}
            </span>
          </div>

          {dims.length === 0 && (
            <p className="text-sm text-base-content/50 italic">{t("grammar.dimensions.noDimensions")}</p>
          )}

          {dims.length === 1 && dim0 && (
            <div className="overflow-x-auto">
              <table className="table table-sm table-zebra">
                <thead>
                  <tr>
                    <th>{dim0.name}</th>
                    <th>{t("grammar.tag")}</th>
                    <th>{t("grammar.test.output")}</th>
                    <th>{"IPA"}</th>
                  </tr>
                </thead>
                <tbody>
                  {dim0.values.map((value) => {
                    const combo = { [dim0.dim_id]: value.val_id };
                    const result = inflect(combo);
                    return (
                      <tr key={value.val_id}>
                        <td className="font-semibold">
                          {value.name}{" "}
                          <span className={`${BADGE} badge-ghost text-xs`}>{value.gloss}</span>
                        </td>
                        <td className="font-mono text-xs">{result?.gloss_labels ?? "—"}</td>
                        <td className="font-mono font-bold">
                          {result?.surface_form ?? "—"}
                          {result && (
                            <ScriptLine
                              text={result.surface_form}
                              ipa={result.phonetic_ipa}
                              className="block text-lg"
                            />
                          )}
                        </td>
                        <td className="font-mono text-sm text-primary">{result?.phonetic_ipa ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {dims.length >= 2 && dim0 && dim1 && (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th className="bg-base-200">
                      {dim0.name} ╲ {dim1.name}
                    </th>
                    {dim1.values.map((value) => (
                      <th key={value.val_id} className="text-center">
                        {value.name}
                        <br />
                        <span className="text-xs text-base-content/50">{value.gloss}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dim0.values.map((v0) => (
                    <tr key={v0.val_id}>
                      <td className="bg-base-200/50 font-semibold">
                        {v0.name}{" "}
                        <span className="text-xs text-base-content/50">{v0.gloss}</span>
                      </td>
                      {dim1.values.map((v1) => (
                        <td key={v1.val_id} className="text-center">
                          {renderCell({
                            [dim0.dim_id]: v0.val_id,
                            [dim1.dim_id]: v1.val_id,
                          })}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {dims.length > 2 && (
            <p className="text-xs text-base-content/50">
              {t("grammar.matrix.extraDims")}: {dims.slice(2).map((d) => d.name).join(", ")}
            </p>
          )}

          {picked && (
            <InflectionTracePanel result={picked.result} dimensionLabels={dimensionLabels} />
          )}
        </>
      )}
    </div>
  );
};
