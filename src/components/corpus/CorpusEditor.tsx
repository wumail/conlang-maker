import { useTranslation } from "react-i18next";
import { useCorpusStore } from "../../store/corpusStore";
import { GlossingEditor } from "./GlossingEditor";
import { INPUT, TEXTAREA, CARD, CARD_BODY } from "../../lib/ui";

export function CorpusEditor() {
  const { t } = useTranslation();
  const corpus = useCorpusStore((s) => s.activeCorpus);
  const upsertCorpus = useCorpusStore((s) => s.upsertCorpus);

  if (!corpus) return null;

  const update = (field: string, value: string) => {
    upsertCorpus({
      ...corpus,
      [field]: value,
      metadata: { ...corpus.metadata, updated_at: new Date().toISOString() },
    });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Meta fields */}
      <div className={CARD}>
        <div className={`${CARD_BODY} p-4 space-y-3`}>
          <div>
            <label className="text-xs text-base-content/60">
              {t("corpus.editTitle")}
            </label>
            <input
              className={`${INPUT} w-full`}
              value={corpus.title}
              onChange={(e) => update("title", e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-base-content/60">
              {t("corpus.description")}
            </label>
            <input
              className={`${INPUT} w-full`}
              value={corpus.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-base-content/60">
              {t("corpus.originalText")}
            </label>
            <textarea
              className={`${TEXTAREA} w-full h-24 font-mono`}
              value={corpus.original_text}
              onChange={(e) => update("original_text", e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-base-content/60">
              {t("corpus.freeTranslation")}
            </label>
            <textarea
              className={`${TEXTAREA} w-full h-16`}
              value={corpus.free_translation}
              onChange={(e) => update("free_translation", e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-base-content/60">
              {t("corpus.tags")}
            </label>
            <input
              className={`${INPUT} w-full`}
              value={corpus.metadata.tags.join(", ")}
              onChange={(e) =>
                upsertCorpus({
                  ...corpus,
                  metadata: {
                    ...corpus.metadata,
                    tags: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    updated_at: new Date().toISOString(),
                  },
                })
              }
            />
          </div>
        </div>
      </div>

      {/* Glossing Editor */}
      <GlossingEditor />
    </div>
  );
}
