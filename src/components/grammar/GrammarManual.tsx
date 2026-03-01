/**
 * GrammarManual.tsx — Phase 2 语法手册编辑器
 *
 * 支持：章节 CRUD、拖拽排序、嵌入式范式表渲染
 * 范式表语法：{{paradigm:pos_id:testword}}
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { generateParadigm } from "../../utils/morphologyEngine";
import type {
  GrammarChapter,
  GrammarConfig,
  PhonologyConfig,
} from "../../types";
import { Plus, Trash2, GripVertical, Eye, Edit3 } from "lucide-react";
import {
  INPUT,
  TEXTAREA,
  BTN_PRIMARY,
  BTN_ERROR,
  BTN_GHOST,
  BADGE,
} from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";
import { EmptyState } from "../common/EmptyState";
import { generateIPA } from "../../utils/ipaGenerator";
import {
  DndContext,
  closestCenter,
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  type DragEndEvent,
} from "../../utils/useDragReorder";
import { useDndSensors } from "../../utils/useDragReorder";
import { SortableItem } from "../common/SortableItem";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** 渲染 Markdown 内容中的 {{paradigm:pos_id:testword}} 语法 */
const renderContentWithParadigms = (
  content: string,
  config: GrammarConfig,
  phonoConfig: PhonologyConfig,
  t: any,
) => {
  const parts = content.split(/({{paradigm:[^}]+}})/g);
  return parts.map((part, i) => {
    const match = part.match(/{{paradigm:([^:]+):([^}]+)}}/);
    if (!match)
      return (
        <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
          {part}
        </ReactMarkdown>
      );

    const [, posId, testWord] = match;
    const results = generateParadigm(
      testWord,
      posId,
      config.inflection_rules,
      phonoConfig,
    );
    if (results.length === 0)
      return (
        <span key={i} className="text-base-content/50 italic">
          [no rules for {posId}]
        </span>
      );

    return (
      <table key={i} className="table table-sm table-zebra my-2 inline-table">
        <thead>
          <tr>
            <th>{t("grammar.tag")}</th>
            <th>{t("grammar.form")}</th>
            <th>{"IPA"}</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, j) => (
            <tr key={j}>
              <td className="font-mono text-xs">
                {r.tag || Object.values(r.dimensionValues).join("·")}
              </td>
              <td className="font-mono font-bold">{r.result}</td>
              <td className="font-mono text-primary text-sm">
                {generateIPA(r.result, phonoConfig).phonemic}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  });
};

export const GrammarManual: React.FC = () => {
  const { t } = useTranslation();
  const { config, addChapter, updateChapter, deleteChapter, reorderChapters } =
    useGrammarStore();
  const phonoConfig = usePhonoStore((s) => s.config);
  const chapters = [...config.grammar_manual].sort((a, b) => a.order - b.order);

  const [previewChapterId, setPreviewChapterId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const sensors = useDndSensors();

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = chapters.findIndex((c) => c.chapter_id === active.id);
    const newIndex = chapters.findIndex((c) => c.chapter_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(chapters, oldIndex, newIndex);
    reorderChapters(reordered.map((ch, i) => ({ ...ch, order: i })));
  };

  const handleAdd = () => {
    const chapter: GrammarChapter = {
      chapter_id: crypto.randomUUID(),
      title: "",
      content: "",
      order: chapters.length,
      embedded_paradigms: [],
    };
    addChapter(chapter);
  };

  const handleChange = (
    chapterId: string,
    field: keyof GrammarChapter,
    value: GrammarChapter[keyof GrammarChapter],
  ) => {
    const chapter = chapters.find((c) => c.chapter_id === chapterId);
    if (!chapter) return;
    updateChapter(chapterId, { ...chapter, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-base-content">
          {t("grammar.manual.title")}
        </h2>
        <button onClick={handleAdd} className={BTN_PRIMARY}>
          <Plus size={16} /> {t("grammar.manual.addChapter")}
        </button>
      </div>

      {chapters.length === 0 && (
        <EmptyState message={t("grammar.manual.noChapters")} />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={chapters.map((c) => c.chapter_id)}
          strategy={verticalListSortingStrategy}
        >
          {chapters.map((ch, idx) => (
            <SortableItem
              key={ch.chapter_id}
              id={ch.chapter_id}
              className="p-4 border border-base-300 rounded-lg bg-base-200/50 space-y-3"
            >
              {({ listeners, attributes }) => (
                <>
                  <div className="flex items-center gap-2">
                    <span
                      {...listeners}
                      {...attributes}
                      className="cursor-grab"
                    >
                      <GripVertical
                        size={16}
                        className="text-base-content/30"
                      />
                    </span>
                    <span className={`${BADGE} badge-ghost text-xs`}>
                      §{idx + 1}
                    </span>
                    <input
                      type="text"
                      value={ch.title}
                      onChange={(e) =>
                        handleChange(ch.chapter_id, "title", e.target.value)
                      }
                      className={`flex-1 ${INPUT} font-semibold`}
                      placeholder={t("grammar.manual.chapterTitlePlaceholder")}
                    />
                    <button
                      onClick={() =>
                        setPreviewChapterId(
                          previewChapterId === ch.chapter_id
                            ? null
                            : ch.chapter_id,
                        )
                      }
                      className={BTN_GHOST}
                      title={t("common.preview")}
                    >
                      {previewChapterId === ch.chapter_id ? (
                        <Edit3 size={14} />
                      ) : (
                        <Eye size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(ch.chapter_id)}
                      className={BTN_ERROR}
                      title={t("grammar.manual.deleteChapter")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {previewChapterId === ch.chapter_id ? (
                    <div className="prose prose-sm max-w-none p-3 bg-base-100 rounded border">
                      {renderContentWithParadigms(
                        ch.content,
                        config,
                        phonoConfig,
                        t,
                      )}
                    </div>
                  ) : (
                    <textarea
                      value={ch.content}
                      onChange={(e) =>
                        handleChange(ch.chapter_id, "content", e.target.value)
                      }
                      className={`w-full ${TEXTAREA} min-h-[160px] font-mono text-sm`}
                      placeholder={t("grammar.manual.contentPlaceholder")}
                    />
                  )}
                </>
              )}
            </SortableItem>
          ))}
        </SortableContext>
      </DndContext>

      <ConfirmModal
        open={!!deleteTarget}
        title={t("grammar.manual.deleteChapter")}
        message={t("grammar.manual.deleteChapterConfirm")}
        onConfirm={() => {
          if (deleteTarget) deleteChapter(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
