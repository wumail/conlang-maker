/**
 * scaRuleSetTransfer.ts — 规则集文本导出/复制辅助
 *
 * 统一「单集合 / 全量集合」的序列化与剪贴板/文件下载行为，供 RuleSetList 使用。
 */
import type { SCARuleSet } from "../types";
import { serializeSCARuleSetForImport } from "./scaImportParser";
import { saveTextFile } from "./fileSave";

export interface RuleSetTransferNotice {
  type: "success" | "error";
  text: string;
}

/** 文件名安全化：空白转下划线，剔除非字母数字字符 */
export function safeRuleSetFileName(name: string): string {
  const normalized = name
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  return normalized || "sca_ruleset";
}

/** 保存纯文本文件（桌面端走原生保存面板） */
export async function downloadTextFile(filename: string, content: string): Promise<void> {
  await saveTextFile({
    defaultName: filename,
    content,
    filters: [{ name: "Text", extensions: ["txt"] }],
  });
}

/** 单个规则集的导入格式文本 */
export function serializeRuleSet(ruleSet: SCARuleSet, unnamedLabel: string): string {
  return serializeSCARuleSetForImport(ruleSet.name || unnamedLabel, ruleSet.rules);
}

/** 全量规则集导出文本（带文件头注释） */
export function serializeAllRuleSets(ruleSets: SCARuleSet[], unnamedLabel: string): string {
  const header = ["# SCA Rule Sets Export", `# Total Rule Sets: ${ruleSets.length}`];
  const body = ruleSets.map((ruleSet) => serializeRuleSet(ruleSet, unnamedLabel));
  return [...header, ...body].join("\n\n");
}

/** 复制到剪贴板；返回是否成功（调用方负责提示文案） */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn(`Clipboard write failed: ${err}`);
    return false;
  }
}
