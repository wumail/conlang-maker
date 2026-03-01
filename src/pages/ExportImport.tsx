import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FileDown,
  FileUp,
  FileSpreadsheet,
  FileText,
  BookType,
  Copy,
  Bot,
  ArrowUpDown,
} from "lucide-react";
import { useLexiconStore } from "../store/lexiconStore";
import { usePhonoStore } from "../store/phonoStore";
import { useGrammarStore } from "../store/grammarStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSCAStore } from "../store/scaStore";
import { useCorpusStore } from "../store/corpusStore";
import { exportPDF } from "../utils/exportPDF";
import { exportExcel } from "../utils/exportExcel";
import { exportDic } from "../utils/exportDic";
import {
  exportPromptAsMarkdown,
  copyPromptToClipboard,
} from "../utils/llmPrompt";
import { previewCSVImport } from "../utils/importCSV";
import { WordEntry } from "../types";
import {
  BTN_PRIMARY,
  BTN_SUCCESS,
  BTN_GHOST,
  CARD,
  CARD_BODY,
} from "../lib/ui";
import { PageHeader } from "../components/common/PageHeader";

export function ExportImport() {
  const { t } = useTranslation();
  const { wordsList, importWords } = useLexiconStore();
  const { config: phonoConfig } = usePhonoStore();
  const { config: grammarConfig } = useGrammarStore();
  const { config: scaConfig } = useSCAStore();
  const activeCorpus = useCorpusStore((s) => s.activeCorpus);
  const corpusTexts = activeCorpus ? [activeCorpus] : [];
  const { activeLanguageId } = useWorkspaceStore();
  const languages = useWorkspaceStore((s) => s.config.languages);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<WordEntry[] | null>(null);
  const [importFormat, setImportFormat] = useState("");
  const [conflictStrategy, setConflictStrategy] = useState<
    "keep_both" | "skip" | "overwrite"
  >("keep_both");

  const activeLangName = useWorkspaceStore(
    (s) =>
      s.config.languages.find((l) => l.language_id === s.activeLanguageId)
        ?.name || "Conlang",
  );

  const handleExportPDF = () => {
    exportPDF(activeLangName, wordsList, phonoConfig, grammarConfig, [
      { title: "orthography", enabled: true },
      { title: "paradigms", enabled: true },
      { title: "manual", enabled: true },
      { title: "dictionary", enabled: true },
    ]);
  };

  const handleExportExcel = () => {
    exportExcel(activeLangName, wordsList, phonoConfig);
  };

  const handleExportDic = () => {
    exportDic(
      wordsList,
      activeLangName,
      grammarConfig.inflection_rules,
      phonoConfig,
    );
  };

  const promptOpts = {
    langName: activeLangName,
    phonoConfig,
    grammarConfig,
    words: wordsList,
    scaConfig,
    corpusTexts,
    languages,
  };

  const handleCopyPrompt = async () => {
    await copyPromptToClipboard(promptOpts);
  };

  const handleDownloadPrompt = () => {
    exportPromptAsMarkdown(promptOpts);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const preview = previewCSVImport(text, activeLanguageId);
      setImportPreview(preview.words);
      setImportFormat(preview.format);
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = () => {
    if (!importPreview) return;

    let wordsToImport = [...importPreview];

    if (conflictStrategy !== "keep_both") {
      const finalImports: WordEntry[] = [];
      const updatedExisting: WordEntry[] = [];

      for (const w of wordsToImport) {
        // Find if this word conflicts (same spelling and pos)
        const conflict = wordsList.find(
          (ex) =>
            ex.con_word_romanized.toLowerCase() ===
              w.con_word_romanized.toLowerCase() &&
            ex.senses[0]?.pos_id === w.senses[0]?.pos_id,
        );

        if (conflict) {
          if (conflictStrategy === "skip") {
            continue; // Ignore this word
          } else if (conflictStrategy === "overwrite") {
            // Overwrite existing word with imported data, keep old ID
            updatedExisting.push({
              ...conflict,
              phonetic_ipa: w.phonetic_ipa || conflict.phonetic_ipa,
              senses: w.senses, // Replace senses with imported
              metadata: {
                ...conflict.metadata,
                tags: Array.from(
                  new Set([...conflict.metadata.tags, "imported"]),
                ),
              },
            });
          }
        } else {
          finalImports.push(w);
        }
      }
      wordsToImport = [...finalImports, ...updatedExisting];
    }

    importWords(wordsToImport);
    setImportPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={<ArrowUpDown size={24} />} title={t("export.title")} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* PDF Export */}
        <div className={CARD}>
          <div className={`${CARD_BODY} p-4 text-center space-y-3`}>
            <FileText className="w-12 h-12 mx-auto text-red-500" />
            <h3 className="font-semibold">{t("export.pdf")}</h3>
            <p className="text-sm text-base-content/60">
              {t("export.pdfDesc")}
            </p>
            <button className={BTN_PRIMARY} onClick={handleExportPDF}>
              <FileDown className="w-4 h-4" /> {t("export.downloadPDF")}
            </button>
          </div>
        </div>

        {/* Excel Export */}
        <div className={CARD}>
          <div className={`${CARD_BODY} p-4 text-center space-y-3`}>
            <FileSpreadsheet className="w-12 h-12 mx-auto text-green-600" />
            <h3 className="font-semibold">{t("export.excel")}</h3>
            <p className="text-sm text-base-content/60">
              {t("export.excelDesc")}
            </p>
            <button className={BTN_PRIMARY} onClick={handleExportExcel}>
              <FileDown className="w-4 h-4" /> {t("export.downloadExcel")}
            </button>
          </div>
        </div>

        {/* Hunspell .dic Export */}
        <div className={CARD}>
          <div className={`${CARD_BODY} p-4 text-center space-y-3`}>
            <BookType className="w-12 h-12 mx-auto text-purple-500" />
            <h3 className="font-semibold">{t("export.dic")}</h3>
            <p className="text-sm text-base-content/60">
              {t("export.dicDesc")}
            </p>
            <button className={BTN_PRIMARY} onClick={handleExportDic}>
              <FileDown className="w-4 h-4" /> {t("export.downloadDic")}
            </button>
          </div>
        </div>

        {/* CSV Import */}
        <div className={CARD}>
          <div className={`${CARD_BODY} p-4 text-center space-y-3`}>
            <FileUp className="w-12 h-12 mx-auto text-blue-500" />
            <h3 className="font-semibold">{t("export.csvImport")}</h3>
            <p className="text-sm text-base-content/60">
              {t("export.csvDesc")}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleFileSelect}
              className="file-input file-input-primary file-input-sm w-full "
            />
          </div>
        </div>

        {/* LLM Prompt Export */}
        <div className={CARD}>
          <div className={`${CARD_BODY} p-4 text-center space-y-3`}>
            <Bot className="w-12 h-12 mx-auto text-indigo-500" />
            <h3 className="font-semibold">{t("export.llmPrompt")}</h3>
            <p className="text-sm text-base-content/60">
              {t("export.llmPromptDesc")}
            </p>
            <div className="flex gap-2 justify-center">
              <button className={BTN_PRIMARY} onClick={handleCopyPrompt}>
                <Copy className="w-4 h-4" /> {t("export.copyPrompt")}
              </button>
              <button className={BTN_GHOST} onClick={handleDownloadPrompt}>
                <FileDown className="w-4 h-4" /> .md
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Import Preview */}
      {importPreview && (
        <div className={CARD}>
          <div className={`${CARD_BODY} p-4 space-y-3`}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {t("export.importPreview")} ({importPreview.length}{" "}
                {t("export.entries")})
              </h3>
              <span className="badge badge-sm">{importFormat}</span>
            </div>
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>{t("lexicon.word")}</th>
                    <th>{"IPA"}</th>
                    <th>{t("lexicon.pos")}</th>
                    <th>{t("lexicon.gloss")}</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.slice(0, 30).map((w) => (
                    <tr key={w.entry_id}>
                      <td className="font-mono">{w.con_word_romanized}</td>
                      <td className="font-mono text-xs">{w.phonetic_ipa}</td>
                      <td>{w.senses[0]?.pos_id}</td>
                      <td>{w.senses[0]?.gloss}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importPreview.length > 30 && (
                <p className="text-xs text-base-content/50 mt-1">
                  +{importPreview.length - 30} {t("common.more")}
                </p>
              )}
            </div>

            <div className="flex items-center gap-4 bg-base-200 p-3 rounded-lg text-sm border border-base-300">
              <span className="font-semibold text-base-content/80">
                {t("export.conflictHandling", "If word exists:")}
              </span>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="conflict"
                  className="radio radio-primary radio-sm"
                  checked={conflictStrategy === "keep_both"}
                  onChange={() => setConflictStrategy("keep_both")}
                />
                {t("export.conflictKeepBoth", "Keep Both")}
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="conflict"
                  className="radio radio-primary radio-sm"
                  checked={conflictStrategy === "skip"}
                  onChange={() => setConflictStrategy("skip")}
                />
                {t("export.conflictSkip", "Skip New")}
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="conflict"
                  className="radio radio-primary radio-sm"
                  checked={conflictStrategy === "overwrite"}
                  onChange={() => setConflictStrategy("overwrite")}
                />
                {t("export.conflictOverwrite", "Overwrite Existing")}
              </label>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                className={BTN_GHOST}
                onClick={() => {
                  setImportPreview(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                {t("common.close")}
              </button>
              <button className={BTN_SUCCESS} onClick={handleConfirmImport}>
                <FileUp className="w-4 h-4" /> {t("export.confirmImport")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
