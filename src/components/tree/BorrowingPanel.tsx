import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BookCopy } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { SELECT, INPUT, BTN_PRIMARY_MD, BTN_PRIMARY } from "../../lib/ui";
import { WordEntry } from "../../types";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmModal } from "../common/ConfirmModal";

export function BorrowingPanel() {
  const { t } = useTranslation();
  const {
    config: wsConfig,
    activeLanguageId,
    projectPath,
  } = useWorkspaceStore();
  const { importWords } = useLexiconStore();
  const [sourceLanguageId, setSourceLanguageId] = useState("");
  const [sourceWords, setSourceWords] = useState<WordEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const lexiconWords = useLexiconStore((s) => s.wordsList);

  const otherLanguages = wsConfig.languages.filter(
    (l) => l.language_id !== activeLanguageId,
  );

  const handleLoadSource = async () => {
    if (!sourceLanguageId) return;
    const sourceLang = wsConfig.languages.find(
      (l) => l.language_id === sourceLanguageId,
    );
    if (!sourceLang) return;
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const words = await invoke<WordEntry[]>("load_all_words", {
        projectPath,
        languagePath: sourceLang.path,
      });
      setSourceWords(words);
    } catch (err) {
      console.warn(`Failed to load source words: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredWords = useMemo(
    () =>
      sourceWords.filter(
        (w) =>
          w.con_word_romanized.toLowerCase().includes(search.toLowerCase()) ||
          w.senses.some((s) =>
            s.gloss.toLowerCase().includes(search.toLowerCase()),
          ),
      ),
    [sourceWords, search],
  );

  const isAlreadyBorrowed = (wordId: string) => {
    return lexiconWords.some(
      (lw: WordEntry) =>
        lw.etymology?.origin_type === "borrowed" &&
        lw.etymology?.source_language_id === sourceLanguageId &&
        lw.etymology?.parent_entry_id === wordId
    );
  };

  const toggleSelect = (entryId: string) => {
    if (isAlreadyBorrowed(entryId)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visible = filteredWords.slice(0, 100).filter(w => !isAlreadyBorrowed(w.entry_id));
    const allSelected = visible.every((w) => selectedIds.has(w.entry_id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visible.forEach((w) => next.delete(w.entry_id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visible.forEach((w) => next.add(w.entry_id));
        return next;
      });
    }
  };

  const selectedWords = useMemo(
    () => sourceWords.filter((w) => selectedIds.has(w.entry_id)),
    [sourceWords, selectedIds],
  );

  const handleBorrowSelected = () => {
    if (selectedWords.length === 0) return;
    setShowConfirmModal(true);
  };

  const confirmBorrow = async () => {
    // Optionally create snapshot before borrowing (oplog)
    try {
      const activeLang = wsConfig.languages.find(
        (l) => l.language_id === activeLanguageId,
      );
      if (activeLang) {
        await invoke("create_snapshot", {
          projectPath,
          languagePath: activeLang.path,
          operationType: "borrowing",
          sourceLanguageId,
          targetLanguageId: activeLanguageId,
          description: `Borrowed ${selectedWords.length} words`,
        });
      }
    } catch (err) {
      console.warn(`Snapshot failed (non-fatal): ${err}`);
    }

    const borrowed: WordEntry[] = selectedWords.map((word) => ({
      ...word,
      entry_id: `${word.entry_id}_borrowed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      language_id: activeLanguageId,
      etymology: {
        origin_type: "borrowed",
        parent_entry_id: word.entry_id,
        source_language_id: sourceLanguageId,
        applied_sound_changes: [],
        semantic_shift_note: "",
      },
    }));
    importWords(borrowed);
    setSelectedIds(new Set());
    setShowConfirmModal(false);
  };

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{t("tree.borrowing")}</h3>
      <p className="text-xs text-base-content/50">{t("tree.borrowingDesc")}</p>

      <div className="flex gap-2 items-center">
        <select
          className={`${SELECT} flex-1`}
          value={sourceLanguageId}
          onChange={(e) => {
            setSourceLanguageId(e.target.value);
            setSourceWords([]);
            setSelectedIds(new Set());
          }}
        >
          <option value="">{t("tree.selectSource")}</option>
          {otherLanguages.map((l) => (
            <option key={l.language_id} value={l.language_id}>
              {l.name}
            </option>
          ))}
        </select>
        <button
          className={BTN_PRIMARY_MD}
          onClick={handleLoadSource}
          disabled={!sourceLanguageId || loading}
        >
          {t("tree.loadWords")}
        </button>
      </div>

      {sourceWords.length > 0 && (
        <>
          <input
            className={`${INPUT} w-full`}
            placeholder={t("common.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {/* Selection summary + batch borrow */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between bg-primary/10 rounded-lg px-3 py-2">
              <span className="text-sm">
                {t("tree.selectedCount", { count: selectedIds.size })}
              </span>
              <button className={BTN_PRIMARY} onClick={handleBorrowSelected}>
                <BookCopy className="w-4 h-4" /> {t("tree.borrowSelected")}
              </button>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto">
            <table className="table table-xs">
              <thead>
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={
                        filteredWords.length > 0 &&
                        filteredWords
                          .slice(0, 100)
                          .every((w) => selectedIds.has(w.entry_id))
                      }
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>{t("lexicon.word")}</th>
                  <th>{t("lexicon.gloss")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredWords.slice(0, 100).map((w) => (
                  <tr
                    key={w.entry_id}
                    className={`cursor-pointer ${selectedIds.has(w.entry_id) ? "bg-primary/5" : ""
                      }`}
                    onClick={() => toggleSelect(w.entry_id)}
                  >
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs"
                        checked={selectedIds.has(w.entry_id)}
                        onChange={() => toggleSelect(w.entry_id)}
                      />
                    </td>
                    <td className="font-mono text-sm">
                      {w.con_word_romanized}
                    </td>
                    <td className="text-sm">
                      {w.senses.map((s) => s.gloss).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ConfirmModal
        open={showConfirmModal}
        title={t("tree.borrowSelected")}
        message={t("tree.confirmBorrow", { count: selectedWords.length })}
        onConfirm={confirmBorrow}
        onCancel={() => setShowConfirmModal(false)}
      />
    </div>
  );
}
