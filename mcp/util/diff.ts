export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface StructuralDiff {
  added: string[];
  removed: string[];
  changed: FieldChange[];
}

export function computeStructuralDiff(
  before: unknown,
  after: unknown,
  basePath: string = "",
): StructuralDiff {
  const diff: StructuralDiff = {
    added: [],
    removed: [],
    changed: [],
  };
  walkDiff(before, after, basePath, diff);
  return diff;
}

function walkDiff(
  before: unknown,
  after: unknown,
  currentPath: string,
  out: StructuralDiff,
): void {
  if (Object.is(before, after)) {
    return;
  }

  if (
    typeof before !== "object" ||
    before === null ||
    typeof after !== "object" ||
    after === null ||
    Array.isArray(before) !== Array.isArray(after)
  ) {
    out.changed.push({ path: currentPath || "$", before, after });
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      out.changed.push({
        path: currentPath || "$",
        before: `Array(${before.length})`,
        after: `Array(${after.length})`,
      });
    }
    return;
  }

  const beforeObj = before as Record<string, unknown>;
  const afterObj = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);

  for (const key of Array.from(keys).sort()) {
    const subPath = currentPath ? `${currentPath}.${key}` : key;
    const inBefore = Object.prototype.hasOwnProperty.call(beforeObj, key);
    const inAfter = Object.prototype.hasOwnProperty.call(afterObj, key);
    if (!inBefore && inAfter) {
      out.added.push(subPath);
    } else if (inBefore && !inAfter) {
      out.removed.push(subPath);
    } else {
      walkDiff(beforeObj[key], afterObj[key], subPath, out);
    }
  }
}
