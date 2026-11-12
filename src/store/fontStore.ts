import { create } from "zustand";
import type { FontInspection } from "../types";
import { EMPTY_FONT_INPUT_INDEX, type FontInputIndex } from "../core/engines/fontInput";

interface FontStore {
  /** Bumped after a language imports or removes its own font file or on external font change. */
  revision: number;
  /** Disk revision of this language's own font file ("missing" when inherited or absent). */
  ownFileRevision: string;
  /** Disk revision of the resolved font file (own or ancestor). */
  resolvedFileRevision: string | null;
  /** Cmap of the resolved font. Null when this language has no readable font. */
  codepoints: number[] | null;
  /** Cached inspection result for the active language font. */
  inspection: FontInspection | null;
  /** Key matching [projectPath, conlangFilePath, activeLanguageId, revision] for `inspection`. */
  inspectionKey: string;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  inputIndex: FontInputIndex;
  bump: () => void;
  setCodepoints: (codepoints: number[] | null) => void;
}

export const useFontStore = create<FontStore>((set) => ({
  revision: 0,
  ownFileRevision: "missing",
  resolvedFileRevision: null,
  codepoints: null,
  inspection: null,
  inspectionKey: "",
  loaded: false,
  loading: false,
  error: null,
  inputIndex: EMPTY_FONT_INPUT_INDEX,
  bump: () =>
    set((state) => ({
      revision: state.revision + 1,
      inspectionKey: "",
    })),
  setCodepoints: (codepoints) => set({ codepoints }),
}));
