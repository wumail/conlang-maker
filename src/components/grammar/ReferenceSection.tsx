/**
 * ReferenceSection — 参考 & 测试聚合标签页
 *
 * 将语法手册和屈折测试合并到一个标签页内，通过子标签切换。
 */
import React from "react";
import { GrammarManual } from "./GrammarManual";

export const ReferenceSection: React.FC = () => {
  return (
    <div className="space-y-4 bg-base-100 p-6 min-w-[900px] flex-1">
      {/* <h3 className="text-sm font-semibold text-base-content/70">
        {t("grammar.sections.manual")}
      </h3> */}
      <GrammarManual />
    </div>
  );
};
