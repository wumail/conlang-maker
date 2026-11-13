import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save, Wand2, X } from "lucide-react";
import type { GlossedLine, PartOfSpeech, WordEntry } from "../../types";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { generateIPA } from "../../utils/ipaGenerator";
import { normalizeToken } from "../../core/workflows/autoGloss";
import { ModalPortal } from "../common/ModalPortal";
import { INPUT, INPUT_MONO, SELECT, BTN_PRIMARY, BTN_GHOST, BTN_LINK } from "../../lib/ui";
import { ScriptPreview } from "../writing/ScriptText";

interface CorpusQuickLexDrawerProps {
  open: boolean;
  /** 语料原文中的表层词形（自动预填） */
  surfaceForm: string;
  /** 当前行（用于展示上下文并触发重标注） */
  line: GlossedLine | null;
  onClose: () => void;
  /** 建词成功后回调：由语料页重跑当前句 autoGloss */
  onCreated: (entry: WordEntry) => void;
}

export interface StemSuggestion {
  stem: string;
  affix: string;
  ruleLabel: string;
}

/** 从表面词形反推可能的词干：剥离已知屈折后缀 */
export function suggestStems(
  surface: string,
  rules: { affix: string; tag: string; type: string; disabled?: boolean }[],
): StemSuggestion[] {
  const normalized = surface.trim();
  if (!normalized) return [];
  const suggestions: StemSuggestion[] = [];
  for (const rule of rules) {
    if (rule.disabled || rule.type !== "suffix" || !rule.affix) continue;
    if (!normalized.toLowerCase().endsWith(rule.affix.toLowerCase())) continue;
    if (normalized.length <= rule.affix.length) continue;
    suggestions.push({
      stem: normalized.slice(0, normalized.length - rule.affix.length),
      affix: rule.affix,
      ruleLabel: rule.tag || rule.affix,
    });
  }
  return suggestions.slice(0, 3);
}

