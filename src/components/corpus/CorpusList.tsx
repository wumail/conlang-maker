import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Search } from "lucide-react";
import { ConfirmModal } from "../common/ConfirmModal";
import { useCorpusStore } from "../../store/corpusStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { BTN_GHOST_SQ } from "../../lib/ui";

export function CorpusList() {
  const { t } = useTranslation();
  const {
    index,
    activeCorpusId,
    setActiveCorpusId,
    deleteCorpus,
    upsertCorpus,
  } = useCorpusStore();
  const { activeLanguageId } = useWorkspaceStore();
  const [search, setSearch] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filtered = index.filter(
    (e) =>
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase()),
  );

  const handleAdd = () => {
    const now = new Date().toISOString();
    const id = `corpus_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    upsertCorpus({
      corpus_id: id,
      language_id: activeLanguageId,
      title: t("corpus.addText"),
      description: "",
      original_text: "",
      glossed_lines: [],
      free_translation: "",
      metadata: { tags: [], created_at: now, updated_at: now },
    });
    setActiveCorpusId(id);
  };

  const handleDeleteClick = (corpusId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(corpusId);
  };

  return (
    <div className="w-64 border-r border-base-300 h-full flex flex-col bg-base-200">
      <div className="p-4 border-b border-base-300 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-lg text-base-content">
            {t("corpus.title")}
          </h2>
          <button
            onClick={handleAdd}
            className={BTN_GHOST_SQ}
            title={t("corpus.addText")}
          >
            <Plus size={18} />
          </button>
        </div>
        <div className="input input">
          <Search className="text-base-content" size={16} />
          <input
            type="text"
            placeholder={t("corpus.searchPlaceholder")}
            className={`w-full pr-2 grow`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {filtered.map((entry) => (
          <div
            key={entry.corpus_id}
            onClick={() => setActiveCorpusId(entry.corpus_id)}
            className={`p-3 border-b border-base-200 rounded cursor-pointer hover:bg-primary/10 flex items-center gap-2 ${activeCorpusId === entry.corpus_id ? "bg-primary/15" : ""
              }`}
          >
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-base-content truncate">
                {entry.title}
              </div>
              {entry.description && (
                <div className="text-xs text-base-content/60 truncate">
                  {entry.description}
                </div>
              )}
            </div>
            <button
              className="text-base-content/50 hover:text-error shrink-0"
              onClick={(e) => handleDeleteClick(entry.corpus_id, e)}
              title={t("common.delete")}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <ConfirmModal
        open={!!confirmDeleteId}
        title={t("common.delete")}
        message={t("corpus.deleteConfirm")}
        onConfirm={() => {
          if (confirmDeleteId) deleteCorpus(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
