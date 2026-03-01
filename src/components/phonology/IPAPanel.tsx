import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePhonoStore } from "../../store/phonoStore";
import { playIpaAudio } from "../../utils/ipaAudio";
import { PHONOLOGY_PRESETS } from "../../data/phonology_presets";
import {
  NATURAL_PAIRS,
  getImbalanceWarnings,
  ImbalanceWarning,
} from "../../data/ipa_features";
import { AlertTriangle, X } from "lucide-react";
import {
  SELECT,
  BTN_GHOST,
  BTN_OUTLINE_ERROR,
  SECTION_HEADER,
} from "../../lib/ui";
import { ConsonantCharts } from "./ConsonantCharts";
import { VowelChart } from "./VowelChart";

export const IPAPanel: React.FC = () => {
  const { t } = useTranslation();
  const { config, togglePhoneme, setPhonemeInventory } = usePhonoStore();
  const selectedConsonants = new Set(config.phoneme_inventory.consonants);
  const selectedVowels = new Set(config.phoneme_inventory.vowels);

  const [activeTab, setActiveTab] = useState<"consonants" | "vowels">(
    "consonants",
  );
  const [hoveredPhoneme, setHoveredPhoneme] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");

  // Imbalance warnings
  const warnings = useMemo<ImbalanceWarning[]>(
    () =>
      getImbalanceWarnings(
        config.phoneme_inventory.consonants,
        config.phoneme_inventory.vowels,
      ),
    [config.phoneme_inventory.consonants, config.phoneme_inventory.vowels],
  );

  // Natural pair highlight
  const pairOf = (p: string): string | undefined => {
    if (NATURAL_PAIRS[p]) return NATURAL_PAIRS[p];
    return Object.entries(NATURAL_PAIRS).find(([, v]) => v === p)?.[0];
  };
  const highlightPair = hoveredPhoneme ? pairOf(hoveredPhoneme) : undefined;

  // Apply preset
  const handlePreset = (presetId: string) => {
    const preset = PHONOLOGY_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedPresetId(presetId);
    setPhonemeInventory({
      consonants: [...preset.consonants],
      vowels: [...preset.vowels],
    });
  };

  // Clear all selected phonemes
  const handleClearAll = () => {
    setSelectedPresetId("");
    setPhonemeInventory({ consonants: [], vowels: [] });
  };

  const isConsonantSelected = (p: string) => selectedConsonants.has(p);
  const isVowelSelected = (p: string) => selectedVowels.has(p);

  const handleConsonantClick = (phoneme: string) => {
    if (!phoneme) return;
    togglePhoneme(phoneme, "consonants");
  };

  const handleVowelClick = (phoneme: string) => {
    if (!phoneme) return;
    togglePhoneme(phoneme, "vowels");
  };

  const handlePlayAudio = (e: React.MouseEvent, phoneme: string) => {
    e.stopPropagation();
    playIpaAudio(phoneme);
  };

  return (
    <div className="bg-base-100 p-6 min-w-[900px] flex-1">
      {/* Presets bar */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-sm font-medium text-base-content/70">
          {t("phonology.presets.label")}:
        </span>
        <select
          value={selectedPresetId}
          onChange={(e) => handlePreset(e.target.value)}
          className={`${SELECT}`}
        >
          <option value="" disabled>
            {t("phonology.presets.select")}
          </option>
          {PHONOLOGY_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(p.nameKey)} ({p.consonants.length}C + {p.vowels.length}V)
            </option>
          ))}
        </select>
        {selectedPresetId && (
          <button
            onClick={() => setSelectedPresetId("")}
            className={BTN_GHOST}
            title={t("common.close")}
          >
            <X size={12} /> {t("phonology.presets.deselect")}
          </button>
        )}
        <button
          onClick={handleClearAll}
          className={`ml-auto ${BTN_OUTLINE_ERROR}`}
        >
          {t("phonology.presets.clearAll")}
        </button>
      </div>

      {/* Imbalance warnings */}
      {warnings.length > 0 && (
        <div role="alert" className="alert alert-warning alert-soft mb-4">
          <AlertTriangle size={16} />
          <div>
            <span className="text-sm font-medium">
              {t("phonology.imbalance.title")}
            </span>
            <ul className="text-xs list-disc list-inside space-y-0.5">
              {warnings.map((w, i) => (
                <li key={i}>
                  {t(w.key, w.values as Record<string, string | number>)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Selected inventory summary */}
      <div className="mb-6 p-4 bg-base-200/50 rounded-lg border border-base-300">
        <h3 className={SECTION_HEADER}>{t("phonology.inventory.selected")}</h3>
        <div className="flex flex-wrap gap-4">
          <div>
            <span className="text-xs text-base-content/60 mr-2">
              {t("phonology.inventory.consonants")} ({selectedConsonants.size}):
            </span>
            <span className="ipa-char text-sm text-primary">
              {config.phoneme_inventory.consonants.length > 0 ? (
                config.phoneme_inventory.consonants.join(" ")
              ) : (
                <span className="text-base-content/50 italic">
                  {t("phonology.inventory.clickToSelect")}
                </span>
              )}
            </span>
          </div>
          <div>
            <span className="text-xs text-base-content/60 mr-2">
              {t("phonology.inventory.vowels")} ({selectedVowels.size}):
            </span>
            <span className="ipa-char text-sm text-primary">
              {config.phoneme_inventory.vowels.length > 0 ? (
                config.phoneme_inventory.vowels.join(" ")
              ) : (
                <span className="text-base-content/50 italic">
                  {t("phonology.inventory.clickToSelect")}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs Layout */}
      <div role="tablist" className="tabs tabs-border mb-6">
        <button
          role="tab"
          className={`tab ${activeTab === "consonants" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("consonants")}
        >
          {t("phonology.inventory.tabs.consonants")}
        </button>
        <button
          role="tab"
          className={`tab ${activeTab === "vowels" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("vowels")}
        >
          {t("phonology.inventory.tabs.vowels")}
        </button>
      </div>

      {activeTab === "consonants" && (
        <ConsonantCharts
          isConsonantSelected={isConsonantSelected}
          handleConsonantClick={handleConsonantClick}
          handlePlayAudio={handlePlayAudio}
          setHoveredPhoneme={setHoveredPhoneme}
          highlightPair={highlightPair}
        />
      )}

      {activeTab === "vowels" && (
        <VowelChart
          selectedVowels={selectedVowels}
          isVowelSelected={isVowelSelected}
          handleVowelClick={handleVowelClick}
          handlePlayAudio={handlePlayAudio}
        />
      )}
    </div>
  );
};
