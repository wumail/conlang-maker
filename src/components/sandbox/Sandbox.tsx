/**
 * Sandbox.tsx — 翻译沙盒（Phase 3）
 *
 * 1. 标签屈折模式：`gloss-TAG1-TAG2` 逐词翻译
 * 2. 短语句法台：主语 NP / 动词 TAM / 宾语 NP / 斜格 PP 的结构化构建
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { CARD } from "../../lib/ui";
import { PageHeader } from "../common/PageHeader";
import { GlossSandboxCard } from "./GlossSandboxCard";
import { ClauseBuilderCard } from "./ClauseBuilderCard";
import { InflectionHelperCard } from "./InflectionHelperCard";

type SandboxMode = "gloss" | "clause";

export const Sandbox: React.FC = () => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<SandboxMode>("clause");

  return (
    <div className="space-y-6">
      <PageHeader icon={<Languages size={24} />} title={t("sandbox.title")}>
        <p className="max-w-2xl text-right text-xs text-base-content/50">
          {t("sandbox.description")}
        </p>
      </PageHeader>

      <div className={`${CARD} p-6`}>
        <div role="tablist" className="tabs tabs-border mb-4">
          <button
            role="tab"
            className={`tab ${mode === "clause" ? "tab-active" : ""}`}
            onClick={() => setMode("clause")}
          >
            {t("sandbox.clauseMode")}
          </button>
          <button
            role="tab"
            className={`tab ${mode === "gloss" ? "tab-active" : ""}`}
            onClick={() => setMode("gloss")}
          >
            {t("sandbox.glossMode")}
          </button>
        </div>

        {mode === "clause" ? <ClauseBuilderCard /> : <GlossSandboxCard />}

        <div className="mt-6">
          <InflectionHelperCard />
        </div>
      </div>
    </div>
  );
};
