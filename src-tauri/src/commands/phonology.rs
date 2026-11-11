use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use serde::Deserialize;
use tauri::command;
use crate::models::{GlyphAnnotation, PhonologyConfig, WorkspaceConfig};
use crate::commands::lexicon::atomic_write;

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

/// Parse `PhonologyConfig` and transparently migrate any legacy
/// `writing_systems` + `font_encoding_profiles` unit annotations into
/// `glyph_annotations` when `glyph_annotations` is not yet populated.
pub(crate) fn parse_phonology_with_legacy(content: &str) -> Result<PhonologyConfig, String> {
    let mut config: PhonologyConfig = serde_json::from_str(content).map_err(|e| e.to_string())?;
    if !config.glyph_annotations.is_empty() || !content.contains("\"writing_systems\"") {
        return Ok(config);
    }
    let Ok(legacy) = serde_json::from_str::<LegacyPhonologyOverlay>(content) else {
        return Ok(config);
    };
    let Some(system) = legacy
        .writing_systems
        .iter()
        .find(|sys| sys.active)
        .or_else(|| legacy.writing_systems.first())
    else {
        return Ok(config);
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
        return Ok(config);
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
        migrated.push(GlyphAnnotation {
            codepoint,
            label: unit.label.clone(),
            kind: unit.kind.clone(),
            phonemes: unit.phonemes.clone(),
        });
    }
    config.glyph_annotations = migrated;
    Ok(config)
}

fn find_workspace_config(project_dir: &Path) -> Option<WorkspaceConfig> {
    let entries = fs::read_dir(project_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.ends_with(".conlang") || name.ends_with(".conlang.json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(ws) = serde_json::from_str::<WorkspaceConfig>(&content) {
                    return Some(ws);
                }
            }
        }
    }
    None
}

fn inherit_ancestor_annotations(project_dir: &Path, language_path: &str, config: &mut PhonologyConfig) {
    if !config.glyph_annotations.is_empty() {
        return;
    }
    let Some(ws) = find_workspace_config(project_dir) else {
        return;
    };
    let Some(start) = ws
        .languages
        .iter()
        .find(|item| item.path == language_path || item.language_id == config.language_id)
    else {
        return;
    };
    let mut seen = HashSet::new();
    seen.insert(start.language_id.clone());
    let mut current = start.parent_id.clone();
    while let Some(parent_id) = current {
        if !seen.insert(parent_id.clone()) {
            break;
        }
        let Some(parent_entry) = ws.languages.iter().find(|item| item.language_id == parent_id) else {
            break;
        };
        let parent_phono_path = project_dir.join(&parent_entry.path).join("phonology.json");
        if let Ok(content) = fs::read_to_string(&parent_phono_path) {
            if let Ok(parent_config) = parse_phonology_with_legacy(&content) {
                if !parent_config.glyph_annotations.is_empty() {
                    config.glyph_annotations = parent_config.glyph_annotations;
                    break;
                }
            }
        }
        current = parent_entry.parent_id.clone();
    }
}

#[command]
pub fn load_phonology(project_path: String, language_path: String) -> Result<PhonologyConfig, String> {
    let project_dir = Path::new(&project_path);
    let path = project_dir.join(&language_path).join("phonology.json");
    if !path.exists() {
        let mut config = PhonologyConfig::default();
        inherit_ancestor_annotations(project_dir, &language_path, &mut config);
        return Ok(config);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut config = parse_phonology_with_legacy(&content)?;
    inherit_ancestor_annotations(project_dir, &language_path, &mut config);
    Ok(config)
}

#[command]
pub fn save_phonology(project_path: String, language_path: String, config: PhonologyConfig) -> Result<(), String> {
    let dir = Path::new(&project_path).join(&language_path);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("phonology.json");
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write(&path, &content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_phonology_json_defaults_and_migrates_legacy_annotations() {
        let json = r#"{
            "language_id": "x",
            "phoneme_inventory": {"consonants": ["s"], "vowels": ["a"]},
            "romanization_maps": [{
                "map_id": "m",
                "name": "n",
                "is_default": true,
                "writing_system_id": "lamitic",
                "rules": [{"input": "s", "output_phoneme": "s", "output_phonemes": ["s"], "phonemes_confirmed": true}]
            }],
            "writing_systems": [{
                "writing_system_id": "lamitic",
                "name": "Lamitic",
                "encoding_profile_id": "prof",
                "active": true,
                "units": [
                    {"unit_id": "u.s", "kind": "base", "label": "sa", "phonemes": ["s", "a"]}
                ]
            }],
            "font_encoding_profiles": [{
                "profile_id": "prof",
                "writing_system_id": "lamitic",
                "name": "Encoding",
                "codes": [
                    {"unit_id": "u.s", "codepoints": [59136]}
                ]
            }],
            "phonotactics": {"macros": {}, "syllable_structure": "CV"},
            "allophony_rules": []
        }"#;
        let config = parse_phonology_with_legacy(json).unwrap();
        assert_eq!(config.glyph_annotations.len(), 1);
        assert_eq!(config.glyph_annotations[0].codepoint, 59136);
        assert_eq!(config.glyph_annotations[0].label, "sa");
        assert_eq!(config.glyph_annotations[0].kind, "base");
        assert_eq!(config.glyph_annotations[0].phonemes, vec!["s", "a"]);
        assert_eq!(config.romanization_maps[0].rules[0].input, "s");
    }
}
