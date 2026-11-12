import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { WordEntry } from "../../types";
import type { WordLifecycleFlags } from "../../utils/wordLifecycle";
import { BADGE } from "../../lib/ui";
import { ScriptLine } from "../writing/ScriptText";

interface LexiconVirtualListProps {
  entries: WordEntry[];
  lifecycleMap: Record<string, WordLifecycleFlags>;
  activeWordId: string | null;
  batchMode: boolean;
  selectedIds: Set<string>;
  ipaMode: boolean;
  onSelectWord: (entryId: string) => void;
  onToggleSelection: (entryId: string) => void;
  emptyHint: string;
}

/**
 * 动态高度虚拟列表（@tanstack/react-virtual）。
 *
 * 严格遵循 EXECUTION_PLAN §7.2-A：测量节点只写 position/top/left/width/transform，
 * 严禁写死 height 或 margin（行间距一律由内层 `pb-1.5` 提供），保证万词滚动不跳动。
 */
export const LexiconVirtualList: React.FC<LexiconVirtualListProps> = ({
  entries,
  lifecycleMap,
  activeWordId,
  batchMode,
  selectedIds,
  ipaMode,
  onSelectWord,
  onToggleSelection,
  emptyHint,
}) => {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 68,
    overscan: 8,
  });

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-sm text-base-content/50 text-center">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto contain-strict px-2">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const word = entries[virtualRow.index];
          if (!word) return null;
          const lifecycle = lifecycleMap[word.entry_id];
          const isSelected = selectedIds.has(word.entry_id);
          const isActive =
            activeWordId === word.entry_id && (!batchMode || selectedIds.size === 0);

          return (
            <div
              key={word.entry_id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="pb-1.5">
                <div
                  onClick={() => {
                    if (batchMode) onToggleSelection(word.entry_id);
                    else onSelectWord(word.entry_id);
                  }}
                  className={`p-3 border-b border-base-200 rounded cursor-pointer flex gap-3 ${
                    batchMode ? "hover:bg-base-200" : "hover:bg-info/10"
                  } ${isActive ? "bg-primary/15" : ""} ${
                    isSelected && batchMode ? "bg-primary/5" : ""
                  }`}
                >
                  {batchMode && (
                    <div className="pt-1">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm checkbox-primary"
                        checked={isSelected}
                        readOnly
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-base-content truncate min-w-0">
                        {word.con_word_romanized}
                      </div>
                      {lifecycle &&
                        (lifecycle.isNew ||
                          lifecycle.isDeprecated ||
                          lifecycle.isChanged) && (
                          <div className="flex items-center gap-1 shrink-0 whitespace-nowrap">
                            {lifecycle.isNew && (
                              <span className={`${BADGE} badge-success`}>
                                {t("lexicon.lifecycle.added")}
                              </span>
                            )}
                            {lifecycle.isDeprecated && (
                              <span className={`${BADGE} badge-error`}>
                                {t("lexicon.lifecycle.deprecated")}
                              </span>
                            )}
                            {lifecycle.isChanged && (
                              <span className={`${BADGE} badge-warning`}>
                                {t("lexicon.lifecycle.changed")}
                              </span>
                            )}
                          </div>
                        )}
                    </div>
                    <ScriptLine
                      text={word.con_word_romanized}
                      entryId={word.entry_id}
                      className="block text-lg leading-tight truncate"
                    />
                    {ipaMode && word.phonetic_ipa && (
                      <div className="text-xs font-mono text-primary truncate">
                        /{word.phonetic_ipa}/
                      </div>
                    )}
                    {word.metadata?.tags && word.metadata.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 mb-2">
                        {word.metadata.tags.slice(0, 4).map((tag) => (
                          <span key={`${word.entry_id}-${tag}`} className="badge badge-ghost badge-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-xs text-base-content/60 truncate">
                      {word.senses.map((sense) => sense.gloss).join("; ")}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
