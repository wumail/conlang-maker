import { useEffect, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { useCorpusStore } from "../../store/corpusStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { GlossedLine, GlossToken } from "../../types";
import { GlossTokenEdit } from "./GlossTokenEdit";
import { WordPopover } from "./WordPopover";
import { INPUT, BTN_ERROR } from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { ScriptText } from "../writing/ScriptText";

interface GlossLineRowProps {
  line: GlossedLine;
  /** 由语料页重跑当前句 autoGloss */
  onLexEntryCreated?: () => void;
  /** 从词条跳转过来时高亮并滚动定位 */
  highlight?: boolean;
}

export function GlossLineRow({ line, onLexEntryCreated, highlight = false }: GlossLineRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (highlight) rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight]);
  const { t } = useTranslation();
  const updateGlossedLine = useCorpusStore((s) => s.updateGlossedLine);
  const deleteGlossedLine = useCorpusStore((s) => s.deleteGlossedLine);
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [hoverTokenId, setHoverTokenId] = useState<string | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const wordsList = useLexiconStore((s) => s.wordsList);
  const wordsMap = useMemo(
    () => new Map(wordsList.map((w) => [w.entry_id, w])),
    [wordsList],
  );

  const updateToken = (tokenId: string, token: GlossToken) => {
    const updated: GlossedLine = {
      ...line,
      tokens: line.tokens.map((t) => (t.token_id === tokenId ? token : t)),
    };
    updateGlossedLine(line.line_id, updated);
  };

  const addToken = () => {
    const token: GlossToken = {
      token_id: `tok_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      surface_form: "",
      morpheme_break: "",
      gloss_labels: "",
      linked_entry_id: "",
      ipa: "",
    };
    updateGlossedLine(line.line_id, {
      ...line,
      tokens: [...line.tokens, token],
    });
  };

  const deleteToken = (tokenId: string) => {
    updateGlossedLine(line.line_id, {
      ...line,
      tokens: line.tokens.filter((t) => t.token_id !== tokenId),
    });
  };

  return (
    <div
      ref={rowRef}
      className={`rounded-lg border p-3 space-y-2 ${
        highlight ? "border-primary ring-2 ring-primary/30" : "border-base-200"
      }`}
    >
      {/* Interlinear display: 4-row aligned grid */}
      <div className="overflow-x-auto">
        <div className="inline-flex gap-4 min-w-0">
          {/* Row labels */}
          <div className="flex flex-col items-end shrink-0 text-xs text-base-content/40 gap-[1px]">
            <span className="h-5 flex items-center">
              {t("corpus.surfaceForm")}
            </span>
            <span className="h-4 flex items-center">
              {t("corpus.morphemeBreak")}
            </span>
            <span className="h-4 flex items-center">
              {t("corpus.glossLabels")}
            </span>
            <span className="h-4 flex items-center">IPA</span>
          </div>
          {line.tokens.map((token) => (
            <div
              key={token.token_id}
              className="relative flex flex-col items-start cursor-pointer hover:bg-info/10 rounded px-1"
              onClick={() => setEditingTokenId(token.token_id)}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                // 词卡宽 264：优先放右侧；右侧空间不足则翻到左侧，避免遮住后一个词
                const width = 264;
                const gap = 8;
                const margin = 8;
                const fitsRight = rect.right + gap + width <= window.innerWidth - margin;
                const x = fitsRight
                  ? rect.right + gap
                  : Math.max(margin, rect.left - width - gap);
                const y = Math.min(
                  Math.max(margin, rect.top),
                  window.innerHeight - 200,
                );
                setHoverPosition({ x, y });
                setHoverTokenId(token.token_id);
              }}
              onMouseLeave={() => setHoverTokenId(null)}
            >
              {(token.status || (token.linked_entry_id && !wordsMap.has(token.linked_entry_id))) && (
                <span className="absolute -top-0.5 right-0 flex items-center gap-0.5">
                  {token.status && (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        token.status === "verified"
                          ? "bg-success"
                          : token.status === "edited"
                            ? "bg-warning"
                            : "bg-info"
                      }`}
                      title={token.status}
                    />
                  )}
                  {token.linked_entry_id && !wordsMap.has(token.linked_entry_id) && (
                    <span className="text-[9px] text-error" title={t("lexicon.family.missing")}>
                      !
                    </span>
                  )}
                </span>
              )}
              {/* Row 1: Surface form */}
              <ScriptText
                text={token.surface_form || "—"}
                className="h-5 flex items-center font-semibold text-sm"
              />
              {/* Row 2: Morpheme break */}
              <span className="h-4 flex items-center text-xs text-base-content/70 font-mono">
                {token.morpheme_break || "—"}
              </span>
              {/* Row 3: Gloss labels */}
              <span className="h-4 flex items-center text-xs text-primary">
                {token.gloss_labels || "—"}
              </span>
              {/* Row 4: IPA */}
              <span className="h-4 flex items-center text-xs text-base-content/50 font-mono">
                {token.ipa ? `${token.ipa}` : ""}
              </span>

              {/* Word popover on hover */}
              {hoverTokenId === token.token_id &&
                token.linked_entry_id &&
                wordsMap.get(token.linked_entry_id) && (
                  <WordPopover
                    entry={wordsMap.get(token.linked_entry_id)!}
                    position={hoverPosition}
                  />
                )}
            </div>
          ))}
          <button
            className="text-xs text-base-content/50 hover:text-primary self-center"
            onClick={(e) => {
              e.stopPropagation();
              addToken();
            }}
            title={t("corpus.addToken")}
          >
            +
          </button>
        </div>
      </div>

      {/* Translation line */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-base-content/50 shrink-0">
          {t("corpus.freeTranslation")}:
        </span>
        <input
          className={`${INPUT} flex-1 text-sm`}
          value={line.translation}
          onChange={(e) =>
            updateGlossedLine(line.line_id, {
              ...line,
              translation: e.target.value,
            })
          }
        />
        <button
          className={BTN_ERROR}
          onClick={() => setShowDeleteConfirm(true)}
          title={t("corpus.deleteLine")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Token edit modal */}
      {editingTokenId && (
        <GlossTokenEdit
          token={line.tokens.find((t) => t.token_id === editingTokenId)!}
          line={line}
          onLexEntryCreated={onLexEntryCreated}
          onSave={(token) => {
            updateToken(editingTokenId, token);
            setEditingTokenId(null);
          }}
          onDelete={() => {
            deleteToken(editingTokenId);
            setEditingTokenId(null);
          }}
          onClose={() => setEditingTokenId(null)}
        />
      )}

      <ConfirmModal
        open={showDeleteConfirm}
        title={t("corpus.deleteLine")}
        message={t("corpus.deleteLineConfirm")}
        onConfirm={() => {
          deleteGlossedLine(line.line_id);
          setShowDeleteConfirm(false);
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
