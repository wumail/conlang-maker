/**
 * IPA 音素拼接 TTS（方案 C）
 * 将 IPA 字符串 tokenize 后，逐个查找 IPA_AUDIO_MAP 并顺序播放
 * 完全离线、零成本；韵律不自然但足以试听造语发音
 */
import { IPA_AUDIO_MAP } from "./ipaAudio";
import { tokenizePhonemes } from "./phonemeTokenizer";

const BASE = "/ipa_audio/";
/** 音素之间的间隔（毫秒）*/
const GAP_MS = 60;

let abortController: AbortController | null = null;

/**
 * 播放一个 IPA 字符串（音素拼接方式）
 * @param ipaString 如 "kaluma"
 * @param inventory 当前语言的音素总表
 * @returns 当播放结束或被取消时 resolve
 */
export async function playIpaConcatenated(
  ipaString: string,
  inventory: string[],
): Promise<void> {
  // 取消之前正在播放的
  stopConcatenatedPlayback();

  const controller = new AbortController();
  abortController = controller;

  const tokens = tokenizePhonemes(ipaString.trim(), inventory);
  if (tokens.length === 0) return;

  for (const token of tokens) {
    if (controller.signal.aborted) return;

    const filename = IPA_AUDIO_MAP[token];
    if (!filename) continue;

    const url = BASE + encodeURIComponent(filename).replace(/%2F/g, "/");
    await playOnePhoneme(url, controller.signal);

    // 间隔
    if (!controller.signal.aborted) {
      await sleep(GAP_MS, controller.signal);
    }
  }

  if (abortController === controller) {
    abortController = null;
  }
}

/** 停止当前拼接播放 */
export function stopConcatenatedPlayback(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}

function playOnePhoneme(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    const onAbort = () => {
      audio.pause();
      audio.currentTime = 0;
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    audio.addEventListener("ended", () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
    audio.addEventListener("error", () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
    audio.play().catch(() => resolve());
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
