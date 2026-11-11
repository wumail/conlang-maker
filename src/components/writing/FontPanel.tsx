import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Trash2, Type } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useFontStore } from "../../store/fontStore";
import { useLexiconStore } from "../../store/lexiconStore";
import { openPathSafely, messageSafely } from "../../utils/safeDialog";
import { decodeBase64 } from "../../utils/conlangFont";
import { charactersOf, formatCodepoint } from "../../utils/unicodeBlocks";
import { ScriptPreview } from "./ScriptText";
import { ConfirmModal } from "../common/ConfirmModal";
import {
  BTN_GHOST,
  BTN_OUTLINE_ERROR,
  BTN_PRIMARY,
  CARD,
  CARD_BODY,
  SECTION_HEADER,
  TEXTAREA,
} from "../../lib/ui";
import { useFontInspection } from "./FontInspectionContext";

interface MissingCharacterItem {
  character: string;
  codepoint: number;
  word: string;
}

export function FontPanel() {
  const { t } = useTranslation();
  const { inspection, loading, error } = useFontInspection();
  const projectPath = useWorkspaceStore((state) => state.projectPath);
  const activeLanguageId = useWorkspaceStore((state) => state.activeLanguageId);
  const languages = useWorkspaceStore((state) => state.config.languages);
  const wordsList = useLexiconStore((state) => state.wordsList);
  const fontLoaded = useFontStore((state) => state.loaded);
  const fontLoading = useFontStore((state) => state.loading);
  const fontError = useFontStore((state) => state.error);
  const [sample, setSample] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = languages.find((item) => item.language_id === activeLanguageId);

  const sampleWords = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const entry of wordsList) {
      const trimmed = entry.con_word_romanized.trim();
      if (trimmed.length > 0 && !seen.has(trimmed)) {
        seen.add(trimmed);
        result.push(trimmed);
      }
    }
    return result;
  }, [wordsList]);

  const coverage = useMemo(() => {
    if (!inspection?.present || inspection.warning || fontLoading) {
      return [] as MissingCharacterItem[];
    }
    const covered = new Set(inspection.codepoints);
    const missing = new Map<string, MissingCharacterItem>();
    for (const word of sampleWords) {
      for (const character of charactersOf(word)) {
        if (/^\s+$/u.test(character)) continue;
        const codepoint = character.codePointAt(0);
        if (codepoint === undefined || covered.has(codepoint) || missing.has(character)) continue;
        missing.set(character, { character, codepoint, word });
      }
    }
    return [...missing.values()];
  }, [inspection, sampleWords, fontLoading]);

  const importFont = async () => {
    if (!active) return;
    const picked = await openPathSafely({
      title: inspection?.has_own ? t("writing.replace") : t("writing.import"),
      filters: [{ name: "Font", extensions: ["otf", "ttf"] }],
    });
    if (!picked) return;
    setBusy(true);
    try {
      const candidate = await invoke<string>("read_font_candidate", { sourcePath: picked });
      const bytes = decodeBase64(candidate);
      await new FontFace("ConlangImportCandidate", bytes).load();
      await invoke("import_checked_language_font", {
        projectPath,
        languagePath: active.path,
        sourcePath: picked,
        expectedBase64: candidate,
      });
      useFontStore.getState().bump();
    } catch (err) {
      await messageSafely(`${t("writing.importFailed")}\n${err}`, {
        title: t("writing.import"),
      });
    } finally {
      setBusy(false);
    }
  };

  const removeFont = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await invoke("clear_language_font", {
        projectPath,
        languagePath: active.path,
      });
      useFontStore.getState().bump();
    } catch (err) {
      await messageSafely(`${t("writing.removeFailed")}\n${err}`, {
        title: t("writing.removeTitle"),
      });
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  const showFolder = async () => {
    const languagePath = inspection?.owner_path ?? active?.path;
    if (!languagePath) return;
    try {
      await invoke("show_in_folder", { projectPath, languagePath });
    } catch (err) {
      console.warn("Failed to show font folder:", err);
    }
  };

  if (!activeLanguageId) {
    return <p className="p-6 text-sm text-base-content/70">{t("writing.noLanguage")}</p>;
  }

  if (loading && !inspection) {
    return (
      <div className="p-6">
        <span className="loading loading-spinner loading-md" />
        <span className="ml-2 text-sm">{t("writing.loading")}</span>
      </div>
    );
  }

  if (error || !inspection) {
    return (
      <div className="p-6">
        <div role="alert" className="alert alert-warning alert-soft">
          {t("writing.loadFailed")}
          {error ? ` ${error}` : ""}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-y-auto flex-1 bg-base-100">
      <section className={CARD} data-testid="writing-font-status">
        <div className={`${CARD_BODY} gap-3`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5 min-w-0 flex-1">
              {!inspection.present ? (
                <div>
                  <h2 className="text-base font-semibold">{t("writing.noneTitle")}</h2>
                  <p className="text-xs text-base-content/60 mt-0.5">{t("writing.noneBody")}</p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge badge-sm badge-primary badge-soft" data-testid="writing-badge">
                      {inspection.has_own
                        ? t("writing.ownBadge")
                        : t("writing.inheritedBadge", {
                            name: inspection.owner_name ?? "",
                          })}
                    </span>
                    <span className="text-xs font-mono bg-base-200/80 border border-base-300/60 px-2 py-0.5 rounded text-base-content/80">
                      {inspection.file_name}
                    </span>
                  </div>
                  <p className="text-xs text-base-content/60">
                    {inspection.has_own
                      ? t("writing.overrideHint")
                      : t("writing.inheritedHint", {
                          name: inspection.owner_name ?? "",
                        })}
                  </p>
                </>
              )}
              <p className="text-xs text-base-content/50">{t("writing.inheritHint")}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                className={BTN_PRIMARY}
                onClick={importFont}
                disabled={busy}
                data-testid="writing-import"
              >
                <Type className="w-4 h-4" />
                {inspection.has_own ? t("writing.replace") : t("writing.import")}
              </button>
              {inspection.has_own && (
                <button
                  className={BTN_OUTLINE_ERROR}
                  onClick={() => setConfirmRemove(true)}
                  disabled={busy}
                  data-testid="writing-remove"
                >
                  <Trash2 className="w-4 h-4" />
                  {t("writing.remove")}
                </button>
              )}
              <button className={BTN_GHOST} onClick={showFolder} data-testid="writing-folder">
                <FolderOpen className="w-4 h-4" />
                {t("writing.showFolder")}
              </button>
            </div>
          </div>

          {inspection.present && (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm rounded-lg border border-base-200 bg-base-200/40 p-3">
              <div className="min-w-0">
                <dt className="text-xs font-medium text-base-content/50">{t("writing.family")}</dt>
                <dd className="font-medium mt-0.5 truncate" data-testid="writing-family">
                  {inspection.family_name ?? t("writing.unknown")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-base-content/50">{t("writing.version")}</dt>
                <dd className="font-medium mt-0.5 truncate" data-testid="writing-version">
                  {inspection.version ?? t("writing.unknown")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-base-content/50">{t("writing.file")}</dt>
                <dd className="font-mono font-medium mt-0.5 truncate">
                  {inspection.file_name ?? t("writing.unknown")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-base-content/50">{t("writing.count")}</dt>
                <dd className="font-medium mt-0.5 truncate" data-testid="writing-count">
                  {t("writing.countValue", { count: inspection.codepoints.length })}
                </dd>
              </div>
            </dl>
          )}

          {fontError && (
            <div role="alert" className="alert alert-error alert-soft text-xs py-2">
              {t("writing.fontLoadFailed")} {fontError}
            </div>
          )}
          {inspection.warning && (
            <div role="alert" className="alert alert-warning alert-soft text-xs py-2">
              {t("writing.parseWarning", { warning: inspection.warning })}
            </div>
          )}
        </div>
      </section>

      <section className={CARD}>
        <div className={`${CARD_BODY} gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className={`${SECTION_HEADER} mb-0.5`}>{t("writing.sampleTitle")}</h2>
              <p className="text-xs text-base-content/60">{t("writing.sampleHint")}</p>
            </div>
            <button
              type="button"
              className={BTN_GHOST}
              disabled={sampleWords.length === 0}
              title={
                sampleWords.length === 0
                  ? t("writing.noLexiconWords")
                  : t("writing.fillFromLexicon")
              }
              onClick={() => setSample(sampleWords.slice(0, 24).join(" "))}
              data-testid="writing-fill-lexicon"
            >
              {t("writing.fillFromLexicon")}
            </button>
          </div>

          <textarea
            className={`${TEXTAREA} w-full min-h-24 bg-base-200/30 border-base-300 focus:border-primary focus:outline-none font-mono text-sm leading-relaxed placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:text-base-content/40`}
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            placeholder={t("writing.samplePlaceholder")}
            data-testid="writing-sample"
          />

          {fontLoaded && sample.trim().length > 0 && (
            <div className="rounded-lg border border-base-200 bg-base-200/40 p-3">
              <ScriptPreview text={sample} className="text-2xl" />
            </div>
          )}
        </div>
      </section>

      <section className={CARD} data-testid="writing-coverage">
        <div className={`${CARD_BODY} gap-2.5`}>
          <h2 className={`${SECTION_HEADER} mb-0`}>{t("writing.coverageTitle")}</h2>
          {!inspection.present ? (
            <p className="text-xs text-base-content/60">{t("writing.coverageEmpty")}</p>
          ) : inspection.warning || fontError ? (
            <p className="text-xs text-base-content/60">{t("writing.coverageUnreadable")}</p>
          ) : fontLoading ? (
            <p role="status" className="text-xs text-base-content/60">
              {t("writing.loading")}
            </p>
          ) : coverage.length === 0 ? (
            <p className="text-xs text-success/90 font-medium">{t("writing.coverageOk")}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-warning font-medium">
                {t("writing.coverageMissing", { count: coverage.length })}
              </p>
              <ul className="flex flex-wrap gap-2">
                {coverage.slice(0, 24).map((item) => (
                  <li
                    key={item.character}
                    className="rounded-lg border border-base-300 bg-base-200/30 px-2.5 py-1 text-xs flex items-center gap-1.5"
                    data-testid="coverage-missing"
                  >
                    <span className="font-mono text-sm font-medium">{item.character}</span>
                    <span className="font-mono text-[11px] text-base-content/60">
                      {formatCodepoint(item.codepoint)}
                    </span>
                    <span className="text-[11px] text-base-content/50">
                      {t("writing.coverageWord", { word: item.word })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <ConfirmModal
        open={confirmRemove}
        title={t("writing.removeTitle")}
        message={t("writing.removeConfirm")}
        confirmLabel={t("writing.remove")}
        onConfirm={removeFont}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
