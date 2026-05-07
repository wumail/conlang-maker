import { invoke } from "@tauri-apps/api/core";
import {
  open as tauriOpen,
  save as tauriSave,
  message as tauriMessage,
  type OpenDialogOptions,
  type SaveDialogOptions,
  type MessageDialogOptions,
} from "@tauri-apps/plugin-dialog";

function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
}

function firstPath(value: string | string[] | null): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : null;
  }
  return value;
}

function basename(pathValue: string): string {
  const parts = pathValue.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : pathValue;
}

export async function openPathSafely(
  options: OpenDialogOptions,
): Promise<string | null> {
  if (isMacOS()) {
    if (options.directory) {
      return invoke<string | null>("pick_directory_path_macos", {
        title: options.title ?? null,
      });
    }

    return invoke<string | null>("pick_file_path_macos", {
      title: options.title ?? null,
    });
  }

  const selected = await tauriOpen(options);
  return firstPath(selected as string | string[] | null);
}

export async function savePathSafely(
  options: SaveDialogOptions,
): Promise<string | null> {
  if (isMacOS()) {
    const defaultName = options.defaultPath
      ? basename(String(options.defaultPath))
      : null;

    return invoke<string | null>("pick_save_file_path_macos", {
      title: options.title ?? null,
      defaultName,
    });
  }

  return tauriSave(options);
}

export async function messageSafely(
  text: string,
  options?: MessageDialogOptions,
): Promise<void> {
  if (isMacOS()) {
    const title = options?.title ? `${options.title}\n\n` : "";
    window.alert(`${title}${text}`);
    return;
  }

  await tauriMessage(text, options);
}
