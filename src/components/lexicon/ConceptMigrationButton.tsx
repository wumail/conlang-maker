import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLexiconStore } from "../../store/lexiconStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { ConceptDefinition } from "../../types";
import type { ConceptMigrationResult } from "../../core/workflows/conceptMigration";
import { ConceptMigrationModal } from "./ConceptMigrationModal";

const EMPTY_CONCEPTS: readonly ConceptDefinition[] = [];

/** 「迁移旧式概念标签」入口：自带弹窗与落地逻辑，宿主只需渲染本组件 */
export const ConceptMigrationButton: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wordsList = useLexiconStore((s) => s.wordsList);
  const upsertWord = useLexiconStore((s) => s.upsertWord);
  const customConcepts = useWorkspaceStore((s) => s.config.custom_concepts) ?? EMPTY_CONCEPTS;
  const addCustomConcepts = useWorkspaceStore((s) => s.addCustomConcepts);

  const apply = (result: ConceptMigrationResult) => {
    addCustomConcepts(result.customConcepts);
    // 只回写发生变化的词条，未改动项保持原对象引用
    result.words.forEach((word, index) => {
      if (word !== wordsList[index]) upsertWord(word);
    });
  };

  return (
    <>
      <button
        className="w-full text-left text-primary hover:underline"
        onClick={() => setOpen(true)}
      >
        {t("concept.migration.title")}
      </button>
      <ConceptMigrationModal
        open={open}
        words={wordsList}
        customConcepts={customConcepts}
        onApply={apply}
        onClose={() => setOpen(false)}
      />
    </>
  );
};
