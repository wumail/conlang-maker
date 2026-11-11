import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Terminal } from "lucide-react";
import type { McpPermissionMode } from "../../types";
import { BADGE, BTN_GHOST, CARD, CARD_BODY, SECTION_HEADER } from "../../lib/ui";

interface McpConfigSnippetsProps {
  binaryPath: string;
  mode: McpPermissionMode;
  familyFilePath: string | null;
}

type ClientSnippetId = "dsh" | "claude" | "cursor";

interface ClientSnippetItem {
  id: ClientSnippetId;
  title: string;
  subtitle: string;
  code: string;
}

const MODE_TOOLSETS: Record<McpPermissionMode, string> = {
  "read-only": "core,audit,compute",
  write: "core,audit,compute,write,evolution",
  "write+destructive": "all",
};

function shellEscapeArg(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

export function buildMcpCliArgs(
  mode: McpPermissionMode,
  familyFilePath: string | null,
): string[] {
  const args = ["--mode", mode, "--toolsets", MODE_TOOLSETS[mode]];
  if (familyFilePath && familyFilePath.trim().length > 0) {
    args.push("--family", familyFilePath.trim());
  }
  return args;
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

export const McpConfigSnippets: React.FC<McpConfigSnippetsProps> = ({
  binaryPath,
  mode,
  familyFilePath,
}) => {
  const { t } = useTranslation();
  const [copiedId, setCopiedId] = useState<ClientSnippetId | null>(null);

  const effectiveBin = binaryPath.trim() || "conlang-mcp";
  const cliArgs = useMemo(
    () => buildMcpCliArgs(mode, familyFilePath),
    [mode, familyFilePath],
  );

  const snippets = useMemo<ClientSnippetItem[]>(() => {
    const jsonPayload = JSON.stringify(
      {
        mcpServers: {
          "conlang-maker": {
            command: effectiveBin,
            args: cliArgs,
          },
        },
      },
      null,
      2,
    );

    const dshArgsJoined = cliArgs.map(shellEscapeArg).join(" ");
    const dshCmd = `dsh mcp add conlang-maker --command ${shellEscapeArg(effectiveBin)} --args "${dshArgsJoined.replace(/"/g, '\\"')}"`;

    return [
      {
        id: "dsh",
        title: t("mcp.dshTitle"),
        subtitle: "CLI",
        code: dshCmd,
      },
      {
        id: "claude",
        title: t("mcp.claudeTitle"),
        subtitle: "claude_desktop_config.json",
        code: jsonPayload,
      },
      {
        id: "cursor",
        title: t("mcp.cursorTitle"),
        subtitle: ".cursor/mcp.json",
        code: jsonPayload,
      },
    ];
  }, [effectiveBin, cliArgs, t]);

  const handleCopy = async (item: ClientSnippetItem): Promise<void> => {
    const ok = await writeTextToClipboard(item.code);
    if (ok) {
      setCopiedId(item.id);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === item.id ? null : cur));
      }, 1500);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className={`${SECTION_HEADER} flex items-center gap-2`}>
        <Terminal className="w-4 h-4" />
        {t("mcp.snippetsTitle")}
      </h3>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {snippets.map((item) => {
          const isCopied = copiedId === item.id;
          return (
            <div key={item.id} className={CARD} data-testid={`mcp-snippet-${item.id}`}>
              <div className={`${CARD_BODY} p-4 space-y-2.5`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">
                      {item.title}
                    </div>
                    <span className={`${BADGE} badge-ghost font-mono mt-0.5`}>
                      {item.subtitle}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={BTN_GHOST}
                    onClick={() => void handleCopy(item)}
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
    </div>
  );
};
