/**
 * Sandbox.tsx — Phase 2 增强翻译沙盒
 *
 * 支持两种模式：
 * 1. 标签屈折模式（Phase 1 延续）：gloss-TAG1-TAG2
 * 2. 句法重排模式（Phase 2 新增）：标注 S/V/O 角色 → 自动重排 + 屈折
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import {
  processSandboxText,
  reorderBySyntax,
  autoApplyInflections,
  SandboxResult,
  AnnotatedToken,
  SyntaxRole,
} from "../../utils/sandbox";
import { applyInflectionTypologyAware } from "../../utils/morphologyEngine";
import { generateIPA } from "../../utils/ipaGenerator";
import {
  CARD,
  BTN_PRIMARY,
  BTN_GHOST,
  TEXTAREA,
  SELECT,
  INPUT_MONO,
  BADGE,
} from "../../lib/ui";
import { Languages } from "lucide-react";
import { PageHeader } from "../common/PageHeader";

const ROLES: SyntaxRole[] = ["S", "V", "O", "Mod", "Adp", "Other"];

export const Sandbox: React.FC = () => {
  const { t } = useTranslation();
  const { wordsMap } = useLexiconStore();
  const phonoConfig = usePhonoStore((s) => s.config);
  const grammarConfig = useGrammarStore((s) => s.config);

  // Mode
  const [mode, setMode] = useState<"gloss" | "syntax">("gloss");

  // Gloss mode
  const [inputText, setInputText] = useState("[star-PL] shine-PAST in void");
  const [results, setResults] = useState<SandboxResult[]>([]);

  // Syntax mode
  const [syntaxTokens, setSyntaxTokens] = useState<AnnotatedToken[]>([
    { gloss: "cat", role: "S", tags: [] },
    { gloss: "eat", role: "V", tags: [] },
    { gloss: "fish", role: "O", tags: [] },
  ]);
  const [reorderedResults, setReorderedResults] = useState<SandboxResult[]>([]);

  // ── 词形构建助手 ──────────────────────────────────────
  const [helperWord, setHelperWord] = useState("");
  const [helperPos, setHelperPos] = useState("");
  const [helperDimVals, setHelperDimVals] = useState<Record<string, string>>(
    {},
  );

  const helperDims = grammarConfig.inflection_dimensions.filter((d) =>
    d.applies_to_pos.includes(helperPos),
  );

  const helperResult = (() => {
    if (!helperWord || !helperPos) return null;
    const hasAnyDim = Object.values(helperDimVals).some((v) => v !== "");
    if (!hasAnyDim) return null;
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
    // 找到匹配规则的 tag 用于显示
    const matchedRule = grammarConfig.inflection_rules.find(
      (r) =>
        r.pos_id === helperPos &&
        !r.disabled &&
        Object.entries(helperDimVals).every(
          ([k, v]) => r.dimension_values[k] === v,
        ),
    );
    return { form: result, ipa: phonemic, tag: matchedRule?.tag ?? "" };
  })();

  // ── Gloss mode handler ────────────────────────────────
  const handleTranslate = () => {
    const cleanText = inputText.replace(/[\[\]]/g, "");
    setResults(
      processSandboxText(cleanText, wordsMap, grammarConfig, phonoConfig),
    );
  };

  // ── Syntax mode handler ───────────────────────────────
  const handleSyntaxReorder = () => {
    const reordered = reorderBySyntax(syntaxTokens, grammarConfig.syntax);

    const sandboxResults = reordered.map((tok) => {
      // 自动推断屈折标签
      const lookup = Object.values(wordsMap).find((w) =>
        w.senses.some((s) => s.gloss.toLowerCase() === tok.gloss.toLowerCase()),
      );
      const posId = lookup?.senses[0]?.pos_id ?? "";
      const autoTags = autoApplyInflections(
        tok.role,
        grammarConfig.inflection_dimensions,
        posId,
      );
      const allTags = [...tok.tags, ...autoTags];

      const text =
        allTags.length > 0 ? `${tok.gloss}-${allTags.join("-")}` : tok.gloss;
      const res = processSandboxText(
        text,
        wordsMap,
        grammarConfig,
        phonoConfig,
      );
      return (
        res[0] ?? {
          original: tok.gloss,
          conlang: `?${tok.gloss}?`,
          ipa: "/?/",
          gloss: tok.gloss,
        }
      );
    });
    setReorderedResults(sandboxResults);
  };

  const addSyntaxToken = () =>
    setSyntaxTokens((prev) => [
      ...prev,
      { gloss: "", role: "Other", tags: [] },
    ]);
  const removeSyntaxToken = (idx: number) =>
    setSyntaxTokens((prev) => prev.filter((_, i) => i !== idx));
  const updateToken = (
    idx: number,
    field: keyof AnnotatedToken,
    value: string,
  ) => {
    setSyntaxTokens((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)),
    );
  };

  const activeResults = mode === "gloss" ? results : reorderedResults;

  return (
    <div className="space-y-6">
      <PageHeader icon={<Languages size={24} />} title={t("sandbox.title")} />

      <div className={`${CARD} p-6`}>
        {/* Mode tabs */}
        <div role="tablist" className="tabs tabs-border mb-4">
          <button
            role="tab"
            className={`tab ${mode === "gloss" ? "tab-active" : ""}`}
            onClick={() => setMode("gloss")}
          >
            {t("sandbox.glossMode")}
          </button>
          <button
            role="tab"
            className={`tab ${mode === "syntax" ? "tab-active" : ""}`}
            onClick={() => setMode("syntax")}
          >
            {t("sandbox.syntaxMode")}
          </button>
        </div>

        {/* Gloss mode */}
        {mode === "gloss" && (
          <div className="mb-4">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className={`w-full ${TEXTAREA} font-mono text-sm`}
              rows={3}
            />
            <button onClick={handleTranslate} className={`mt-2 ${BTN_PRIMARY}`}>
              {t("sandbox.translate")}
            </button>
          </div>
        )}

        {/* Syntax reorder mode */}
        {mode === "syntax" && (
          <div className="mb-4 space-y-2">
            {syntaxTokens.map((tok, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={tok.gloss}
                  onChange={(e) => updateToken(i, "gloss", e.target.value)}
                  className={`w-32 ${INPUT_MONO}`}
                  placeholder="gloss"
                />
                <select
                  value={tok.role}
                  onChange={(e) => updateToken(i, "role", e.target.value)}
                  className={`w-20 ${SELECT}`}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <span className={`${BADGE} badge-ghost text-xs`}>
                  {tok.role}
                </span>
                <button
                  onClick={() => removeSyntaxToken(i)}
                  className="text-red-400 text-xs hover:text-red-600"
                  title={t("common.removeToken")}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <button onClick={addSyntaxToken} className={BTN_GHOST}>
                + {t("sandbox.addToken")}
              </button>
              <button onClick={handleSyntaxReorder} className={BTN_PRIMARY}>
                {t("sandbox.reorder")}
              </button>
            </div>
          </div>
        )}

        {/* Interlinear results */}
        {activeResults.length > 0 && (
          <div className="mt-6 p-4 bg-base-200/50 rounded-md border border-base-200">
            <h3 className="text-lg font-semibold mb-4 text-base-content/80">
              {t("sandbox.interlinear")}
            </h3>
            <div className="overflow-x-auto">
              <table className="border-collapse">
                <tbody>
                  <tr>
                    {activeResults.map((r, i) => (
                      <td
                        key={i}
                        className="pr-6 pb-0.5 font-bold text-primary text-lg font-mono whitespace-nowrap"
                      >
                        {r.conlang}
                      </td>
                    ))}
                  </tr>
                  {/* 黏着语：显示语素边界 */}
                  {grammarConfig.typology.morphological_type ===
                    "agglutinative" && (
                    <tr>
                      {activeResults.map((r, i) => {
                        const morphemes = r.gloss.split("-");
                        return (
                          <td
                            key={i}
                            className="pr-6 pb-0.5 text-xs text-purple-600 font-mono whitespace-nowrap"
                          >
                            {morphemes.join("-")}
                          </td>
                        );
                      })}
                    </tr>
                  )}
                  <tr>
                    {activeResults.map((r, i) => {
                      // 孤立语: 为虚词显示 grammatical_function 标签
                      const extraLabel =
                        grammarConfig.typology.morphological_type ===
                        "isolating"
                          ? (() => {
                              const entry = Object.values(wordsMap).find((w) =>
                                w.senses.some(
                                  (s) =>
                                    s.gloss.toLowerCase() ===
                                    r.original.split("-")[0].toLowerCase(),
                                ),
                              );
                              const fn = entry?.senses[0]?.grammatical_function;
                              return fn ? ` [${fn}]` : "";
                            })()
                          : "";
                      return (
                        <td
                          key={i}
                          className="pr-6 pb-0.5 text-sm text-base-content/70 font-mono whitespace-nowrap"
                        >
                          {r.gloss}
                          {extraLabel}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    {activeResults.map((r, i) => (
                      <td
                        key={i}
                        className="pr-6 text-sm text-success font-mono whitespace-nowrap"
                      >
                        {r.ipa}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 词形构建助手 */}
        <div className="mt-6 p-4 bg-info/10/50 rounded-md border border-info/20">
          <h3 className="text-sm font-semibold mb-2 text-base-content/80">
            {t("sandbox.inflectionHelper")}
          </h3>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              value={helperWord}
              onChange={(e) => setHelperWord(e.target.value)}
              className={`w-32 ${INPUT_MONO}`}
              placeholder={t("grammar.testWordPlaceholder")}
            />
            <select
              value={helperPos}
              onChange={(e) => {
                setHelperPos(e.target.value);
                setHelperDimVals({});
              }}
              className={`w-32 ${SELECT}`}
            >
              <option value="">--</option>
              {grammarConfig.parts_of_speech.map((p) => (
                <option key={p.pos_id} value={p.pos_id}>
                  {p.name}
                </option>
              ))}
            </select>
            {helperDims.map((dim) => (
              <select
                key={dim.dim_id}
                value={helperDimVals[dim.dim_id] ?? ""}
                onChange={(e) =>
                  setHelperDimVals((prev) => ({
                    ...prev,
                    [dim.dim_id]: e.target.value,
                  }))
                }
                className={`w-28 ${SELECT}`}
              >
                <option value="">{dim.name}</option>
                {dim.values.map((v) => (
                  <option key={v.val_id} value={v.val_id}>
                    {v.name}
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
              <span className="font-mono text-sm text-primary">
                /{helperResult.ipa}/
              </span>
              <span className={`${BADGE} badge-ghost text-xs`}>
                {helperResult.tag}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
