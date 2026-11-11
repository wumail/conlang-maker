use crate::models::{
    ExtraFields, GlyphAnnotation, LegacyReviewItem, LegacyWritingInspection, PhonologyConfig,
};
use crate::utils::fs_util::{now_compact_utc, now_rfc3339};
use crate::utils::revision::sha256_hex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};

pub const TOP_LEVEL_LEGACY_KEYS: &[&str] = &["writing_systems", "font_encoding_profiles"];
pub const MAP_LEGACY_KEYS: &[&str] = &["writing_system_id"];
pub const RULE_LEGACY_KEYS: &[&str] = &[
    "output_phonemes",
    "phonemes_confirmed",
    "writing_override",
    "writing_overrides",
];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LegacyWritingArchivePayload {
    pub format: String,
    pub archived_at: String,
    pub archived_by: String,
    pub source_file: String,
    pub source_sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_level: Option<Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maps: Option<Vec<Map<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules: Option<Vec<Map<String, Value>>>,
    pub needs_review: Vec<LegacyReviewItem>,
    pub migrated_glyph_annotations: usize,
}

#[derive(Deserialize)]
struct LegacyWritingUnit {
    unit_id: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    phonemes: Vec<String>,
}

#[derive(Deserialize)]
struct LegacyWritingSystem {
    writing_system_id: String,
    #[serde(default)]
    encoding_profile_id: String,
    #[serde(default)]
    active: bool,
    #[serde(default)]
    units: Vec<LegacyWritingUnit>,
}

#[derive(Deserialize)]
struct LegacyUnitEncoding {
    unit_id: String,
    #[serde(default)]
    codepoints: Vec<u32>,
}

#[derive(Deserialize)]
struct LegacyEncodingProfile {
    profile_id: String,
    writing_system_id: String,
    #[serde(default)]
    codes: Vec<LegacyUnitEncoding>,
}

#[derive(Deserialize)]
struct LegacyPhonologyOverlay {
    #[serde(default)]
    writing_systems: Vec<LegacyWritingSystem>,
    #[serde(default)]
    font_encoding_profiles: Vec<LegacyEncodingProfile>,
}

/// Extract glyph annotations from legacy `writing_systems` + `font_encoding_profiles`
/// when `glyph_annotations` on the raw JSON object is absent or empty.
pub fn migrate_legacy_glyph_annotations_from_str(content: &str) -> Vec<GlyphAnnotation> {
    if !content.contains("\"writing_systems\"") {
        return Vec::new();
    }
    let Ok(legacy) = serde_json::from_str::<LegacyPhonologyOverlay>(content) else {
        return Vec::new();
    };
    let Some(system) = legacy
        .writing_systems
        .iter()
        .find(|sys| sys.active)
        .or_else(|| legacy.writing_systems.first())
    else {
        return Vec::new();
    };
    let profile = legacy
        .font_encoding_profiles
        .iter()
        .find(|prof| {
            prof.writing_system_id == system.writing_system_id
                && prof.profile_id == system.encoding_profile_id
        })
        .or_else(|| {
            legacy
                .font_encoding_profiles
                .iter()
                .find(|prof| prof.writing_system_id == system.writing_system_id)
        });
    let Some(profile) = profile else {
        return Vec::new();
    };

    let unit_by_id: HashMap<&str, &LegacyWritingUnit> = system
        .units
        .iter()
        .map(|u| (u.unit_id.as_str(), u))
        .collect();
    let mut seen_codes = HashSet::new();
    let mut migrated = Vec::new();
    for row in &profile.codes {
        let Some(&codepoint) = row.codepoints.first() else {
            continue;
        };
        if codepoint > 0x10FFFF || !seen_codes.insert(codepoint) {
            continue;
        }
        let Some(unit) = unit_by_id.get(row.unit_id.as_str()) else {
            continue;
        };
        if unit.label.is_empty() && unit.phonemes.is_empty() && unit.kind.is_empty() {
            continue;
        }
        let kind = match unit.kind.as_str() {
            "base" | "vowel" | "carrier" | "mark" | "punctuation" => unit.kind.clone(),
            _ => String::new(),
        };
        migrated.push(GlyphAnnotation {
            codepoint,
            label: unit.label.clone(),
            kind,
            phonemes: unit.phonemes.clone(),
            extra: ExtraFields::new(),
        });
    }
    migrated
}

