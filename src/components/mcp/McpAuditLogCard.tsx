import React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { RefreshCw, ScrollText } from "lucide-react";
import type { McpAuditLogEntry } from "../../types";
import { BADGE, BTN_GHOST, CARD, CARD_BODY } from "../../lib/ui";

interface McpAuditLogCardProps {
  logs: McpAuditLogEntry[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function getStatusBadgeClass(status: McpAuditLogEntry["status"]): string {
  switch (status) {
    case "committed":
      return "badge-success";
    case "rolled_back":
      return "badge-warning";
    case "dry_run":
      return "badge-info";
    case "error":
      return "badge-error";
  }
}

function renderStatusLabel(
  t: TFunction,
  status: McpAuditLogEntry["status"],
): string {
  switch (status) {
    case "committed":
      return t("mcp.statusCommitted");
    case "rolled_back":
      return t("mcp.statusRolledBack");
    case "dry_run":
      return t("mcp.statusDryRun");
    case "error":
      return t("mcp.statusError");
  }
}

function formatAuditTime(timestamp: string): string {
  const trimmed = timestamp.trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) {
    const num = Number.parseInt(trimmed, 10);
    const millis = num > 10_000_000_000 ? num : num * 1000;
    return new Date(millis).toLocaleString();
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? trimmed : new Date(parsed).toLocaleString();
}

/**
 * HTTP calls carry the token name; legacy stdio calls and GUI writes have no client,
 * so fall back to the recorded origin.
 */
function renderClient(t: TFunction, entry: McpAuditLogEntry): string {
  if (entry.client) return entry.client;
  if (entry.origin === "gui") return t("mcp.originGui");
  if (entry.origin === "mcp") return t("mcp.originStdio");
  return entry.origin || "—";
}

export const McpAuditLogCard: React.FC<McpAuditLogCardProps> = ({
  logs,
  loading,
  error,
  onRefresh,
}) => {
  const { t } = useTranslation();

  return (
    <div className={CARD} data-testid="mcp-audit-log-card">
      <div className={`${CARD_BODY} p-4 space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2">
              <ScrollText className="w-4 h-4 text-primary" />
              {t("mcp.auditLogsTitle")}
            </h3>
            <p className="text-xs text-base-content/60">
              {t("mcp.auditLogsDesc")}
            </p>
          </div>
          <button
            type="button"
            className={BTN_GHOST}
            disabled={loading}
            onClick={onRefresh}
            data-testid="mcp-refresh-logs"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {t("mcp.refreshLogs")}
          </button>
        </div>

        {error && (
          <div className="alert alert-warning alert-soft py-2 px-3 text-xs">
            <span>{error}</span>
          </div>
        )}

        {logs.length === 0 ? (
          <div className="py-8 text-center text-sm text-base-content/50">
            {loading ? t("common.loading") : t("mcp.noAuditLogs")}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-lg border border-base-300">
            <table className="table table-xs w-full" data-testid="mcp-audit-table">
              <thead>
                <tr>
                  <th>{t("mcp.colTime")}</th>
                  <th>{t("mcp.colClient")}</th>
                  <th>{t("mcp.colTool")}</th>
                  <th className="whitespace-nowrap">{t("mcp.colLanguage")}</th>
                  <th className="whitespace-nowrap">{t("mcp.colStatus")}</th>
                  <th>{t("mcp.colSummary")}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry, idx) => (
                  <tr key={`${entry.operation_id}:${entry.timestamp}:${idx}`}>
                    <td className="whitespace-nowrap font-mono text-[11px] text-base-content/70">
                      {formatAuditTime(entry.timestamp)}
                    </td>
                    <td className="text-xs whitespace-nowrap max-w-[9rem] truncate" title={renderClient(t, entry)}>
                      {renderClient(t, entry)}
                    </td>
                    <td className="font-mono text-xs">{entry.tool}</td>
                    <td className="font-mono text-xs text-base-content/70">
                      {entry.language_id ?? "—"}
                    </td>
                    <td className="w-px whitespace-nowrap">
                      <span
                        className={`${BADGE} ${getStatusBadgeClass(entry.status)} whitespace-nowrap`}
                      >
                        {renderStatusLabel(t, entry.status)}
                      </span>
                    </td>
                    <td className="text-xs max-w-md truncate" title={entry.summary}>
                      {entry.summary}
                      {entry.snapshot_id && (
                        <span className="ml-1.5 font-mono text-[11px] text-base-content/50">
                          (#{entry.snapshot_id.slice(0, 6)})
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
