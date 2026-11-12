/**
 * lineageLexiconStore.ts — 谱系词库按需缓存层
 *
 * 目的（PRD §2.3）：`Sidebar` 与 `EditorPane` 历史上各自调用 `load_all_words`
 * 拉取父语言/祖先链词表，同一父语言在切换词条时被反复 IPC 读取。
 *
 * 设计：
 *  - 以 `${projectPath}::${languagePath}` 为键缓存 `{ wordsById, phonoConfig, revision }`；
 *  - 同一父语言的并发请求复用同一个 `loadingPromise`（请求去重）；
 *  - 外部文件变更 / 切换工作区时按需失效；重新加载后若 `revision` 未变则复用原快照对象，
 *    避免下游 `useMemo` 无意义重算。
 *
 * 不引入新的状态管理库：模块级 Map + `useSyncExternalStore` 订阅。
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  LexiconLoadResult,
  PhonologyConfig,
  PhonologyLoadResult,
  WordEntry,
} from "../types";

export interface LineageLexiconSnapshot {
  wordsById: Record<string, WordEntry>;
  phonoConfig: PhonologyConfig;
  revision: string;
}

export type LineageLexiconLoader = (
  projectPath: string,
  languagePath: string,
) => Promise<LineageLexiconSnapshot | null>;

interface CacheRecord {
  snapshot: LineageLexiconSnapshot | null;
  loadingPromise: Promise<LineageLexiconSnapshot | null> | null;
  error: string | null;
  /** 最近一次成功加载的快照，用于 revision 未变时复用对象引用 */
  lastSnapshot: LineageLexiconSnapshot | null;
}

const cache = new Map<string, CacheRecord>();
const listeners = new Set<() => void>();
let version = 0;

function cacheKey(projectPath: string, languagePath: string): string {
  return `${projectPath}::${languagePath}`;
}

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

const defaultLoader: LineageLexiconLoader = async (projectPath, languagePath) => {
  const [lexicon, phonology] = await Promise.all([
    invoke<LexiconLoadResult>("load_all_words_with_revision", {
      projectPath,
      languagePath,
    }),
    invoke<PhonologyLoadResult>("load_phonology", { projectPath, languagePath }),
  ]);
  const wordsById: Record<string, WordEntry> = {};
  for (const word of lexicon.words) wordsById[word.entry_id] = word;
  return {
    wordsById,
    phonoConfig: phonology.config,
    revision: `${lexicon.revision}|${phonology.revision}`,
  };
};

let loader: LineageLexiconLoader = defaultLoader;

/** 测试注入：替换底层加载器（会清空缓存并通知订阅者） */
export function setLineageLexiconLoader(next: LineageLexiconLoader): void {
  loader = next;
  cache.clear();
  notify();
}

/** 恢复默认 Tauri 加载器 */
export function resetLineageLexiconLoader(): void {
  loader = defaultLoader;
  cache.clear();
  notify();
}

export function getLineageLexicon(
  projectPath: string,
  languagePath: string,
): LineageLexiconSnapshot | null {
  return cache.get(cacheKey(projectPath, languagePath))?.snapshot ?? null;
}

export function isLineageLexiconLoading(
  projectPath: string,
  languagePath: string,
): boolean {
  return Boolean(cache.get(cacheKey(projectPath, languagePath))?.loadingPromise);
}

/**
 * 按需加载（并发去重）。已有快照时直接返回，不触发 IPC。
 */
export function loadLineageLexicon(
  projectPath: string,
  languagePath: string,
): Promise<LineageLexiconSnapshot | null> {
  if (!projectPath || !languagePath) return Promise.resolve(null);

  const key = cacheKey(projectPath, languagePath);
  const existing = cache.get(key);
  if (existing?.loadingPromise) return existing.loadingPromise;
  if (existing?.snapshot) return Promise.resolve(existing.snapshot);

  const record: CacheRecord = existing ?? {
    snapshot: null,
    loadingPromise: null,
    error: null,
    lastSnapshot: null,
  };

  const promise = loader(projectPath, languagePath)
    .then((loaded) => {
      if (!loaded) {
        record.snapshot = null;
        return null;
      }
      // revision 未变时复用旧快照，保持引用稳定（避免下游 useMemo 重算）
      const reusable = record.lastSnapshot;
      if (reusable && reusable.revision === loaded.revision) {
        record.snapshot = reusable;
        record.error = null;
        return reusable;
      }
      record.snapshot = loaded;
      record.lastSnapshot = loaded;
      record.error = null;
      return loaded;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      record.error = message;
      console.warn(`Failed to load lineage lexicon ${languagePath}: ${message}`);
      return null;
    })
    .finally(() => {
      record.loadingPromise = null;
      notify();
    });

  record.loadingPromise = promise;
  cache.set(key, record);
  notify();
  return promise;
}

/**
 * 失效缓存：不传参数清空全部（切换工作区）；传 projectPath 清空该工作区；
 * 同时传 projectPath + languagePath 只失效单个语言。
 */
export function invalidateLineageLexicon(
  projectPath?: string,
  languagePath?: string,
): void {
  if (!projectPath) {
    if (cache.size === 0) return;
    for (const record of cache.values()) record.snapshot = null;
    notify();
    return;
  }
  if (languagePath) {
    const record = cache.get(cacheKey(projectPath, languagePath));
    if (!record?.snapshot) return;
    record.snapshot = null;
    notify();
    return;
  }
  const prefix = `${projectPath}::`;
  let changed = false;
  for (const [key, record] of cache) {
    if (key.startsWith(prefix) && record.snapshot) {
      record.snapshot = null;
      changed = true;
    }
  }
  if (changed) notify();
}

export interface LineageLexiconState {
  snapshot: LineageLexiconSnapshot | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** 订阅缓存版本号（缓存变更时触发重渲染） */
export function useLineageLexiconCacheVersion(): number {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}

/** React 绑定：挂载/切换语言时自动按需加载 */
export function useLineageLexicon(
  projectPath: string | null,
  languagePath: string | null,
): LineageLexiconState {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const getVersion = useCallback(() => version, []);
  // 订阅全局版本号以在缓存变化时重渲染
  useSyncExternalStore(subscribe, getVersion, getVersion);

  useEffect(() => {
    if (!projectPath || !languagePath) return;
    void loadLineageLexicon(projectPath, languagePath);
  }, [projectPath, languagePath]);

  const record =
    projectPath && languagePath
      ? cache.get(cacheKey(projectPath, languagePath))
      : undefined;

  return {
    snapshot: record?.snapshot ?? null,
    loading: Boolean(record?.loadingPromise),
    error: record?.error ?? null,
    reload: () => {
      if (!projectPath || !languagePath) return;
      invalidateLineageLexicon(projectPath, languagePath);
      void loadLineageLexicon(projectPath, languagePath);
    },
  };
}
