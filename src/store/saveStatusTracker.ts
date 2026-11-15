/**
 * saveStatusTracker.ts — 全局保存状态追踪器（Roadmap v3 / Pillar 7）
 *
 * 设计：
 *  - 不污染业务 Zustand Store，独立模块级状态 + `useSyncExternalStore` 订阅；
 *  - 6 大业务 Store 落盘成功调 `reportSaveSuccess(domain)`，
 *    非冲突异常 catch 处调 `reportSaveError(domain, message)`；
 *  - 错误按 `domain` 独立登记：A 域保存成功只清除 A 域的错误，
 *    不会冲掉 B 域尚未解决的报错；
 *  - TitleBar 的 SaveStatusPill 聚合展示 Saved / Saving / Save failed / Conflict。
 */
import { useCallback, useSyncExternalStore } from "react";

export interface SaveStatusSnapshot {
  /** 最近一次任一域成功落盘的时间戳（ms）；null = 尚未落盘 */
  lastSavedAt: number | null;
  /** 最近一次保存失败的错误消息（多域同时失败时取最后上报者）；null = 无错误 */
  lastError: string | null;
  /** 最近一次失败的域标识（如 "lexicon"）；null = 无错误 */
  failedDomain: string | null;
  /** 任一域 dirty 时为 true（dirty 由各 Store 直读，此处保留供调用方上报） */
  saving: boolean;
}

const listeners = new Set<() => void>();

/** 按业务域独立登记的错误（Map 保持插入顺序，末尾即最近一次失败） */
const errorsByDomain = new Map<string, string>();

let snapshot: SaveStatusSnapshot = {
  lastSavedAt: null,
  lastError: null,
  failedDomain: null,
  saving: false,
};

function emit(): void {
  for (const listener of listeners) listener();
}

/** 用当前错误表重建快照（保留 lastSavedAt / saving） */
function rebuildErrors(): void {
  let failedDomain: string | null = null;
  let lastError: string | null = null;
  for (const [domain, message] of errorsByDomain) {
    failedDomain = domain;
    lastError = message;
  }
  snapshot = { ...snapshot, lastError, failedDomain };
  emit();
}

/** 某业务域落盘成功时调用（仅清除该域错误态，刷新 lastSavedAt） */
export function reportSaveSuccess(domain: string): void {
  snapshot = { ...snapshot, lastSavedAt: Date.now() };
  if (errorsByDomain.delete(domain)) rebuildErrors();
  else emit();
}

/** 某业务域落盘失败时调用（记录该域错误供顶部胶囊展示重试入口） */
export function reportSaveError(domain: string, errorMessage: string): void {
  // 重新插入以刷新「最近一次失败」的顺序
  errorsByDomain.delete(domain);
  errorsByDomain.set(domain, errorMessage);
  rebuildErrors();
}

/** 用户点击「重试」或全部错误已解决时清除错误态 */
export function clearSaveError(): void {
  if (errorsByDomain.size === 0 && snapshot.lastError === null) return;
  errorsByDomain.clear();
  rebuildErrors();
}

export function getSaveStatusSnapshot(): SaveStatusSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React 绑定：保存状态快照 */
export function useSaveStatusSnapshot(): SaveStatusSnapshot {
  const getSnapshot = useCallback(() => snapshot, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
