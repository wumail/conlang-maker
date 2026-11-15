/**
 * CommandPaletteResults.tsx — 命令面板结果列表（Roadmap v3 / Pillar 7）
 *
 * 从 CommandPalette 拆出：命中词条分组、动作列表、覆盖范围芯片与空态。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, BookOpen, Languages, Plus } from "lucide-react";
import type { CommandWordHit } from "../../lib/commandPalette";
import { BADGE } from "../../lib/ui";

export interface PaletteActionItem {
  id: string;
  label: string;
  kind: "language" | "route" | "create";
}

interface CommandPaletteResultsProps {
  mode: "search" | "actions" | "calc";
  body: string;
  hits: CommandWordHit[];
  actions: PaletteActionItem[];
  activeIndex: number;
  scopeLabel: string;
  onActivate: (index: number) => void;
  onHover: (index: number) => void;
}

export const CommandPaletteResults: React.FC<CommandPaletteResultsProps> = ({
  mode,
  body,
  hits,
  actions,
  activeIndex,
  scopeLabel,
  onActivate,
  onHover,
}) => {
  const { t } = useTranslation();

  return (
    <div className="max-h-[22rem] overflow-y-auto py-1">
      <div className="px-4 pb-1">
        <span className={`${BADGE} badge-ghost badge-xs`}>{scopeLabel}</span>
      </div>

      {mode === "search" && hits.length === 0 && (
        <p className="px-4 py-6 text-sm text-base-content/50">
          {body.trim() ? t("commandPalette.noResults") : t("commandPalette.searchHint")}
        </p>
      )}

      {mode === "search" &&
        hits.map((hit, index) => (
          <button
            key={`${hit.languageId}_${hit.entryId}`}
            className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
              index === activeIndex ? "bg-primary/10" : "hover:bg-base-200"
            }`}
            onMouseEnter={() => onHover(index)}
            onClick={() => onActivate(index)}
          >
            <BookOpen size={14} className="shrink-0 text-base-content/50" />
            <span className="shrink-0 font-mono font-semibold">{hit.romanized}</span>
            {hit.ipa && (
              <span className="shrink-0 truncate font-mono text-xs text-success">/{hit.ipa}/</span>
            )}
            <span className="truncate text-base-content/60">{hit.gloss}</span>
            <span className={`${BADGE} badge-ghost badge-xs ml-auto shrink-0`}>
              {hit.languageName}
            </span>
          </button>
        ))}

      {mode === "actions" &&
        actions.map((action, index) => (
          <button
            key={action.id}
            className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
              index === activeIndex ? "bg-primary/10" : "hover:bg-base-200"
            }`}
            onMouseEnter={() => onHover(index)}
            onClick={() => onActivate(index)}
          >
            {action.kind === "language" && <Languages size={14} />}
            {action.kind === "route" && <ArrowRight size={14} />}
            {action.kind === "create" && <Plus size={14} />}
            <span className="truncate">{action.label}</span>
          </button>
        ))}

      {mode === "actions" && actions.length === 0 && (
        <p className="px-4 py-6 text-sm text-base-content/50">{t("commandPalette.noResults")}</p>
      )}
    </div>
  );
};
