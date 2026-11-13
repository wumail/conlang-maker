/**
 * scaRuleSetImport.ts — 规则集文本导入的解析与本地化错误装配
 *
 * 从 `RuleSetList` 抽出，保持组件只负责状态与渲染。
 */
import type { TFunction } from "i18next";
import type { SCARule } from "../types";
import { parseSCARulesText } from "../utils/scaImportParser";

export interface ImportedRuleSet {
  rules: SCARule[];
  errors: string[];
}

/** 解析导入文本；出错时返回最多 6 条本地化错误（其余折叠为计数） */
export function parseRuleSetImport(
  text: string,
  newRuleId: () => string,
  t: TFunction,
): ImportedRuleSet {
  const parsed = parseSCARulesText(text);
  if (parsed.rules.length === 0) {
    return { rules: [], errors: [t("sca.importRuleSetNoRules")] };
  }
  if (parsed.errors.length > 0) {
    const errors = parsed.errors
      .slice(0, 6)
      .map((error) =>
        t("sca.importRuleSetErrorLine", {
          line: error.line,
          source: error.source.trim(),
        }),
      );
    if (parsed.errors.length > 6) {
      errors.push(t("sca.importRuleSetMoreErrors", { count: parsed.errors.length - 6 }));
    }
    return { rules: [], errors };
  }
  return {
    rules: parsed.rules.map((rule) => ({ ...rule, rule_id: newRuleId() })),
    errors: [],
  };
}
