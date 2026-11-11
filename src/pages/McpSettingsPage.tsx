import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, Cpu, Shield } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { McpAuditLogEntry, McpPermissionMode } from "../types";
import { useWorkspaceStore } from "../store/workspaceStore";
import { PageHeader } from "../components/common/PageHeader";
import { McpConfigSnippets } from "../components/mcp/McpConfigSnippets";
import { McpAuditLogCard } from "../components/mcp/McpAuditLogCard";
import {
  CARD,
  CARD_BODY,
  FIELD_LABEL,
  INPUT_MONO,
  SELECT,
  TOGGLE,
} from "../lib/ui";

const AUDIT_LOG_LIMIT = 50;

const PERMISSION_MODES: readonly McpPermissionMode[] = [
  "read-only",
  "write",
  "write+destructive",
];

function renderModeLabel(t: TFunction, mode: McpPermissionMode): string {
  switch (mode) {
    case "read-only":
      return t("mcp.modeReadOnly");
    case "write":
      return t("mcp.modeWrite");
    case "write+destructive":
      return t("mcp.modeDestructive");
  }
}

function renderModeDesc(t: TFunction, mode: McpPermissionMode): string {
  switch (mode) {
    case "read-only":
      return t("mcp.modeReadOnlyDesc");
    case "write":
      return t("mcp.modeWriteDesc");
    case "write+destructive":
      return t("mcp.modeDestructiveDesc");
  }
}

export const McpSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const conlangFilePath = useWorkspaceStore((s) => s.conlangFilePath);

  const [binaryPath, setBinaryPath] = useState<string>("");
  const [binaryError, setBinaryError] = useState<string | null>(null);
  const [mode, setMode] = useState<McpPermissionMode>("read-only");
  const [bindCurrentFamily, setBindCurrentFamily] = useState<boolean>(
    Boolean(conlangFilePath),
  );

  const [auditLogs, setAuditLogs] = useState<McpAuditLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  useEffect(() => {
    setBindCurrentFamily(Boolean(conlangFilePath));
  }, [conlangFilePath]);

  useEffect(() => {
    let cancelled = false;
    invoke<string>("get_mcp_binary_path")
      .then((resolved) => {
        if (!cancelled) {
          setBinaryPath(resolved);
          setBinaryError(null);
        }
      })
      .catch((err) => {
        console.warn(`Failed to get MCP binary path: ${err}`);
        if (!cancelled) {
          setBinaryError(String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAuditLogs = useCallback(async (): Promise<void> => {
    setLoadingLogs(true);
    setLogsError(null);
    try {
      const entries = await invoke<McpAuditLogEntry[]>("get_mcp_audit_logs", {
        projectPath: conlangFilePath ? projectPath : undefined,
        limit: AUDIT_LOG_LIMIT,
      });
      setAuditLogs(entries);
    } catch (err) {
      console.warn(`Failed to load MCP audit logs: ${err}`);
      setLogsError(String(err));
    } finally {
      setLoadingLogs(false);
    }
  }, [conlangFilePath, projectPath]);

  useEffect(() => {
    void loadAuditLogs();
  }, [loadAuditLogs]);

  const effectiveFamilyPath =
    bindCurrentFamily && conlangFilePath ? conlangFilePath : null;

  return (
    <div className="space-y-6 max-w-6xl mx-auto" data-testid="mcp-settings-page">
      <div className="space-y-1">
        <PageHeader icon={<Cpu className="w-6 h-6" />} title={t("mcp.title")} />
        <p className="text-sm text-base-content/60">{t("mcp.subtitle")}</p>
      </div>

      <div className={CARD}>
        <div className={`${CARD_BODY} p-5 space-y-4`}>
          <div className="space-y-1.5">
            <label className={FIELD_LABEL}>{t("mcp.binaryPathLabel")}</label>
            <input
              type="text"
              readOnly
              className={`${INPUT_MONO} input-sm w-full bg-base-200/70`}
              value={binaryPath || t("mcp.binaryNotFound")}
              data-testid="mcp-binary-path"
            />
            {binaryError && (
              <p className="text-xs text-warning">{binaryError}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <label className={`${FIELD_LABEL} flex items-center gap-1.5`}>
                <Shield className="w-4 h-4 text-primary" />
                {t("mcp.modeLabel")}
              </label>
              <select
                className={`${SELECT} select-sm w-full`}
                value={mode}
                onChange={(e) => setMode(e.target.value as McpPermissionMode)}
                data-testid="mcp-mode-select"
              >
                {PERMISSION_MODES.map((m) => (
                  <option key={m} value={m}>
                    {renderModeLabel(t, m)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-base-content/60">
                {renderModeDesc(t, mode)}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className={FIELD_LABEL}>{t("mcp.bindFamilyLabel")}</span>
                <input
                  type="checkbox"
                  className={TOGGLE}
                  checked={Boolean(effectiveFamilyPath)}
                  disabled={!conlangFilePath}
                  onChange={(e) => setBindCurrentFamily(e.target.checked)}
                  data-testid="mcp-bind-family-toggle"
                />
              </label>
              <p className="text-xs text-base-content/60 break-all">
                {conlangFilePath
                  ? `${t("mcp.bindFamilyHint")}: ${conlangFilePath}`
                  : t("mcp.noActiveFamily")}
              </p>
            </div>
          </div>

          {mode === "write+destructive" && (
            <div
              className="alert alert-warning py-2.5 px-3 text-xs flex items-center gap-2"
              data-testid="mcp-destructive-warning"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{t("mcp.destructiveWarning")}</span>
            </div>
          )}
        </div>
      </div>

      <McpConfigSnippets
        binaryPath={binaryPath}
        mode={mode}
        familyFilePath={effectiveFamilyPath}
      />

      <McpAuditLogCard
        logs={auditLogs}
        loading={loadingLogs}
        error={logsError}
        onRefresh={() => void loadAuditLogs()}
      />
    </div>
  );
};