/// Inspect a parsed JSON value of `phonology.json` for deprecated writing fields and
/// rules requiring manual review (`phonemes_confirmed == false`).
pub fn inspect_legacy_writing_value(raw: &Value) -> LegacyWritingInspection {
    let Some(obj) = raw.as_object() else {
        return LegacyWritingInspection::default();
    };

    let mut fields_set = BTreeSet::new();
    let mut needs_review = Vec::new();

    for &k in TOP_LEVEL_LEGACY_KEYS {
        if obj.contains_key(k) {
            fields_set.insert(k.to_string());
        }
    }

    if let Some(maps) = obj.get("romanization_maps").and_then(|v| v.as_array()) {
        for map_val in maps {
            let Some(map_obj) = map_val.as_object() else {
                continue;
            };
            let map_id = map_obj
                .get("map_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            for &mk in MAP_LEGACY_KEYS {
                if map_obj.contains_key(mk) {
                    fields_set.insert(format!("romanization_maps.{mk}"));
                }
            }
            if let Some(rules) = map_obj.get("rules").and_then(|v| v.as_array()) {
                for rule_val in rules {
                    let Some(rule_obj) = rule_val.as_object() else {
                        continue;
                    };
                    for &rk in RULE_LEGACY_KEYS {
                        if rule_obj.contains_key(rk) {
                            fields_set.insert(format!("romanization_maps.rules.{rk}"));
                        }
                    }
                    if rule_obj.get("phonemes_confirmed") == Some(&Value::Bool(false)) {
                        needs_review.push(LegacyReviewItem {
                            map_id: map_id.clone(),
                            rule_id: rule_obj
                                .get("rule_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            input: rule_obj
                                .get("input")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            output_phoneme: rule_obj
                                .get("output_phoneme")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            reason: "phonemes_unconfirmed".to_string(),
                        });
                    }
                }
            }
        }
    }

    let fields: Vec<String> = fields_set.into_iter().collect();
    LegacyWritingInspection {
        present: !fields.is_empty(),
        fields,
        needs_review,
    }
}

/// Strip all deprecated writing keys from `PhonologyConfig`'s `extra` maps (top-level, maps, rules)
/// while preserving all genuinely unknown extension fields.
pub fn strip_legacy_fields_from_config(config: &mut PhonologyConfig) {
    for &k in TOP_LEVEL_LEGACY_KEYS {
        config.extra.remove(k);
    }
    for map in &mut config.romanization_maps {
        for &mk in MAP_LEGACY_KEYS {
            map.extra.remove(mk);
        }
        for rule in &mut map.rules {
            for &rk in RULE_LEGACY_KEYS {
                rule.extra.remove(rk);
            }
        }
    }
}

/// Build the §3.5 archive filename and JSON payload when `raw_disk_bytes` contains legacy fields.
/// Returns `Ok(None)` if no legacy fields are present on disk.
pub fn build_legacy_archive(
    raw_disk_bytes: &[u8],
    raw_disk_val: &Value,
    operation_id: &str,
    archived_by: &str,
    migrated_count: usize,
) -> Result<Option<(String, LegacyWritingArchivePayload)>, String> {
    let inspection = inspect_legacy_writing_value(raw_disk_val);
    if !inspection.present {
        return Ok(None);
    }

    let Some(obj) = raw_disk_val.as_object() else {
        return Ok(None);
    };

    let mut top_level = Map::new();
    for &k in TOP_LEVEL_LEGACY_KEYS {
        if let Some(v) = obj.get(k) {
            top_level.insert(k.to_string(), v.clone());
        }
    }

    let mut archived_maps: Vec<Map<String, Value>> = Vec::new();
    let mut archived_rules: Vec<Map<String, Value>> = Vec::new();

    if let Some(maps) = obj.get("romanization_maps").and_then(|v| v.as_array()) {
        for map_val in maps {
            let Some(map_obj) = map_val.as_object() else {
                continue;
            };
            let map_id = map_obj
                .get("map_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let map_name = map_obj
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let mut map_legacy = Map::new();
            let mut has_map_legacy = false;
            for &mk in MAP_LEGACY_KEYS {
                if let Some(v) = map_obj.get(mk) {
                    map_legacy.insert(mk.to_string(), v.clone());
                    has_map_legacy = true;
                }
            }
            if has_map_legacy {
                let mut entry = Map::new();
                entry.insert("map_id".to_string(), Value::String(map_id.clone()));
                entry.insert("name".to_string(), Value::String(map_name));
                for (k, v) in map_legacy {
                    entry.insert(k, v);
                }
                archived_maps.push(entry);
            }

            if let Some(rules) = map_obj.get("rules").and_then(|v| v.as_array()) {
                for rule_val in rules {
                    let Some(rule_obj) = rule_val.as_object() else {
                        continue;
                    };
                    let mut rule_legacy = Map::new();
                    let mut has_rule_legacy = false;
                    for &rk in RULE_LEGACY_KEYS {
                        if let Some(v) = rule_obj.get(rk) {
                            rule_legacy.insert(rk.to_string(), v.clone());
                            has_rule_legacy = true;
                        }
                    }
                    if has_rule_legacy {
                        let mut entry = Map::new();
                        entry.insert("map_id".to_string(), Value::String(map_id.clone()));
                        entry.insert(
                            "rule_id".to_string(),
                            Value::String(
                                rule_obj
                                    .get("rule_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                            ),
                        );
                        entry.insert(
                            "input".to_string(),
                            Value::String(
                                rule_obj
                                    .get("input")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                            ),
                        );
                        entry.insert(
                            "output_phoneme".to_string(),
                            Value::String(
                                rule_obj
                                    .get("output_phoneme")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                            ),
                        );
                        for (k, v) in rule_legacy {
                            entry.insert(k, v);
                        }
                        archived_rules.push(entry);
                    }
                }
            }
        }
    }

    let safe_op_id: String = operation_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let file_name = format!("writing-{}-{safe_op_id}.json", now_compact_utc());

    let payload = LegacyWritingArchivePayload {
        format: "conlang-maker/legacy-writing@1".to_string(),
        archived_at: now_rfc3339(),
        archived_by: archived_by.to_string(),
        source_file: "phonology.json".to_string(),
        source_sha256: sha256_hex(raw_disk_bytes),
        top_level: if top_level.is_empty() {
            None
        } else {
            Some(top_level)
        },
        maps: if archived_maps.is_empty() {
            None
        } else {
            Some(archived_maps)
        },
        rules: if archived_rules.is_empty() {
            None
        } else {
            Some(archived_rules)
        },
        needs_review: inspection.needs_review,
        migrated_glyph_annotations: migrated_count,
    };

    Ok(Some((file_name, payload)))
}