/** 语料三行标注旁的「侧边快建词条」抽屉（经 ModalPortal 挂载） */
export const CorpusQuickLexDrawer: React.FC<CorpusQuickLexDrawerProps> = ({
  open,
  surfaceForm,
  line,
  onClose,
  onCreated,
}) => {
  const { t } = useTranslation();
  const wordsList = useLexiconStore((s) => s.wordsList);
  const upsertWord = useLexiconStore((s) => s.upsertWord);
  const partsOfSpeech = useGrammarStore((s) => s.config.parts_of_speech);
  const inflectionRules = useGrammarStore((s) => s.config.inflection_rules);
  const phonoConfig = usePhonoStore((s) => s.config);

  const [lemma, setLemma] = useState(normalizeToken(surfaceForm) || surfaceForm);
  const [posId, setPosId] = useState(partsOfSpeech[0]?.pos_id ?? "");
  const [gloss, setGloss] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(
    () => suggestStems(surfaceForm || lemma, inflectionRules),
    [surfaceForm, lemma, inflectionRules],
  );

  const duplicate = useMemo(() => {
    const needle = lemma.trim().toLowerCase();
    if (!needle) return null;
    return wordsList.find((word) => word.con_word_romanized.trim().toLowerCase() === needle) ?? null;
  }, [wordsList, lemma]);

  const handleSave = () => {
    const romanized = lemma.trim();
    if (!romanized) {
      setError(t("corpus.quickLex.lemmaRequired"));
      return;
    }
    if (!gloss.trim()) {
      setError(t("corpus.quickLex.glossRequired"));
      return;
    }

    const now = new Date().toISOString();
    const { phonemic } = generateIPA(romanized, phonoConfig);
    const entry: WordEntry = {
      entry_id: crypto.randomUUID(),
      language_id: useWorkspaceStore.getState().activeLanguageId || "",
      con_word_romanized: romanized,
      phonetic_ipa: phonemic.replace(/^\/|\/$/g, ""),
      phonetic_override: false,
      senses: [
        {
          sense_id: crypto.randomUUID(),
          pos_id: posId,
          gloss: gloss.trim(),
          definitions: [],
          examples: [],
        },
      ],
      etymology: {
        origin_type: "a_priori",
        parent_entry_id: null,
        source_language_id: null,
        applied_sound_changes: [],
        semantic_shift_note: "",
      },
      metadata: {
        tags: tagsInput
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        created_at: now,
        updated_at: now,
      },
      evolution: { is_deprecated: false, deprecated_since_language_id: null },
    };

    upsertWord(entry);
    onCreated(entry);
    onClose();
  };

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open">
        <div className="modal-box absolute right-0 top-0 h-full max-h-full w-[26rem] max-w-full rounded-none rounded-l-xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-bold text-lg">{t("corpus.quickLex.title")}</h3>
              <p className="text-xs text-base-content/60">{t("corpus.quickLex.hint")}</p>
            </div>
            <button className={BTN_GHOST} onClick={onClose} title={t("common.close")}>
              <X size={16} />
            </button>
          </div>

          {line && (
            <div className="mt-3 rounded border border-base-300 bg-base-200/50 px-2 py-1.5 text-xs">
              <div className="text-base-content/50">{t("corpus.quickLex.context")}</div>
              <div className="font-mono truncate">{line.original}</div>
            </div>
          )}

          <div className="mt-4 space-y-3">
            <div>
              <label className="block text-xs text-base-content/60 mb-1">
                {t("corpus.quickLex.lemma")}
              </label>
              <input
                className={`${INPUT_MONO} w-full`}
                value={lemma}
                onChange={(event) => {
                  setLemma(event.target.value);
                  setError(null);
                }}
              />
              <ScriptPreview text={lemma} className="text-lg mt-1" />
            </div>

            {suggestions.length > 0 && (
              <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 space-y-1">
                <div className="flex items-center gap-1 text-xs text-base-content/70">
                  <Wand2 size={12} /> {t("corpus.quickLex.stemSuggestion")}
                </div>
                <div className="flex flex-wrap gap-1">
                  {suggestions.map((suggestion) => (
                    <button
                      key={`${suggestion.stem}_${suggestion.affix}`}
                      className={`${BTN_LINK} text-xs font-mono`}
                      onClick={() => setLemma(suggestion.stem)}
                      title={t("corpus.quickLex.stemHint", { affix: suggestion.affix })}
                    >
                      {suggestion.stem} (−{suggestion.ruleLabel})
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs text-base-content/60 mb-1">
                {t("lexicon.pos")}
              </label>
              <select
                className={`${SELECT} w-full`}
                value={posId}
                onChange={(event) => setPosId(event.target.value)}
              >
                {partsOfSpeech.map((pos: PartOfSpeech) => (
                  <option key={pos.pos_id} value={pos.pos_id}>
                    {pos.name || pos.pos_id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-base-content/60 mb-1">
                {t("lexicon.gloss")}
              </label>
              <input
                className={`${INPUT} w-full`}
                value={gloss}
                placeholder={t("corpus.quickLex.glossPlaceholder")}
                onChange={(event) => {
                  setGloss(event.target.value);
                  setError(null);
                }}
              />
            </div>

            <div>
              <label className="block text-xs text-base-content/60 mb-1">
                {t("lexicon.tags")}
              </label>
              <input
                className={`${INPUT} w-full`}
                value={tagsInput}
                placeholder={t("corpus.quickLex.tagsPlaceholder")}
                onChange={(event) => setTagsInput(event.target.value)}
              />
            </div>

            {duplicate && (
              <p className="text-xs text-warning">
                {t("corpus.quickLex.duplicateHint", { word: duplicate.con_word_romanized })}
              </p>
            )}
            {error && <p className="text-xs text-error">{error}</p>}
          </div>

          <div className="modal-action">
            <button className={BTN_PRIMARY} onClick={handleSave}>
              <Save size={14} /> {t("corpus.quickLex.save")}
            </button>
            <button className={BTN_GHOST} onClick={onClose}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
