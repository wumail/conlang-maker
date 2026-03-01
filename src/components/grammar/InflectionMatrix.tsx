/**
 * InflectionMatrix.tsx — Sprint 2 维度交叉矩阵视图
 *
 * 用户选择词性 → 显示所有相关维度 → 生成二维交叉矩阵
 * 每个单元格对应一条屈折规则
 */
import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { applyInflection } from "../../utils/morphologyEngine";
import { generateIPA } from "../../utils/ipaGenerator";
import { SELECT, INPUT_MONO, BADGE } from "../../lib/ui";

export const InflectionMatrix: React.FC = () => {
  const { t } = useTranslation();
  const { config } = useGrammarStore();
  const phonoConfig = usePhonoStore((s) => s.config);
  const { parts_of_speech, inflection_dimensions, inflection_rules } = config;

  const [posId, setPosId] = useState(parts_of_speech[0]?.pos_id ?? "");
  const [testWord, setTestWord] = useState("");

  // 筛选当前词性的维度
  const dims = useMemo(
    () => inflection_dimensions.filter((d) => d.applies_to_pos.includes(posId)),
    [inflection_dimensions, posId],
  );

  // 筛选当前词性的规则
  const posRules = useMemo(
    () => inflection_rules.filter((r) => r.pos_id === posId && !r.disabled),
    [inflection_rules, posId],
  );

  // 查找匹配维度组合的规则
  const findRule = (combo: Record<string, string>) => {
    return posRules.find((r) => {
      return Object.entries(combo).every(
        ([dimId, valId]) => r.dimension_values[dimId] === valId,
      );
    });
  };

  // 生成屈折结果
  const inflect = (combo: Record<string, string>) => {
    if (!testWord) return null;
    const rule = findRule(combo);
    if (!rule) return null;
    const { result, applied } = applyInflection(testWord, rule, phonoConfig);
    if (!applied) return null;
    const { phonemic } = generateIPA(result, phonoConfig);
    return { form: result, ipa: phonemic, tag: rule.tag };
  };

  // 二维矩阵：取前两个维度
  const dim0 = dims[0];
  const dim1 = dims[1];

  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      {parts_of_speech.length === 0 ? (
        <p className="text-sm text-base-content/50 italic">
          {t("typology.noPosHint")}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <select
              value={posId}
              onChange={(e) => setPosId(e.target.value)}
              className={SELECT}
            >
              {parts_of_speech.map((p) => (
                <option key={p.pos_id} value={p.pos_id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={testWord}
              onChange={(e) => setTestWord(e.target.value)}
              className={`w-40 ${INPUT_MONO}`}
              placeholder={t("grammar.testWordPlaceholder")}
            />
            <span className="text-xs text-base-content/50">
              {dims.length} {t("grammar.dimensions.title")} · {posRules.length}{" "}
              {t("grammar.title")}
            </span>
          </div>

          {dims.length === 0 && (
            <p className="text-sm text-base-content/50 italic">
              {t("grammar.dimensions.noDimensions")}
            </p>
          )}

          {/* 1D: 单维度列表 */}
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
                  {dim0.values.map((v) => {
                    const combo = { [dim0.dim_id]: v.val_id };
                    const res = inflect(combo);
                    const rule = findRule(combo);
                    return (
                      <tr key={v.val_id}>
                        <td className="font-semibold">
                          {v.name}{" "}
                          <span className={`${BADGE} badge-ghost text-xs`}>
                            {v.gloss}
                          </span>
                        </td>
                        <td className="font-mono text-xs">
                          {rule?.tag ?? "—"}
                        </td>
                        <td className="font-mono font-bold">
                          {res?.form ?? "—"}
                        </td>
                        <td className="font-mono text-primary text-sm">
                          {res?.ipa ?? ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 2D+: 交叉矩阵 */}
          {dims.length >= 2 && dim0 && dim1 && (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th className="bg-base-200">
                      {dim0.name} ╲ {dim1.name}
                    </th>
                    {dim1.values.map((v1) => (
                      <th key={v1.val_id} className="text-center">
                        {v1.name}
                        <br />
                        <span className="text-xs text-base-content/50">
                          {v1.gloss}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dim0.values.map((v0) => (
                    <tr key={v0.val_id}>
                      <td className="font-semibold bg-base-200/50">
                        {v0.name}{" "}
                        <span className="text-xs text-base-content/50">
                          {v0.gloss}
                        </span>
                      </td>
                      {dim1.values.map((v1) => {
                        const combo = {
                          [dim0.dim_id]: v0.val_id,
                          [dim1.dim_id]: v1.val_id,
                        };
                        const res = inflect(combo);
                        return (
                          <td key={v1.val_id} className="text-center">
                            {res ? (
                              <div>
                                <span className="font-mono font-bold text-sm">
                                  {res.form}
                                </span>
                                <br />
                                <span className="font-mono text-xs text-primary">
                                  {res.ipa}
                                </span>
                              </div>
                            ) : (
                              <span className="text-base-content/30">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 3D+ 提示 */}
          {dims.length > 2 && (
            <p className="text-xs text-base-content/50">
              {t("grammar.matrix.extraDims")}:{" "}
              {dims
                .slice(2)
                .map((d) => d.name)
                .join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  );
};
