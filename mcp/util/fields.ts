/**
 * Dot-path field projection supporting nested objects and arrays (e.g. "senses.gloss").
 */
export function projectFields<T>(input: T, fields?: readonly string[]): unknown {
  if (!fields || fields.length === 0) {
    return input;
  }
  const tree = buildFieldTree(fields);
  return applyFieldTree(input, tree);
}

export function projectArrayFields<T>(
  items: readonly T[],
  fields?: readonly string[],
): unknown[] {
  if (!fields || fields.length === 0) {
    return [...items];
  }
  const tree = buildFieldTree(fields);
  return items.map((item) => applyFieldTree(item, tree));
}

type FieldTree = Map<string, FieldTree | true>;

function buildFieldTree(fields: readonly string[]): FieldTree {
  const root: FieldTree = new Map();
  for (const rawPath of fields) {
    const segments = rawPath
      .split(".")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (segments.length === 0) continue;

    let current = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLeaf = i === segments.length - 1;
      const existing = current.get(seg);
      if (isLeaf) {
        current.set(seg, true);
      } else if (existing === true) {
        // Parent already selected in full; keep full selection
        break;
      } else if (existing instanceof Map) {
        current = existing;
      } else {
        const next: FieldTree = new Map();
        current.set(seg, next);
        current = next;
      }
    }
  }
  return root;
}

function applyFieldTree(value: unknown, tree: FieldTree): unknown {
  if (Array.isArray(value)) {
    return value.map((elem) => applyFieldTree(elem, tree));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, spec] of tree.entries()) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }
    const propVal = record[key];
    if (spec === true) {
      out[key] = propVal;
    } else {
      out[key] = applyFieldTree(propVal, spec);
    }
  }
  return out;
}
