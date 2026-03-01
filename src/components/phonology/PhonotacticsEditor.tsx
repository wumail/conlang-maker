import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePhonoStore } from "../../store/phonoStore";
import { Plus, Trash2 } from "lucide-react";
import { INPUT_MONO, BTN_LINK, BTN_ERROR } from "../../lib/ui";
import { VowelHarmonySection, ToneSystemSection } from "./PhonotacticsSections";
import { ConfirmModal } from "../common/ConfirmModal";
import { EmptyState } from "../common/EmptyState";
import { PhonemeStrip } from "../common/PhonemeStrip";

export const PhonotacticsEditor: React.FC = () => {
  const { t } = useTranslation();
  const {
    config,
    updateSyllableStructure,
    updateMacros,
    updateBlacklistPatterns,
  } = usePhonoStore();
  const { phonotactics } = config;
  const [confirmDeleteMacroKey, setConfirmDeleteMacroKey] = React.useState<
    string | null
  >(null);
  const [confirmDeleteBlacklistIdx, setConfirmDeleteBlacklistIdx] =
    React.useState<number | null>(null);
  const [activeMacroKey, setActiveMacroKey] = React.useState<string | null>(
    null,
  );
  const macroValueRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const consonants = config.phoneme_inventory.consonants;
  const vowels = config.phoneme_inventory.vowels;

  const handleQuickInsert = (phoneme: string) => {
    if (activeMacroKey === null) return;
    const currentValues = phonotactics.macros[activeMacroKey] ?? [];
    // Check if phoneme already exists
    if (!currentValues.includes(phoneme)) {
      const newMacros = { ...phonotactics.macros };
      newMacros[activeMacroKey] = [...currentValues, phoneme];
      updateMacros(newMacros);
    }
    setTimeout(() => macroValueRefs.current[activeMacroKey]?.focus(), 0);
  };

  const handleMacroKeyChange = (oldKey: string, newKey: string) => {
    const newMacros = { ...phonotactics.macros };
    const values = newMacros[oldKey] ?? [];
    delete newMacros[oldKey];
    if (newKey.trim()) {
      newMacros[newKey] = values;
    }
    updateMacros(newMacros);
  };

  const handleMacroValueChange = (key: string, valuesStr: string) => {
    const newMacros = { ...phonotactics.macros };
    newMacros[key] = valuesStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    updateMacros(newMacros);
  };

  const handleAddMacro = () => {
    const newMacros = { ...phonotactics.macros };
    // Find next available letter
    let letter = "X";
    for (let i = 0; i < 26; i++) {
      const candidate = String.fromCharCode(65 + i);
      if (!(candidate in newMacros)) {
        letter = candidate;
        break;
      }
    }
    newMacros[letter] = [];
    updateMacros(newMacros);
  };

  const handleDeleteMacro = (key: string) => {
    const newMacros = { ...phonotactics.macros };
    delete newMacros[key];
    updateMacros(newMacros);
  };

  const handleAddBlacklist = () => {
    updateBlacklistPatterns([...phonotactics.blacklist_patterns, ""]);
  };

  const handleBlacklistChange = (idx: number, value: string) => {
    const newPatterns = [...phonotactics.blacklist_patterns];
    newPatterns[idx] = value;
    updateBlacklistPatterns(newPatterns);
  };

  const handleDeleteBlacklist = (idx: number) => {
    updateBlacklistPatterns(
      phonotactics.blacklist_patterns.filter((_, i) => i !== idx),
    );
  };

  const macroEntries = Object.entries(phonotactics.macros);

  return (
    <div className="bg-base-100 p-6 min-w-[900px] flex-1 space-y-8">
      {/* Syllable structure */}
      <div>
        <label className="block text-sm font-medium text-base-content/80 mb-2">
          {t("phonology.phonotactics.syllableStructure")}
        </label>
        <input
          type="text"
          value={phonotactics.syllable_structure}
          onChange={(e) => updateSyllableStructure(e.target.value)}
          className={`w-full max-w-md ${INPUT_MONO}`}
          placeholder={"(C)V(C)"}
        />
        <p className="text-xs text-base-content/50 mt-1">
          {t("phonology.phonotactics.syllableHint")}
        </p>
      </div>

      {/* Macros */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <label className="text-sm font-medium text-base-content/80">
            {t("phonology.phonotactics.macros")}
          </label>
          <button onClick={handleAddMacro} className={BTN_LINK}>
            <Plus size={14} /> {t("phonology.phonotactics.addMacro")}
          </button>
        </div>
        <div className="space-y-2">
          {/* Quick-add from inventory */}
          <PhonemeStrip
            consonants={consonants}
            vowels={vowels}
            isActive={activeMacroKey !== null}
            onInsert={handleQuickInsert}
            activeTooltip={t(
              "phonology.phonotactics.clickToInsert",
              "Click to insert",
            )}
            inactiveTooltip={t(
              "phonology.phonotactics.focusFirst",
              "Focus a macro value field first",
            )}
          />
          {macroEntries.length === 0 && (
            <EmptyState message={t("phonology.phonotactics.noMacros")} />
          )}
          {macroEntries.map(([key, values]) => (
            <div key={key} className="flex items-center gap-2">
              <input
                type="text"
                value={key}
                onChange={(e) => handleMacroKeyChange(key, e.target.value)}
                className={`w-16 ${INPUT_MONO} text-center font-bold`}
                maxLength={3}
              />
              <span className="text-base-content/50">=</span>
              <input
                type="text"
                value={values.join(", ")}
                ref={(el) => {
                  macroValueRefs.current[key] = el;
                }}
                onChange={(e) => handleMacroValueChange(key, e.target.value)}
                onFocus={() => setActiveMacroKey(key)}
                className={`flex-1 ${INPUT_MONO} ${activeMacroKey === key ? "ring-2 ring-primary/50" : ""}`}
                placeholder={"a, e, i, o, u"}
              />
              <button
                onClick={() => setConfirmDeleteMacroKey(key)}
                className={BTN_ERROR}
                title={t("phonology.phonotactics.deleteMacro")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Blacklist patterns */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <label className="text-sm font-medium text-base-content/80">
            {t("phonology.phonotactics.blacklist")}
          </label>
          <button onClick={handleAddBlacklist} className={BTN_LINK}>
            <Plus size={14} /> {t("phonology.phonotactics.addPattern")}
          </button>
        </div>

        {phonotactics.blacklist_patterns.length === 0 && (
          <EmptyState message={t("phonology.phonotactics.noBlacklist")} />
        )}

        <div className="space-y-2">
          {phonotactics.blacklist_patterns.map((pattern, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={pattern}
                onChange={(e) => handleBlacklistChange(idx, e.target.value)}
                className={`flex-1 ${INPUT_MONO}`}
                placeholder={t("phonology.phonotactics.placeholders.blacklist")}
              />
              <button
                onClick={() => setConfirmDeleteBlacklistIdx(idx)}
                className={BTN_ERROR}
                title={t("phonology.phonotactics.deletePattern")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <VowelHarmonySection />
      <ToneSystemSection />

      <ConfirmModal
        open={confirmDeleteMacroKey !== null}
        title={t("common.delete")}
        message={t(
          "phonology.phonotactics.deleteMacroConfirm",
          "Are you sure you want to delete this macro?",
        )}
        onConfirm={() => {
          if (confirmDeleteMacroKey !== null) {
            handleDeleteMacro(confirmDeleteMacroKey);
            setConfirmDeleteMacroKey(null);
          }
        }}
        onCancel={() => setConfirmDeleteMacroKey(null)}
      />

      <ConfirmModal
        open={confirmDeleteBlacklistIdx !== null}
        title={t("common.delete")}
        message={t(
          "phonology.phonotactics.deletePatternConfirm",
          "Are you sure you want to delete this pattern?",
        )}
        onConfirm={() => {
          if (confirmDeleteBlacklistIdx !== null) {
            handleDeleteBlacklist(confirmDeleteBlacklistIdx);
            setConfirmDeleteBlacklistIdx(null);
          }
        }}
        onCancel={() => setConfirmDeleteBlacklistIdx(null)}
      />
    </div>
  );
};
