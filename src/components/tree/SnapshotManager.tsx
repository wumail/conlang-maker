import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { History, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type {
  OperationLog,
  OperationLogEntry,
  SnapshotDiffSummary,
  SnapshotRollbackResult,
  SnapshotSummary,
  TrashedLanguageEntry,
} from "../../types";
import { flushAllDomainStores, useWorkspaceStore } from "../../store/workspaceStore";
import {
  generateOperationId,
  isConflictError,
  recordGuiOperationId,
} from "../../store/conflictStore";
import { reloadAllActiveStoresAndFonts } from "../../utils/externalChanges";
import { BTN_GHOST, INPUT } from "../../lib/ui";
import {
  resolveExpectedRevisionForSnapshot,
  type ManualSnapshotTarget,
  type SnapshotScopeFilter,
} from "./snapshotHelpers";
import { SnapshotListSection } from "./SnapshotListSection";
import { SnapshotRollbackModal } from "./SnapshotRollbackModal";
import { LanguageTrashSection } from "./LanguageTrashSection";

export type { OperationLog, OperationLogEntry };

export function SnapshotManager() {
  const { t } = useTranslation();
  const {
    projectPath,
    conlangFilePath,
    activeLanguageId,
    activeLanguagePath,
    config: wsConfig,
  } = useWorkspaceStore();

  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [trashItems, setTrashItems] = useState<TrashedLanguageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [maxSnapshotsInput, setMaxSnapshotsInput] = useState("10");

  const [manualScope, setManualScope] = useState<ManualSnapshotTarget>("project");
  const [manualDesc, setManualDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const [scopeFilter, setScopeFilter] = useState<SnapshotScopeFilter>("all");
  const [langFilter, setLangFilter] = useState<string>("all");

  const [rollbackTarget, setRollbackTarget] = useState<SnapshotSummary | null>(null);
  const [rollbackDiff, setRollbackDiff] = useState<SnapshotDiffSummary | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  const loadAllData = useCallback(async (): Promise<void> => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const [allSnaps, trash, activeLog] = await Promise.all([
        invoke<SnapshotSummary[]>("list_all_snapshots", {
          projectPath,
          conlangFilePath: conlangFilePath || undefined,
        }),
        invoke<TrashedLanguageEntry[]>("list_language_trash", { projectPath }),
        activeLanguagePath
          ? invoke<OperationLog>("load_operation_log", {
              projectPath,
              languagePath: activeLanguagePath,
            }).catch((err) => {
              console.warn(`Optional active oplog load failed: ${err}`);
              return null;
            })
          : Promise.resolve(null),
      ]);
      setSnapshots(allSnaps);
      setTrashItems(trash);
      if (activeLog) setMaxSnapshotsInput(String(activeLog.max_snapshots));
    } catch (err) {
      console.warn("Failed to load snapshots & trash:", err);
    } finally {
      setLoading(false);
    }
  }, [projectPath, conlangFilePath, activeLanguagePath]);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  const handleUpdateLimit = async (): Promise<void> => {
    if (!activeLanguagePath) return;
    const parsed = Number.parseInt(maxSnapshotsInput, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 100) return;
    try {
      const opId = generateOperationId();
      recordGuiOperationId(opId);
      const updated = await invoke<OperationLog>("set_max_snapshots", {
        projectPath,
        languagePath: activeLanguagePath,
        maxSnapshots: parsed,
        operationId: opId,
      });
      setMaxSnapshotsInput(String(updated.max_snapshots));
      await loadAllData();
    } catch (err) {
      console.warn("Failed to set max snapshots:", err);
    }
  };

  const handleCreateSnapshot = async (): Promise<void> => {
    if (!projectPath) return;
    setCreating(true);
    try {
      await flushAllDomainStores();
      const opId = generateOperationId();
      recordGuiOperationId(opId);
      const description = manualDesc.trim() || t("snapshots.manualDefaultDesc");

      if (manualScope === "project") {
        await invoke<SnapshotSummary>("create_project_snapshot", {
          projectPath,
          conlangFilePath: conlangFilePath || undefined,
          operationType: "manual_project_snapshot",
          description,
          origin: "gui",
          operationId: opId,
        });
      } else if (activeLanguagePath) {
        await invoke<OperationLog>("create_snapshot", {
          projectPath,
          languagePath: activeLanguagePath,
          operationType: "manual_snapshot",
          sourceLanguageId: activeLanguageId,
          targetLanguageId: activeLanguageId,
          description,
          scope: manualScope,
          origin: "gui",
          operationId: opId,
        });
      }
      setManualDesc("");
      await loadAllData();
    } catch (err) {
      console.warn("Failed to create manual snapshot:", err);
    } finally {
      setCreating(false);
    }
  };

  const openRollbackPreview = async (snap: SnapshotSummary): Promise<void> => {
    setRollbackTarget(snap);
    setRollbackDiff(null);
    setRollbackError(null);
    setLoadingDiff(true);
    try {
      const diff = await invoke<SnapshotDiffSummary>("preview_snapshot_rollback", {
        projectPath,
        conlangFilePath: conlangFilePath || undefined,
        snapshotId: snap.snapshot_id,
        languageId: snap.level === "project" ? undefined : (snap.language_id ?? undefined),
      });
      setRollbackDiff(diff);
    } catch (err) {
      setRollbackError(String(err));
    } finally {
      setLoadingDiff(false);
    }
  };

  const confirmRollback = async (): Promise<void> => {
    if (!rollbackTarget) return;
    setRollingBack(true);
    setRollbackError(null);
    try {
      await flushAllDomainStores();
      const expectedRevision = await resolveExpectedRevisionForSnapshot(
        rollbackTarget,
        projectPath,
        conlangFilePath,
      );
      const opId = generateOperationId();
      recordGuiOperationId(opId);
      await invoke<SnapshotRollbackResult>("rollback_any_snapshot", {
        projectPath,
        conlangFilePath: conlangFilePath || undefined,
        snapshotId: rollbackTarget.snapshot_id,
        languageId:
          rollbackTarget.level === "project"
            ? undefined
            : (rollbackTarget.language_id ?? undefined),
        dryRun: false,
        expectedRevision,
        operationId: opId,
      });
      setRollbackTarget(null);
      setRollbackDiff(null);
      await reloadAllActiveStoresAndFonts();
      await loadAllData();
    } catch (err) {
      if (isConflictError(err) && conlangFilePath) {
        await useWorkspaceStore.getState().triggerExternalConflict(conlangFilePath);
      }
      setRollbackError(String(err));
    } finally {
      setRollingBack(false);
    }
  };

  const filteredSnapshots = useMemo(
    () =>
      snapshots.filter((item) => {
        if (scopeFilter !== "all" && item.scope !== scopeFilter) return false;
        if (langFilter !== "all") {
          return langFilter === "__project__"
            ? item.level === "project"
            : item.language_id === langFilter;
        }
        return true;
      }),
    [snapshots, scopeFilter, langFilter],
  );

  const langNameMap = useMemo(() => {
    const map = new Map<string, string>();
    wsConfig.languages.forEach((l) => map.set(l.language_id, l.name));
    return map;
  }, [wsConfig.languages]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-lg flex items-center gap-2">
          <History className="w-5 h-5" /> {t("tree.snapshots")}
        </h3>
        <div className="flex items-center gap-2">
          <label className="text-xs text-base-content/60">{t("tree.maxSnapshots")}</label>
          <input
            type="number"
            className={`${INPUT} input-xs w-16`}
            value={maxSnapshotsInput}
            onChange={(e) => setMaxSnapshotsInput(e.target.value)}
            onBlur={() => void handleUpdateLimit()}
            min={1}
            max={100}
          />
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() => void loadAllData()}
            disabled={loading}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <SnapshotListSection
        languages={wsConfig.languages}
        langNameMap={langNameMap}
        manualScope={manualScope}
        onManualScopeChange={setManualScope}
        manualDesc={manualDesc}
        onManualDescChange={setManualDesc}
        creating={creating}
        onCreateSnapshot={() => void handleCreateSnapshot()}
        scopeFilter={scopeFilter}
        onScopeFilterChange={setScopeFilter}
        langFilter={langFilter}
        onLangFilterChange={setLangFilter}
        filteredSnapshots={filteredSnapshots}
        onPreviewRollback={(snap) => void openRollbackPreview(snap)}
      />

      <LanguageTrashSection trashItems={trashItems} onRestored={loadAllData} />

      <SnapshotRollbackModal
        target={rollbackTarget}
        diff={rollbackDiff}
        loadingDiff={loadingDiff}
        rollingBack={rollingBack}
        error={rollbackError}
        onConfirm={() => void confirmRollback()}
        onCancel={() => {
          setRollbackTarget(null);
          setRollbackDiff(null);
        }}
      />
    </div>
  );
}
