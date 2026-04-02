import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, AlertTriangle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useSCAStore } from "../../store/scaStore";
import { applySoundChanges, buildMacrosFromInventory } from "../../utils/scaEngine";
import { BTN_PRIMARY } from "../../lib/ui";
import { WordEntry } from "../../types";
import { getWordComparableDigest, getWordEvolution, getWordSyncDigest } from "../../utils/wordLifecycle";

interface PendingSyncWord {
  word: WordEntry;
  mode: "add" | "update";
}

function isValidWordEntry(word: WordEntry): boolean {
  const romanized = (word.con_word_romanized || "").trim();
  if (!romanized || romanized === "new_word") return false;
  return word.senses.some((sense) => (sense.gloss || "").trim().length > 0);
}

export function PullSync() {
  const { t } = useTranslation();
  const {
    config: wsConfig,
    activeLanguageId,
    projectPath,
    conlangFilePath,
  } = useWorkspaceStore();
  const { wordsList, importWords } = useLexiconStore();
  const { config: phonoConfig } = usePhonoStore();
  const { config: scaConfig } = useSCAStore();

  const [pendingSyncWords, setPendingSyncWords] = useState<PendingSyncWord[]>([]);
  const [conflictCount, setConflictCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [previewingMigration, setPreviewingMigration] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState("");

  const addCount = useMemo(
    () => pendingSyncWords.filter((item) => item.mode === "add").length,
    [pendingSyncWords],
  );
  const updateCount = useMemo(
    () => pendingSyncWords.filter((item) => item.mode === "update").length,
    [pendingSyncWords],
  );

  const activeLang = wsConfig.languages.find(
    (language) => language.language_id === activeLanguageId,
  );
  const parentLang = activeLang?.parent_id
    ? wsConfig.languages.find((language) => language.language_id === activeLang.parent_id)
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
      const parentWords = await invoke<WordEntry[]>("load_all_words", {
        projectPath,
        languagePath: parentLang.path,
      });
      const validParentWords = parentWords.filter(isValidWordEntry);

      const childByParentId = new Map<string, WordEntry>();
      wordsList.forEach((word) => {
        const parentEntryId = word.etymology.parent_entry_id ?? word.entry_id;
        childByParentId.set(parentEntryId, word);
      });

      const nextPending: PendingSyncWord[] = [];
      let conflicts = 0;

      validParentWords.forEach((parentWord) => {
        const { result, changelog } = applySoundChanges(
          parentWord.con_word_romanized,
          scaConfig.rule_sets,
          macros,
        );
        const appliedRuleIds = Array.from(new Set(changelog.map((step) => step.rule_id)));
        const parentEvolution = getWordEvolution(parentWord);

        const parentComparableHash = getWordComparableDigest(parentWord);
        const parentSyncHash = getWordSyncDigest(parentWord);

        const syncedCandidate: WordEntry = {
          ...parentWord,
          entry_id: parentWord.entry_id,
          language_id: activeLanguageId,
          con_word_romanized: result.trim(),
          phonetic_ipa: "",
          phonetic_override: false,
          etymology: {
            ...parentWord.etymology,
            origin_type: "evolved",
            parent_entry_id: parentWord.entry_id,
            source_language_id: parentLang.language_id,
            applied_sound_changes: appliedRuleIds,
          },
          evolution: {
            ...parentEvolution,
            parent_snapshot_hash: parentSyncHash,
            last_synced_word_hash: null,
          },
        };

        const syncedWordSyncHash = getWordSyncDigest(syncedCandidate);
        const normalizedEvolution = getWordEvolution(syncedCandidate);
        syncedCandidate.evolution = {
          ...normalizedEvolution,
          last_synced_word_hash: syncedWordSyncHash,
        };

        const existingChild = childByParentId.get(parentWord.entry_id);
        if (!existingChild) {
          nextPending.push({ word: syncedCandidate, mode: "add" });
          return;
        }

        const existingEvolution = getWordEvolution(existingChild);
        const currentChildHash = getWordComparableDigest(existingChild);
        const currentChildSyncHash = getWordSyncDigest(existingChild);

        // Never synced (freshly forked) — compare content directly
        if (!existingEvolution.parent_snapshot_hash) {
          if (syncedWordSyncHash !== currentChildSyncHash) {
            nextPending.push({
              word: { ...syncedCandidate, entry_id: existingChild.entry_id },
              mode: "update",
            });
          }
          return;
        }

        // Has been synced before — use hash-based comparison
        const parentSnapshotHash = existingEvolution.parent_snapshot_hash;
        const parentChanged =
          parentSnapshotHash !== parentSyncHash &&
          parentSnapshotHash !== parentComparableHash;

        const lastSyncedHash = existingEvolution.last_synced_word_hash;
        const childChangedSinceLastSync = lastSyncedHash
          ? lastSyncedHash !== currentChildSyncHash &&
            lastSyncedHash !== currentChildHash
          : false;

        if (parentChanged && childChangedSinceLastSync) {
          conflicts += 1;
          return;
        }

        if (!parentChanged && !childChangedSinceLastSync) {
          return;
        }

        nextPending.push({
          word: {
            ...syncedCandidate,
            entry_id: existingChild.entry_id,
          },
          mode: "update",
        });
      });

      setPendingSyncWords(nextPending);
      setConflictCount(conflicts);
    } catch (error) {
      console.warn(`Pull sync check failed: ${error}`);
      setPendingSyncWords([]);
      setConflictCount(0);
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
          description: `Pulled ${pendingSyncWords.length} words via sound changes`,
        });
      }
    } catch (error) {
      console.warn("Failed to create snapshot before pull sync:", error);
    }

    importWords(pendingSyncWords.map((item) => item.word));
    setPendingSyncWords([]);
    setConflictCount(0);
  };

  const runMigration = async (dryRun: boolean) => {
    if (!conlangFilePath) return;
    if (dryRun) {
      setPreviewingMigration(true);
    } else {
      setMigrating(true);
    }
    setMigrationMessage("");
    try {
      const stats = await invoke<{
        dry_run: boolean;
        languages_processed: number;
        words_scanned: number;
        parent_link_filled: number;
        source_language_filled: number;
        origin_fixed: number;
        files_changed: number;
      }>("migrate_inherited_lexicon_links", {
        projectPath,
        conlangFilePath,
        dryRun,
      });

      setMigrationMessage(
        t(stats.dry_run ? "tree.migrationPreviewDone" : "tree.migrationDone", {
          scanned: stats.words_scanned,
          links: stats.parent_link_filled,
          source: stats.source_language_filled,
          origin: stats.origin_fixed,
          files: stats.files_changed,
        }),
      );
    } catch (error) {
      console.warn(`迁移旧词条失败：${error}`);
      setMigrationMessage(t(dryRun ? "tree.migrationPreviewFailed" : "tree.migrationFailed"));
    } finally {
      if (dryRun) {
        setPreviewingMigration(false);
      } else {
        setMigrating(false);
      }
    }
  };

  const handleMigrateLegacyData = async () => runMigration(false);
  const handlePreviewMigration = async () => runMigration(true);

  if (!parentLang) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-base-content/50">{t("tree.noParentLanguage")}</p>
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
      <div className="flex items-center gap-2">
        <button
        className={BTN_PRIMARY}
        onClick={handleCheckForUpdates}
        disabled={loading}
      >
        <Download className="w-4 h-4" />
        {loading ? t("common.loading") : t("tree.checkUpdates")}
      </button>
      <button
        className={BTN_PRIMARY}
        onClick={handlePreviewMigration}
        disabled={previewingMigration || migrating}
      >
        {previewingMigration ? t("common.loading") : t("tree.previewMigration")}
      </button>
      <button
        className={BTN_PRIMARY}
        onClick={handleMigrateLegacyData}
        disabled={migrating || previewingMigration}
      >
        {migrating ? t("common.loading") : t("tree.migrateLegacy")}
      </button>
      </div>
      {migrationMessage && (
        <p className="text-xs text-base-content/60">{migrationMessage}</p>
      )}

      {scaConfig.rule_sets.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-warning">
          <AlertTriangle size={14} />
          {t("typology.noScaRulesWarning")}
        </div>
      )}

      {pendingSyncWords.length > 0 && (
        <div className="space-y-2">
          {addCount > 0 && (
            <p className="text-sm">
              {t("tree.newWordsAvailable", { count: addCount })}
            </p>
          )}
          {updateCount > 0 && (
            <p className="text-sm">
              {t("tree.updatedWordsAvailable", { count: updateCount })}
            </p>
          )}
          {conflictCount > 0 && (
            <p className="text-xs text-warning">
              {t("tree.syncConflicts", { count: conflictCount })}
            </p>
          )}
          <div className="max-h-40 overflow-y-auto space-y-1">
            {pendingSyncWords.slice(0, 20).map((item) => (
              <span key={item.word.entry_id} className="badge badge-sm mr-1">
                {item.word.con_word_romanized}
              </span>
            ))}
            {pendingSyncWords.length > 20 && (
              <span className="text-xs text-base-content/50">
                +{pendingSyncWords.length - 20} {t("common.more")}
              </span>
            )}
          </div>
          <button className={BTN_PRIMARY} onClick={handlePullAll}>
            {t("tree.pullAndEvolve")}
          </button>
        </div>
      )}

      {pendingSyncWords.length === 0 && !loading && (
        <p className="text-xs text-base-content/50">{t("tree.upToDate")}</p>
      )}
    </div>
  );
}
