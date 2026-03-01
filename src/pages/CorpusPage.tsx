import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useCorpusStore } from "../store/corpusStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { CorpusList } from "../components/corpus/CorpusList";
import { CorpusEditor } from "../components/corpus/CorpusEditor";

export function CorpusPage() {
  const { t } = useTranslation();
  const { projectPath, activeLanguagePath } = useWorkspaceStore();
  const loadIndex = useCorpusStore((s) => s.loadIndex);
  const activeCorpus = useCorpusStore((s) => s.activeCorpus);

  useEffect(() => {
    loadIndex(projectPath, activeLanguagePath);
  }, [projectPath, activeLanguagePath, loadIndex]);

  return (
    <div className="flex-1 flex overflow-hidden">
      <CorpusList />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Editor */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeCorpus ? (
            <CorpusEditor />
          ) : (
            <div className="flex items-center justify-center h-full text-base-content/50">
              {t("corpus.noTexts")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
