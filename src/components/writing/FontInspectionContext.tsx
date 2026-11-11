import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useFontStore } from "../../store/fontStore";
import { fetchFontInspection, makeFontInspectionKey } from "../../utils/conlangFont";
import type { FontInspection } from "../../types";

interface FontInspectionState {
  inspection: FontInspection | null;
  loading: boolean;
  error: string | null;
}

const FontInspectionContext = createContext<FontInspectionState | null>(null);

export function FontInspectionProvider({ children }: { children: ReactNode }) {
  const projectPath = useWorkspaceStore((state) => state.projectPath);
  const conlangFilePath = useWorkspaceStore((state) => state.conlangFilePath);
  const activeLanguageId = useWorkspaceStore((state) => state.activeLanguageId);
  const revision = useFontStore((state) => state.revision);
  const currentKey =
    conlangFilePath && activeLanguageId
      ? makeFontInspectionKey(projectPath, conlangFilePath, activeLanguageId, revision)
      : "";
  const cachedInspection = useFontStore((state) =>
    currentKey && state.inspectionKey === currentKey ? state.inspection : null,
  );

  const [inspection, setInspection] = useState<FontInspection | null>(() => cachedInspection);
  const [loading, setLoading] = useState(() => Boolean(currentKey && !cachedInspection));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!conlangFilePath || !activeLanguageId) {
        setInspection(null);
        setError(null);
        setLoading(false);
        return;
      }
      const store = useFontStore.getState();
      if (store.inspectionKey === currentKey && store.inspection) {
        setInspection(store.inspection);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setInspection(null);
      setError(null);
      try {
        const result = await fetchFontInspection(
          projectPath,
          conlangFilePath,
          activeLanguageId,
          revision,
        );
        if (!cancelled) {
          setInspection(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setInspection(null);
          setError(String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [projectPath, conlangFilePath, activeLanguageId, revision, currentKey]);

  return (
    <FontInspectionContext.Provider value={{ inspection: cachedInspection ?? inspection, loading, error }}>
      {children}
    </FontInspectionContext.Provider>
  );
}

export function useFontInspection(): FontInspectionState {
  const value = useContext(FontInspectionContext);
  if (!value) {
    throw new Error("useFontInspection must be used inside FontInspectionProvider");
  }
  return value;
}
