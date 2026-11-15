import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen, Download, FileCode, Printer, X } from "lucide-react";
import type { ConceptDefinition, CorpusText, ResolvedFontBytes } from "../../types";
import {
  buildReferenceBookHtml,
  buildReferenceBookTypst,
  DEFAULT_REFERENCE_SECTIONS,
  type ReferenceBookSections,
} from "../../core/engines/referenceBookBuilder";
import { useGrammarStore } from "../../store/grammarStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useCorpusStore } from "../../store/corpusStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { ModalPortal } from "../common/ModalPortal";
import { saveTextFile } from "../../utils/fileSave";
import {
  BADGE,
  BTN_GHOST,
  BTN_GHOST_SQ,
  BTN_PRIMARY,
  CARD,
  CARD_BODY,
} from "../../lib/ui";

const SECTION_KEYS: (keyof ReferenceBookSections)[] = [
  "phonology",
  "typology",
  "paradigms",
  "manual",
  "corpus",
  "dictionary",
  "reverseIndex",
];

const EMPTY_CONCEPTS: readonly ConceptDefinition[] = [];

function download(name: string, content: string, type: string): Promise<boolean> {
  return saveTextFile({ defaultName: name, content, mimeType: type });
}

/** 参考语法弹窗：章节勾选 → 实时 iframe 预览 → 独立 HTML / Typst / 系统打印 */
export function ReferenceBookModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const words = useLexiconStore((state) => state.wordsList);
  const phono = usePhonoStore((state) => state.config);
  const grammar = useGrammarStore((state) => state.config);
  const [corpusTexts, setCorpusTexts] = useState<CorpusText[]>([]);
  const { projectPath, conlangFilePath, activeLanguageId, config } = useWorkspaceStore();
  const languageName =
    config.languages.find((language) => language.language_id === activeLanguageId)?.name ??
    "Conlang";

  const sectionLabels: Record<keyof ReferenceBookSections, string> = {
    phonology: t("export.reference.section.phonology"),
    typology: t("export.reference.section.typology"),
    paradigms: t("export.reference.section.paradigms"),
    manual: t("export.reference.section.manual"),
    corpus: t("export.reference.section.corpus"),
    dictionary: t("export.reference.section.dictionary"),
    reverseIndex: t("export.reference.section.reverseIndex"),
  };

  const [sections, setSections] = useState<ReferenceBookSections>(DEFAULT_REFERENCE_SECTIONS);
  const [font, setFont] = useState<{ base64: string; mime: string; fileName: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!open || !projectPath || !conlangFilePath || !activeLanguageId) return;
    let cancelled = false;
    invoke<ResolvedFontBytes | null>("read_resolved_font", {
      projectPath,
      conlangFilePath,
      languageId: activeLanguageId,
    })
      .then((resolved) => {
        if (cancelled || !resolved?.bytes_base64) return;
        setFont({
          base64: resolved.bytes_base64,
          mime: resolved.file_name.endsWith(".otf") ? "font/otf" : "font/ttf",
          fileName: resolved.file_name,
        });
      })
      .catch((error) => console.warn(`Failed to read font for reference book: ${error}`));
    return () => {
      cancelled = true;
    };
  }, [open, projectPath, conlangFilePath, activeLanguageId]);

  const customConcepts = config.custom_concepts ?? EMPTY_CONCEPTS;

  // 参考语法书的「语料」章节必须覆盖当前语言的全部语料（原先只取 activeCorpus）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    useCorpusStore
      .getState()
      .loadAllCorpusTexts()
      .then((texts) => {
        if (!cancelled) setCorpusTexts(texts);
      })
      .catch((error) => console.warn(`Failed to load corpus for reference book: ${error}`));
    return () => {
      cancelled = true;
    };
  }, [open, activeLanguageId]);

  const options = useMemo(
    () => ({
      languageName,
      nativeName: languageName,
      phono,
      grammar,
      words,
      corpus: corpusTexts,
      sections,
      fontBase64: font?.base64 ?? null,
      fontMime: font?.mime,
      fontFileName: font?.fileName,
      concepts: customConcepts,
    }),
    [languageName, phono, grammar, words, corpusTexts, sections, font, customConcepts],
  );

  const html = useMemo(() => (open ? buildReferenceBookHtml(options) : ""), [open, options]);
  const typst = useMemo(() => (open ? buildReferenceBookTypst(options) : ""), [open, options]);

  const toggle = (key: keyof ReferenceBookSections): void =>
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const handlePrint = async (): Promise<void> => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    await win.document.fonts.ready;
    win.focus();
    win.print();
  };

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open z-50" data-testid="reference-book-modal">
        <div className="modal-box max-w-5xl space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-bold text-base flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              {t("export.reference.title")}
            </h3>
            <button className={BTN_GHOST_SQ} onClick={onClose} aria-label={t("common.close")}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-base-content/60">{t("export.reference.desc")}</p>

          <div className="flex flex-wrap gap-1.5">
            {SECTION_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={sections[key] ? BTN_PRIMARY : BTN_GHOST}
                onClick={() => toggle(key)}
              >
                {sectionLabels[key]}
              </button>
            ))}
            {font && (
              <span className={`${BADGE} badge-success`}>
                {t("export.reference.fontEmbedded")}
              </span>
            )}
          </div>

          <iframe
            ref={iframeRef}
            title={t("export.reference.preview")}
            srcDoc={html}
            className="w-full h-[60vh] rounded-lg border border-base-300 bg-white"
            sandbox="allow-same-origin allow-modals"
          />

          <div className="modal-action">
            <button className={BTN_GHOST} onClick={onClose}>
              {t("common.close")}
            </button>
            <button className={BTN_GHOST} onClick={() => void download(`${languageName}.typ`, typst, "text/plain")}>
              <FileCode className="w-4 h-4" />
              .typ
            </button>
            <button className={BTN_GHOST} onClick={() => void handlePrint()}>
              <Printer className="w-4 h-4" />
              {t("export.reference.print")}
            </button>
            <button
              className={BTN_PRIMARY}
              onClick={() => void download(`${languageName}-reference.html`, html, "text/html")}
            >
              <Download className="w-4 h-4" />
              {t("export.reference.downloadHtml")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

/** 导出页卡片入口 */
export function ReferenceBookCard() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className={CARD}>
      <div className={`${CARD_BODY} p-4 text-center space-y-3`}>
        <BookOpen className="w-12 h-12 mx-auto text-amber-600" />
        <h3 className="font-semibold">{t("export.reference.card")}</h3>
        <p className="text-sm text-base-content/60">{t("export.reference.cardDesc")}</p>
        <button className={BTN_PRIMARY} onClick={() => setOpen(true)} data-testid="open-reference-book">
          <BookOpen className="w-4 h-4" />
          {t("export.reference.open")}
        </button>
      </div>
      <ReferenceBookModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
