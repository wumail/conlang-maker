/**
 * Hunspell .dic / .aff 导出（浏览器下载包装层）
 * 纯文本生成位于 src/core/engines/exportDic.ts
 */
import { WordEntry, InflectionRule, PhonologyConfig } from "../types";
import { generateAff, generateDic } from "../core/engines/exportDic";
import { isDesktopRuntime, saveTextFile, writeTextFileAt } from "./fileSave";
import { savePathSafely } from "./safeDialog";

export { generateAff, generateDic };

/**
 * 下载 .dic + .aff 压缩包（以两次独立下载实现，避免引入额外压缩库）
 */
/**
 * 导出 Hunspell .dic + .aff。
 * 桌面端：一次原生保存面板选定 .dic，.aff 自动写到同目录；
 * 浏览器端：两次独立下载。
 */
export async function exportDic(
  words: WordEntry[],
  langName = "conlang",
  inflectionRules?: InflectionRule[],
  phonoConfig?: PhonologyConfig,
): Promise<void> {
  const safeName = langName.replace(/[^a-zA-Z0-9_-]/g, "_") || "conlang";
  const dicContent = generateDic(words, inflectionRules, phonoConfig);
  const affContent = generateAff(langName);

  if (!isDesktopRuntime()) {
    await saveTextFile({ defaultName: `${safeName}.dic`, content: dicContent });
    await saveTextFile({ defaultName: `${safeName}.aff`, content: affContent });
    return;
  }

  const picked = await savePathSafely({
    defaultPath: `${safeName}.dic`,
    filters: [{ name: "Hunspell dictionary", extensions: ["dic"] }],
  });
  if (!picked) return;
  // 保存面板可能被用户改成无后缀（或改成 .txt）：统一补齐 .dic 再派生同名 .aff，
  // 避免写出与 .dic 不同名的伴随文件而让 Hunspell 找不到词缀表。
  const dicPath = /\.dic$/i.test(picked) ? picked : `${picked}.dic`;
  const affPath = dicPath.replace(/\.dic$/i, ".aff");
  try {
    await writeTextFileAt(dicPath, dicContent);
    await writeTextFileAt(affPath, affContent);
  } catch (err) {
    console.warn(`Hunspell export failed: ${err}`);
  }
}
