/**
 * LexiconTablePasteModal.tsx — 多行 TSV / CSV 粘贴入库预览（Roadmap v3 / Pillar 4）
 *
 * 每行格式：`词形 <Tab或逗号> 释义 [<Tab或逗号> 词性]`，
 * 确认后单次批量写入（已存在同形词则更新首个义项）。
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLexiconStore } from "../../store/lexiconStore";
import { useGrammarStore } from "../../store/grammarStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { pushUndoEntry } from "../../store/undoManager";
import { generateIPA } from "../../core/engines/ipaGenerator";
import { usePhonoStore } from "../../store/phonoStore";
import type { WordEntry } from "../../types";
import { BTN_GHOST, BTN_PRIMARY, TEXTAREA, BADGE } from "../../lib/ui";
import { ModalPortal } from "../common/ModalPortal";

interface LexiconTablePasteModalProps {
  open: boolean;
  onClose: () => void;
}

interface ParsedRow {
  form: string;
  gloss: string;
  posId: string;
}

export const LexiconTablePasteModal: React.FC<LexiconTablePasteModalProps> = ({
  open,
  onClose,
}) => {
  const { t } = useTranslation();
  const wordsList = useLexiconStore((s) => s.wordsList);
  const languagePath = useLexiconStore((s) => s.languagePath);
  const importWords = useLexiconStore((s) => s.importWords);
  const partsOfSpeech = useGrammarStore((s) => s.config.parts_of_speech);
  const phonoConfig = usePhonoStore((s) => s.config);
  const [raw, setRaw] = useState("");

  const parsed = useMemo<ParsedRow[]>(() => {
    const defaultPos = partsOfSpeech[0]?.pos_id ?? "noun";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [form = "", gloss = "", posId = ""] = line.split(/\t|,|\s{2,}/);
        return {
          form: form.trim(),
          gloss: gloss.trim() || form.trim(),
          posId: partsOfSpeech.some((pos) => pos.pos_id === posId.trim())
            ? posId.trim()
            : defaultPos,
        };
      })
      .filter((row) => row.form.length > 0);
  }, [raw, partsOfSpeech]);

  const apply = () => {
    if (parsed.length === 0) return;
    const byForm = new Map(wordsList.map((word) => [word.con_word_romanized, word]));
    const now = new Date().toISOString();
    const activeLanguageId = useWorkspaceStore.getState().activeLanguageId;
    const created: WordEntry[] = [];
    const originals: WordEntry[] = [];

    for (const row of parsed) {
      const existing = byForm.get(row.form);
      if (existing) {
        originals.push(existing);
        const senses = [...existing.senses];
        const first = senses[0];
        if (first) senses[0] = { ...first, gloss: row.gloss, pos_id: row.posId };
        else
          senses.push({
            sense_id: crypto.randomUUID(),
            pos_id: row.posId,
            gloss: row.gloss,
            definitions: [],
            examples: [],
          });
        created.push({ ...existing, senses, metadata: { ...existing.metadata, updated_at: now } });
        continue;
      }
      const ipa = generateIPA(row.form, phonoConfig).phonemic.replace(/^\/|\/$/g, "");
      created.push({
        entry_id: crypto.randomUUID(),
        language_id: activeLanguageId,
        con_word_romanized: row.form,
        phonetic_ipa: ipa,
        phonetic_override: false,
        senses: [
          {
            sense_id: crypto.randomUUID(),
            pos_id: row.posId,
            gloss: row.gloss,
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
        metadata: { tags: [], created_at: now, updated_at: now },
      });
    }

    importWords(created);
    pushUndoEntry({
      languageId: languagePath,
      domain: "lexicon",
      labelKey: "lexicon.table.pasteTsv",
      undo: () => {
        const store = useLexiconStore.getState();
        const createdIds = created
          .filter((word) => !originals.some((original) => original.entry_id === word.entry_id))
          .map((word) => word.entry_id);
        // 单次批量删除（避免逐条 deleteWord 产生 N 次串行写盘）
        if (createdIds.length > 0) void store.deleteWordsBatch(createdIds);
        if (originals.length > 0) store.importWords(originals);
      },
      redo: () => useLexiconStore.getState().importWords(created),
    });
    setRaw("");
    onClose();
  };

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open">
        <div className="modal-box max-w-2xl">
          <h3 className="text-lg font-bold">{t("lexicon.table.pastePreviewTitle")}</h3>
          <p className="mt-1 text-xs text-base-content/50">{t("lexicon.table.pasteTsv")}</p>
          <textarea
            className={`${TEXTAREA} mt-2 h-40 w-full font-mono text-xs`}
            placeholder={"kata\tstone\tnoun\nsana\twalk\tverb"}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
          />

          <div className="mt-2 max-h-48 overflow-y-auto rounded border border-base-300">
            {parsed.map((row, index) => (
              <div
                key={`${row.form}_${index}`}
                className="flex items-center gap-2 border-b border-base-200 px-2 py-1 text-xs last:border-0"
              >
                <span className="font-mono">{row.form}</span>
                <span className="text-base-content/60">{row.gloss}</span>
                <span className={`${BADGE} badge-ghost badge-xs`}>{row.posId}</span>
                {wordsList.some((word) => word.con_word_romanized === row.form) && (
                  <span className={`${BADGE} badge-warning badge-xs`}>{t("common.preview")}</span>
                )}
              </div>
            ))}
          </div>

          <div className="modal-action">
            <button type="button" className={BTN_GHOST} onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={parsed.length === 0}
              onClick={apply}
            >
              {t("common.apply")} ({parsed.length})
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
