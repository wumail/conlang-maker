use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::Path;
use tauri::command;

use crate::commands::transaction::{
    execute_project_transaction, with_consistent_read, PlannedMutation, RevisionExpectation,
    TransactionPlan,
};
use crate::models::{
    GlyphAnnotation, LegacyWritingInspection, PhonologyConfig, PhonologyLoadResult,
    WorkspaceConfig, WriteResult,
};
use crate::utils::legacy::{
    build_legacy_archive, inspect_legacy_writing_value, migrate_legacy_glyph_annotations_from_str,
    strip_legacy_fields_from_config,
};
use crate::utils::revision::{
    bytes_revision, file_revision, find_conlang_file, language_own_font_revision,
    normalize_rel_path,
};

/// Parse `PhonologyConfig` and transparently migrate any local legacy
/// `writing_systems` + `font_encoding_profiles` unit annotations into
/// `glyph_annotations` when `glyph_annotations` is not yet populated.
pub(crate) fn parse_phonology_with_legacy_detail(
    content: &str,
) -> Result<(PhonologyConfig, bool), String> {
    let mut config: PhonologyConfig = serde_json::from_str(content).map_err(|e| e.to_string())?;
    let mut did_migrate = false;
    if config.glyph_annotations.is_empty() && content.contains("\"writing_systems\"") {
        let migrated = migrate_legacy_glyph_annotations_from_str(content);
        if !migrated.is_empty() {
            config.glyph_annotations = migrated;
            did_migrate = true;
        }
    }
    Ok((config, did_migrate))
}

#[allow(dead_code)]
pub(crate) fn parse_phonology_with_legacy(content: &str) -> Result<PhonologyConfig, String> {
    parse_phonology_with_legacy_detail(content).map(|(c, _)| c)
}

fn load_workspace_with_rev(project_dir: &Path) -> (Option<WorkspaceConfig>, String) {
    let Some(ws_path) = find_conlang_file(project_dir) else {
        return (None, "missing".to_string());
    };
    let rev = file_revision(&ws_path).unwrap_or_else(|_| "missing".to_string());
    let cfg = fs::read_to_string(&ws_path)
        .ok()
        .and_then(|s| serde_json::from_str::<WorkspaceConfig>(&s).ok());
    (cfg, rev)
}

