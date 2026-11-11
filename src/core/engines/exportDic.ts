/**
 * Hunspell .dic / .aff 纯文本生成模块（不含 DOM 下载依赖）
 */
import { WordEntry, InflectionRule, PhonologyConfig } from "../../types";
import { generateParadigm } from "./morphologyEngine";

/**
 * 生成 .aff 文件内容（最简版本）
 * Hunspell 至少需要一个 .aff 文件，即使为空也要有 SET 行
 */
export function generateAff(langName: string): string {
  return [`# Affix file for ${langName}`, "SET UTF-8", ""].join("\n");
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

    if (inflectionRules && phonoConfig && w.senses.length > 0) {
      for (const sense of w.senses) {
        if (!sense.pos_id) continue;
        const paradigm = generateParadigm(
          base,
          sense.pos_id,
          inflectionRules,
          phonoConfig,
        );
        for (const entry of paradigm) {
          if (entry.result) allForms.add(entry.result);
        }
      }
    }
  }

  const sorted = [...allForms].sort();
  return [String(sorted.length), ...sorted].join("\n");
}
