/**
 * Hunspell .dic / .aff 导出
 * 生成可被拼写检查工具（LibreOffice、VS Code 等）加载的自定义词典文件
 */
import { WordEntry, InflectionRule, PhonologyConfig } from "../types";
import { generateParadigm } from "./morphologyEngine";

/**
 * 生成 .aff 文件内容（最简版本）
 * Hunspell 至少需要一个 .aff 文件，即使为空也要有 SET 行
 */
export function generateAff(langName: string): string {
  return [
    `# Affix file for ${langName}`,
    "SET UTF-8",
    "",
  ].join("\n");
}

/**
 * 生成 .dic 文件内容
 * 格式：首行词条计数，后续每行一个词条
 * 包含基础形式和所有屈折形式
 */
export function generateDic(
  words: WordEntry[],
  inflectionRules?: InflectionRule[],
  phonoConfig?: PhonologyConfig,
): string {
  const allForms = new Set<string>();

  for (const w of words) {
    const base = w.con_word_romanized;
    if (!base) continue;
    allForms.add(base);

    // 尝试生成屈折变位形式
    if (inflectionRules && phonoConfig && w.senses.length > 0) {
      for (const sense of w.senses) {
        if (!sense.pos_id) continue;
        const paradigm = generateParadigm(base, sense.pos_id, inflectionRules, phonoConfig);
        for (const entry of paradigm) {
          if (entry.result) allForms.add(entry.result);
        }
      }
    }
  }

  const sorted = [...allForms].sort();
  return [String(sorted.length), ...sorted].join("\n");
}

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
