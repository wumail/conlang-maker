import { create } from "zustand";
import type { FontInspection } from "../types";

interface FontStore {
  /** Bumped after a language imports or removes its own font file. */
  revision: number;
  /** Cmap of the resolved font. Null when this language has no readable font. */
  codepoints: number[] | null;
  /** Cached inspection result for the active language font. */
  inspection: FontInspection | null;
  /** Key matching [projectPath, conlangFilePath, activeLanguageId, revision] for `inspection`. */
  inspectionKey: string;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  bump: () => void;
  setCodepoints: (codepoints: number[] | null) => void;
}

export const useFontStore = create<FontStore>((set) => ({
  revision: 0,
  codepoints: null,
  inspection: null,
  inspectionKey: "",
  loaded: false,
  loading: false,
  error: null,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
  setCodepoints: (codepoints) => set({ codepoints }),
}));
