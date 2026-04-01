import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Play, CheckCircle } from "lucide-react";
import { useSCAStore } from "../../store/scaStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import {
  applySoundChanges,
  buildMacrosFromInventory,
} from "../../utils/scaEngine";
import { BTN_PRIMARY_MD, BTN_SUCCESS, INPUT_MONO, CARD } from "../../lib/ui";
import type { DerivationRule, InflectionRule, SCARuleSet } from "../../types";

const PAGE_SIZE = 100;

interface PreviewRow {
  key: string;
  scope: "lexicon" | "inflection" | "derivation";
  label: string;
  field: string;
  original: string;
  result: string;
}

function patchInflectionRuleWithSCA(
  rule: InflectionRule,
  ruleIndex: number,
  ruleSets: SCARuleSet[],
  macros: Record<string, string[]>,
) {
  const rows: PreviewRow[] = [];
  let changed = false;
  let nextRule: InflectionRule = rule;

  const patchString = (
    value: string | undefined,
    updater: (nextValue: string) => void,
    fieldLabel: string,
  ) => {
    const source = value ?? "";
    if (!source.trim()) return;
    const result = applySoundChanges(source, ruleSets, macros).result;
    if (result === source) return;
    updater(result);
    changed = true;
    rows.push({
      key: `inf_${rule.rule_id}_${fieldLabel}_${rows.length}`,
      scope: "inflection",
      label: rule.tag || `#${ruleIndex + 1}`,
      field: fieldLabel,
      original: source,
      result,
    });
  };

  patchString(
    rule.affix,
    (nextValue) => {
      nextRule = { ...nextRule, affix: nextValue };
    },
    "affix",
  );

  patchString(
    rule.infix_config?.morpheme,
    (nextValue) => {
      nextRule = {
        ...nextRule,
        infix_config: {
          ...(nextRule.infix_config ?? { position_regex: "", morpheme: "" }),
          morpheme: nextValue,
        },
      };
    },
    "infix",
  );

  patchString(
    rule.circumfix_config?.prefix_part,
    (nextValue) => {
      nextRule = {
        ...nextRule,
        circumfix_config: {
          ...(nextRule.circumfix_config ?? {
            prefix_part: "",
            suffix_part: "",
          }),
          prefix_part: nextValue,
        },
      };
    },
    "circumfix.prefix",
  );

  patchString(
    rule.circumfix_config?.suffix_part,
    (nextValue) => {
      nextRule = {
        ...nextRule,
        circumfix_config: {
          ...(nextRule.circumfix_config ?? {
            prefix_part: "",
            suffix_part: "",
          }),
          suffix_part: nextValue,
        },
      };
    },
    "circumfix.suffix",
  );

  patchString(
    rule.ablaut_config?.target_vowel,
    (nextValue) => {
      nextRule = {
        ...nextRule,
        ablaut_config: {
          ...(nextRule.ablaut_config ?? {
            target_vowel: "",
            replacement_vowel: "",
          }),
          target_vowel: nextValue,
        },
      };
    },
    "ablaut.target",
  );

  patchString(
    rule.ablaut_config?.replacement_vowel,
    (nextValue) => {
      nextRule = {
        ...nextRule,
        ablaut_config: {
          ...(nextRule.ablaut_config ?? {
            target_vowel: "",
            replacement_vowel: "",
          }),
          replacement_vowel: nextValue,
        },
      };
    },
    "ablaut.replacement",
  );

  return { changed, nextRule, rows };
}

function patchDerivationRuleWithSCA(
  rule: DerivationRule,
  ruleIndex: number,
  ruleSets: SCARuleSet[],
  macros: Record<string, string[]>,
) {
  const rows: PreviewRow[] = [];
  let changed = false;
  let nextRule: DerivationRule = rule;

  const patchString = (
    value: string | undefined,
    updater: (nextValue: string) => void,
    fieldLabel: string,
  ) => {
    const source = value ?? "";
    if (!source.trim()) return;
    const result = applySoundChanges(source, ruleSets, macros).result;
    if (result === source) return;
    updater(result);
    changed = true;
    rows.push({
      key: `der_${rule.rule_id}_${fieldLabel}_${rows.length}`,
      scope: "derivation",
      label: rule.name || `#${ruleIndex + 1}`,
      field: fieldLabel,
      original: source,
      result,
    });
  };

  patchString(
    rule.affix,
    (nextValue) => {
      nextRule = { ...nextRule, affix: nextValue };
    },
    "affix",
  );

  patchString(
    rule.infix_config?.morpheme,
    (nextValue) => {
      nextRule = {
        ...nextRule,
        infix_config: {
          ...(nextRule.infix_config ?? { position_regex: "", morpheme: "" }),
          morpheme: nextValue,
        },
      };
    },
    "infix",
  );

  patchString(
    rule.circumfix_config?.prefix_part,
    (nextValue) => {
      nextRule = {
        ...nextRule,
        circumfix_config: {
          ...(nextRule.circumfix_config ?? {
            prefix_part: "",
            suffix_part: "",
          }),
          prefix_part: nextValue,
        },
      };
    },
    "circumfix.prefix",
  );

  patchString(
    rule.circumfix_config?.suffix_part,
    (nextValue) => {
      nextRule = {
        ...nextRule,
        circumfix_config: {
          ...(nextRule.circumfix_config ?? {
            prefix_part: "",
            suffix_part: "",
          }),
          suffix_part: nextValue,
        },
      };
    },
    "circumfix.suffix",
  );

  return { changed, nextRule, rows };
}

