import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight, Copy, Terminal } from "lucide-react";
import type { McpTokenSettings } from "../../types";
import {
  BADGE,
  BTN_GHOST,
  CARD,
  CARD_BODY,
  SECTION_HEADER,
} from "../../lib/ui";
import { buildHttpSnippets, buildStdioConfig, type HttpSnippetId } from "./httpSnippets";

interface McpHttpSnippetsProps {
  url: string;
  token: McpTokenSettings | null;
  binaryPath: string;
  activeFamilyPath: string | null;
}

const SUBTITLES: Record<HttpSnippetId, string> = {
  cursor: ".cursor/mcp.json",
  "claude-code": "claude mcp add",
  generic: "HTTP",
};

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

export const McpHttpSnippets: React.FC<McpHttpSnippetsProps> = ({
  url,
  token,
  binaryPath,
  activeFamilyPath,
}) => {
  const { t } = useTranslation();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [stdioOpen, setStdioOpen] = useState(false);

  const snippets = useMemo(() => {
    if (!token) return [];
    return buildHttpSnippets(url, token.token).map((item) => ({
      ...item,
      title:
        item.id === "cursor"
          ? t("mcp.cursorTitle")
          : item.id === "claude-code"
            ? t("mcp.claudeCodeTitle")
            : t("mcp.genericClientTitle"),
      subtitle: SUBTITLES[item.id],
    }));
  }, [url, token, t]);

  const stdioConfig = useMemo(
    () =>
      buildStdioConfig(
        binaryPath,
        token?.mode ?? "read-only",
        token?.family ?? activeFamilyPath,
      ),
    [binaryPath, token, activeFamilyPath],
  );

  const handleCopy = async (id: string, code: string): Promise<void> => {
    if (await writeTextToClipboard(code)) {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    }
  };

  return (
    <div className="space-y-3" data-testid="mcp-http-snippets">
      <h3 className={`${SECTION_HEADER} flex items-center gap-2`}>
        <Terminal className="w-4 h-4" />
        {t("mcp.snippetsTitle")}
      </h3>

      {!token ? (
        <div className={CARD}>
          <div className={`${CARD_BODY} p-4 text-sm text-base-content/60`}>
            {t("mcp.snippetSelectTokenHint")}
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-base-content/60">
            {t("mcp.snippetForToken", { name: token.name })}
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {snippets.map((item) => {
              const isCopied = copiedId === item.id;
              return (
                <div key={item.id} className={CARD} data-testid={`mcp-snippet-${item.id}`}>
                  <div className={`${CARD_BODY} p-4 space-y-2.5`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{item.title}</div>
                        <span className={`${BADGE} badge-ghost font-mono mt-0.5`}>
                          {item.subtitle}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={BTN_GHOST}
                        onClick={() => void handleCopy(item.id, item.code)}
                        data-testid={`mcp-copy-${item.id}`}
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-success" />
                            {t("mcp.copiedSnippet")}
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            {t("mcp.copySnippet")}
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="bg-base-200 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-56 whitespace-pre-wrap break-all">
                      {item.code}
                    </pre>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className={CARD}>
        <div
          role="button"
          tabIndex={0}
          className={`${CARD_BODY} p-4 w-full flex items-center justify-between gap-2 text-left cursor-pointer`}
          onClick={() => setStdioOpen((cur) => !cur)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setStdioOpen((cur) => !cur);
          }}
          data-testid="mcp-stdio-toggle"
        >
          <div>
            <div className="font-semibold text-sm flex items-center gap-1.5">
              {stdioOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              {t("mcp.stdioFallbackTitle")}
            </div>
            <p className="text-xs text-base-content/60 mt-0.5">
              {t("mcp.stdioFallbackDesc")}
            </p>
          </div>
          <button
            type="button"
            className={BTN_GHOST}
            onClick={(e) => {
              e.stopPropagation();
              void handleCopy("stdio", stdioConfig);
            }}
            data-testid="mcp-copy-stdio"
          >
            {copiedId === "stdio" ? (
              <>
                <Check className="w-3.5 h-3.5 text-success" />
                {t("mcp.copiedSnippet")}
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                {t("mcp.copySnippet")}
              </>
            )}
          </button>
        </div>
        {stdioOpen && (
          <div className="px-4 pb-4 space-y-2">
            <pre className="bg-base-200 rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {stdioConfig}
            </pre>
            <p className="text-xs text-base-content/50">{t("mcp.stdioFallbackHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
};
