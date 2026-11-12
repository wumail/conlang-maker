import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  Check,
  Copy,
  Play,
  Power,
  RefreshCw,
  Server,
} from "lucide-react";
import type { McpServerRunState, McpServerStatus } from "../../types";
import {
  BADGE,
  BTN_PRIMARY,
  BTN_GHOST,
  CARD,
  CARD_BODY,
  FIELD_LABEL,
  INPUT_MONO,
} from "../../lib/ui";

interface McpServerStatusCardProps {
  status: McpServerStatus | null;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onSavePort: (port: number) => void;
}

function stateBadgeClass(state: McpServerRunState): string {
  switch (state) {
    case "running":
      return "badge-success";
    case "starting":
      return "badge-info";
    case "port_in_use":
      return "badge-warning";
    case "error":
      return "badge-error";
    case "stopped":
      return "badge-ghost";
  }
}

function renderStateLabel(t: TFunction, state: McpServerRunState): string {
  switch (state) {
    case "running":
      return t("mcp.stateRunning");
    case "starting":
      return t("mcp.stateStarting");
    case "port_in_use":
      return t("mcp.statePortInUse");
    case "error":
      return t("mcp.stateError");
    case "stopped":
      return t("mcp.stateStopped");
  }
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

export const McpServerStatusCard: React.FC<McpServerStatusCardProps> = ({
  status,
  busy,
  onStart,
  onStop,
  onRestart,
  onSavePort,
}) => {
  const { t } = useTranslation();
  const [portDraft, setPortDraft] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (status?.port != null) setPortDraft(String(status.port));
  }, [status?.port]);

  const state = status?.state ?? "stopped";
  const url = status?.url ?? "";
  const portChanged =
    status?.port != null && portDraft.trim() !== "" && Number(portDraft) !== status.port;

  const handleCopyUrl = async (): Promise<void> => {
    if (!url) return;
    if (await writeTextToClipboard(url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className={CARD} data-testid="mcp-server-status-card">
      <div className={`${CARD_BODY} p-5 space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-base">{t("mcp.serverTitle")}</h3>
            <span
              className={`${BADGE} ${stateBadgeClass(state)}`}
              data-testid="mcp-server-state"
            >
              {renderStateLabel(t, state)}
            </span>
            {status?.state === "running" && (
              <span className="text-xs text-base-content/50">
                {status.owned ? t("mcp.ownedByThisApp") : t("mcp.ownedByOther")}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={busy || state === "running" || state === "starting"}
              onClick={onStart}
              data-testid="mcp-server-start"
            >
              <Play className="w-3.5 h-3.5" />
              {t("mcp.btnStart")}
            </button>
            <button
              type="button"
              className={BTN_GHOST}
              disabled={busy || state === "stopped"}
              onClick={onStop}
              data-testid="mcp-server-stop"
            >
              <Power className="w-3.5 h-3.5" />
              {t("mcp.btnStop")}
            </button>
            <button
              type="button"
              className={BTN_GHOST}
              disabled={busy}
              onClick={onRestart}
              data-testid="mcp-server-restart"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
              {t("mcp.btnRestart")}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
          <div className="space-y-1.5">
            <label className={FIELD_LABEL}>{t("mcp.urlLabel")}</label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                readOnly
                className={`${INPUT_MONO} input-sm w-full bg-base-200/70`}
                value={url || t("mcp.urlUnavailable")}
                data-testid="mcp-server-url"
              />
              <button
                type="button"
                className={BTN_GHOST}
                disabled={!url}
                onClick={() => void handleCopyUrl()}
                data-testid="mcp-copy-url"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-success" />
                    {t("mcp.copiedUrl")}
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    {t("mcp.copyUrl")}
                  </>
                )}
              </button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60">
              <span>
                {t("mcp.versionLabel")}: {status?.version ?? "—"}
              </span>
              <span>
                {t("mcp.sessionsLabel")}: {status?.sessions ?? 0}
              </span>
              <span>
                {t("mcp.pidLabel")}: {status?.pid ?? "—"}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={FIELD_LABEL}>{t("mcp.portLabel")}</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={65535}
                className={`${INPUT_MONO} input-sm w-28`}
                value={portDraft}
                onChange={(e) => setPortDraft(e.target.value)}
                data-testid="mcp-port-input"
              />
              <button
                type="button"
                className={BTN_GHOST}
                disabled={busy || !portChanged}
                onClick={() => onSavePort(Number(portDraft))}
                data-testid="mcp-port-save"
              >
                {t("mcp.btnSavePort")}
              </button>
            </div>
            <p className="text-xs text-base-content/50">{t("mcp.portHint")}</p>
          </div>
        </div>

        {status?.last_error && (
          <div
            className="alert alert-warning py-2.5 px-3 text-xs items-start gap-2"
            data-testid="mcp-server-error"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <div className="break-all">{status.last_error}</div>
              <div className="text-[11px] text-base-content/60 break-all">
                {t("mcp.logPathLabel")}: {status.log_path}
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-base-content/50">{t("mcp.autoStartHint")}</p>
      </div>
    </div>
  );
};
