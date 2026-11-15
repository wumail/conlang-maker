import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  FileDown,
  FileUp,
  FileSpreadsheet,
  BookType,
  Copy,
  Bot,
  ArrowUpDown,
} from "lucide-react";
import { useLexiconStore } from "../store/lexiconStore";
import { usePhonoStore } from "../store/phonoStore";
import { useGrammarStore } from "../store/grammarStore";
import { flushAllDomainStores, useWorkspaceStore } from "../store/workspaceStore";
import { useSCAStore } from "../store/scaStore";
import { useCorpusStore } from "../store/corpusStore";
import { exportExcel } from "../utils/exportExcel";
import { exportDic } from "../utils/exportDic";
import {
  copyPromptToClipboard,
  corpusTextsToMarkdown,
  exportPromptAsMarkdown,
  type PromptExportOptions,
} from "../utils/llmPrompt";
import { previewCSVImport } from "../utils/importCSV";
import { saveTextFile, writeTextFileAt } from "../utils/fileSave";
import { savePathSafely } from "../utils/safeDialog";
import { WordEntry } from "../types";
import {
  BTN_PRIMARY,
  BTN_GHOST,
  CARD,
  CARD_BODY,
} from "../lib/ui";
import { PageHeader } from "../components/common/PageHeader";
import { ImportPreviewCard } from "../components/export/ImportPreviewCard";
import { ReferenceBookCard } from "../components/export/ReferenceBookModal";
import {
  ExportPresetCards,
  type DictionaryExportOptions,
} from "../components/export/ExportPresetCards";

