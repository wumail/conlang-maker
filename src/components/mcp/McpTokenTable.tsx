import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { McpTokenSettings } from "../../types";
import {
  BADGE,
  BTN_ERROR,
  BTN_GHOST_SQ,
  BTN_PRIMARY,
  CARD,
  CARD_BODY,
  TOGGLE,
} from "../../lib/ui";
import { familyLabel, formatLastUsed, modeLabel, toolsetsLabel } from "./labels";

interface McpTokenTableProps {
  tokens: McpTokenSettings[];
  lastUsed: Record<string, string>;
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onToggleEnabled: (token: McpTokenSettings, enabled: boolean) => void;
  onCopy: (token: McpTokenSettings) => void;
  onRegenerate: (token: McpTokenSettings) => void;
  onEdit: (token: McpTokenSettings) => void;
  onDelete: (token: McpTokenSettings) => void;
  onCreate: () => void;
}

function maskToken(token: string): string {
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}${"•".repeat(12)}${token.slice(-4)}`;
}

export const McpTokenTable: React.FC<McpTokenTableProps> = ({
  tokens,
  lastUsed,
  selectedId,
  busy,
  onSelect,
  onToggleEnabled,
  onCopy,
  onRegenerate,
  onEdit,
  onDelete,
  onCreate,
}) => {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  return (
    <div className={CARD} data-testid="mcp-token-card">
      <div className={`${CARD_BODY} p-4 space-y-3`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-base">{t("mcp.tokensTitle")}</h3>
            <p className="text-xs text-base-content/60">{t("mcp.tokensDesc")}</p>
          </div>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy}
            onClick={onCreate}
            data-testid="mcp-token-create"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("mcp.btnNewToken")}
          </button>
        </div>

        {tokens.length === 0 ? (
          <div className="py-8 text-center text-sm text-base-content/50">
            {t("mcp.tokensEmpty")}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-base-300">
            <table className="table table-sm w-full" data-testid="mcp-token-table">
              <thead>
                <tr>
                  <th>{t("mcp.colName")}</th>
                  <th>{t("mcp.colToken")}</th>
                  <th>{t("mcp.colMode")}</th>
                  <th>{t("mcp.colToolsets")}</th>
                  <th>{t("mcp.colFamily")}</th>
                  <th>{t("mcp.colEnabled")}</th>
                  <th>{t("mcp.colLastUsed")}</th>
                  <th className="text-right">{t("mcp.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => {
                  const isSelected = token.id === selectedId;
                  return (
                    <tr
                      key={token.id}
                      className={`cursor-pointer ${isSelected ? "bg-primary/5" : ""}`}
                      onClick={() => onSelect(token.id)}
                      data-testid={`mcp-token-row-${token.id}`}
                    >
                      <td className="font-medium whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          {token.name}
                          {isSelected && (
                            <span className={`${BADGE} badge-primary badge-outline`}>
                              {t("mcp.tokenSelected")}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="font-mono text-[11px] text-base-content/70 whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          {revealed[token.id] ? token.token : maskToken(token.token)}
                          <button
                            type="button"
                            className={BTN_GHOST_SQ}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRevealed((cur) => ({
                                ...cur,
                                [token.id]: !cur[token.id],
                              }));
                            }}
                            title={
                              revealed[token.id] ? t("mcp.btnHideToken") : t("mcp.btnRevealToken")
                            }
                          >
                            {revealed[token.id] ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </span>
                      </td>
                      <td className="whitespace-nowrap">{modeLabel(t, token.mode)}</td>
                      <td className="font-mono text-[11px] whitespace-nowrap">
                        {toolsetsLabel(t, token.toolsets)}
                      </td>
                      <td
                        className="text-xs text-base-content/70 max-w-[10rem] truncate"
                        title={token.family ?? undefined}
                      >
                        {familyLabel(token.family, t)}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          className={TOGGLE}
                          checked={token.enabled}
                          disabled={busy}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onToggleEnabled(token, e.target.checked)}
                          data-testid={`mcp-token-enabled-${token.id}`}
                        />
                      </td>
                      <td className="text-xs text-base-content/60 whitespace-nowrap">
                        {formatLastUsed(lastUsed[token.id], t)}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            className={BTN_GHOST_SQ}
                            title={t("mcp.btnCopyToken")}
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              onCopy(token);
                            }}
                            data-testid={`mcp-token-copy-${token.id}`}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            className={BTN_GHOST_SQ}
                            title={t("mcp.btnRegenerate")}
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRegenerate(token);
                            }}
                            data-testid={`mcp-token-regenerate-${token.id}`}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            className={BTN_GHOST_SQ}
                            title={t("mcp.btnEdit")}
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(token);
                            }}
                            data-testid={`mcp-token-edit-${token.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            className={BTN_ERROR}
                            title={t("mcp.btnDelete")}
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(token);
                            }}
                            data-testid={`mcp-token-delete-${token.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-base-content/50">{t("mcp.tokenSecretHint")}</p>
      </div>
    </div>
  );
};
