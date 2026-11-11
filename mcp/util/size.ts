export const MAX_RESPONSE_CHARS = 100_000;

const TRUNCATABLE_LIST_KEYS = [
  "items",
  "entries",
  "words",
  "issues",
  "missing",
  "decomposed_only",
  "case_missing",
  "unsubstituted_sequences",
  "residual_glyphs",
  "notdef_produced",
  "results",
  "lines",
  "glossed_lines",
  "cells",
  "segments",
  "glyphs",
  "pending",
  "snapshots",
] as const;

export function enforceMaxResponseSize(
  payload: unknown,
  maxChars: number = MAX_RESPONSE_CHARS,
): unknown {
  const fullJson = JSON.stringify(payload, null, 2);
  if (!fullJson || fullJson.length <= maxChars) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return truncateTopLevelArray(payload, maxChars);
  }

  if (typeof payload !== "object" || payload === null) {
    if (typeof payload === "string" && payload.length > maxChars - 500) {
      return {
        text: payload.slice(0, Math.max(0, maxChars - 500)),
        truncated: true,
        truncation_hint:
          "Text response exceeded 100,000 characters and was truncated.",
      };
    }
    return payload;
  }

  const clone: Record<string, unknown> = {
    ...(payload as Record<string, unknown>),
    truncated: true,
    truncation_hint:
      "Response exceeded 100,000 characters and was truncated. Use limit/cursor pagination or fields projection to retrieve remaining items.",
  };

  // Find array properties (top-level or 1-level nested) sorted largest first
  const targets: { container: Record<string, unknown>; key: string; arr: unknown[] }[] = [];

  for (const key of Object.keys(clone)) {
    const val = clone[key];
    if (Array.isArray(val) && val.length > 0) {
      targets.push({ container: clone, key, arr: val });
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      const subClone: Record<string, unknown> = { ...(val as Record<string, unknown>) };
      clone[key] = subClone;
      for (const subKey of Object.keys(subClone)) {
        const subVal = subClone[subKey];
        if (Array.isArray(subVal) && subVal.length > 0) {
          targets.push({ container: subClone, key: subKey, arr: subVal });
        }
      }
    }
  }

  targets.sort((a, b) => {
    const aPreferred = (TRUNCATABLE_LIST_KEYS as readonly string[]).includes(a.key) ? 1 : 0;
    const bPreferred = (TRUNCATABLE_LIST_KEYS as readonly string[]).includes(b.key) ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;
    return b.arr.length - a.arr.length;
  });

  for (const target of targets) {
    if (JSON.stringify(clone, null, 2).length <= maxChars) {
      break;
    }
    const original = target.arr;
    let lo = 0;
    let hi = original.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      target.container[target.key] = original.slice(0, mid);
      target.container[`${target.key}_total_before_truncation`] = original.length;
      if (JSON.stringify(clone, null, 2).length <= maxChars) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    target.container[target.key] = original.slice(0, lo);
    target.container[`${target.key}_total_before_truncation`] = original.length;
  }

  // Final safety fallback if non-array string fields still exceed maxChars
  if (JSON.stringify(clone, null, 2).length > maxChars) {
    for (const key of Object.keys(clone)) {
      const val = clone[key];
      if (typeof val === "string" && val.length > 1000) {
        clone[key] = val.slice(0, Math.max(200, Math.floor(maxChars / 4))) + "…[truncated]";
      }
    }
  }

  return clone;
}

function truncateTopLevelArray(
  arr: readonly unknown[],
  maxChars: number,
): Record<string, unknown> {
  const wrapper: Record<string, unknown> = {
    total_before_truncation: arr.length,
    items: [],
    truncated: true,
    truncation_hint:
      "Response exceeded 100,000 characters and was truncated. Narrow your query or use pagination.",
  };
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    wrapper.items = arr.slice(0, mid);
    if (JSON.stringify(wrapper, null, 2).length <= maxChars) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  wrapper.items = arr.slice(0, lo);
  return wrapper;
}
