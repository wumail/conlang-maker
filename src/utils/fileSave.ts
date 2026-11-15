/**
 * fileSave.ts — 桌面端原生保存对话框 + 写文件，浏览器端回退为下载。
 *
 * Tauri 的 WKWebView 不会处理 `<a download>` 的 blob 下载（点击后静默丢弃），
 * 因此所有导出都必须走原生保存面板 + Rust 写盘命令。
 */
import { invoke } from "@tauri-apps/api/core";
import type { WriteResult } from "../types";
import { savePathSafely } from "./safeDialog";

interface SaveDialogFilter {
  name: string;
  extensions: string[];
}

interface SaveOptions {
  title?: string;
  defaultName: string;
  filters?: SaveDialogFilter[];
}

export function isDesktopRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

/** 浏览器环境下的下载回退（开发预览用） */
export function downloadInBrowser(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 直接写入指定路径（用于「同目录伴随文件」，例如 .dic 旁边的 .aff） */
export async function writeTextFileAt(filePath: string, content: string): Promise<void> {
  await invoke<WriteResult>("write_text_file", { filePath, content });
}

/** 统一兜底：写盘失败不应变成未捕获的 Promise 拒绝 */
function warnWriteFailure(err: unknown): void {
  console.warn(`File save failed: ${err}`);
}

/** 保存文本文件；返回 false 表示用户取消了保存 */
export async function saveTextFile(
  options: SaveOptions & { content: string; mimeType?: string },
): Promise<boolean> {
  if (!isDesktopRuntime()) {
    downloadInBrowser(
      options.defaultName,
      new Blob([options.content], { type: options.mimeType ?? "text/plain;charset=utf-8" }),
    );
    return true;
  }
  const path = await savePathSafely({
    title: options.title,
    defaultPath: options.defaultName,
    filters: options.filters,
  });
  if (!path) return false;
  try {
    await writeTextFileAt(path, options.content);
    return true;
  } catch (err) {
    warnWriteFailure(err);
    return false;
  }
}

/** 保存二进制文件（base64 传输，避免前端再引编码依赖） */
export async function saveBinaryFile(
  options: SaveOptions & { base64: string; mimeType?: string },
): Promise<boolean> {
  if (!isDesktopRuntime()) {
    const binary = atob(options.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    downloadInBrowser(
      options.defaultName,
      new Blob([bytes], { type: options.mimeType ?? "application/octet-stream" }),
    );
    return true;
  }
  const path = await savePathSafely({
    title: options.title,
    defaultPath: options.defaultName,
    filters: options.filters,
  });
  if (!path) return false;
  try {
    await invoke<WriteResult>("write_binary_file_base64", {
      filePath: path,
      base64: options.base64,
    });
    return true;
  } catch (err) {
    warnWriteFailure(err);
    return false;
  }
}
