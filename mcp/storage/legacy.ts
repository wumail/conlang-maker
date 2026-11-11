import type {
  GlyphAnnotation,
  GlyphKind,
  LegacyReviewItem,
  LegacyWritingInspection,
} from "../../src/types";
import { sha256FullHex } from "./revision";

const TOP_LEVEL_LEGACY_KEYS = [
  "writing_systems",
  "font_encoding_profiles",
] as const;

const MAP_LEGACY_KEYS = ["writing_system_id"] as const;

const RULE_LEGACY_KEYS = [
  "output_phonemes",
  "phonemes_confirmed",
  "writing_override",
  "writing_overrides",
] as const;

export interface LegacyWritingArchivePayload {
  format: "conlang-maker/legacy-writing@1";
  archived_at: string;
  archived_by: "gui" | "mcp";
  source_file: "phonology.json";
  source_sha256: string;
  top_level?: Record<string, unknown>;
  maps?: Record<string, unknown>[];
  rules?: Record<string, unknown>[];
  needs_review: LegacyReviewItem[];
  migrated_glyph_annotations: number;
}

interface LegacyUnit {
  unit_id?: string;
  kind?: string;
  label?: string;
  phonemes?: unknown[];
}

interface LegacyWritingSystem {
  writing_system_id?: string;
  encoding_profile_id?: string;
  active?: boolean;
  units?: LegacyUnit[];
}

interface LegacyEncodingCode {
  unit_id?: string;
  codepoints?: unknown[];
}

interface LegacyEncodingProfile {
  profile_id?: string;
  writing_system_id?: string;
  codes?: LegacyEncodingCode[];
}

export function migrateLegacyGlyphAnnotations(
  rawObj: Record<string, unknown>,
): GlyphAnnotation[] {
  const existing = rawObj.glyph_annotations;
  if (Array.isArray(existing) && existing.length > 0) {
    return existing as GlyphAnnotation[];
  }
  const systems = Array.isArray(rawObj.writing_systems)
    ? (rawObj.writing_systems as LegacyWritingSystem[])
    : [];
  const profiles = Array.isArray(rawObj.font_encoding_profiles)
    ? (rawObj.font_encoding_profiles as LegacyEncodingProfile[])
    : [];

  if (systems.length === 0 || profiles.length === 0) {
    return [];
  }

  const system = systems.find((s) => s.active === true) ?? systems[0];
  if (!system || typeof system.writing_system_id !== "string") {
    return [];
  }

  const profile =
    profiles.find(
      (p) =>
        p.writing_system_id === system.writing_system_id &&
        p.profile_id === system.encoding_profile_id,
    ) ??
    profiles.find((p) => p.writing_system_id === system.writing_system_id);

  if (!profile || !Array.isArray(profile.codes)) {
    return [];
  }

  const units = Array.isArray(system.units) ? system.units : [];
  const unitById = new Map<string, LegacyUnit>();
  for (const u of units) {
    if (typeof u.unit_id === "string") {
      unitById.set(u.unit_id, u);
    }
  }

  const seenCodes = new Set<number>();
  const migrated: GlyphAnnotation[] = [];

  for (const row of profile.codes) {
    if (!Array.isArray(row.codepoints) || row.codepoints.length === 0) {
      continue;
    }
    const cp = row.codepoints[0];
    if (
      typeof cp !== "number" ||
      !Number.isInteger(cp) ||
      cp < 0 ||
      cp > 0x10ffff ||
      seenCodes.has(cp)
    ) {
      continue;
    }
    seenCodes.add(cp);
    const unit =
      typeof row.unit_id === "string" ? unitById.get(row.unit_id) : undefined;
    if (!unit) continue;

    const label = typeof unit.label === "string" ? unit.label : "";
    const kindStr = typeof unit.kind === "string" ? unit.kind : "";
    const phonemes = Array.isArray(unit.phonemes)
      ? unit.phonemes.filter((p): p is string => typeof p === "string")
      : [];

    if (!label && !kindStr && phonemes.length === 0) {
      continue;
    }

    const annot: GlyphAnnotation = {
      codepoint: cp,
      label,
    };
    if (
      kindStr === "base" ||
      kindStr === "vowel" ||
      kindStr === "carrier" ||
      kindStr === "mark" ||
      kindStr === "punctuation"
    ) {
      annot.kind = kindStr as GlyphKind;
    }
    if (phonemes.length > 0) {
      annot.phonemes = phonemes;
    }
    migrated.push(annot);
  }

  return migrated;
}

export function inspectLegacyWritingFromRaw(
  rawObj: Record<string, unknown>,
): LegacyWritingInspection {
  const fieldsSet = new Set<string>();
  const needsReview: LegacyReviewItem[] = [];

  for (const k of TOP_LEVEL_LEGACY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(rawObj, k)) {
      fieldsSet.add(k);
    }
  }

  const maps = Array.isArray(rawObj.romanization_maps)
    ? (rawObj.romanization_maps as Record<string, unknown>[])
    : [];

  for (const map of maps) {
    if (typeof map !== "object" || map === null) continue;
    const mapId = typeof map.map_id === "string" ? map.map_id : "";
    for (const mk of MAP_LEGACY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(map, mk)) {
        fieldsSet.add(`romanization_maps.${mk}`);
      }
    }
    const rules = Array.isArray(map.rules)
      ? (map.rules as Record<string, unknown>[])
      : [];
    for (const rule of rules) {
      if (typeof rule !== "object" || rule === null) continue;
      for (const rk of RULE_LEGACY_KEYS) {
        if (Object.prototype.hasOwnProperty.call(rule, rk)) {
          fieldsSet.add(`romanization_maps.rules.${rk}`);
        }
      }
      if (rule.phonemes_confirmed === false) {
        needsReview.push({
          map_id: mapId,
          rule_id: typeof rule.rule_id === "string" ? rule.rule_id : "",
          input: typeof rule.input === "string" ? rule.input : "",
          output_phoneme:
            typeof rule.output_phoneme === "string" ? rule.output_phoneme : "",
          reason: "phonemes_unconfirmed",
        });
      }
    }
  }

  const fields = Array.from(fieldsSet).sort();
  return {
    present: fields.length > 0,
    fields,
    needs_review: needsReview,
  };
}

