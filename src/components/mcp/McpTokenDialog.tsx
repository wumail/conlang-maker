import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import type { McpPermissionMode, McpTokenSettings } from "../../types";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  FIELD_LABEL,
  INPUT,
  INPUT_MONO,
  SELECT,
} from "../../lib/ui";
import { modeDescription, modeLabel } from "./labels";
import { MODE_TOOLSETS } from "./httpSnippets";

export interface McpTokenDraft {
  name: string;
  mode: McpPermissionMode;
  /** "default" | "all" | comma separated toolset list */
  toolsets: string;
  family: string | null;
}

interface McpTokenDialogProps {
  editing: McpTokenSettings | null;
  families: { name: string; conlangFilePath: string }[];
  activeFamilyPath: string | null;
  busy: boolean;
  onSubmit: (draft: McpTokenDraft) => void;
  onClose: () => void;
}

const MODES: readonly McpPermissionMode[] = ["read-only", "write", "write+destructive"];
const TOOLSET_NAMES = ["core", "audit", "compute", "write", "evolution", "admin"] as const;
type ToolsetName = (typeof TOOLSET_NAMES)[number];

type ToolsetMode = "default" | "all" | "custom";

function splitCustomToolsets(toolsets: string): ToolsetName[] {
  return toolsets
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is ToolsetName =>
      (TOOLSET_NAMES as readonly string[]).includes(part),
    );
}

export const McpTokenDialog: React.FC<McpTokenDialogProps> = ({
  editing,
  families,
  activeFamilyPath,
  busy,
  onSubmit,
  onClose,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<McpPermissionMode>("read-only");
  const [toolsets, setToolsets] = useState<ToolsetMode>("default");
  const [customToolsets, setCustomToolsets] = useState<ToolsetName[]>(["core"]);
  const [family, setFamily] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setMode(editing.mode);
      const raw = editing.toolsets.trim();
      if (raw === "" || raw === "default") {
        setToolsets("default");
        setCustomToolsets(["core"]);
      } else if (raw === "all") {
        setToolsets("all");
        setCustomToolsets([...TOOLSET_NAMES]);
      } else {
        setToolsets("custom");
        setCustomToolsets(splitCustomToolsets(raw));
      }
      setFamily(editing.family ?? "");
    } else {
      setName("");
      setMode("read-only");
      setToolsets("default");
      setCustomToolsets(["core"]);
      setFamily("");
    }
    setError(null);
  }, [editing]);

  const familyOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { path: string; label: string }[] = [];
    if (activeFamilyPath) {
      seen.add(activeFamilyPath);
      options.push({
        path: activeFamilyPath,
        label: `${t("mcp.familyActiveOption")} · ${activeFamilyPath.split(/[\\/]/).pop() ?? activeFamilyPath}`,
      });
    }
    for (const family of families) {
      if (!family.conlangFilePath || seen.has(family.conlangFilePath)) continue;
      seen.add(family.conlangFilePath);
      options.push({ path: family.conlangFilePath, label: family.name });
    }
    return options;
  }, [activeFamilyPath, families, t]);

  const handleSubmit = (): void => {
    if (!name.trim()) {
      setError(t("mcp.tokenNameRequired"));
      return;
    }
    if (toolsets === "custom" && customToolsets.length === 0) {
      setError(t("mcp.toolsetsRequired"));
      return;
    }
    const resolvedToolsets =
      toolsets === "default"
        ? "default"
        : toolsets === "all"
          ? "all"
          : TOOLSET_NAMES.filter((toolset) => customToolsets.includes(toolset)).join(",");
    onSubmit({
      name: name.trim(),
      mode,
      toolsets: resolvedToolsets,
      family: family.trim() === "" ? null : family.trim(),
    });
  };

  const toggleToolset = (toolset: ToolsetName, checked: boolean): void => {
    setCustomToolsets((cur) =>
      checked ? [...new Set([...cur, toolset])] : cur.filter((item) => item !== toolset),
    );
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      data-testid="mcp-token-dialog"
    >
      <div
        className="bg-base-100 rounded-xl shadow-xl p-5 w-full max-w-lg space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-base">
          {editing ? t("mcp.editTokenTitle") : t("mcp.createTokenTitle")}
        </h3>

        <div className="space-y-1.5">
          <label className={FIELD_LABEL}>{t("mcp.fieldTokenName")}</label>
          <input
            className={`${INPUT} input-sm w-full`}
            value={name}
            placeholder={t("mcp.tokenNamePlaceholder")}
            onChange={(e) => setName(e.target.value)}
            data-testid="mcp-token-name"
          />
        </div>

        <div className="space-y-1.5">
          <label className={FIELD_LABEL}>{t("mcp.modeLabel")}</label>
          <select
            className={`${SELECT} select-sm w-full`}
            value={mode}
            onChange={(e) => setMode(e.target.value as McpPermissionMode)}
            data-testid="mcp-token-mode"
          >
            {MODES.map((item) => (
              <option key={item} value={item}>
                {modeLabel(t, item)}
              </option>
            ))}
          </select>
          <p className="text-xs text-base-content/60">{modeDescription(t, mode)}</p>
        </div>

        {mode === "write+destructive" && (
          <div className="alert alert-warning py-2.5 px-3 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t("mcp.destructiveWarning")}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label className={FIELD_LABEL}>{t("mcp.fieldToolsets")}</label>
          <select
            className={`${SELECT} select-sm w-full`}
            value={toolsets}
            onChange={(e) => setToolsets(e.target.value as ToolsetMode)}
            data-testid="mcp-token-toolsets"
          >
            <option value="default">
              {t("mcp.toolsetsDefaultHint", { list: MODE_TOOLSETS[mode] })}
            </option>
            <option value="all">{t("mcp.toolsetsAll")}</option>
            <option value="custom">{t("mcp.toolsetsCustom")}</option>
          </select>
          {toolsets === "custom" && (
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {TOOLSET_NAMES.map((toolset) => (
                <label
                  key={toolset}
                  className="flex items-center gap-2 text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs"
                    checked={customToolsets.includes(toolset)}
                    onChange={(e) => toggleToolset(toolset, e.target.checked)}
                  />
                  <span className="font-mono">{toolset}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label className={FIELD_LABEL}>{t("mcp.fieldFamily")}</label>
          <select
            className={`${SELECT} select-sm w-full`}
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            data-testid="mcp-token-family"
          >
            <option value="">{t("mcp.familyDynamic")}</option>
            {familyOptions.map((option) => (
              <option key={option.path} value={option.path}>
                {option.label}
              </option>
            ))}
          </select>
          {family && (
            <p className="text-xs text-base-content/50 break-all font-mono">{family}</p>
          )}
        </div>

        {error && (
          <div className="alert alert-error alert-soft py-2 px-3 text-xs">{error}</div>
        )}

        {editing && (
          <div className="space-y-1.5">
            <label className={FIELD_LABEL}>{t("mcp.colToken")}</label>
            <input
              readOnly
              className={`${INPUT_MONO} input-sm w-full bg-base-200/70`}
              value={editing.token}
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" className={BTN_GHOST} onClick={onClose} disabled={busy}>
            {t("mcp.btnCancel")}
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={handleSubmit}
            disabled={busy}
            data-testid="mcp-token-submit"
          >
            {editing ? t("mcp.btnSave") : t("mcp.btnCreate")}
          </button>
        </div>
      </div>
    </div>
  );
};
