/**
 * configHistory.ts — 把「整份配置前像/后像」写入撤销栈的通用适配层
 *
 * 两种接入方式：
 *  1. `recordConfigChange`：在 Store 的统一编辑入口（如 `applyEdit`）里显式调用；
 *  2. `attachConfigHistory`：对没有统一入口、但 `config` 每次整体替换的 Store 做订阅式记录。
 */
import { pushUndoEntry, type UndoDomain } from "./undoManager";

export interface ConfigChangeOptions<T> {
  domain: UndoDomain;
  labelKey: string;
  languageId: string;
  coalesceKey?: string;
  prev: T;
  next: T;
  restore: (snapshot: T) => void;
}

/** 记录一次配置变更（深拷贝前后像，杜绝可变引用污染） */
export function recordConfigChange<T>(options: ConfigChangeOptions<T>): void {
  const prevSnapshot = structuredClone(options.prev);
  const nextSnapshot = structuredClone(options.next);
  pushUndoEntry({
    languageId: options.languageId,
    domain: options.domain,
    labelKey: options.labelKey,
    coalesceKey: options.coalesceKey,
    undo: () => options.restore(structuredClone(prevSnapshot)),
    redo: () => options.restore(structuredClone(nextSnapshot)),
  });
}

export interface ConfigHistoryAdapter<T> {
  domain: UndoDomain;
  labelKey: string;
  /** 当前语言 ID（用于跨语言隔离） */
  getLanguageId: () => string;
  /** 读取当前业务快照（必须返回新的对象引用才会被识别为变更） */
  read: () => T;
  /** 用快照整体回写 Store（内部需触发防抖落盘） */
  restore: (snapshot: T) => void;
  /** 订阅 Store 变更（Zustand 的 store.subscribe 可直接传入） */
  subscribe: (listener: () => void) => () => void;
  /** 仅在这些条件下记录（例如 Store 已处于 dirty 状态） */
  shouldRecord?: () => boolean;
}

/**
 * 订阅式历史记录。返回取消订阅函数。
 */
export function attachConfigHistory<T>(adapter: ConfigHistoryAdapter<T>): () => void {
  let last = adapter.read();
  let applying = false;

  return adapter.subscribe(() => {
    const next = adapter.read();
    if (next === last) return;
    const prev = last;
    last = next;

    if (applying) return;
    if (adapter.shouldRecord && !adapter.shouldRecord()) return;

    const languageId = adapter.getLanguageId();
    recordConfigChange<T>({
      domain: adapter.domain,
      labelKey: adapter.labelKey,
      languageId,
      coalesceKey: `${adapter.domain}:${languageId}`,
      prev,
      next,
      restore: (snapshot) => {
        applying = true;
        try {
          adapter.restore(snapshot);
        } finally {
          last = adapter.read();
          applying = false;
        }
      },
    });
  });
}
