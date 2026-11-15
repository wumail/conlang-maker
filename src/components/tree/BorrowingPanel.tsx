import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookCopy } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { generateOperationId, recordGuiOperationId } from "../../store/conflictStore";
import { INPUT, BTN_PRIMARY, CHECKBOX, SELECT } from "../../lib/ui";
import type { OperationLog, WordEntry } from "../../types";
import { ConfirmModal } from "../common/ConfirmModal";
import {
  CrossProjectSourceSelector,
  type LoadedSourceContext,
} from "./CrossProjectSourceSelector";

export function BorrowingPanel() {
  const { t } = useTranslation();
  const { config: wsConfig, activeLanguageId, projectPath, conlangFilePath } =
    useWorkspaceStore();
  const { importWords } = useLexiconStore();
  const lexiconWords = useLexiconStore((s) => s.wordsList);
  const [source, setSource] = useState<LoadedSourceContext | null>(null);
  const [search, setSearch] = useState("");
  /** entryId → 借入义项 senseId（精确到义项） */
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const currentProjectLabel =
    wsConfig.languages.find((language) => language.language_id === activeLanguageId)?.name ??
    "";
  const excludedLanguageIds = useMemo(() => [activeLanguageId], [activeLanguageId]);
  const handleSourceLoaded = useCallback((context: LoadedSourceContext | null) => {
    setSource(context);
    setSelected(new Map());
  }, []);

  const filteredWords = useMemo(() => {
    if (!source) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return source.words;
    return source.words.filter(
      (word) =>
        word.con_word_romanized.toLowerCase().includes(needle) ||
        word.senses.some((sense) => sense.gloss.toLowerCase().includes(needle)),
    );
  }, [source, search]);

  /** 借词识别以 borrowed_source 快照为准（v3 parent_entry_id 恒为 null）；
   *  同一 language_id 可能出现在多个项目（如都叫 lang_proto），因此还要比对快照里的供语项目路径。 */
  const isAlreadyBorrowed = (word: WordEntry): boolean =>
    lexiconWords.some((local) => {
      const etymology = local.etymology;
      if (etymology?.origin_type !== "borrowed") return false;
      const snapshot = etymology.borrowed_source;
      const entryMatches =
        (snapshot?.source_entry_id ?? etymology.parent_entry_id) === word.entry_id;
      const languageMatches =
        (snapshot?.source_language_id ?? etymology.source_language_id) ===
        (source?.language.language_id ?? "");
      // 旧数据可能没有 source_conlang_path，此时不做项目维度约束
      const projectMatches =
        !snapshot?.source_conlang_path ||
        snapshot.source_conlang_path === source?.conlangFilePath;
      return entryMatches && languageMatches && projectMatches;
    });

  const toggleSelect = (word: WordEntry): void => {
    if (isAlreadyBorrowed(word)) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(word.entry_id)) next.delete(word.entry_id);
      else next.set(word.entry_id, word.senses[0]?.sense_id ?? "");
      return next;
    });
  };

  const setSense = (entryId: string, senseId: string): void => {
    setSelected((prev) => new Map(prev).set(entryId, senseId));
  };

  const confirmBorrow = async (): Promise<void> => {
    if (!source || selected.size === 0) return;
    try {
      const activeLang = wsConfig.languages.find((l) => l.language_id === activeLanguageId);
      if (activeLang) {
        const opId = generateOperationId();
        recordGuiOperationId(opId);
        await invoke<OperationLog>("create_snapshot", {
          projectPath,
          languagePath: activeLang.path,
          operationType: "borrowing",
          sourceLanguageId: source.language.language_id,
          targetLanguageId: activeLanguageId,
          description: `Borrowed ${selected.size} words`,
          scope: "lexicon",
          origin: "gui",
          operationId: opId,
        });
      }
    } catch (err) {
      console.warn(`Snapshot failed (non-fatal): ${err}`);
    }

    const now = new Date().toISOString();
    const suffix = Date.now().toString(36);
    const borrowed: WordEntry[] = [];
    selected.forEach((senseId, entryId) => {
      const word = source.words.find((candidate) => candidate.entry_id === entryId);
      if (!word) return;
      const sense = word.senses.find((item) => item.sense_id === senseId) ?? word.senses[0];
      borrowed.push({
        ...word,
        entry_id: `${word.entry_id}_borrowed_${suffix}_${Math.random().toString(36).slice(2, 6)}`,
        language_id: activeLanguageId,
        senses: sense ? [{ ...sense, sense_id: crypto.randomUUID() }] : [],
        etymology: {
          origin_type: "borrowed",
          parent_entry_id: null,
          source_language_id: source.language.language_id,
          applied_sound_changes: [],
          semantic_shift_note: "",
          semantic_change_kind: "unchanged",
          components: [],
          borrowed_source: {
            source_conlang_path: source.conlangFilePath,
            source_family_name: source.projectLabel,
            source_language_id: source.language.language_id,
            source_language_name: source.language.name,
            source_entry_id: word.entry_id,
            source_sense_id: sense?.sense_id,
            borrowed_form: word.con_word_romanized,
            borrowed_ipa: word.phonetic_ipa,
            borrowed_gloss: sense?.gloss ?? "",
          },
        },
        evolution: {
          is_deprecated: false,
          deprecated_since_language_id: null,
          parent_snapshot_hash: null,
          last_synced_word_hash: null,
        },
        metadata: { ...word.metadata, created_at: now, updated_at: now },
      });
    });

    importWords(borrowed);
    setSelected(new Map());
    setShowConfirmModal(false);
  };

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{t("tree.borrowing")}</h3>
      <p className="text-xs text-base-content/50">{t("tree.borrowingDesc")}</p>

      <CrossProjectSourceSelector
        currentConlangPath={conlangFilePath}
        currentProjectLabel={currentProjectLabel}
        excludeLanguageIds={excludedLanguageIds}
        onLoaded={handleSourceLoaded}
      />

      {source && (
        <>
          <input
            className={`${INPUT} w-full`}
            placeholder={t("common.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          {selected.size > 0 && (
            <div className="flex items-center justify-between bg-primary/10 rounded-lg px-3 py-2">
              <span className="text-sm">{t("tree.selectedCount", { count: selected.size })}</span>
              <button className={BTN_PRIMARY} onClick={() => setShowConfirmModal(true)}>
                <BookCopy className="w-4 h-4" /> {t("tree.borrowSelected")}
              </button>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto">
            <table className="table table-xs">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>{t("lexicon.word")}</th>
                  <th>{t("lexicon.gloss")}</th>
                  <th>{t("tree.borrowingV3.sense")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredWords.slice(0, 100).map((word) => {
                  const borrowed = isAlreadyBorrowed(word);
                  const picked = selected.has(word.entry_id);
                  return (
                    <tr
                      key={word.entry_id}
                      className={`${borrowed ? "opacity-50" : "cursor-pointer"} ${
                        picked ? "bg-primary/5" : ""
                      }`}
                      onClick={() => toggleSelect(word)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          className={CHECKBOX}
                          checked={picked}
                          disabled={borrowed}
                          onChange={() => toggleSelect(word)}
                        />
                      </td>
                      <td className="font-mono text-sm">{word.con_word_romanized}</td>
                      <td className="text-sm">{word.senses.map((s) => s.gloss).join(", ")}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <select
                          className={`${SELECT} select-xs`}
                          disabled={!picked || word.senses.length <= 1}
                          value={selected.get(word.entry_id) ?? word.senses[0]?.sense_id ?? ""}
                          onChange={(event) => setSense(word.entry_id, event.target.value)}
                        >
                          {word.senses.map((sense) => (
                            <option key={sense.sense_id} value={sense.sense_id}>
                              {sense.gloss}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ConfirmModal
        open={showConfirmModal}
        title={t("tree.borrowSelected")}
        message={t("tree.confirmBorrow", { count: selected.size })}
        onConfirm={() => void confirmBorrow()}
        onCancel={() => setShowConfirmModal(false)}
      />
    </div>
  );
}
