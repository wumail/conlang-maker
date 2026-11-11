/**
 * LLM Prompt 模板导出（浏览器下载与剪贴板包装层）
 * 纯文本生成位于 src/core/engines/llmPrompt.ts
 */
import {
  generateLLMPrompt,
  type PromptExportOptions,
} from "../core/engines/llmPrompt";

export { generateLLMPrompt, type PromptExportOptions };

/** 将 prompt 下载为 .md 文件 */
export function exportPromptAsMarkdown(opts: PromptExportOptions): void {
  const content = generateLLMPrompt(opts);
  const safeName = opts.langName.replace(/[^a-zA-Z0-9_-]/g, "_") || "conlang";
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}_llm_prompt.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 将 prompt 复制到剪贴板 */
export async function copyPromptToClipboard(
  opts: PromptExportOptions,
): Promise<void> {
  const content = generateLLMPrompt(opts);
  await navigator.clipboard.writeText(content);
}
