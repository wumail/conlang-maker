import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save, X } from "lucide-react";
import type { GlossedLine, GlossToken, Sense, WordEntry } from "../../types";
import { useCorpusStore } from "../../store/corpusStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { normalizeToken } from "../../core/workflows/autoGloss";
import { pushCompositeUndoEntry } from "../../store/undoManager";
import { ModalPortal } from "../common/ModalPortal";
import { BTN_PRIMARY, BTN_GHOST, CHECKBOX } from "../../lib/ui";
import { QuickLexExistingPicker } from "./QuickLexExistingPicker";
import { QuickLexEntryForm, buildQuickLexEntry } from "./QuickLexEntryForm";

type QuickLexMode = "link" | "new_sense" | "new_entry";

interface CorpusQuickLexDrawerProps {
  open: boolean;
  surfaceForm: string;
  line: GlossedLine | null;
  /** 当前语料 token（用于绑定与组合撤销） */
  token?: GlossToken | null;
  onClose: () => void;
  onCreated: (entry: WordEntry) => void;
  /** 绑定 token 到词条义项（由语料行回写） */
  onBindToken?: (entryId: string, senseId: string) => void;
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

/** 语料三行标注旁的「收词」抽屉：关联已有义项 / 同形词加义项 / 新建词条 */
export const CorpusQuickLexDrawer: React.FC<CorpusQuickLexDrawerProps> = ({
  open,
  surfaceForm,
  line,
  token = null,
  onClose,
  onCreated,
  onBindToken,
}) => {
  const { t } = useTranslation();
  const wordsList = useLexiconStore((s) => s.wordsList);
  const importWords = useLexiconStore((s) => s.importWords);
  const languagePath = useLexiconStore((s) => s.languagePath);
  const partsOfSpeech = useGrammarStore((s) => s.config.parts_of_speech);
  const inflectionRules = useGrammarStore((s) => s.config.inflection_rules);
  const phonoConfig = usePhonoStore((s) => s.config);

  const [mode, setMode] = useState<QuickLexMode>("link");
  const [lemma, setLemma] = useState(normalizeToken(surfaceForm) || surfaceForm);
  const [posId, setPosId] = useState(partsOfSpeech[0]?.pos_id ?? "");
  const [gloss, setGloss] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [addExample, setAddExample] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(
    () => suggestStems(surfaceForm || lemma, inflectionRules),
    [surfaceForm, lemma, inflectionRules],
  );
  const homographs = useMemo(
    () =>
      wordsList.filter(
        (word) =>
          lemma.trim().length > 0 &&
          word.con_word_romanized.trim().toLowerCase() === lemma.trim().toLowerCase(),
      ),
    [wordsList, lemma],
  );

  const exampleText = line
    ? `${line.original}${line.translation ? ` — ${line.translation}` : ""}`
    : "";

  /** 组合撤销：一次 ⌘Z 同时回滚词典词条与整行语料 token 状态（含同句自动重算） */
  const commit = (original: WordEntry | null, updated: WordEntry, entryId: string, senseId: string) => {
    const lineId = line?.line_id;
    const readLiveLine = () =>
      lineId
        ? structuredClone(
            useCorpusStore.getState().activeCorpus?.glossed_lines.find((l) => l.line_id === lineId) ?? null,
          )
        : null;
    const beforeLine = readLiveLine();
    const prevEntry = token?.linked_entry_id ?? "";
    const prevSense = token?.linked_sense_id ?? "";
    importWords([updated]);
    onBindToken?.(entryId, senseId);
    onCreated(updated);
    const afterLine = readLiveLine();
    pushCompositeUndoEntry({
      languageId: languagePath,
      labelKey: "corpus.quickLex.title",
      steps: [
        {
          undo: () =>
            original
              ? useLexiconStore.getState().importWords([original])
              : useLexiconStore.getState().deleteWord(updated.entry_id, { skipHistory: true }),
          redo: () => useLexiconStore.getState().importWords([updated]),
        },
        {
          undo: () =>
            lineId && beforeLine
              ? useCorpusStore.getState().updateGlossedLine(lineId, structuredClone(beforeLine), { skipHistory: true })
              : onBindToken?.(prevEntry, prevSense),
          redo: () =>
            lineId && afterLine
              ? useCorpusStore.getState().updateGlossedLine(lineId, structuredClone(afterLine), { skipHistory: true })
              : onBindToken?.(entryId, senseId),
        },
      ],
    });
  };

  const withExample = (sense: Sense): Sense => {
    if (!addExample || !exampleText) return sense;
    if ((sense.examples ?? []).includes(exampleText)) return sense;
    return { ...sense, examples: [...(sense.examples ?? []), exampleText] };
  };

  const linkExisting = (word: WordEntry, senseId: string) => {
    const sense = word.senses.find((item) => item.sense_id === senseId);
    if (!sense) return;
    const updated: WordEntry = {
      ...word,
      senses: word.senses.map((item) => (item.sense_id === senseId ? withExample(item) : item)),
    };
    commit(word, updated, word.entry_id, senseId);
    onClose();
  };

  const addSenseToHomograph = (word: WordEntry) => {
    if (!gloss.trim()) return setError(t("corpus.quickLex.glossRequired"));
    const sense: Sense = withExample({
      sense_id: crypto.randomUUID(),
      pos_id: posId,
      gloss: gloss.trim(),
      definitions: [],
      examples: [],
    });
    const updated: WordEntry = { ...word, senses: [...word.senses, sense] };
    commit(word, updated, word.entry_id, sense.sense_id);
    onClose();
  };

  const handleCreate = () => {
    const romanized = lemma.trim();
    if (!romanized) return setError(t("corpus.quickLex.lemmaRequired"));
    if (!gloss.trim()) return setError(t("corpus.quickLex.glossRequired"));
    const sense = withExample({
      sense_id: crypto.randomUUID(),
      pos_id: posId,
      gloss: gloss.trim(),
      definitions: [],
      examples: [],
    });
    const entry = buildQuickLexEntry({
      lemma: romanized,
      tags: tagsInput.split(",").map((tag) => tag.trim()).filter(Boolean),
      sense,
      languageId: useWorkspaceStore.getState().activeLanguageId || "",
      phono: phonoConfig,
    });
    commit(null, entry, entry.entry_id, sense.sense_id);
    onClose();
  };

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open">
        <div className="modal-box absolute right-0 top-0 h-full max-h-full w-[26rem] max-w-full rounded-none rounded-l-xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-lg font-bold">{t("corpus.quickLex.title")}</h3>
              <p className="text-xs text-base-content/60">{t("corpus.quickLex.hint")}</p>
            </div>
            <button className={BTN_GHOST} onClick={onClose} title={t("common.close")}>
              <X size={16} />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            {(["link", "new_sense", "new_entry"] as QuickLexMode[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`btn btn-xs ${mode === item ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setMode(item)}
              >
                {item === "link"
                  ? t("corpus.quickLex.modeLink")
                  : item === "new_sense"
                    ? t("corpus.quickLex.modeNewSense")
                    : t("corpus.quickLex.modeNewEntry")}
              </button>
            ))}
          </div>

          {line && (
            <div className="mt-3 rounded border border-base-300 bg-base-200/50 px-2 py-1.5 text-xs">
              <div className="text-base-content/50">{t("corpus.quickLex.context")}</div>
              <div className="truncate font-mono">{line.original}</div>
            </div>
          )}

          <label className="mt-3 flex cursor-pointer items-center gap-1.5 text-xs text-base-content/70">
            <input
              type="checkbox"
              className={CHECKBOX}
              checked={addExample}
              onChange={(event) => setAddExample(event.target.checked)}
            />
            {t("corpus.quickLex.addExample")}
          </label>

          {mode === "link" && (
            <div className="mt-3">
              <QuickLexExistingPicker words={wordsList} onPick={linkExisting} />
            </div>
          )}

          {mode !== "link" && (
            <QuickLexEntryForm
              mode={mode === "new_sense" ? "new_sense" : "new_entry"}
              lemma={lemma}
              onLemmaChange={(value) => {
                setLemma(value);
                setError(null);
              }}
              suggestions={suggestions}
              onPickStem={setLemma}
              partsOfSpeech={partsOfSpeech}
              posId={posId}
              onPosChange={setPosId}
              gloss={gloss}
              onGlossChange={(value) => {
                setGloss(value);
                setError(null);
              }}
              tagsInput={tagsInput}
              onTagsChange={setTagsInput}
              homographs={homographs}
              onAddSenseTo={addSenseToHomograph}
            />
          )}

          {error && <p className="mt-2 text-xs text-error">{error}</p>}

          <div className="modal-action">
            {mode === "new_entry" && (
              <button className={BTN_PRIMARY} onClick={handleCreate}>
                <Save size={14} /> {t("corpus.quickLex.save")}
              </button>
            )}
            <button className={BTN_GHOST} onClick={onClose}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
