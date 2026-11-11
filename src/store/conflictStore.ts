import { create } from "zustand";
import type { ExternalConflictItem } from "../types";

export interface ConflictHandlers {
  keepLocal: (diskRevision: string) => Promise<void>;
  useDisk: () => Promise<void>;
}

interface ConflictStoreState {
  conflicts: ExternalConflictItem[];
  resolvingKey: string | null;
  resolveError: string | null;
  upsertConflict: (item: ExternalConflictItem, handlers: ConflictHandlers) => void;
  removeConflict: (key: string) => void;
  resolveKeepLocal: (key: string) => Promise<void>;
  resolveUseDisk: (key: string) => Promise<void>;
  clearAllConflicts: () => void;
}

const MAX_RECENT_OP_IDS = 256;
const MAX_PREVIEW_CHARS = 8000;
const recentGuiOperationIds: string[] = [];
const recentGuiOperationIdSet = new Set<string>();
const handlerRegistry = new Map<string, ConflictHandlers>();

export function generateOperationId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function recordGuiOperationId(operationId: string): void {
  const trimmed = operationId.trim();
  if (!trimmed || recentGuiOperationIdSet.has(trimmed)) return;
  recentGuiOperationIds.push(trimmed);
  recentGuiOperationIdSet.add(trimmed);
  while (recentGuiOperationIds.length > MAX_RECENT_OP_IDS) {
    const evicted = recentGuiOperationIds.shift();
    if (evicted) recentGuiOperationIdSet.delete(evicted);
  }
}

export function isOwnGuiOperationId(
  operationId: string | null | undefined,
): boolean {
  if (!operationId) return false;
  return recentGuiOperationIdSet.has(operationId.trim());
}

export function clearRecordedGuiOperationIds(): void {
  recentGuiOperationIds.length = 0;
  recentGuiOperationIdSet.clear();
}

export function isConflictError(err: unknown): boolean {
  const msg = String(err ?? "").trim();
  return msg.startsWith("CONFLICT:") || msg.includes("CONFLICT:");
}

/**
 * Merge incoming items with existing items sharing the same stable ID key,
 * preserving unknown extra fields present on loaded objects (`T1.13`).
 */
export function mergeById<T extends object, K extends keyof T>(
  existingList: readonly T[] | undefined,
  incomingList: readonly T[],
  idKey: K,
  mergeItem?: (existing: T, incoming: T) => T,
): T[] {
  if (!existingList || existingList.length === 0) {
    return [...incomingList];
  }
  const byId = new Map<T[K], T>();
  for (const item of existingList) {
    byId.set(item[idKey], item);
  }
  return incomingList.map((incoming) => {
    const prev = byId.get(incoming[idKey]);
    if (!prev) return incoming;
    return mergeItem ? mergeItem(prev, incoming) : { ...prev, ...incoming };
  });
}

function safeStringify(value: unknown): string {
  try {
    const raw = JSON.stringify(value, null, 2) ?? "";
    if (raw.length <= MAX_PREVIEW_CHARS) return raw;
    return `${raw.slice(0, MAX_PREVIEW_CHARS)}\n... (${raw.length - MAX_PREVIEW_CHARS} chars truncated)`;
  } catch (err) {
    console.warn("Failed to stringify conflict preview:", err);
    return String(value);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function computeJsonDiffSummary(
  localValue: unknown,
  diskValue: unknown,
): { changedFields: string[]; localPreview: string; diskPreview: string } {
  const changedFields: string[] = [];
  if (isPlainRecord(localValue) && isPlainRecord(diskValue)) {
    const keys = new Set<string>([
      ...Object.keys(localValue),
      ...Object.keys(diskValue),
    ]);
    for (const key of keys) {
      if (JSON.stringify(localValue[key]) !== JSON.stringify(diskValue[key])) {
        changedFields.push(key);
      }
    }
  } else if (Array.isArray(localValue) && Array.isArray(diskValue)) {
    if (localValue.length !== diskValue.length) {
      changedFields.push(`length (${localValue.length} vs ${diskValue.length})`);
    } else if (JSON.stringify(localValue) !== JSON.stringify(diskValue)) {
      changedFields.push("entries");
    }
  } else if (JSON.stringify(localValue) !== JSON.stringify(diskValue)) {
    changedFields.push("content");
  }

  return {
    changedFields,
    localPreview: safeStringify(localValue),
    diskPreview: safeStringify(diskValue),
  };
}

export const useConflictStore = create<ConflictStoreState>((set, get) => ({
  conflicts: [],
  resolvingKey: null,
  resolveError: null,

  upsertConflict: (item, handlers) => {
    handlerRegistry.set(item.key, handlers);
    set((state) => {
      const idx = state.conflicts.findIndex((c) => c.key === item.key);
      const next =
        idx >= 0
          ? state.conflicts.map((c, i) => (i === idx ? item : c))
          : [...state.conflicts, item];
      return { conflicts: next, resolveError: null };
    });
  },

  removeConflict: (key) => {
    handlerRegistry.delete(key);
    set((state) => ({
      conflicts: state.conflicts.filter((c) => c.key !== key),
      resolvingKey: state.resolvingKey === key ? null : state.resolvingKey,
      resolveError: null,
    }));
  },

  resolveKeepLocal: async (key) => {
    const conflict = get().conflicts.find((c) => c.key === key);
    const handlers = handlerRegistry.get(key);
    if (!conflict || !handlers) {
      get().removeConflict(key);
      return;
    }
    set({ resolvingKey: key, resolveError: null });
    try {
      // Remove first so if Keep Local encounters a newer disk conflict,
      // the store can re-enqueue an updated conflict record cleanly.
      handlerRegistry.delete(key);
      set((state) => ({
        conflicts: state.conflicts.filter((c) => c.key !== key),
      }));
      await handlers.keepLocal(conflict.diskRevision);
      set({ resolvingKey: null });
    } catch (err) {
      console.warn("Failed to resolve conflict with Keep Local:", err);
      set({ resolvingKey: null, resolveError: String(err) });
    }
  },

  resolveUseDisk: async (key) => {
    const handlers = handlerRegistry.get(key);
    if (!handlers) {
      get().removeConflict(key);
      return;
    }
    set({ resolvingKey: key, resolveError: null });
    try {
      handlerRegistry.delete(key);
      set((state) => ({
        conflicts: state.conflicts.filter((c) => c.key !== key),
      }));
      await handlers.useDisk();
      set({ resolvingKey: null });
    } catch (err) {
      console.warn("Failed to resolve conflict with Use Disk:", err);
      set({ resolvingKey: null, resolveError: String(err) });
    }
  },

  clearAllConflicts: () => {
    handlerRegistry.clear();
    set({ conflicts: [], resolvingKey: null, resolveError: null });
  },
}));
