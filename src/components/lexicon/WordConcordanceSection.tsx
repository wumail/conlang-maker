import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { CorpusText, GrammarConfig, PhonologyConfig, WordEntry } from "../../types";
import { findWordConcordance } from "../../core/engines/concordance";
import { useCorpusStore } from "../../store/corpusStore";

interface WordConcordanceSectionProps {
  word: WordEntry;
  grammar: GrammarConfig;
  phono: PhonologyConfig;
  /** 点击某句出处时跳转到语料页并激活对应语料 */
  onNavigate: (corpusId: string, lineId: string) => void;
}

/** 词典详情内的语料反向索引（折叠面板，展开时才读取全部语料正文） */
export const WordConcordanceSection: React.FC<WordConcordanceSectionProps> = ({
  word,
  grammar,
  phono,
  onNavigate,
}) => {
  const { t } = useTranslation();
  const loadAllCorpusTexts = useCorpusStore((s) => s.loadAllCorpusTexts);
  const corpusCount = useCorpusStore((s) => s.index.length);
  const [open, setOpen] = useState(false);
  const [texts, setTexts] = useState<CorpusText[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || texts || loading || corpusCount === 0) return;
    setLoading(true);
    let cancelled = false;
    void loadAllCorpusTexts()
      .then((loaded) => {
        if (!cancelled) setTexts(loaded);
      })
      .catch((error: unknown) => {
        // 读取失败时落空数组，避免 effect 反复重试
        console.warn(`加载语料失败：${String(error)}`);
        if (!cancelled) setTexts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, texts, loading, corpusCount, loadAllCorpusTexts]);

  const result = useMemo(() => {
    if (!texts) return { matches: [], total: 0 };
    return findWordConcordance({ entry: word, corpusTexts: texts, grammar, phono });
  }, [texts, word, grammar, phono]);

  return (
    <div className="border border-base-300 rounded-lg bg-base-200/40">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-base-content/80"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {t("lexicon.concordance.title")}
        <span className="text-xs font-normal text-base-content/50">
          {texts ? t("lexicon.concordance.count", { count: result.total }) : `· ${corpusCount}`}
        </span>
      </button>

      {open && (
        <div className="border-t border-base-300 px-3 py-3 space-y-2">
          {loading && (
            <p className="text-xs text-base-content/50">{t("common.loading")}</p>
          )}
          {!loading && corpusCount === 0 && (
            <p className="text-xs text-base-content/50">{t("lexicon.concordance.noCorpus")}</p>
          )}
          {!loading && corpusCount > 0 && result.total === 0 && (
            <p className="text-xs text-base-content/50">{t("lexicon.concordance.empty")}</p>
          )}

          {result.matches.length > 0 && (
            <ul className="space-y-1.5 max-h-72 overflow-y-auto">
              {result.matches.map((hit, index) => (
                <li key={`${hit.textId}_${hit.lineId}_${index}`}>
                  <button
                    type="button"
                    onClick={() => onNavigate(hit.textId, hit.lineId)}
                    className="w-full rounded border border-base-300 bg-base-100 px-2 py-1.5 text-left hover:border-primary/60"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-base-content/50">
                      <span className="truncate">{hit.title}</span>
                      <span className="inline-flex items-center gap-1 shrink-0">
                        <span className="font-mono text-primary">{hit.matchedTokenSurface}</span>
                        <ExternalLink size={11} />
                      </span>
                    </div>
                    <div className="font-mono text-sm truncate">{hit.originalLine}</div>
                    {hit.freeTranslation && (
                      <div className="text-xs text-base-content/60 truncate">
                        {hit.freeTranslation}
                      </div>
                    )}
                    {hit.gloss && (
                      <div className="text-[11px] text-base-content/50 truncate">{hit.gloss}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {result.total > result.matches.length && (
            <p className="text-[11px] text-base-content/50">
              {t("lexicon.concordance.truncated", {
                shown: result.matches.length,
                total: result.total,
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
