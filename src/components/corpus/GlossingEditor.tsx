import { useTranslation } from "react-i18next";
import { Plus, Wand2 } from "lucide-react";
import { useCorpusStore } from "../../store/corpusStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { GlossedLine, GlossToken } from "../../types";
import { GlossLineRow } from "./GlossLineRow";
import { generateIPA } from "../../utils/ipaGenerator";
import { BTN_PRIMARY, BTN_GHOST, CARD, CARD_BODY } from "../../lib/ui";

export function GlossingEditor() {
  const { t } = useTranslation();
  const corpus = useCorpusStore((s) => s.activeCorpus);
  const addGlossedLine = useCorpusStore((s) => s.addGlossedLine);
  const upsertCorpus = useCorpusStore((s) => s.upsertCorpus);
  const wordsList = useLexiconStore((s) => s.wordsList);
  const phonoConfig = usePhonoStore((s) => s.config);

  if (!corpus) return null;

  const handleAddLine = () => {
    const line: GlossedLine = {
      line_id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      original: "",
      tokens: [],
      translation: "",
    };
    addGlossedLine(line);
  };

  /** 自动标注：将原始文本按空格分割为 token，并从词典中查找匹配 */
  const handleAutoGloss = () => {
    if (!corpus.original_text.trim()) return;

    const sentences = corpus.original_text
      .split(/[.!?。！？]+/)
      .filter((s) => s.trim());
    const wordsMap = new Map(
      wordsList.map((w) => [w.con_word_romanized.toLowerCase(), w]),
    );

    const newLines: GlossedLine[] = sentences.map((sentence, idx) => {
      const words = sentence.trim().split(/\s+/).filter(Boolean);
      const tokens: GlossToken[] = words.map((word) => {
        const clean = word.toLowerCase().replace(/[,;:]/g, "");
        const entry = wordsMap.get(clean);
        const ipa = entry
          ? entry.phonetic_override
            ? entry.phonetic_ipa
            : generateIPA(entry.con_word_romanized, phonoConfig).phonemic
          : "";
        return {
          token_id: `tok_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          surface_form: word,
          morpheme_break: word,
          gloss_labels: entry?.senses[0]?.gloss || "",
          linked_entry_id: entry?.entry_id || "",
          ipa,
        };
      });
      return {
        line_id: `line_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 4)}`,
        original: sentence.trim(),
        tokens,
        translation: "",
      };
    });

    upsertCorpus({
      ...corpus,
      glossed_lines: newLines,
      metadata: { ...corpus.metadata, updated_at: new Date().toISOString() },
    });
  };

  return (
    <div className={CARD}>
      <div className={`${CARD_BODY} p-4 space-y-4`}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{t("corpus.glossing")}</h3>
          <div className="flex gap-2">
            <button className={BTN_PRIMARY} onClick={handleAutoGloss}>
              <Wand2 className="w-4 h-4" /> {t("corpus.autoGloss")}
            </button>
            <button className={BTN_GHOST} onClick={handleAddLine}>
              <Plus className="w-4 h-4" /> {t("corpus.addLine")}
            </button>
          </div>
        </div>

        {corpus.glossed_lines.length === 0 && (
          <p className="text-base-content/50 text-sm">{t("corpus.noTexts")}</p>
        )}

        {corpus.glossed_lines.map((line) => (
          <GlossLineRow key={line.line_id} line={line} />
        ))}
      </div>
    </div>
  );
}
