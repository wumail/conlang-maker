/**
 * Pure ID and timestamp generators aligned with GUI conventions (§3.1 / T1.4).
 */

/** UUID v4 for entry_id, sense_id, rule_id, map_id, chapter_id, tone_id. */
export function newEntryId(): string {
  return crypto.randomUUID();
}

/** Prefixed short UUID (e.g. pos_xxxxxxxx, dim_xxxxxxxx, val_xxxxxxxx, slot_xxxxxxxx, conj_xxxxxxxx). */
export function newPrefixedId(
  prefix: "pos" | "dim" | "val" | "slot" | "conj" | string,
): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

/** Timestamp-based language ID matching FamilyTree.tsx (`lang_` + base36 epoch ms). */
export function newLanguageId(): string {
  return `lang_${Date.now().toString(36)}`;
}

/** Current UTC timestamp as ISO 8601 string. */
export function nowIso(): string {
  return new Date().toISOString();
}
