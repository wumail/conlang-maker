import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Tag, X, Plus } from "lucide-react";
import type { ConceptDefinition } from "../../types";
import {
  getCoreConcept,
  searchConcepts,
  type SemanticField,
} from "../../data/core_concepts";
import { INPUT, BTN_GHOST_SQ } from "../../lib/ui";
import { useSemanticFieldLabels } from "../../lib/labelMaps";
import { slugifyConceptId } from "../../core/workflows/conceptMigration";

interface ConceptPickerProps {
  /** 已绑定的 concept_id */
  value?: string;
  onChange: (conceptId: string | undefined) => void;
  /** 工作区自定义概念 */
  customConcepts?: readonly ConceptDefinition[];
  /** 允许把查询词一键新建为自定义概念 */
  onCreate?: (concept: ConceptDefinition) => void;
  compact?: boolean;
}

/** 词义的概念锚点选择器（可搜索，支持中英文 / ID / 语义域） */
export const ConceptPicker: React.FC<ConceptPickerProps> = ({
  value,
  onChange,
  customConcepts = [],
  onCreate,
  compact = false,
}) => {
  const { t } = useTranslation();
  const fieldLabels = useSemanticFieldLabels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [field, setField] = useState<SemanticField | "">("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const current = useMemo(() => {
    if (!value) return null;
    return getCoreConcept(value) ?? customConcepts.find((c) => c.concept_id === value) ?? null;
  }, [value, customConcepts]);

  const hits = useMemo(
    () => searchConcepts(query, { field, extra: customConcepts, limit: 30 }),
    [query, field, customConcepts],
  );

  const openPanel = () => {
    setOpen(true);
    setQuery("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const pick = (conceptId: string) => {
    onChange(conceptId);
    setOpen(false);
  };

  const createCustom = () => {
    const label = query.trim();
    if (!label || !onCreate) return;
    // 自定义概念 ID 与迁移工作流共用同一 slug 规则，避免两处生成的 ID 不一致
    const baseId = slugifyConceptId(label);
    const taken =
      Boolean(getCoreConcept(baseId)) ||
      customConcepts.some((concept) => concept.concept_id === baseId);
    const concept: ConceptDefinition = {
      concept_id: taken ? `${baseId}_custom` : baseId,
      gloss_en: label,
      gloss_zh: label,
      semantic_field: field || "culture",
      standard_lists: [],
    };
    onCreate(concept);
    pick(concept.concept_id);
  };

  if (!open) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={openPanel}
          className={`flex items-center gap-1 rounded border border-base-300 bg-base-100 px-2 ${
            compact ? "py-0.5 text-xs" : "py-1 text-sm"
          } hover:border-primary/60`}
          title={t("lexicon.concept.pick")}
        >
          <Tag size={compact ? 11 : 13} className="text-base-content/50" />
          {current ? (
            <span>
              <span className="text-base-content/80">
                {current.gloss_zh || current.gloss_en}
              </span>
              <span className="ml-1 font-mono text-[10px] text-base-content/40">
                {current.concept_id}
              </span>
            </span>
          ) : (
            <span className="text-base-content/40">{t("lexicon.concept.none")}</span>
          )}
        </button>
        {current && (
          <button
            type="button"
            className={BTN_GHOST_SQ}
            onClick={() => onChange(undefined)}
            title={t("lexicon.concept.clear")}
          >
            <X size={12} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-base-content/40"
          />
          <input
            ref={inputRef}
            className={`${INPUT} w-full pl-7 text-sm`}
            value={query}
            placeholder={t("lexicon.concept.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
              if (event.key === "Enter" && hits[0]) pick(hits[0].concept.concept_id);
            }}
          />
        </div>
        <select
          className="select select-bordered select-xs"
          value={field}
          onChange={(event) => setField(event.target.value as SemanticField | "")}
          title={t("lexicon.concept.fieldFilter")}
        >
          <option value="">{t("lexicon.concept.allFields")}</option>
          {(Object.keys(fieldLabels) as SemanticField[]).map((key) => (
            <option key={key} value={key}>
              {fieldLabels[key]}
            </option>
          ))}
        </select>
        <button className={BTN_GHOST_SQ} onClick={() => setOpen(false)} title={t("common.cancel")}>
          <X size={13} />
        </button>
      </div>

      <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg">
        {hits.length === 0 && (
          <p className="px-3 py-2 text-xs text-base-content/50">{t("lexicon.concept.empty")}</p>
        )}
        {hits.map((hit) => (
          <button
            key={hit.concept.concept_id}
            type="button"
            onClick={() => pick(hit.concept.concept_id)}
            className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-base-200 ${
              hit.concept.concept_id === value ? "bg-primary/10" : ""
            }`}
          >
            <span className="truncate">
              <span>{hit.concept.gloss_zh || hit.concept.gloss_en}</span>
              <span className="ml-1 text-xs text-base-content/50">{hit.concept.gloss_en}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-base-content/40">
              {hit.isCustom && <span className="badge badge-xs badge-ghost">custom</span>}
              <span>{fieldLabels[hit.concept.semantic_field as SemanticField] ?? hit.concept.semantic_field}</span>
            </span>
          </button>
        ))}
        {onCreate && query.trim() && (
          <button
            type="button"
            onClick={createCustom}
            className="flex w-full items-center gap-1 border-t border-base-200 px-3 py-1.5 text-left text-sm text-primary hover:bg-base-200"
          >
            <Plus size={12} /> {t("lexicon.concept.create", { label: query.trim() })}
          </button>
        )}
      </div>
    </div>
  );
};
