import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCorpusStore } from "../store/corpusStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { getLanguageViewMemory } from "../lib/languageViewMemory";
import { CorpusList } from "../components/corpus/CorpusList";
import { CorpusEditor } from "../components/corpus/CorpusEditor";

export function CorpusPage() {
  const { t } = useTranslation();
  const { projectPath, activeLanguagePath, activeLanguageId } = useWorkspaceStore();
  const loadIndex = useCorpusStore((s) => s.loadIndex);
  const loadCorpus = useCorpusStore((s) => s.loadCorpus);
  const activeCorpus = useCorpusStore((s) => s.activeCorpus);
  const [params] = useSearchParams();
  const requestedCorpusId = params.get("corpus");

  // 索引与目标语料必须在同一个顺序异步链里加载：loadIndex 会递增 corpusGeneration
  // 作废并发的 loadCorpus（同时承接切换语言后的语料视图记忆恢复）
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      await loadIndex(projectPath, activeLanguagePath);
      if (cancelled) return;
      const state = useCorpusStore.getState();
      const rememberedId = getLanguageViewMemory(activeLanguageId).activeCorpusId ?? null;
      const targetId =
        requestedCorpusId ||
        (rememberedId && state.index.some((item) => item.corpus_id === rememberedId)
          ? rememberedId
          : null);
      if (targetId && state.activeCorpus?.corpus_id !== targetId) {
        await loadCorpus(targetId);
      }
    };
    void sync().catch((err) => console.warn("Corpus page sync failed:", err));
    return () => {
      cancelled = true;
    };
  }, [projectPath, activeLanguagePath, activeLanguageId, requestedCorpusId, loadIndex, loadCorpus]);

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
