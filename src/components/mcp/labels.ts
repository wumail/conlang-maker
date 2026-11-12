import type { TFunction } from "i18next";
import type { McpPermissionMode } from "../../types";

/** Shared label helpers for the MCP settings page and its dialogs. */

export function modeLabel(t: TFunction, mode: McpPermissionMode | string): string {
  switch (mode) {
    case "read-only":
      return t("mcp.modeReadOnly");
    case "write":
      return t("mcp.modeWrite");
    case "write+destructive":
      return t("mcp.modeDestructive");
    default:
      return String(mode);
  }
}

export function modeDescription(t: TFunction, mode: McpPermissionMode | string): string {
  switch (mode) {
    case "read-only":
      return t("mcp.modeReadOnlyDesc");
    case "write":
      return t("mcp.modeWriteDesc");
    case "write+destructive":
      return t("mcp.modeDestructiveDesc");
    default:
      return "";
  }
}

export function toolsetsLabel(t: TFunction, toolsets: string): string {
  const trimmed = toolsets.trim();
  if (trimmed === "" || trimmed === "default") return t("mcp.toolsetsDefault");
  if (trimmed === "all") return t("mcp.toolsetsAll");
  return trimmed;
}

export function formatLastUsed(iso: string | undefined, t: TFunction): string {
  if (!iso) return t("mcp.tokenNeverUsed");
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleString();
}

/** Last path segment of a `.conlang` path, for compact family display. */
export function familyLabel(family: string | null, t: TFunction): string {
  if (!family) return t("mcp.familyDynamic");
  const parts = family.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? family;
}
