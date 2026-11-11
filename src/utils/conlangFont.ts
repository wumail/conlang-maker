import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useFontStore } from "../store/fontStore";
import type { FontInspection, ResolvedFontBytes } from "../types";

const FONT_FAMILY = "ConlangScript";

let activeFace: FontFace | null = null;
let loadToken = 0;
let inflightInspectionKey = "";
let inflightInspectionPromise: Promise<FontInspection> | null = null;

export function makeFontInspectionKey(
  projectPath: string,
  conlangFilePath: string,
  languageId: string,
  revision: number,
): string {
  return JSON.stringify([projectPath, conlangFilePath, languageId, revision]);
}

export function fetchFontInspection(
  projectPath: string,
  conlangFilePath: string,
  languageId: string,
  revision: number,
): Promise<FontInspection> {
  const key = makeFontInspectionKey(
    projectPath,
    conlangFilePath,
    languageId,
    revision,
  );
  const store = useFontStore.getState();
  if (store.inspectionKey === key && store.inspection) {
    return Promise.resolve(store.inspection);
  }
  if (inflightInspectionKey === key && inflightInspectionPromise) {
    return inflightInspectionPromise;
  }
  const promise = invoke<FontInspection>("inspect_language_font", {
    projectPath,
    conlangFilePath,
    languageId,
  }).finally(() => {
    if (inflightInspectionPromise === promise) {
      inflightInspectionPromise = null;
      inflightInspectionKey = "";
    }
  });
  inflightInspectionKey = key;
  inflightInspectionPromise = promise;
  return promise;
}

/** Invalidate cached FontInspection & FontFace and trigger re-load for active language. */
export function invalidateFontCache(): void {
  inflightInspectionKey = "";
  inflightInspectionPromise = null;
  clearLoadedFont();
  useFontStore.getState().bump();
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function clearLoadedFont(): void {
  if (typeof document === "undefined") return;
  if (activeFace) {
    document.fonts.delete(activeFace);
    activeFace = null;
  }
  document.documentElement.style.removeProperty("--conlang-font");
  document.documentElement.removeAttribute("data-conlang-font");
}

export async function applyResolvedFont(
  bytesOrBase64: Uint8Array | string | null,
): Promise<boolean> {
  const token = ++loadToken;
  clearLoadedFont();
  if (!bytesOrBase64 || typeof document === "undefined") return false;

  try {
    const bytes =
      typeof bytesOrBase64 === "string"
        ? decodeBase64(bytesOrBase64)
        : bytesOrBase64;
    const face = new FontFace(FONT_FAMILY, bytes, {
      weight: "400",
      style: "normal",
      display: "swap",
    });
    await face.load();
    if (token !== loadToken) return false;
    document.fonts.add(face);
    activeFace = face;
    document.documentElement.style.setProperty(
      "--conlang-font",
      `"${FONT_FAMILY}"`,
    );
    document.documentElement.setAttribute("data-conlang-font", "on");
    return true;
  } catch (err) {
    if (token !== loadToken) return false;
    clearLoadedFont();
    throw err;
  }
}

/** Load the active language's resolved font whenever the language or its file changes. */
export function useConlangFont(): void {
  const projectPath = useWorkspaceStore((state) => state.projectPath);
  const conlangFilePath = useWorkspaceStore((state) => state.conlangFilePath);
  const activeLanguageId = useWorkspaceStore((state) => state.activeLanguageId);
  const revision = useFontStore((state) => state.revision);

  useEffect(() => {
    let cancelled = false;
    loadToken += 1;
    clearLoadedFont();
    useFontStore.setState({
      codepoints: null,
      inspection: null,
      inspectionKey: "",
      ownFileRevision: "missing",
      resolvedFileRevision: null,
      loaded: false,
      loading: true,
      error: null,
    });
    const run = async (): Promise<void> => {
      if (!conlangFilePath || !activeLanguageId) {
        await applyResolvedFont(null);
        if (!cancelled) {
          useFontStore.setState({
            codepoints: null,
            inspection: null,
            inspectionKey: "",
            ownFileRevision: "missing",
            resolvedFileRevision: null,
            loaded: false,
            loading: false,
          });
        }
        return;
      }
      const key = makeFontInspectionKey(
        projectPath,
        conlangFilePath,
        activeLanguageId,
        revision,
      );
      try {
        const [font, inspection] = await Promise.all([
          invoke<ResolvedFontBytes | null>("read_resolved_font", {
            projectPath,
            conlangFilePath,
            languageId: activeLanguageId,
          }),
          fetchFontInspection(
            projectPath,
            conlangFilePath,
            activeLanguageId,
            revision,
          ).catch((err) => {
            console.warn(`读取字体字符表失败：${err}`);
            return null;
          }),
        ]);
        if (cancelled) return;
        const decodedBytes = font?.bytes_base64
          ? decodeBase64(font.bytes_base64)
          : null;
        const loaded = await applyResolvedFont(decodedBytes);
        if (cancelled) return;
        const codes =
          inspection && inspection.present && inspection.codepoints.length > 0
            ? inspection.codepoints
            : null;
        useFontStore.setState({
          codepoints: loaded ? codes : null,
          inspection,
          inspectionKey: inspection ? key : "",
          ownFileRevision: inspection?.revision ?? "missing",
          resolvedFileRevision: inspection?.resolved_revision ?? null,
          loaded,
          loading: false,
          error: null,
        });
      } catch (err) {
        console.warn(`读取语言字体失败：${err}`);
        if (!cancelled) {
          await applyResolvedFont(null);
          useFontStore.setState({
            codepoints: null,
            inspection: null,
            inspectionKey: "",
            ownFileRevision: "missing",
            resolvedFileRevision: null,
            loaded: false,
            loading: false,
            error: String(err),
          });
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      loadToken += 1;
      clearLoadedFont();
    };
  }, [projectPath, conlangFilePath, activeLanguageId, revision]);
}
