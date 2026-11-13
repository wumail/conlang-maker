import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen, Download, FileCode, Printer, X } from "lucide-react";
import type { CorpusText, ResolvedFontBytes } from "../../types";
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
import { BADGE, BTN_GHOST, BTN_PRIMARY, CARD, CARD_BODY } from "../../lib/ui";

const SECTION_KEYS: (keyof ReferenceBookSections)[] = [
  "phonology",
  "typology",
  "paradigms",
  "manual",
  "corpus",
  "dictionary",
  "reverseIndex",
];

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 参考语法弹窗：章节勾选 → 实时 iframe 预览 → 独立 HTML / Typst / 系统打印 */
export function ReferenceBookModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const words = useLexiconStore((state) => state.wordsList);
  const phono = usePhonoStore((state) => state.config);
  const grammar = useGrammarStore((state) => state.config);
  const activeCorpus = useCorpusStore((state) => state.activeCorpus);
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
  const [font, setFont] = useState<{ base64: string; mime: string } | null>(null);
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
        });
      })
      .catch((error) => console.warn(`Failed to read font for reference book: ${error}`));
    return () => {
      cancelled = true;
    };
  }, [open, projectPath, conlangFilePath, activeLanguageId]);

  const options = useMemo(
    () => ({
      languageName,
      nativeName: languageName,
      phono,
      grammar,
      words,
      corpus: activeCorpus ? ([activeCorpus] as CorpusText[]) : [],
      sections,
      fontBase64: font?.base64 ?? null,
      fontMime: font?.mime,
    }),
    [languageName, phono, grammar, words, activeCorpus, sections, font],
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
            <button className="btn btn-ghost btn-xs btn-square" onClick={onClose} aria-label={t("common.close")}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-base-content/60">{t("export.reference.desc")}</p>

          <div className="flex flex-wrap gap-1.5">
            {SECTION_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={`btn btn-xs ${sections[key] ? "btn-primary" : "btn-ghost"}`}
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
            <button className={BTN_GHOST} onClick={() => download(`${languageName}.typ`, typst, "text/plain")}>
              <FileCode className="w-4 h-4" />
              .typ
            </button>
            <button className={BTN_GHOST} onClick={() => void handlePrint()}>
              <Printer className="w-4 h-4" />
              {t("export.reference.print")}
            </button>
            <button
              className={BTN_PRIMARY}
              onClick={() => download(`${languageName}-reference.html`, html, "text/html")}
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