#[command]
pub fn load_phonology(
    project_path: String,
    language_path: String,
) -> Result<PhonologyLoadResult, String> {
    let project_dir = Path::new(&project_path);

    with_consistent_read(project_dir, "load_phonology", true, None, |proj, _| {
        let lang_rel = normalize_rel_path(&language_path)?;
        let lang_dir = proj.join(&lang_rel);
        let phono_path = lang_dir.join("phonology.json");

        let local_rev = file_revision(&phono_path)?;
        let mut legacy_fields_present = false;
        let mut local_migrated = false;

        let local_config = if phono_path.is_file() {
            let content = fs::read_to_string(&phono_path).map_err(|e| format!("IO: {e}"))?;
            if let Ok(raw_val) = serde_json::from_str::<serde_json::Value>(&content) {
                legacy_fields_present = inspect_legacy_writing_value(&raw_val).present;
            }
            let (cfg, migrated) = parse_phonology_with_legacy_detail(&content)?;
            local_migrated = migrated;
            cfg
        } else {
            PhonologyConfig::default()
        };

        let mut dependencies: BTreeMap<String, String> = BTreeMap::new();
        dependencies.insert("local_phonology".to_string(), local_rev.clone());
        let (_, own_font_rev) = language_own_font_revision(&lang_dir)?;
        dependencies.insert("own_font".to_string(), own_font_rev);

        let (ws_opt, ws_rev) = load_workspace_with_rev(proj);
        dependencies.insert("workspace".to_string(), ws_rev);

        let mut start_lang_id: Option<String> = if !local_config.language_id.is_empty() {
            Some(local_config.language_id.clone())
        } else {
            None
        };

        let mut inherited_annotations: Option<(String, Vec<GlyphAnnotation>)> = None;

        if let Some(ref ws) = ws_opt {
            if let Some(start_entry) = ws.languages.iter().find(|item| {
                normalize_rel_path(&item.path).ok().as_deref() == Some(lang_rel.as_str())
                    || (!local_config.language_id.is_empty()
                        && item.language_id == local_config.language_id)
            }) {
                start_lang_id = Some(start_entry.language_id.clone());
                let mut seen = HashSet::new();
                seen.insert(start_entry.language_id.clone());
                let mut current = start_entry.parent_id.clone();

                while let Some(parent_id) = current {
                    if !seen.insert(parent_id.clone()) {
                        break;
                    }
                    let Some(parent_entry) = ws
                        .languages
                        .iter()
                        .find(|item| item.language_id == parent_id)
                    else {
                        break;
                    };
                    let parent_rel = normalize_rel_path(&parent_entry.path)?;
                    let parent_dir = proj.join(&parent_rel);
                    let parent_phono_path = parent_dir.join("phonology.json");
                    let parent_phono_rev = file_revision(&parent_phono_path)?;
                    dependencies.insert(
                        format!("ancestor_phonology:{parent_id}"),
                        parent_phono_rev,
                    );
                    let (_, parent_font_rev) = language_own_font_revision(&parent_dir)?;
                    dependencies.insert(format!("ancestor_font:{parent_id}"), parent_font_rev);

                    if inherited_annotations.is_none() && parent_phono_path.is_file() {
                        if let Ok(p_content) = fs::read_to_string(&parent_phono_path) {
                            if let Ok((p_cfg, _)) = parse_phonology_with_legacy_detail(&p_content) {
                                if !p_cfg.glyph_annotations.is_empty() {
                                    inherited_annotations =
                                        Some((parent_id.clone(), p_cfg.glyph_annotations));
                                }
                            }
                        }
                    }

                    current = parent_entry.parent_id.clone();
                }
            }
        }

        let (effective_annotations, annotations_source, annotations_owner_id) =
            if !local_config.glyph_annotations.is_empty() {
                let src = if local_migrated {
                    "legacy_migrated"
                } else {
                    "local"
                };
                (
                    local_config.glyph_annotations.clone(),
                    src.to_string(),
                    start_lang_id,
                )
            } else if let Some((anc_id, anc_ann)) = inherited_annotations {
                (anc_ann, "inherited".to_string(), Some(anc_id))
            } else {
                (Vec::new(), "none".to_string(), None)
            };

        let mut effective_config = local_config.clone();
        effective_config.glyph_annotations = effective_annotations;

        let mut dep_buf = String::new();
        for (k, v) in &dependencies {
            dep_buf.push_str(k);
            dep_buf.push('=');
            dep_buf.push_str(v);
            dep_buf.push('\n');
        }
        let effective_revision = bytes_revision(dep_buf.as_bytes());

        Ok(PhonologyLoadResult {
            config: effective_config.clone(),
            revision: local_rev,
            local_config: Some(local_config),
            effective_config: Some(effective_config),
            annotations_source: Some(annotations_source),
            annotations_owner_id,
            effective_revision: Some(effective_revision),
            dependencies,
            legacy_fields_present,
        })
    })
}

/// Read-only inspection of deprecated writing-system fields in `<lang>/phonology.json` (`T1.10`).
#[command]
pub fn inspect_legacy_writing(
    project_path: String,
    language_path: String,
) -> Result<LegacyWritingInspection, String> {
    let project_dir = Path::new(&project_path);
    with_consistent_read(
        project_dir,
        "inspect_legacy_writing",
        true,
        None,
        |proj, _| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let phono_path = proj.join(&lang_rel).join("phonology.json");
            if !phono_path.is_file() {
                return Ok(LegacyWritingInspection {
                    present: false,
                    fields: Vec::new(),
                    needs_review: Vec::new(),
                });
            }
            let content = fs::read_to_string(&phono_path).map_err(|e| format!("IO: {e}"))?;
            let raw_val: serde_json::Value =
                serde_json::from_str(&content).map_err(|e| format!("IO: {e}"))?;
            Ok(inspect_legacy_writing_value(&raw_val))
        },
    )
}

