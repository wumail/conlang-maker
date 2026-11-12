import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { FontInspection, WriteResult } from "../../types";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useFontStore } from "../../store/fontStore";
import { usePhonoStore } from "../../store/phonoStore";
import { parseFontFeature, resolveFontFeatures } from "../../core/engines/fontLayout";
import { textToFontInput } from "../../core/engines/fontInput";
import { useLexiconStore } from "../../store/lexiconStore";
import {
  computeJsonDiffSummary,
  generateOperationId,
  isConflictError,
  recordGuiOperationId,
  useConflictStore,
} from "../../store/conflictStore";
import { openPathSafely, messageSafely } from "../../utils/safeDialog";
import { decodeBase64 } from "../../utils/conlangFont";
import { charactersOf } from "../../utils/unicodeBlocks";
import { ConfirmModal } from "../common/ConfirmModal";
import { useFontInspection } from "./FontInspectionContext";
import { FontStatusCard } from "./FontStatusCard";
import {
  FontSampleAndCoverage,
  type MissingCharacterItem,
} from "./FontSampleAndCoverage";

export function FontPanel() {
  const { t } = useTranslation();
  const { inspection, loading, error } = useFontInspection();
  const projectPath = useWorkspaceStore((state) => state.projectPath);
  const conlangFilePath = useWorkspaceStore((state) => state.conlangFilePath);
  const activeLanguageId = useWorkspaceStore((state) => state.activeLanguageId);
  const languages = useWorkspaceStore((state) => state.config.languages);
  const wordsList = useLexiconStore((state) => state.wordsList);
  const fontLoaded = useFontStore((state) => state.loaded);
  const fontLoading = useFontStore((state) => state.loading);
  const fontError = useFontStore((state) => state.error);
  const inputIndex = useFontStore((state) => state.inputIndex);
  const phonoConfig = usePhonoStore((state) => state.config);
  const fontFeatures = phonoConfig.font_features ?? [];
  const setFontFeatures = usePhonoStore((state) => state.setFontFeatures);
  const modernMode = useMemo(() => {
    try {
      return resolveFontFeatures(fontFeatures).some((feature) => {
        const parsed = parseFontFeature(feature);
        return parsed.tag === "ss01" && parsed.value > 0;
      });
    } catch {
      return false;
    }
  }, [fontFeatures]);
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
      for (const character of charactersOf(textToFontInput(word, phonoConfig, inputIndex))) {
        if (/^\s+$/u.test(character)) continue;
        const codepoint = character.codePointAt(0);
        if (
          codepoint === undefined ||
          covered.has(codepoint) ||
          missing.has(character)
        ) {
          continue;
        }
        missing.set(character, { character, codepoint, word });
      }
    }
    return [...missing.values()];
  }, [inspection, sampleWords, fontLoading, phonoConfig, inputIndex]);

  const enqueueFontConflict = async (
    languagePath: string,
    localActionDesc: Record<string, unknown>,
    retryWithLatestRevision: (latestRevision: string) => Promise<void>,
  ): Promise<void> => {
    let latestRevision = "missing";
    let diskSummary: Record<string, unknown> = {};
    try {
      const latest = await invoke<FontInspection>("inspect_language_font", {
        projectPath,
        conlangFilePath,
        languageId: activeLanguageId,
      });
      latestRevision = latest.revision ?? "missing";
      diskSummary = {
        file_name: latest.file_name,
        has_own: latest.has_own,
        revision: latestRevision,
      };
    } catch (err) {
      console.warn(`Failed to inspect latest font on conflict: ${err}`);
    }
    const diff = computeJsonDiffSummary(localActionDesc, diskSummary);
    useConflictStore.getState().upsertConflict(
      {
        key: `font:${projectPath}:${languagePath}`,
        kind: "font",
        projectPath,
        languagePath,
        languageId: activeLanguageId,
        corpusId: null,
        origin: "external",
        diskRevision: latestRevision,
        reason: "CONFLICT",
        changedFields: diff.changedFields,
        localPreview: diff.localPreview,
        diskPreview: diff.diskPreview,
      },
      {
        keepLocal: async (diskRevision) => {
          await retryWithLatestRevision(diskRevision);
          useFontStore.getState().bump();
        },
        useDisk: async () => {
          useFontStore.getState().bump();
        },
      },
    );
  };

  const runCheckedImport = async (
    languagePath: string,
    sourcePath: string,
    expectedRevision: string,
  ): Promise<void> => {
    const candidate = await invoke<string>("read_font_candidate", {
      sourcePath,
    });
    const bytes = decodeBase64(candidate);
    await new FontFace("ConlangImportCandidate", bytes).load();
    const opId = generateOperationId();
    recordGuiOperationId(opId);
    await invoke<WriteResult>("import_checked_language_font", {
      projectPath,
      languagePath,
      sourcePath,
      expectedBase64: candidate,
      expectedRevision,
      operationId: opId,
    });
  };

  const importFont = async (): Promise<void> => {
    if (!active) return;
    const picked = await openPathSafely({
      title: inspection?.has_own ? t("writing.replace") : t("writing.import"),
      filters: [{ name: "Font", extensions: ["otf", "ttf"] }],
    });
    if (!picked) return;
    setBusy(true);
    try {
      await runCheckedImport(
        active.path,
        picked,
        inspection?.revision ?? "missing",
      );
      useFontStore.getState().bump();
    } catch (err) {
      if (isConflictError(err)) {
        await enqueueFontConflict(
          active.path,
          { action: "import_font", source_path: picked },
          (latestRev) => runCheckedImport(active.path, picked, latestRev),
        );
      } else {
        await messageSafely(`${t("writing.importFailed")}\n${err}`, {
          title: t("writing.import"),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const removeFont = async (): Promise<void> => {
    if (!active) return;
    setBusy(true);
    try {
      const opId = generateOperationId();
      recordGuiOperationId(opId);
      await invoke<WriteResult>("clear_language_font", {
        projectPath,
        languagePath: active.path,
        expectedRevision: inspection?.revision ?? "missing",
        operationId: opId,
      });
      useFontStore.getState().bump();
    } catch (err) {
      if (isConflictError(err)) {
        await enqueueFontConflict(
          active.path,
          { action: "clear_language_font" },
          async (latestRev) => {
            const opId = generateOperationId();
            recordGuiOperationId(opId);
            await invoke<WriteResult>("clear_language_font", {
              projectPath,
              languagePath: active.path,
              expectedRevision: latestRev,
              operationId: opId,
            });
          },
        );
      } else {
        await messageSafely(`${t("writing.removeFailed")}\n${err}`, {
          title: t("writing.removeTitle"),
        });
      }
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  const showFolder = async (): Promise<void> => {
    const languagePath = inspection?.owner_path ?? active?.path;
    if (!languagePath) return;
    try {
      await invoke("show_in_folder", { projectPath, languagePath });
    } catch (err) {
      console.warn("Failed to show font folder:", err);
    }
  };

  if (!activeLanguageId) {
    return (
      <p className="p-6 text-sm text-base-content/70">
        {t("writing.noLanguage")}
      </p>
    );
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
      <FontStatusCard
        inspection={inspection}
        fontError={fontError}
        busy={busy}
        onImport={() => void importFont()}
        onRemoveRequest={() => setConfirmRemove(true)}
        onShowFolder={() => void showFolder()}
      />

      {inspection.substitution_features?.includes("ss01") && (
        <label className="form-control max-w-sm gap-2">
          <span className="label-text">{t("writing.displayMode")}</span>
          <select
            className="select select-bordered"
            data-testid="font-writing-mode"
            value={modernMode ? "modern" : "default"}
            onChange={(event) => {
              const remaining = fontFeatures.filter((feature) => !/^[+-]?ss01(?:=\d+)?$/.test(feature));
              setFontFeatures([...remaining, event.target.value === "modern" ? "ss01=1" : "ss01=0"]);
            }}
          >
            <option value="default">{t("writing.traditionalMode")}</option>
            <option value="modern">{t("writing.modernMode")}</option>
          </select>
        </label>
      )}

      <FontSampleAndCoverage
        inspection={inspection}
        sample={sample}
        onSampleChange={setSample}
        sampleWords={sampleWords}
        fontLoaded={fontLoaded}
        fontLoading={fontLoading}
        fontError={fontError}
        coverage={coverage}
      />

      <ConfirmModal
        open={confirmRemove}
        title={t("writing.removeTitle")}
        message={t("writing.removeConfirm")}
        confirmLabel={t("writing.remove")}
        onConfirm={() => void removeFont()}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
