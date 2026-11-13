import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, AlertTriangle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  flushAllDomainStores,
  useWorkspaceStore,
} from "../../store/workspaceStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useSCAStore } from "../../store/scaStore";
import {
  generateOperationId,
  isConflictError,
  recordGuiOperationId,
} from "../../store/conflictStore";
import { buildMacrosFromInventory } from "../../utils/scaEngine";
import { BADGE, BTN_PRIMARY } from "../../lib/ui";
import type {
  LexiconLoadResult,
  MigrationStats,
  OperationLog,
  WordEntry,
} from "../../types";
import { computePullSync, isValidWordEntry } from "../../core";
import { GrammarSyncLauncher } from "./GrammarSyncModal";

interface PendingSyncWord {
  word: WordEntry;
  mode: "add" | "update";
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

  const [pendingSyncWords, setPendingSyncWords] = useState<PendingSyncWord[]>(
    [],
  );
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
    ? wsConfig.languages.find(
        (language) => language.language_id === activeLang.parent_id,
      )
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

  const handleCheckForUpdates = async (): Promise<void> => {
    if (!parentLang) return;
    setLoading(true);

    try {
      const parentLoaded = await invoke<LexiconLoadResult>(
        "load_all_words_with_revision",
        {
          projectPath,
          languagePath: parentLang.path,
        },
      );
      const validParentWords = parentLoaded.words.filter(isValidWordEntry);

      const { pending, conflicts } = computePullSync({
        parentLanguageId: parentLang.language_id,
        childLanguageId: activeLanguageId,
        parentWords: validParentWords,
        childWords: wordsList,
        scaRuleSets: scaConfig.rule_sets,
        macros,
      });

      setPendingSyncWords(pending);
      setConflictCount(conflicts.length);
    } catch (error) {
      console.warn(`Pull sync check failed: ${error}`);
      setPendingSyncWords([]);
      setConflictCount(0);
    } finally {
      setLoading(false);
    }
  };

  const handlePullAll = async (): Promise<void> => {
    try {
      if (activeLang) {
        const opId = generateOperationId();
        recordGuiOperationId(opId);
        await invoke<OperationLog>("create_snapshot", {
          projectPath,
          languagePath: activeLang.path,
          operationType: "pull_sync",
          sourceLanguageId: parentLang?.language_id || "",
          targetLanguageId: activeLanguageId,
          description: `Pulled ${pendingSyncWords.length} words via sound changes`,
          scope: "lexicon",
          origin: "gui",
          operationId: opId,
        });
      }
    } catch (error) {
      console.warn("Failed to create snapshot before pull sync:", error);
    }

    importWords(pendingSyncWords.map((item) => item.word));
    setPendingSyncWords([]);
    setConflictCount(0);
  };

  const runMigration = async (dryRun: boolean): Promise<void> => {
    if (!conlangFilePath) return;
    if (dryRun) {
      setPreviewingMigration(true);
    } else {
      setMigrating(true);
    }
    setMigrationMessage("");
    try {
      await flushAllDomainStores();
      const opId = generateOperationId();
      if (!dryRun) {
        recordGuiOperationId(opId);
      }
      const stats = await invoke<MigrationStats>(
        "migrate_inherited_lexicon_links",
        {
          projectPath,
          conlangFilePath,
          dryRun,
          expectedRevision: useWorkspaceStore.getState().revision,
          operationId: opId,
        },
      );

      if (!dryRun && activeLang) {
        await useLexiconStore
          .getState()
          .loadFromBackend(projectPath, activeLang.path);
      }

      const migrationStats = {
        scanned: stats.words_scanned,
        links: stats.parent_link_filled,
        source: stats.source_language_filled,
        origin: stats.origin_fixed,
        files: stats.files_changed,
      };
      setMigrationMessage(
        stats.dry_run
          ? t("tree.migrationPreviewDone", migrationStats)
          : t("tree.migrationDone", migrationStats),
      );
    } catch (error) {
      if (isConflictError(error)) {
        await useWorkspaceStore
          .getState()
          .triggerExternalConflict(conlangFilePath);
      }
      console.warn(`迁移旧词条失败：${error}`);
      setMigrationMessage(
        dryRun
          ? t("tree.migrationPreviewFailed")
          : t("tree.migrationFailed"),
      );
    } finally {
      if (dryRun) {
        setPreviewingMigration(false);
      } else {
        setMigrating(false);
      }
    }
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={BTN_PRIMARY}
          onClick={() => void handleCheckForUpdates()}
          disabled={loading}
        >
          <Download className="w-4 h-4" />
          {loading ? t("common.loading") : t("tree.checkUpdates")}
        </button>
        <GrammarSyncLauncher />
        <button
          className={BTN_PRIMARY}
          onClick={() => void runMigration(true)}
          disabled={previewingMigration || migrating}
        >
          {previewingMigration
            ? t("common.loading")
            : t("tree.previewMigration")}
        </button>
        <button
          className={BTN_PRIMARY}
          onClick={() => void runMigration(false)}
          disabled={migrating || previewingMigration}
        >
          {migrating ? t("common.loading") : t("tree.migrateLegacy")}
        </button>
      </div>
      {migrationMessage && <p className="text-xs text-base-content/60">{migrationMessage}</p>}

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
              <span key={item.word.entry_id} className={`${BADGE} mr-1`}>
                {item.word.con_word_romanized}
              </span>
            ))}
            {pendingSyncWords.length > 20 && (
              <span className="text-xs text-base-content/50">
                +{pendingSyncWords.length - 20} {t("common.more")}
              </span>
            )}
          </div>
          <button className={BTN_PRIMARY} onClick={() => void handlePullAll()}>
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