export function SCAPreview() {
  const { t } = useTranslation();
  const { config: scaConfig } = useSCAStore();
  const { config: phonoConfig } = usePhonoStore();
  const { wordsList, upsertWord } = useLexiconStore();
  const {
    config: grammarConfig,
    setInflections,
    setDerivations,
  } = useGrammarStore();
  const [testWord, setTestWord] = useState("");
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [applied, setApplied] = useState(false);
  const [batchPage, setBatchPage] = useState(1);

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

  const batchRows = useMemo(() => {
    if (mode !== "batch") return [];
    const rows: PreviewRow[] = [];

    for (const w of wordsList) {
      const { result, changelog } = applySoundChanges(
        w.con_word_romanized,
        scaConfig.rule_sets,
        macros,
      );
      if (changelog.length === 0) continue;
      rows.push({
        key: `lex_${w.entry_id}`,
        scope: "lexicon",
        label: w.con_word_romanized,
        field: "word",
        original: w.con_word_romanized,
        result,
      });
    }

    grammarConfig.inflection_rules.forEach((rule, index) => {
      if (!rule.sca_mutable) return;
      const patched = patchInflectionRuleWithSCA(
        rule,
        index,
        scaConfig.rule_sets,
        macros,
      );
      rows.push(...patched.rows);
    });

    grammarConfig.derivation_rules.forEach((rule, index) => {
      if (!rule.sca_mutable) return;
      const patched = patchDerivationRuleWithSCA(
        rule,
        index,
        scaConfig.rule_sets,
        macros,
      );
      rows.push(...patched.rows);
    });

    return rows;
  }, [
    mode,
    wordsList,
    grammarConfig.inflection_rules,
    grammarConfig.derivation_rules,
    scaConfig.rule_sets,
    macros,
  ]);

  const changedCount = batchRows.length;
  const totalPages = Math.max(1, Math.ceil(changedCount / PAGE_SIZE));
  const pagedResults = useMemo(() => {
    const start = (batchPage - 1) * PAGE_SIZE;
    return batchRows.slice(start, start + PAGE_SIZE);
  }, [batchRows, batchPage]);

  useEffect(() => {
    setApplied(false);
  }, [
    mode,
    wordsList,
    grammarConfig.inflection_rules,
    grammarConfig.derivation_rules,
    scaConfig.rule_sets,
    macros,
  ]);

  useEffect(() => {
    setBatchPage(1);
  }, [changedCount, mode]);

  useEffect(() => {
    if (batchPage > totalPages) {
      setBatchPage(totalPages);
    }
  }, [batchPage, totalPages]);

  const handleBatchApply = () => {
    const wordResults = new Map(
      wordsList.map((w) => [
        w.entry_id,
        applySoundChanges(w.con_word_romanized, scaConfig.rule_sets, macros),
      ]),
    );
    for (const w of wordsList) {
      const result = wordResults.get(w.entry_id);
      if (!result || result.changelog.length === 0) continue;
      upsertWord({ ...w, con_word_romanized: result.result });
    }

    const nextInflections = grammarConfig.inflection_rules.map(
      (rule, index) => {
        if (!rule.sca_mutable) return rule;
        const patched = patchInflectionRuleWithSCA(
          rule,
          index,
          scaConfig.rule_sets,
          macros,
        );
        return patched.changed ? patched.nextRule : rule;
      },
    );
    setInflections(nextInflections);

    const nextDerivations = grammarConfig.derivation_rules.map(
      (rule, index) => {
        if (!rule.sca_mutable) return rule;
        const patched = patchDerivationRuleWithSCA(
          rule,
          index,
          scaConfig.rule_sets,
          macros,
        );
        return patched.changed ? patched.nextRule : rule;
      },
    );
    setDerivations(nextDerivations);

    setApplied(true);
  };

  const scopeLabel = (scope: PreviewRow["scope"]) => {
    if (scope === "lexicon") return t("sca.scopeLexicon");
    if (scope === "inflection") return t("sca.scopeInflection");
    return t("sca.scopeDerivation");
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
                  <th>{t("sca.scope")}</th>
                  <th>{t("sca.label")}</th>
                  <th>{t("sca.field")}</th>
                  <th>{t("sca.original")}</th>
                  <th>{t("sca.result")}</th>
                </tr>
              </thead>
              <tbody>
                {pagedResults.map((r, i) => (
                  <tr key={`${r.key}_${i}`} className="bg-success/5">
                    <td className="text-xs">{scopeLabel(r.scope)}</td>
                    <td className="font-mono text-sm">{r.label}</td>
                    <td className="font-mono text-sm">{r.field}</td>
                    <td className="font-mono text-sm">{r.original}</td>
                    <td className="font-mono text-sm font-bold">{r.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {changedCount === 0 && (
              <p className="text-xs text-base-content/50 mt-2">
                {t("sca.noChanges")}
              </p>
            )}
            {changedCount > 0 && (
              <p className="text-xs text-base-content/50 mt-2">
                {t("sca.pageInfo", {
                  current: batchPage,
                  total: totalPages,
                  totalItems: changedCount,
                })}
              </p>
            )}

            {totalPages > 1 && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  className="btn btn-xs"
                  onClick={() => setBatchPage((p) => Math.max(1, p - 1))}
                  disabled={batchPage <= 1}
                >
                  {t("sca.prevPage")}
                </button>
                <button
                  className="btn btn-xs"
                  onClick={() =>
                    setBatchPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={batchPage >= totalPages}
                >
                  {t("sca.nextPage")}
                </button>
              </div>
            )}
          </div>
          {changedCount > 0 && (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-base-content/60">
                {t("sca.changedCountAll", { count: changedCount })}
              </span>
              {applied ? (
                <span className="text-success text-sm flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" /> {t("sca.applied")}
                </span>
              ) : (
                <button className={BTN_SUCCESS} onClick={handleBatchApply}>
                  <CheckCircle className="w-4 h-4" /> {t("sca.batchApplyAll")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
