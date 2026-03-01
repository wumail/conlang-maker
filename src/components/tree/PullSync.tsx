import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Download, AlertTriangle } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useSCAStore } from "../../store/scaStore";
import {
  applySoundChanges,
  buildMacrosFromInventory,
} from "../../utils/scaEngine";
import { BTN_PRIMARY } from "../../lib/ui";
import { WordEntry } from "../../types";
import { invoke } from "@tauri-apps/api/core";

export function PullSync() {
  const { t } = useTranslation();
  const {
    config: wsConfig,
    activeLanguageId,
    projectPath,
  } = useWorkspaceStore();
  const { wordsList, importWords } = useLexiconStore();
  const { config: phonoConfig } = usePhonoStore();
  const { config: scaConfig } = useSCAStore();
  const [parentWords, setParentWords] = useState<WordEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const activeLang = wsConfig.languages.find(
    (l) => l.language_id === activeLanguageId,
  );
  const parentLang = activeLang?.parent_id
    ? wsConfig.languages.find((l) => l.language_id === activeLang.parent_id)
    : null;

  const macros = useMemo(
    () =>
      buildMacrosFromInventory(
        phonoConfig.phoneme_inventory.consonants,
        phonoConfig.phoneme_inventory.vowels,
        phonoConfig.phonotactics.macros,
      ),
    [phonoConfig],
  );

  const handleCheckForUpdates = async () => {
    if (!parentLang) return;
    setLoading(true);
    try {
      const pWords = await invoke<WordEntry[]>("load_all_words", {
        projectPath,
        languagePath: parentLang.path,
      });
      // Find parent words not already in current language
      const currentParentIds = new Set(
        wordsList.map((w) => w.etymology.parent_entry_id).filter(Boolean),
      );
      const newWords = pWords.filter((w) => !currentParentIds.has(w.entry_id));
      setParentWords(newWords);
    } catch (err) {
      console.warn(`Pull sync check failed: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePullAll = async () => {
    try {
      if (activeLang) {
        await invoke("create_snapshot", {
          projectPath,
          languagePath: activeLang.path,
          operationType: "pull_sync",
          sourceLanguageId: parentLang?.language_id || "",
          targetLanguageId: activeLanguageId,
          description: `Pulled ${parentWords.length} words via sound changes`,
        });
      }
    } catch (err) {
      console.warn("Failed to create snapshot before pull sync:", err);
    }

    const evolved = parentWords.map((pw) => {
      const { result } = applySoundChanges(
        pw.con_word_romanized,
        scaConfig.rule_sets,
        macros,
      );
      return {
        ...pw,
        entry_id: `${pw.entry_id}_evolved_${Date.now().toString(36)}`,
        language_id: activeLanguageId,
        con_word_romanized: result,
        phonetic_ipa: "",
        phonetic_override: false,
        etymology: {
          ...pw.etymology,
          origin_type: "evolved" as const,
          parent_entry_id: pw.entry_id,
          source_language_id: parentLang?.language_id || null,
          applied_sound_changes: scaConfig.rule_sets.map((rs) => rs.ruleset_id),
        },
      };
    });
    importWords(evolved);
    setParentWords([]);
  };

  if (!parentLang) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-base-content/50">
          {t("tree.noParentLanguage")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{t("tree.pullSync")}</h3>
      <p className="text-xs text-base-content/50">{t("tree.pullSyncDesc")}</p>
      <p className="text-sm text-base-content/60">
        {t("tree.pullFrom")}: {parentLang.name}
      </p>
      <button
        className={BTN_PRIMARY}
        onClick={handleCheckForUpdates}
        disabled={loading}
      >
        <Download className="w-4 h-4" />
        {loading ? t("common.loading") : t("tree.checkUpdates")}
      </button>
      {scaConfig.rule_sets.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-warning">
          <AlertTriangle size={14} />
          {t("typology.noScaRulesWarning")}
        </div>
      )}
      {parentWords.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm">
            {t("tree.newWordsAvailable", { count: parentWords.length })}
          </p>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {parentWords.slice(0, 20).map((w) => (
              <span key={w.entry_id} className="badge badge-sm mr-1">
                {w.con_word_romanized}
              </span>
            ))}
            {parentWords.length > 20 && (
              <span className="text-xs text-base-content/50">
                +{parentWords.length - 20} {t("common.more")}
              </span>
            )}
          </div>
          <button className={BTN_PRIMARY} onClick={handlePullAll}>
            {t("tree.pullAndEvolve")}
          </button>
        </div>
      )}
      {parentWords.length === 0 && !loading && (
        <p className="text-xs text-base-content/50">{t("tree.upToDate")}</p>
      )}
    </div>
  );
}
