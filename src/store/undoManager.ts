/**
 * undoManager.ts — 零依赖跨 Store 命令合并型撤销/重做引擎
 *
 * 设计（PRD §3.1 / EXECUTION_PLAN §7.3）：
 *  - 不使用 Zustand，模块级环形栈 + `useSyncExternalStore` 订阅；
 *  - 连续同 `coalesceKey` 的输入在 800ms 内合并为一步（保留最初前像）；
 *  - 撤销/重做闭包内部一律 `{ skipHistory: true }` 调用 Store 写方法，
 *    从而复用各 Store 原有的 500ms 按实体防抖落盘。
 */
import { useCallback, useSyncExternalStore } from "react";

export type UndoDomain = "lexicon" | "phonology" | "grammar" | "sca" | "corpus";

export interface HistoryOpts {
  skipHistory?: boolean;
  coalesceKey?: string;
  labelKey?: string;
}

export interface UndoEntry {
  id: string;
  languageId: string;
  domain: UndoDomain;
  /** i18n key，用于「已撤销：编辑词条」提示与按钮悬停文案 */
  labelKey: string;
  coalesceKey?: string;
  timestamp: number;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabelKey?: string;
  redoLabelKey?: string;
  undoCount: number;
  redoCount: number;
}

const MAX_HISTORY = 100;
const COALESCE_MS = 800;

let undoStack: UndoEntry[] = [];
let redoStack: UndoEntry[] = [];
let entrySeq = 0;
const listeners = new Set<() => void>();

const EMPTY_STATE: UndoState = {
  canUndo: false,
  canRedo: false,
  undoCount: 0,
  redoCount: 0,
};

let cachedState: UndoState = EMPTY_STATE;

function recomputeState(): void {
  const undoTop = undoStack[undoStack.length - 1];
  const redoTop = redoStack[redoStack.length - 1];
  cachedState = {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoLabelKey: undoTop?.labelKey,
    redoLabelKey: redoTop?.labelKey,
    undoCount: undoStack.length,
    redoCount: redoStack.length,
  };
}

function emit(): void {
  recomputeState();
  for (const listener of listeners) listener();
}

function nextId(): string {
  entrySeq += 1;
  return `undo_${Date.now()}_${entrySeq}`;
}

export function pushUndoEntry(
  entry: Omit<UndoEntry, "id" | "timestamp"> & { timestamp?: number },
): void {
  const now = entry.timestamp ?? Date.now();
  const top = undoStack[undoStack.length - 1];

  if (
    top &&
    entry.coalesceKey &&
    top.coalesceKey === entry.coalesceKey &&
    top.languageId === entry.languageId &&
    now - top.timestamp <= COALESCE_MS
  ) {
    // 保留最初前像（top.undo），仅替换最新后像与时间戳
    undoStack[undoStack.length - 1] = { ...top, redo: entry.redo, timestamp: now };
    redoStack = [];
    emit();
    return;
  }

  undoStack = [
    ...undoStack.slice(-(MAX_HISTORY - 1)),
    { ...entry, id: nextId(), timestamp: now },
  ];
  redoStack = [];
  emit();
}

/** 从栈尾向前查找首个匹配项（避免依赖 ES2023 的 findLastIndex） */
function findLastMatchingIndex(
  entries: UndoEntry[],
  predicate: (entry: UndoEntry) => boolean,
): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && predicate(entry)) return index;
  }
  return -1;
}

/** 撤销；传 `activeLanguageId` 时只在该语言的历史中回退（跨语言隔离） */
export async function performUndo(activeLanguageId?: string): Promise<UndoEntry | null> {
  const index = activeLanguageId
    ? findLastMatchingIndex(undoStack, (entry) => entry.languageId === activeLanguageId)
    : undoStack.length - 1;
  if (index < 0) return null;

  const target = undoStack[index]!;
  undoStack = [...undoStack.slice(0, index), ...undoStack.slice(index + 1)];
  await target.undo();
  redoStack = [...redoStack, target];
  emit();
  return target;
}

/** 重做；传 `activeLanguageId` 时只重做该语言的动作 */
export async function performRedo(activeLanguageId?: string): Promise<UndoEntry | null> {
  const index = activeLanguageId
    ? findLastMatchingIndex(redoStack, (entry) => entry.languageId === activeLanguageId)
    : redoStack.length - 1;
  if (index < 0) return null;

  const target = redoStack[index]!;
  redoStack = [...redoStack.slice(0, index), ...redoStack.slice(index + 1)];
  await target.redo();
  undoStack = [...undoStack, target];
  emit();
  return target;
}

export function getUndoState(): UndoState {
  return cachedState;
}

export function clearHistory(): void {
  undoStack = [];
  redoStack = [];
  emit();
}

/** 测试与调试用：读取当前栈内容（不含闭包调用） */
export function inspectHistory(): { undo: UndoEntry[]; redo: UndoEntry[] } {
  return { undo: [...undoStack], redo: [...redoStack] };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React 绑定：撤销/重做可用性与标签 */
export function useUndoState(): UndoState {
  const getSnapshot = useCallback(() => cachedState, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
