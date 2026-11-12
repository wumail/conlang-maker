import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Cpu } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type {
  McpAuditLogEntry,
  McpServerSettingsPayload,
  McpServerStatus,
  McpTokenSettings,
} from "../types";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useRegistryStore } from "../store/registryStore";
import { PageHeader } from "../components/common/PageHeader";
import { McpServerStatusCard } from "../components/mcp/McpServerStatusCard";
import { McpTokenTable } from "../components/mcp/McpTokenTable";
import { McpTokenDialog, type McpTokenDraft } from "../components/mcp/McpTokenDialog";
import { McpHttpSnippets } from "../components/mcp/McpHttpSnippets";
import { McpAuditLogCard } from "../components/mcp/McpAuditLogCard";
import { Toast } from "../components/common/Toast";
import { BTN_GHOST } from "../lib/ui";

const AUDIT_LOG_LIMIT = 50;
const STATUS_POLL_MS = 3000;

interface PendingConfirm {
  kind: "delete" | "regenerate";
  token: McpTokenSettings;
}

async function writeTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn(`Clipboard write failed: ${err}`);
  }
  return false;
}

export const McpSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const conlangFilePath = useWorkspaceStore((s) => s.conlangFilePath);
  const registry = useRegistryStore((s) => s.registry);
  const loadRegistry = useRegistryStore((s) => s.loadRegistry);

  const [payload, setPayload] = useState<McpServerSettingsPayload | null>(null);
  const [status, setStatus] = useState<McpServerStatus | null>(null);
  const [binaryPath, setBinaryPath] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [dialogToken, setDialogToken] = useState<McpTokenSettings | null | undefined>(
    undefined,
  );
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const [auditLogs, setAuditLogs] = useState<McpAuditLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  const noticeTimer = useRef<number | null>(null);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2500);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  const loadSettings = useCallback(async (): Promise<void> => {
    try {
      const next = await invoke<McpServerSettingsPayload>("mcp_server_get_settings");
      setPayload(next);
      setSelectedTokenId((cur) => {
        if (cur && next.settings.tokens.some((token) => token.id === cur)) return cur;
        return next.settings.tokens[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      console.warn(`Failed to load MCP server settings: ${err}`);
      setError(String(err));
    }
  }, []);

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      const next = await invoke<McpServerStatus>("mcp_server_status");
      setStatus(next);
    } catch (err) {
      console.warn(`Failed to read MCP server status: ${err}`);
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadStatus();
    void loadRegistry();
  }, [loadSettings, loadStatus, loadRegistry]);

  useEffect(() => {
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadStatus();
    };
    const timer = window.setInterval(tick, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadStatus]);

  useEffect(() => {
    let cancelled = false;
    invoke<string>("get_mcp_binary_path")
      .then((resolved) => {
        if (!cancelled) setBinaryPath(resolved);
      })
      .catch((err) => {
        console.warn(`Failed to get MCP binary path: ${err}`);
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

  const runAction = useCallback(
    async <T,>(action: () => Promise<T>, after?: (result: T) => Promise<void> | void) => {
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        if (after) await after(result);
      } catch (err) {
        console.warn(`MCP settings action failed: ${err}`);
        setError(String(err));
      } finally {
        setBusy(false);
        // Actions can change the process or the port: always re-read the real state.
        void loadStatus();
      }
    },
    [loadStatus],
  );

  const tokens = payload?.settings.tokens ?? [];
  const lastUsed = payload?.token_last_used ?? {};
  const selectedToken = useMemo(
    () => tokens.find((token) => token.id === selectedTokenId) ?? null,
    [tokens, selectedTokenId],
  );

  const families = useMemo(
    () =>
      (registry.families ?? []).map((family) => ({
        name: family.name,
        conlangFilePath: family.conlang_file_path,
      })),
    [registry.families],
  );

  const handleStart = (): void =>
    void runAction(
      () => invoke<McpServerStatus>("mcp_server_start"),
      (next) => {
        setStatus(next);
        if (next.state !== "running") setError(next.last_error);
      },
    );

  const handleStop = (): void =>
    void runAction(
      () => invoke<McpServerStatus>("mcp_server_stop"),
      (next) => setStatus(next),
    );

  const handleRestart = (): void =>
    void runAction(
      () => invoke<McpServerStatus>("mcp_server_restart"),
      (next) => {
        setStatus(next);
        if (next.state !== "running") setError(next.last_error);
      },
    );

  const handleSavePort = (port: number): void => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(t("mcp.portInvalid"));
      return;
    }
    void runAction(
      () => invoke<McpServerStatus>("mcp_server_set_port", { port }),
      async (next) => {
        setStatus(next);
        await loadSettings();
        // The URL is derived from the port, so refresh the snippets too.
        showNotice(t("mcp.portSaved"));
      },
    );
  };

  const handleCopyToken = (token: McpTokenSettings): void => {
    void (async () => {
      if (await writeTextToClipboard(token.token)) showNotice(t("mcp.tokenCopied"));
    })();
  };

  const handleToggleEnabled = (token: McpTokenSettings, enabled: boolean): void => {
    void runAction(
      () =>
        invoke<McpTokenSettings>("mcp_token_update", {
          id: token.id,
          enabled,
        }),
      async () => {
        await loadSettings();
      },
    );
  };

  const handleDialogSubmit = (draft: McpTokenDraft): void => {
    if (dialogToken) {
      void runAction(
        () =>
          invoke<McpTokenSettings>("mcp_token_update", {
            id: dialogToken.id,
            name: draft.name,
            mode: draft.mode,
            toolsets: draft.toolsets,
            // Empty string tells the backend to fall back to dynamic discovery.
            family: draft.family ?? "",
          }),
        async (updated) => {
          setDialogToken(undefined);
          setSelectedTokenId(updated.id);
          await loadSettings();
          showNotice(t("mcp.tokenSaved"));
        },
      );
      return;
    }
    void runAction(
      () =>
        invoke<McpTokenSettings>("mcp_token_create", {
          name: draft.name,
          mode: draft.mode,
          toolsets: draft.toolsets,
          family: draft.family,
        }),
      async (created) => {
        setDialogToken(undefined);
        setSelectedTokenId(created.id);
        await loadSettings();
        showNotice(t("mcp.tokenCreated"));
      },
    );
  };

  const handleConfirm = (): void => {
    if (!pendingConfirm) return;
    const { kind, token } = pendingConfirm;
    setPendingConfirm(null);
    if (kind === "delete") {
      void runAction(
        () => invoke<void>("mcp_token_delete", { id: token.id }),
        async () => {
          await loadSettings();
          showNotice(t("mcp.tokenDeleted"));
        },
      );
      return;
    }
    void runAction(
      () => invoke<string>("mcp_token_regenerate", { id: token.id }),
      async () => {
        await loadSettings();
        showNotice(t("mcp.tokenRegenerated"));
      },
    );
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto" data-testid="mcp-settings-page">
      <div className="space-y-1">
        <PageHeader icon={<Cpu className="w-6 h-6" />} title={t("mcp.title")} />
        <p className="text-sm text-base-content/60">{t("mcp.subtitle")}</p>
      </div>

      {(error || notice) && (
        <Toast
          message={error ?? notice ?? ""}
          tone={error ? "error" : "success"}
          onClose={() => {
            if (error) setError(null);
            else setNotice(null);
          }}
          testId="mcp-page-message"
        />
      )}

      <McpServerStatusCard
        status={status}
        busy={busy}
        onStart={handleStart}
        onStop={handleStop}
        onRestart={handleRestart}
        onSavePort={handleSavePort}
      />

      <McpTokenTable
        tokens={tokens}
        lastUsed={lastUsed}
        selectedId={selectedTokenId}
        busy={busy}
        onSelect={setSelectedTokenId}
        onToggleEnabled={handleToggleEnabled}
        onCopy={handleCopyToken}
        onRegenerate={(token) => setPendingConfirm({ kind: "regenerate", token })}
        onEdit={(token) => setDialogToken(token)}
        onDelete={(token) => setPendingConfirm({ kind: "delete", token })}
        onCreate={() => setDialogToken(null)}
      />

      <McpHttpSnippets
        url={payload?.url ?? ""}
        token={selectedToken}
        binaryPath={binaryPath}
        activeFamilyPath={conlangFilePath || null}
      />

      <McpAuditLogCard
        logs={auditLogs}
        loading={loadingLogs}
        error={logsError}
        onRefresh={() => void loadAuditLogs()}
      />

      {dialogToken !== undefined && (
        <McpTokenDialog
          editing={dialogToken}
          families={families}
          activeFamilyPath={conlangFilePath || null}
          busy={busy}
          onSubmit={handleDialogSubmit}
          onClose={() => setDialogToken(undefined)}
        />
      )}

      {pendingConfirm && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
          onClick={() => setPendingConfirm(null)}
          data-testid="mcp-token-confirm"
        >
          <div
            className="bg-base-100 rounded-xl shadow-xl p-5 w-full max-w-sm space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="font-semibold text-sm">
                  {pendingConfirm.kind === "delete"
                    ? t("mcp.confirmDeleteTitle")
                    : t("mcp.confirmRegenerateTitle")}
                </h3>
                <p className="text-xs text-base-content/70">
                  {pendingConfirm.kind === "delete"
                    ? t("mcp.confirmDeleteBody", { name: pendingConfirm.token.name })
                    : t("mcp.confirmRegenerateBody", { name: pendingConfirm.token.name })}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className={BTN_GHOST}
                onClick={() => setPendingConfirm(null)}
              >
                {t("mcp.btnCancel")}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-error btn-soft gap-1"
                onClick={handleConfirm}
                data-testid="mcp-token-confirm-ok"
              >
                {pendingConfirm.kind === "delete" ? t("mcp.btnDelete") : t("mcp.btnRegenerate")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