export function buildLegacyArchive(
  rawDiskBytes: Buffer,
  rawDiskObj: Record<string, unknown>,
  operationId: string,
  archivedBy: "gui" | "mcp",
  migratedCount: number,
  now: Date = new Date(),
): {
  archiveFileName: string;
  payload: LegacyWritingArchivePayload;
} | null {
  const inspection = inspectLegacyWritingFromRaw(rawDiskObj);
  if (!inspection.present) {
    return null;
  }

  const topLevel: Record<string, unknown> = {};
  for (const k of TOP_LEVEL_LEGACY_KEYS) {
    if (
      Object.prototype.hasOwnProperty.call(rawDiskObj, k) &&
      rawDiskObj[k] !== undefined
    ) {
      topLevel[k] = rawDiskObj[k];
    }
  }

  const archivedMaps: Record<string, unknown>[] = [];
  const archivedRules: Record<string, unknown>[] = [];

  const maps = Array.isArray(rawDiskObj.romanization_maps)
    ? (rawDiskObj.romanization_maps as Record<string, unknown>[])
    : [];

  for (const map of maps) {
    if (typeof map !== "object" || map === null) continue;
    const mapId = typeof map.map_id === "string" ? map.map_id : "";
    const mapName = typeof map.name === "string" ? map.name : "";

    const mapLegacy: Record<string, unknown> = {};
    let hasMapLegacy = false;
    for (const mk of MAP_LEGACY_KEYS) {
      if (
        Object.prototype.hasOwnProperty.call(map, mk) &&
        map[mk] !== undefined
      ) {
        mapLegacy[mk] = map[mk];
        hasMapLegacy = true;
      }
    }
    if (hasMapLegacy) {
      archivedMaps.push({
        map_id: mapId,
        name: mapName,
        ...mapLegacy,
      });
    }

    const rules = Array.isArray(map.rules)
      ? (map.rules as Record<string, unknown>[])
      : [];
    for (const rule of rules) {
      if (typeof rule !== "object" || rule === null) continue;
      const ruleLegacy: Record<string, unknown> = {};
      let hasRuleLegacy = false;
      for (const rk of RULE_LEGACY_KEYS) {
        if (
          Object.prototype.hasOwnProperty.call(rule, rk) &&
          rule[rk] !== undefined
        ) {
          ruleLegacy[rk] = rule[rk];
          hasRuleLegacy = true;
        }
      }
      if (hasRuleLegacy) {
        archivedRules.push({
          map_id: mapId,
          rule_id: typeof rule.rule_id === "string" ? rule.rule_id : "",
          input: typeof rule.input === "string" ? rule.input : "",
          output_phoneme:
            typeof rule.output_phoneme === "string" ? rule.output_phoneme : "",
          ...ruleLegacy,
        });
      }
    }
  }

  const tsCompact = formatTimestampCompact(now);
  const safeOpId = operationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const archiveFileName = `writing-${tsCompact}-${safeOpId}.json`;

  const payload: LegacyWritingArchivePayload = {
    format: "conlang-maker/legacy-writing@1",
    archived_at: now.toISOString(),
    archived_by: archivedBy,
    source_file: "phonology.json",
    source_sha256: sha256FullHex(rawDiskBytes),
    needs_review: inspection.needs_review,
    migrated_glyph_annotations: migratedCount,
  };

  if (Object.keys(topLevel).length > 0) {
    payload.top_level = topLevel;
  }
  if (archivedMaps.length > 0) {
    payload.maps = archivedMaps;
  }
  if (archivedRules.length > 0) {
    payload.rules = archivedRules;
  }

  return { archiveFileName, payload };
}

export function stripLegacyFieldsFromPhonology<T extends Record<string, unknown>>(
  rawObj: T,
): T {
  const cleaned: Record<string, unknown> = { ...rawObj };
  for (const k of TOP_LEVEL_LEGACY_KEYS) {
    delete cleaned[k];
  }

  if (Array.isArray(cleaned.romanization_maps)) {
    cleaned.romanization_maps = (
      cleaned.romanization_maps as Record<string, unknown>[]
    ).map((map) => {
      if (typeof map !== "object" || map === null) return map;
      const cleanMap: Record<string, unknown> = { ...map };
      for (const mk of MAP_LEGACY_KEYS) {
        delete cleanMap[mk];
      }
      if (Array.isArray(cleanMap.rules)) {
        cleanMap.rules = (cleanMap.rules as Record<string, unknown>[]).map(
          (rule) => {
            if (typeof rule !== "object" || rule === null) return rule;
            const cleanRule: Record<string, unknown> = { ...rule };
            for (const rk of RULE_LEGACY_KEYS) {
              delete cleanRule[rk];
            }
            return cleanRule;
          },
        );
      }
      return cleanMap;
    });
  }

  return cleaned as T;
}

export const stripLegacyWritingFieldsFromRaw = stripLegacyFieldsFromPhonology;

function formatTimestampCompact(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}
