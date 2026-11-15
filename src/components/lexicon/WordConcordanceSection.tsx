import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { CorpusText, GrammarConfig, PhonologyConfig, WordEntry } from "../../types";
import { findWordConcordance } from "../../core/engines/concordance";
import { useCorpusStore } from "../../store/corpusStore";
import { SELECT } from "../../lib/ui";

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
  const [senseId, setSenseId] = useState("");

  useEffect(() => {
    // 注意：不能把 `loading` 放进依赖。setLoading(true) 会触发重跑并清理上一次 effect，
    // 令 cancelled 提前变 true，Promise 完成后既不写入 texts 也不关闭 loading（永远加载中）。
    if (!open || texts !== null || corpusCount === 0) return;
    let alive = true;
    setLoading(true);
    void loadAllCorpusTexts()
      .then((loaded) => {
        if (!alive) return;
        setTexts(loaded);
        setLoading(false);
      })
      .catch((error: unknown) => {
        // 读取失败时落空数组，避免 effect 反复重试
        console.warn(`加载语料失败：${String(error)}`);
        if (!alive) return;
        setTexts([]);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, texts, corpusCount, loadAllCorpusTexts]);

  const result = useMemo(() => {
    if (!texts) return { matches: [], total: 0 };
    return findWordConcordance({
      entry: word,
      corpusTexts: texts,
      grammar,
      phono,
      senseId: senseId || undefined,
    });
  }, [texts, word, grammar, phono, senseId]);

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
          {word.senses.length > 1 && (
            <select
              className={`${SELECT} select-xs w-full text-xs`}
              value={senseId}
              onChange={(event) => setSenseId(event.target.value)}
            >
              <option value="">{t("corpus.v3.senseFilterAll")}</option>
              {word.senses.map((sense) => (
                <option key={sense.sense_id} value={sense.sense_id}>
                  {sense.gloss || sense.sense_id}
                </option>
              ))}
            </select>
          )}
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
