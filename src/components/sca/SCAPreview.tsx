import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSCAStore } from "../../store/scaStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import { applySoundChanges, buildMacrosFromInventory } from "../../utils/scaEngine";
import {
  patchDerivationRuleWithSca,
  patchInflectionRuleWithSca,
  type ScaPreviewRow,
} from "../../utils/scaPreviewPatch";
import { CARD } from "../../lib/ui";
import { SCASingleTester } from "./SCASingleTester";
import { SCABatchVirtualPreview } from "./SCABatchVirtualPreview";

export function SCAPreview() {
  const { t } = useTranslation();
  const { config: scaConfig } = useSCAStore();
  const { config: phonoConfig } = usePhonoStore();
  const { wordsList, upsertWord } = useLexiconStore();
  const { config: grammarConfig, setInflections, setDerivations } = useGrammarStore();
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

  // 超音段伪特征（+stressed / +open_syllable 等）需要音节与重音上下文
  const prosodyContext = useMemo(
    () => ({
      phonotactics: phonoConfig.phonotactics,
      inventory: phonoConfig.phoneme_inventory,
      stress: phonoConfig.phonotactics.stress ?? null,
    }),
    [phonoConfig],
  );

  const singleResult = useMemo(() => {
    if (!testWord.trim()) return null;
    return applySoundChanges(
      testWord.trim(),
      scaConfig.rule_sets,
      macros,
      [],
      prosodyContext,
    );
  }, [testWord, scaConfig.rule_sets, macros, prosodyContext]);

  const batchRows = useMemo<ScaPreviewRow[]>(() => {
    if (mode !== "batch") return [];
    const rows: ScaPreviewRow[] = [];

    for (const word of wordsList) {
      const { result, changelog } = applySoundChanges(
        word.con_word_romanized,
        scaConfig.rule_sets,
        macros,
        [],
        prosodyContext,
      );
      if (changelog.length === 0) continue;
      rows.push({
        key: `lex_${word.entry_id}`,
        scope: "lexicon",
        label: word.con_word_romanized,
        field: "word",
        original: word.con_word_romanized,
        result,
      });
    }

    grammarConfig.inflection_rules.forEach((rule, index) => {
      if (!rule.sca_mutable) return;
      rows.push(
        ...patchInflectionRuleWithSca(
          rule,
          index,
          scaConfig.rule_sets,
          macros,
          prosodyContext,
        ).rows,
      );
    });

    grammarConfig.derivation_rules.forEach((rule, index) => {
      if (!rule.sca_mutable) return;
      rows.push(
        ...patchDerivationRuleWithSca(
          rule,
          index,
          scaConfig.rule_sets,
          macros,
          prosodyContext,
        ).rows,
      );
    });

    return rows;
  }, [
    mode,
    wordsList,
    grammarConfig.inflection_rules,
    grammarConfig.derivation_rules,
    scaConfig.rule_sets,
    macros,
    prosodyContext,
  ]);

  // 任一输入源变化即重置「已应用」提示
  useEffect(() => {
    setApplied(false);
  }, [
    mode,
    wordsList,
    grammarConfig.inflection_rules,
    grammarConfig.derivation_rules,
    scaConfig.rule_sets,
    macros,
    prosodyContext,
  ]);

  const handleBatchApply = () => {
    const wordResults = new Map(
      wordsList.map((word) => [
        word.entry_id,
        applySoundChanges(
          word.con_word_romanized,
          scaConfig.rule_sets,
          macros,
          [],
          prosodyContext,
        ),
      ]),
    );
    for (const word of wordsList) {
      const result = wordResults.get(word.entry_id);
      if (!result || result.changelog.length === 0) continue;
      upsertWord({ ...word, con_word_romanized: result.result });
    }

    setInflections(
      grammarConfig.inflection_rules.map((rule, index) => {
        if (!rule.sca_mutable) return rule;
        const patched = patchInflectionRuleWithSca(
          rule,
          index,
          scaConfig.rule_sets,
          macros,
          prosodyContext,
        );
        return patched.changed ? patched.nextRule : rule;
      }),
    );

    setDerivations(
      grammarConfig.derivation_rules.map((rule, index) => {
        if (!rule.sca_mutable) return rule;
        const patched = patchDerivationRuleWithSca(
          rule,
          index,
          scaConfig.rule_sets,
          macros,
          prosodyContext,
        );
        return patched.changed ? patched.nextRule : rule;
      }),
    );

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
        <SCASingleTester
          testWord={testWord}
          onTestWordChange={setTestWord}
          result={singleResult}
        />
      )}

      {mode === "batch" && (
        <SCABatchVirtualPreview rows={batchRows} applied={applied} onApply={handleBatchApply} />
      )}
    </div>
  );
}
