import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { History, RotateCcw, AlertTriangle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { INPUT } from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";

export interface OperationLogEntry {
    log_id: string;
    operation_type: string;
    timestamp: string;
    source_language_id: string;
    target_language_id: string;
    description: string;
    snapshot_dir: string;
}

export interface OperationLog {
    max_snapshots: number;
    entries: OperationLogEntry[];
}

export function SnapshotManager() {
    const { t } = useTranslation();
    const { projectPath, activeLanguagePath } = useWorkspaceStore();

    const [log, setLog] = useState<OperationLog | null>(null);
    const [loading, setLoading] = useState(false);
    const [maxSnapshotsInput, setMaxSnapshotsInput] = useState("10");
    const [rollbackTarget, setRollbackTarget] = useState<OperationLogEntry | null>(null);

    const loadLog = async () => {
        setLoading(true);
        try {
            const data = await invoke<OperationLog>("load_operation_log", {
                projectPath,
                languagePath: activeLanguagePath,
            });
            setLog(data);
            setMaxSnapshotsInput(data.max_snapshots.toString());
        } catch (err) {
            console.warn("Failed to load oplog:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadLog();
    }, [projectPath, activeLanguagePath]);

    const handleUpdateLimit = async () => {
        const parsed = parseInt(maxSnapshotsInput, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > 100) return;
        try {
            const updated = await invoke<OperationLog>("set_max_snapshots", {
                projectPath,
                languagePath: activeLanguagePath,
                maxSnapshots: parsed,
            });
            setLog(updated);
        } catch (err) {
            console.warn("Failed to set max snapshots", err);
        }
    };

    const confirmRollback = async () => {
        if (!rollbackTarget) return;
        try {
            const updated = await invoke<OperationLog>("rollback_to_snapshot", {
                projectPath,
                languagePath: activeLanguagePath,
                logId: rollbackTarget.log_id,
            });
            setLog(updated);
            setRollbackTarget(null);
            // We must reload the lexicon after rollback, but the page handles that
            // when activeLanguage changes or we could force a workspace reload
            useWorkspaceStore.getState().loadWorkspace(useWorkspaceStore.getState().conlangFilePath);
        } catch (err) {
            console.warn("Rollback failed:", err);
        }
    };

    if (loading && !log) {
        return <div className="p-4 text-center"><span className="loading loading-spinner" /></div>;
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg flex items-center gap-2">
                    <History className="w-5 h-5" /> {t("tree.snapshots")}
                </h3>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-base-content/60">{t("tree.maxSnapshots")}</label>
                    <input
                        type="number"
                        className={`${INPUT} input-xs w-16`}
                        value={maxSnapshotsInput}
                        onChange={e => setMaxSnapshotsInput(e.target.value)}
                        onBlur={handleUpdateLimit}
                        min={1} max={100}
                    />
                </div>
            </div>

            <div className="bg-base-200/50 rounded-lg border border-base-300 max-h-96 overflow-y-auto">
                {(!log?.entries || log.entries.length === 0) ? (
                    <div className="p-8 text-center text-base-content/50 text-sm">
                        {t("tree.noSnapshots")}
                    </div>
                ) : (
                    <div className="divide-y divide-base-300">
                        {log.entries.slice().reverse().map(entry => (
                            <div key={entry.log_id} className="p-3 flex items-center justify-between hover:bg-base-200 transition-colors">
                                <div>
                                    <div className="text-sm font-medium">{entry.description}</div>
                                    <div className="text-xs text-base-content/50 mt-0.5">
                                        {new Date(parseInt(entry.timestamp) * 1000).toLocaleString()} • {entry.operation_type}
                                    </div>
                                </div>
                                <button
                                    className="btn btn-sm btn-ghost text-error"
                                    onClick={() => setRollbackTarget(entry)}
                                    title={t("tree.rollbackHere")}
                                >
                                    <RotateCcw className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <p className="text-xs text-base-content/50 flex items-start gap-1">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                {t("tree.snapshotWarning")}
            </p>

            {rollbackTarget && (
                <ConfirmModal
                    open={true}
                    title={t("tree.rollbackTitle")}
                    message={t("tree.rollbackConfirm", { desc: rollbackTarget.description })}
                    onConfirm={confirmRollback}
                    onCancel={() => setRollbackTarget(null)}
                />
            )}
        </div>
    );
}
