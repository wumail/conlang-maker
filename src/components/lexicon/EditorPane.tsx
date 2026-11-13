import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useSCAStore } from "../../store/scaStore";
import { useCorpusStore } from "../../store/corpusStore";
import type { ConceptDefinition, Sense, WordEntry } from "../../types";
import { generateIPA } from "../../utils/ipaGenerator";
import { getWordEvolution } from "../../utils/wordLifecycle";
import { ConfirmModal } from "../common/ConfirmModal";
import { WordHeaderSection } from "./WordHeaderSection";
import { WordSensesSection } from "./WordSensesSection";
import { WordEtymologySection } from "./WordEtymologySection";
import { WordParadigmCollapsible } from "./WordParadigmCollapsible";
import { WordConcordanceSection } from "./WordConcordanceSection";
import { EvolutionChainCards } from "./EvolutionChainCards";
import { useWordLineage } from "./useWordLineage";

export const EditorPane: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeWordId, wordsMap, wordsList, upsertWord, deleteWord } = useLexiconStore();
  const phonoConfig = usePhonoStore((s) => s.config);
  const grammarConfig = useGrammarStore((s) => s.config);
  const partsOfSpeech = grammarConfig.parts_of_speech;
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const workspaceLanguages = useWorkspaceStore((s) => s.config.languages);
  const customConcepts = useWorkspaceStore((s) => s.config.custom_concepts);
  const addCustomConcepts = useWorkspaceStore((s) => s.addCustomConcepts);
  const scaConfig = useSCAStore((s) => s.config);
  const loadCorpus = useCorpusStore((s) => s.loadCorpus);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteSenseIdx, setConfirmDeleteSenseIdx] = useState<number | null>(null);

  const prevRomanizedRef = useRef<string>("");
  const word = activeWordId ? wordsMap[activeWordId] : null;
  const evolution = word ? getWordEvolution(word) : null;

  const { lifecycleFlags, evolutionChain } = useWordLineage({
    word,
    activeLanguageId,
    projectPath,
    workspaceLanguages,
    phonoConfig,
  });

  const scaRuleLookup = useMemo(() => {
    const map = new Map<string, string>();
    scaConfig.rule_sets.forEach((ruleSet) => {
      ruleSet.rules.forEach((rule) => {
        map.set(rule.rule_id, rule.description || ruleSet.name);
      });
    });
    return map;
  }, [scaConfig]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    wordsList.forEach((entry) => {
      entry.metadata?.tags?.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [wordsList]);

  // 词形变化且未手动锁定 IPA 时自动重算音位转写
  useEffect(() => {
    if (!word || word.phonetic_override) return;
    if (word.con_word_romanized === prevRomanizedRef.current) return;
    prevRomanizedRef.current = word.con_word_romanized;

    const { phonemic } = generateIPA(word.con_word_romanized, phonoConfig);
    const cleanIpa = phonemic.replace(/^\/|\/$/g, "");
    if (cleanIpa && cleanIpa !== word.phonetic_ipa) {
      upsertWord({ ...word, phonetic_ipa: cleanIpa });
    }
  }, [word?.con_word_romanized, word?.phonetic_override, phonoConfig]);

  if (!word) {
    return (
      <div className="flex-1 flex items-center justify-center text-base-content/50 mt-16 italic">
        {t("lexicon.selectWord")}
      </div>
    );
  }

  const handleChange = (
    field: keyof WordEntry,
    value: WordEntry[keyof WordEntry],
  ) => {
    upsertWord({ ...word, [field]: value });
  };

  const handleSenseChange = (
    index: number,
    field: keyof Sense,
    value: Sense[keyof Sense],
  ) => {
    const nextSenses = [...word.senses];
    nextSenses[index] = { ...nextSenses[index], [field]: value };
    handleChange("senses", nextSenses);
  };

  const addSense = () => {
    handleChange("senses", [
      ...word.senses,
      {
        sense_id: crypto.randomUUID(),
        pos_id: partsOfSpeech[0]?.pos_id || "",
        gloss: "",
        definitions: [],
        examples: [],
      },
    ]);
  };

  const removeSense = (index: number) => {
    handleChange(
      "senses",
      word.senses.filter((_, i) => i !== index),
    );
  };

  const showEvolutionChain =
    (word.etymology?.origin_type === "evolved" ||
      word.etymology?.origin_type === "borrowed") &&
    Boolean(word.etymology?.parent_entry_id) &&
    evolutionChain.length > 1;

  const { surface } = generateIPA(word.con_word_romanized, phonoConfig);

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-base-100">
      <WordHeaderSection
        word={word}
        surface={surface}
        lifecycleFlags={lifecycleFlags}
        allTags={allTags}
        onChange={handleChange}
        onTagsChange={(tags) => handleChange("metadata", { ...word.metadata, tags })}
        onRequestDelete={() => setConfirmDelete(true)}
      />

      <WordSensesSection
        customConcepts={customConcepts}
        onCreateConcept={(concept: ConceptDefinition) => addCustomConcepts([concept])}
        senses={word.senses}
        partsOfSpeech={partsOfSpeech}
        onChangeSense={handleSenseChange}
        onAddSense={addSense}
        onRequestDeleteSense={setConfirmDeleteSenseIdx}
      />

      <div className="mt-6 space-y-2">
        <WordParadigmCollapsible
          word={word}
          grammar={grammarConfig}
          phono={phonoConfig}
          onCustomize={() => navigate("/grammar")}
        />
        <WordConcordanceSection
          word={word}
          grammar={grammarConfig}
          phono={phonoConfig}
          onNavigate={(corpusId) => {
            void loadCorpus(corpusId);
            navigate("/corpus");
          }}
        />
      </div>

      <WordEtymologySection
        word={word}
        evolution={evolution}
        workspaceLanguages={workspaceLanguages}
        activeLanguageId={activeLanguageId}
        onChange={handleChange}
      />

      {showEvolutionChain && (
        <div className="mt-3 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2">
          <EvolutionChainCards
            chain={evolutionChain}
            appliedSoundChanges={word.etymology?.applied_sound_changes}
            scaRuleLookup={scaRuleLookup}
          />
        </div>
      )}

      <ConfirmModal
        open={confirmDelete}
        title={t("lexicon.deleteWord")}
        message={t("lexicon.deleteWordConfirm", { word: word.con_word_romanized })}
        onConfirm={() => {
          deleteWord(word.entry_id);
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmModal
        open={confirmDeleteSenseIdx !== null}
        title={t("common.delete")}
        message={t("lexicon.deleteMeaningConfirm")}
        onConfirm={() => {
          if (confirmDeleteSenseIdx !== null) {
            removeSense(confirmDeleteSenseIdx);
            setConfirmDeleteSenseIdx(null);
          }
        }}
        onCancel={() => setConfirmDeleteSenseIdx(null)}
      />
    </div>
  );
};