/// Save local `phonology.json` inside a project transaction (`T1.10`, `T1.13`, `T1.14`, `T1.15`).
/// - Verifies `expected_revision` (when provided) against local `phonology.json`.
/// - If disk `phonology.json` still contains deprecated writing-system fields, archives them to
///   `<lang>/.conlang-maker/legacy/writing-<YYYYMMDDTHHMMSS>-<operation_id>.json` in the SAME
///   transaction, migrates local units if `config.glyph_annotations` is empty, and strips all
///   deprecated writing keys while preserving all other unknown `extra` fields!
/// - Writes ONLY `local_config` (never baking ancestor inherited annotations unless caller
///   explicitly populated `config.glyph_annotations`).
#[command]
pub fn save_phonology(
    project_path: String,
    language_path: String,
    config: PhonologyConfig,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    let project_dir = Path::new(&project_path);
    let payload = serde_json::json!({
        "language_path": &language_path,
        "config": &config,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project_dir,
        "save_phonology",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let phono_rel = format!("{lang_rel}/phonology.json");
            let phono_abs = proj.join(&phono_rel);

            let mut clean_config = config.clone();
            strip_legacy_fields_from_config(&mut clean_config);

            let mut mutations: Vec<PlannedMutation> = Vec::new();
            mutations.push(PlannedMutation::CreateDir {
                rel_path: lang_rel.clone(),
            });

            let mut warnings: Vec<String> = Vec::new();

            if phono_abs.is_file() {
                let disk_bytes = fs::read(&phono_abs).map_err(|e| format!("IO: {e}"))?;
                if let Ok(disk_str) = std::str::from_utf8(&disk_bytes) {
                    if let Ok(disk_val) = serde_json::from_str::<serde_json::Value>(disk_str) {
                        if inspect_legacy_writing_value(&disk_val).present {
                            if clean_config.glyph_annotations.is_empty() {
                                clean_config.glyph_annotations =
                                    migrate_legacy_glyph_annotations_from_str(disk_str);
                            }
                            if let Some((archive_filename, archive_val)) = build_legacy_archive(
                                &disk_bytes,
                                &disk_val,
                                op_id,
                                "gui",
                                clean_config.glyph_annotations.len(),
                            )? {
                                let archive_rel =
                                    format!("{lang_rel}/.conlang-maker/legacy/{archive_filename}");
                                let archive_bytes = serde_json::to_vec_pretty(&archive_val)
                                    .map_err(|e| format!("IO: {e}"))?;
                                mutations.push(PlannedMutation::WriteFile {
                                    rel_path: archive_rel.clone(),
                                    bytes: archive_bytes,
                                });
                                warnings.push(format!(
                                    "Archived legacy writing fields to {archive_rel}"
                                ));
                            }
                        }
                    }
                }
            }

            let phono_bytes =
                serde_json::to_vec_pretty(&clean_config).map_err(|e| format!("IO: {e}"))?;
            mutations.push(PlannedMutation::WriteFile {
                rel_path: phono_rel,
                bytes: phono_bytes,
            });

            let lang_id_opt = if clean_config.language_id.is_empty() {
                None
            } else {
                Some(clean_config.language_id.clone())
            };
            let op_id_owned = op_id.to_string();

            Ok(TransactionPlan {
                expectations: vec![RevisionExpectation::file(
                    "phonology",
                    phono_abs,
                    expected_revision,
                )],
                mutations,
                audit_summary: format!("Saved phonology for '{lang_rel}'"),
                language_id: lang_id_opt,
                snapshot_id: None,
                build_response: Box::new(move |revs, mut tx_warnings| {
                    tx_warnings.extend(warnings);
                    WriteResult {
                        operation_id: op_id_owned,
                        revision: revs.get("phonology").cloned().unwrap_or_default(),
                        revisions: Some(revs.clone()),
                        snapshot_id: None,
                        warnings: tx_warnings,
                    }
                }),
            })
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::LanguageEntry;
    use std::time::UNIX_EPOCH;

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

    #[test]
    fn concurrent_load_phonology_succeeds_without_lock_conflict() {
        use std::sync::Arc;
        use std::thread;
        use std::time::SystemTime;

        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("conlang-phono-lock-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        let project = dir.to_str().unwrap().to_string();

        let mut cfg = PhonologyConfig::default();
        cfg.language_id = "lang_test".to_string();
        cfg.phoneme_inventory.consonants = vec!["p".to_string(), "t".to_string()];
        save_phonology(project.clone(), "proto".to_string(), cfg, None, None).unwrap();

        let shared_project = Arc::new(project);
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let p = Arc::clone(&shared_project);
                thread::spawn(move || load_phonology((*p).clone(), "proto".to_string()).unwrap())
            })
            .collect();

        for handle in handles {
            let res = handle.join().unwrap();
            assert_eq!(res.config.language_id, "lang_test");
            assert_eq!(res.config.phoneme_inventory.consonants, vec!["p", "t"]);
            assert_ne!(res.revision, "default");
            assert_eq!(res.revision.len(), 16);
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn t1_10_legacy_writing_archive_needs_review_and_unknown_field_preservation() {
        let temp = tempfile::tempdir().unwrap();
        let proj = temp.path();
        let proj_str = proj.to_string_lossy().to_string();
        let child_dir = proj.join("stages/child");
        fs::create_dir_all(&child_dir).unwrap();

        let legacy_json = r#"{
            "language_id": "lang_child",
            "__top_sentinel": "preserve_me",
            "phoneme_inventory": {"consonants": ["tʃ"], "vowels": ["a"]},
            "romanization_maps": [{
                "map_id": "m_default",
                "name": "Default",
                "is_default": true,
                "writing_system_id": "ws_old",
                "__map_sentinel": 7,
                "rules": [{
                    "rule_id": "r_ch",
                    "input": "ch",
                    "output_phoneme": "tʃ",
                    "context_before": "",
                    "context_after": "",
                    "output_phonemes": ["t", "ʃ"],
                    "phonemes_confirmed": false,
                    "writing_override": null,
                    "__rule_sentinel": true
                }]
            }],
            "writing_systems": [{
                "writing_system_id": "ws_old",
                "encoding_profile_id": "prof_1",
                "active": true,
                "units": [
                    {"unit_id": "u_ch", "kind": "ligature", "label": "cha", "phonemes": ["tʃ"]}
                ]
            }],
            "font_encoding_profiles": [{
                "profile_id": "prof_1",
                "writing_system_id": "ws_old",
                "codes": [
                    {"unit_id": "u_ch", "codepoints": [57344]}
                ]
            }],
            "phonotactics": {"macros": {}, "syllable_structure": "CV"},
            "allophony_rules": []
        }"#;
        fs::write(child_dir.join("phonology.json"), legacy_json).unwrap();

        // 1. inspect_legacy_writing detects all legacy fields and needs_review for `ch -> tʃ`
        let inspection =
            inspect_legacy_writing(proj_str.clone(), "stages/child".to_string()).unwrap();
        assert!(inspection.present);
        assert_eq!(inspection.needs_review.len(), 1);
        assert_eq!(inspection.needs_review[0].input, "ch");
        assert_eq!(inspection.needs_review[0].output_phoneme, "tʃ");
        assert_eq!(inspection.needs_review[0].reason, "phonemes_unconfirmed");

        // 2. load_phonology reports legacy_fields_present = true and annotations_source = "legacy_migrated"
        let loaded = load_phonology(proj_str.clone(), "stages/child".to_string()).unwrap();
        assert!(loaded.legacy_fields_present);
        assert_eq!(
            loaded.annotations_source.as_deref(),
            Some("legacy_migrated")
        );
        let loaded_local = loaded.local_config.clone().unwrap();
        assert_eq!(loaded_local.glyph_annotations.len(), 1);

        // 3. First save_phonology archives legacy fields, strips deprecated keys, keeps unknown sentinels!
        let res1 = save_phonology(
            proj_str.clone(),
            "stages/child".to_string(),
            loaded_local,
            Some(loaded.revision.clone()),
            Some("op_mig_1".to_string()),
        )
        .unwrap();

        let legacy_dir = child_dir.join(".conlang-maker/legacy");
        let archives: Vec<_> = fs::read_dir(&legacy_dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        assert_eq!(archives.len(), 1);
        let archive_json: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&archives[0]).unwrap()).unwrap();
        assert_eq!(archive_json["format"], "conlang-maker/legacy-writing@1");
        assert_eq!(archive_json["needs_review"][0]["input"], "ch");
        assert_eq!(archive_json["migrated_glyph_annotations"], 1);

        let saved_disk: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(child_dir.join("phonology.json")).unwrap(),
        )
        .unwrap();
        assert!(saved_disk.get("writing_systems").is_none());
        assert!(saved_disk.get("font_encoding_profiles").is_none());
        assert!(saved_disk["romanization_maps"][0]
            .get("writing_system_id")
            .is_none());
        assert!(saved_disk["romanization_maps"][0]["rules"][0]
            .get("phonemes_confirmed")
            .is_none());
        // Unknown non-legacy sentinels MUST survive!
        assert_eq!(saved_disk["__top_sentinel"], "preserve_me");
        assert_eq!(saved_disk["romanization_maps"][0]["__map_sentinel"], 7);
        assert_eq!(
            saved_disk["romanization_maps"][0]["rules"][0]["__rule_sentinel"],
            true
        );

        // 4. Second save_phonology produces NO duplicate archive!
        let loaded2 = load_phonology(proj_str.clone(), "stages/child".to_string()).unwrap();
        assert!(!loaded2.legacy_fields_present);
        save_phonology(
            proj_str,
            "stages/child".to_string(),
            loaded2.local_config.unwrap(),
            Some(res1.revision),
            None,
        )
        .unwrap();
        let archives_after: Vec<_> = fs::read_dir(&legacy_dir).unwrap().collect();
        assert_eq!(archives_after.len(), 1);
    }

    #[test]
    fn t1_14_child_ordinary_save_preserves_inheritance_from_parent() {
        let temp = tempfile::tempdir().unwrap();
        let proj = temp.path();
        let proj_str = proj.to_string_lossy().to_string();

        let ws = WorkspaceConfig {
            workspace_version: "3.0".to_string(),
            languages: vec![
                LanguageEntry {
                    language_id: "lang_root".to_string(),
                    name: "Root".to_string(),
                    path: "roots/root".to_string(),
                    parent_id: None,
                    extra: BTreeMap::new(),
                },
                LanguageEntry {
                    language_id: "lang_child".to_string(),
                    name: "Child".to_string(),
                    path: "stages/child".to_string(),
                    parent_id: Some("lang_root".to_string()),
                    extra: BTreeMap::new(),
                },
            ],
            custom_concepts: Vec::new(),
            lexical_gaps: Vec::new(),
            primary_cognate_overrides: Vec::new(),
            saved_lexicon_filters: Vec::new(),
            extra: BTreeMap::new(),
        };
        fs::write(
            proj.join("fam.conlang"),
            serde_json::to_string_pretty(&ws).unwrap(),
        )
        .unwrap();

        let mut root_cfg = PhonologyConfig::default();
        root_cfg.language_id = "lang_root".to_string();
        root_cfg.glyph_annotations = vec![GlyphAnnotation {
            codepoint: 0x61,
            label: "alpha".to_string(),
            kind: "vowel".to_string(),
            phonemes: vec!["a".to_string()],
            extra: BTreeMap::new(),
        }];
        save_phonology(
            proj_str.clone(),
            "roots/root".to_string(),
            root_cfg.clone(),
            None,
            None,
        )
        .unwrap();

        let mut child_cfg = PhonologyConfig::default();
        child_cfg.language_id = "lang_child".to_string();
        save_phonology(
            proj_str.clone(),
            "stages/child".to_string(),
            child_cfg,
            None,
            None,
        )
        .unwrap();

        let child_loaded = load_phonology(proj_str.clone(), "stages/child".to_string()).unwrap();
        let child_local = child_loaded.local_config.clone().unwrap();
        let child_effective = child_loaded.effective_config.clone().unwrap();
        assert!(child_local.glyph_annotations.is_empty());
        assert_eq!(child_effective.glyph_annotations.len(), 1);
        assert_eq!(child_loaded.annotations_source.as_deref(), Some("inherited"));
        assert_eq!(
            child_loaded.annotations_owner_id.as_deref(),
            Some("lang_root")
        );
        let eff_rev_1 = child_loaded.effective_revision.clone();

        // Ordinary edit on child local_config (e.g. adding consonant "p") and saving:
        let mut edited_child_local = child_local;
        edited_child_local
            .phoneme_inventory
            .consonants
            .push("p".to_string());
        save_phonology(
            proj_str.clone(),
            "stages/child".to_string(),
            edited_child_local,
            Some(child_loaded.revision),
            None,
        )
        .unwrap();

        // Now parent updates its glyph_annotations -> child MUST immediately inherit updated annotation
        // and get a new effective_revision!
        root_cfg.glyph_annotations[0].label = "alpha_v2".to_string();
        save_phonology(
            proj_str.clone(),
            "roots/root".to_string(),
            root_cfg,
            None,
            None,
        )
        .unwrap();

        let child_reloaded = load_phonology(proj_str, "stages/child".to_string()).unwrap();
        assert!(child_reloaded
            .local_config
            .as_ref()
            .unwrap()
            .glyph_annotations
            .is_empty());
        assert_eq!(
            child_reloaded
                .effective_config
                .as_ref()
                .unwrap()
                .glyph_annotations[0]
                .label,
            "alpha_v2"
        );
        assert_eq!(
            child_reloaded.annotations_source.as_deref(),
            Some("inherited")
        );
        assert_ne!(child_reloaded.effective_revision, eff_rev_1);
    }
}
