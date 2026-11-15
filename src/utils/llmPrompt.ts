/**
 * LLM Prompt 模板导出（浏览器下载与剪贴板包装层）
 * 纯文本生成位于 src/core/engines/llmPrompt.ts
 */
import {
  generateLLMPrompt,
  type PromptExportOptions,
} from "../core/engines/llmPrompt";
import type { CorpusText, GlossToken } from "../types";
import { saveTextFile } from "./fileSave";

export { generateLLMPrompt, type PromptExportOptions };

/** 将 prompt 下载为 .md 文件 */
export async function exportPromptAsMarkdown(opts: PromptExportOptions): Promise<void> {
  const content = generateLLMPrompt(opts);
  const safeName = opts.langName.replace(/[^a-zA-Z0-9_-]/g, "_") || "conlang";
  await saveTextFile({
    defaultName: `${safeName}_llm_prompt.md`,
    content,
    mimeType: "text/markdown;charset=utf-8",
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
}

/** 将 prompt 复制到剪贴板 */
export async function copyPromptToClipboard(
  opts: PromptExportOptions,
): Promise<void> {
  const content = generateLLMPrompt(opts);
  await navigator.clipboard.writeText(content);
}

/**
 * 语料文集 → 三行对照 Markdown（表层 / 词素切分 / 词汇注释 + 整行译文）。
 *
 * 导出页（语料 .md）与参考语法书共用同一拼装格式，收在此处避免页面组件重复实现。
 */
export function corpusTextsToMarkdown(texts: readonly CorpusText[]): string {
  return texts
    .map((corpus) => {
      const lines = corpus.glossed_lines.map((line) => {
        const row = (pick: (token: GlossToken) => string): string =>
          line.tokens.map(pick).join("\t");
        return [
          row((token) => token.surface_form),
          row((token) => token.morpheme_break),
          row((token) => token.gloss_labels),
          `'${line.translation}'`,
        ].join("\n");
      });
      return `# ${corpus.title || corpus.corpus_id}\n${corpus.description}\n\n${corpus.original_text}\n\n${lines.join("\n\n")}`;
    })
    .join("\n\n---\n\n");
}