export function ExportImport() {
  const { t } = useTranslation();
  const { wordsList, importWords } = useLexiconStore();
  const { config: phonoConfig } = usePhonoStore();
  const { config: grammarConfig } = useGrammarStore();
  const { config: scaConfig } = useSCAStore();
  const { activeLanguageId } = useWorkspaceStore();
  const languages = useWorkspaceStore((s) => s.config.languages);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<WordEntry[] | null>(null);
  const [importFormat, setImportFormat] = useState("");
  const [conflictStrategy, setConflictStrategy] = useState<
    "keep_both" | "skip" | "overwrite"
  >("keep_both");

  const activeLangName = useWorkspaceStore(
    (s) => s.config.languages.find((l) => l.language_id === s.activeLanguageId)?.name || "Conlang",
  );

  const handleExportExcel = () => {
    void exportExcel(activeLangName, wordsList, phonoConfig);
  };

  const handleExportDic = () => {
    void exportDic(
      wordsList,
      activeLangName,
      grammarConfig.inflection_rules,
      phonoConfig,
    );
  };

  /**
   * LLM Prompt 选项：语料取**当前语言全部文本**（不再只取 activeCorpus），
   * 使导出的 prompt 覆盖整个语料库。
   */
  const buildPromptOptions = async (): Promise<PromptExportOptions> => ({
    langName: activeLangName,
    phonoConfig,
    grammarConfig,
    words: wordsList,
    scaConfig,
    corpusTexts: await useCorpusStore.getState().loadAllCorpusTexts(),
    languages,
  });

  const handleCopyPrompt = async () => {
    await copyPromptToClipboard(await buildPromptOptions());
  };

  const handleDownloadPrompt = async () => {
    await exportPromptAsMarkdown(await buildPromptOptions());
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

  const closeImport = () => {
    setImportPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
    closeImport();
  };

  /** 语料文集：三行对照 Markdown（导出当前语言全部语料） */
  const handleExportCorpus = async () => {
    const texts = await useCorpusStore.getState().loadAllCorpusTexts();
    if (texts.length === 0) return;
    await saveTextFile({
      defaultName: `${activeLangName}_corpus.md`,
      content: corpusTextsToMarkdown(texts),
      mimeType: "text/markdown;charset=utf-8",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
  };

  const handleExportDictionary = (options: DictionaryExportOptions) => {
    const needle = options.tagFilter.trim().toLowerCase();
    const filtered = wordsList.filter((word) => {
      if (options.excludeDeprecated && word.evolution?.is_deprecated) return false;
      if (!needle) return true;
      return (word.metadata?.tags ?? []).some((tag) => tag.toLowerCase().includes(needle));
    });
    void exportDic(filtered, activeLangName, grammarConfig.inflection_rules, phonoConfig);
  };

  /** 完整备份：先落盘全部 Store，再导出工作区 bundle（JSON 交换包） */
  const handleBackup = async () => {
    const date = new Date().toISOString().slice(0, 10);
    const filePath = await savePathSafely({
      title: t("export.presets.fullBackupTitle"),
      defaultPath: `${activeLangName}-backup-${date}.json`,
      filters: [{ name: "Conlang workspace bundle", extensions: ["json"] }],
    });
    if (!filePath) return;
    try {
      await flushAllDomainStores();
      const { projectPath, conlangFilePath } = useWorkspaceStore.getState();
      const bundleJson = await invoke<string>("export_workspace_bundle", {
        projectPath,
        conlangFilePath,
      });
      await writeTextFileAt(filePath, bundleJson);
    } catch (err) {
      console.warn(`Workspace backup failed: ${err}`);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={<ArrowUpDown size={24} />} title={t("export.title")} />
      <ExportPresetCards
        onGrammarBook={() =>
          document.getElementById("reference-book-card")?.scrollIntoView({ behavior: "smooth" })
        }
        onDictionary={handleExportDictionary}
        onCorpus={() => void handleExportCorpus()}
        onBackup={() => void handleBackup()}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div id="reference-book-card">
          <ReferenceBookCard />
        </div>

        <div className={CARD}>
          <div className={`${CARD_BODY} p-4 text-center space-y-3`}>
            <FileSpreadsheet className="w-12 h-12 mx-auto text-green-600" />
            <h3 className="font-semibold">{t("export.excel")}</h3>
            <p className="text-sm text-base-content/60">{t("export.excelDesc")}</p>
            <button className={BTN_PRIMARY} onClick={handleExportExcel}>
              <FileDown className="w-4 h-4" /> {t("export.downloadExcel")}
            </button>
          </div>
        </div>

        <div className={CARD}>
          <div className={`${CARD_BODY} p-4 text-center space-y-3`}>
            <BookType className="w-12 h-12 mx-auto text-purple-500" />
            <h3 className="font-semibold">{t("export.dic")}</h3>
            <p className="text-sm text-base-content/60">{t("export.dicDesc")}</p>
            <button className={BTN_PRIMARY} onClick={handleExportDic}>
              <FileDown className="w-4 h-4" /> {t("export.downloadDic")}
            </button>
          </div>
        </div>

        <div className={CARD}>
          <div className={`${CARD_BODY} p-4 text-center space-y-3`}>
            <FileUp className="w-12 h-12 mx-auto text-blue-500" />
            <h3 className="font-semibold">{t("export.csvImport")}</h3>
            <p className="text-sm text-base-content/60">{t("export.csvDesc")}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleFileSelect}
              className="file-input file-input-primary file-input-sm w-full "
            />
          </div>
        </div>

        <div className={CARD}>
          <div className={`${CARD_BODY} p-4 text-center space-y-3`}>
            <Bot className="w-12 h-12 mx-auto text-indigo-500" />
            <h3 className="font-semibold">{t("export.llmPrompt")}</h3>
            <p className="text-sm text-base-content/60">{t("export.llmPromptDesc")}</p>
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

      {importPreview && (
        <ImportPreviewCard
          preview={importPreview}
          format={importFormat}
          strategy={conflictStrategy}
          onStrategyChange={setConflictStrategy}
          onClose={closeImport}
          onConfirm={handleConfirmImport}
        />
      )}
    </div>
  );
}
