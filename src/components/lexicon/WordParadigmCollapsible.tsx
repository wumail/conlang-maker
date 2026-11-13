import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, PencilRuler } from "lucide-react";
import type { GrammarConfig, PhonologyConfig, WordEntry } from "../../types";
import { generateParadigm } from "../../core/engines/morphologyEngine";
import { BADGE, BTN_LINK } from "../../lib/ui";

interface WordParadigmCollapsibleProps {
  word: WordEntry;
  grammar: GrammarConfig;
  phono: PhonologyConfig;
  /** 一键跳转到语法页定制该词性的屈折规则 */
  onCustomize: () => void;
}

interface ParadigmCellView {
  key: string;
  tag: string;
  result: string;
  isOverride: boolean;
}

/** 词典详情内的折叠式屈折速览（按首个义项词性即时渲染） */
export const WordParadigmCollapsible: React.FC<WordParadigmCollapsibleProps> = ({
  word,
  grammar,
  phono,
  onCustomize,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const posId = word.senses[0]?.pos_id ?? "";

  const cells = useMemo<ParadigmCellView[]>(() => {
    if (!posId) return [];
    const withOverrides = generateParadigm(word.con_word_romanized, posId, grammar.inflection_rules, phono, {
      entryId: word.entry_id,
      grammar,
    });
    const regularOnly = generateParadigm(word.con_word_romanized, posId, grammar.inflection_rules, phono);
    const regularResults = new Map<string, string>();
    for (const cell of regularOnly) {
      regularResults.set(`${cell.tag}|${JSON.stringify(cell.dimensionValues)}`, cell.result);
    }
    return withOverrides.map((cell, index) => {
      const key = `${cell.tag}|${JSON.stringify(cell.dimensionValues)}`;
      return {
        key: `${key}|${index}`,
        tag: cell.tag,
        result: cell.result,
        isOverride: regularResults.has(key) && regularResults.get(key) !== cell.result,
      };
    });
  }, [word.entry_id, word.con_word_romanized, posId, grammar, phono]);

  const posName = grammar.parts_of_speech.find((pos) => pos.pos_id === posId)?.name || posId;

  return (
    <div className="border border-base-300 rounded-lg bg-base-200/40">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-base-content/80"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {t("lexicon.paradigm.title")}
        <span className="text-xs font-normal text-base-content/50">
          {posName} · {cells.length}
        </span>
      </button>

      {open && (
        <div className="border-t border-base-300 px-3 py-3 space-y-2">
          {!posId || cells.length === 0 ? (
            <p className="text-xs text-base-content/50">{t("lexicon.paradigm.empty")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
              {cells.map((cell) => (
                <div
                  key={cell.key}
                  className={`rounded border px-2 py-1 ${
                    cell.isOverride
                      ? "border-warning/60 bg-warning/10"
                      : "border-base-300 bg-base-100"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className={`${BADGE} badge-xs badge-ghost`}>{cell.tag || "—"}</span>
                    {cell.isOverride && (
                      <span className="text-[10px] text-warning">
                        {t("lexicon.paradigm.irregular")}
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-sm truncate" title={cell.result}>
                    {cell.result}
                  </div>
                </div>
              ))}
            </div>
          )}
          <button type="button" className={`${BTN_LINK} text-xs`} onClick={onCustomize}>
            <PencilRuler size={12} /> {t("lexicon.paradigm.customize")}
          </button>
        </div>
      )}
    </div>
  );
};
