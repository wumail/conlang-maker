/**
 * Hunspell .dic / .aff 导出（浏览器下载包装层）
 * 纯文本生成位于 src/core/engines/exportDic.ts
 */
import { WordEntry, InflectionRule, PhonologyConfig } from "../types";
import { generateAff, generateDic } from "../core/engines/exportDic";

export { generateAff, generateDic };

/**
 * 下载 .dic + .aff 压缩包（以两次独立下载实现，避免引入额外压缩库）
 */
export function exportDic(
  words: WordEntry[],
  langName = "conlang",
  inflectionRules?: InflectionRule[],
  phonoConfig?: PhonologyConfig,
): void {
  const safeName = langName.replace(/[^a-zA-Z0-9_-]/g, "_") || "conlang";

  // 下载 .dic
  const dicContent = generateDic(words, inflectionRules, phonoConfig);
  downloadFile(`${safeName}.dic`, dicContent);

  // 下载 .aff
  const affContent = generateAff(langName);
  downloadFile(`${safeName}.aff`, affContent);
}

function downloadFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
