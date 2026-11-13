use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::Path;
use tauri::command;

use crate::commands::lock::with_custom_lock_dir;
use crate::commands::oplog::record_project_snapshot_in_tx;
use crate::commands::transaction::{
    execute_project_transaction, with_consistent_read, PlannedMutation, RevisionExpectation,
    TransactionPlan,
};
use crate::models::{
    CreateProjectResult, GrammarConfig, LanguageEntry, SCAConfig, WorkspaceConfig,
    WorkspaceLoadResult, WriteResult,
};
use crate::utils::fs_util::atomic_write;
use crate::utils::revision::{file_revision, normalize_rel_path};

#[command]
pub fn load_workspace_with_revision(
    conlang_file_path: String,
) -> Result<WorkspaceLoadResult, String> {
    let path = Path::new(&conlang_file_path);
    with_consistent_read(
        path,
        "load_workspace_with_revision",
        true,
        None,
        |_proj, _| {
            let rev = file_revision(path)?;
            let config = if path.is_file() {
                let content = fs::read_to_string(path).map_err(|e| format!("IO: {e}"))?;
                serde_json::from_str(&content).map_err(|e| e.to_string())?
            } else {
                WorkspaceConfig::default()
            };
            Ok(WorkspaceLoadResult {
                config,
                revision: rev,
            })
        },
    )
}

/// Load workspace config from a .conlang file (absolute path).
#[command]
pub fn load_workspace(conlang_file_path: String) -> Result<WorkspaceConfig, String> {
    load_workspace_with_revision(conlang_file_path).map(|res| res.config)
}

fn validate_no_parent_cycles(config: &WorkspaceConfig) -> Result<(), String> {
    let parent_map: HashMap<&str, Option<&str>> = config
        .languages
        .iter()
        .map(|l| (l.language_id.as_str(), l.parent_id.as_deref()))
        .collect();

    for lang in &config.languages {
        let mut seen = HashSet::new();
        seen.insert(lang.language_id.as_str());
        let mut cur = lang.parent_id.as_deref();
        while let Some(pid) = cur {
            if !seen.insert(pid) {
                return Err(format!(
                    "VALIDATION: Parent cycle detected involving language '{}'",
                    lang.language_id
                ));
            }
            cur = parent_map.get(pid).copied().flatten();
        }
    }
    Ok(())
}

/// Save workspace config to a .conlang file inside a project transaction.
/// Automatically creates a project snapshot when any language's `parent_id` changes (§3.6).
#[command]
pub fn save_workspace(
    conlang_file_path: String,
    config: WorkspaceConfig,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    validate_no_parent_cycles(&config)?;
    let ws_path = Path::new(&conlang_file_path);
    let payload = serde_json::json!({
        "conlang_file_path": &conlang_file_path,
        "config": &config,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        ws_path,
        "save_workspace",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let ws_target = if ws_path.is_absolute() {
                ws_path.to_path_buf()
            } else {
                proj.join(ws_path)
            };
            let ws_rel = if let Ok(r) = ws_target.strip_prefix(proj) {
                normalize_rel_path(&r.to_string_lossy().replace('\\', "/"))?
            } else {
                let fname = ws_target
                    .file_name()
                    .ok_or_else(|| "VALIDATION: Invalid conlang_file_path".to_string())?
                    .to_string_lossy();
                normalize_rel_path(&fname)?
            };

            let mut parent_changed = false;
            if ws_target.is_file() {
                if let Ok(existing_str) = fs::read_to_string(&ws_target) {
                    if let Ok(existing_cfg) = serde_json::from_str::<WorkspaceConfig>(&existing_str) {
                        let old_parents: HashMap<&str, Option<&str>> = existing_cfg
                            .languages
                            .iter()
                            .map(|l| (l.language_id.as_str(), l.parent_id.as_deref()))
                            .collect();
                        for lang in &config.languages {
                            if let Some(&old_parent) = old_parents.get(lang.language_id.as_str()) {
                                if old_parent != lang.parent_id.as_deref() {
                                    parent_changed = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            let mut mutations: Vec<PlannedMutation> = Vec::new();
            let mut snap_id: Option<String> = None;

            if parent_changed {
                let (sid, _) = record_project_snapshot_in_tx(
                    proj,
                    Some(&conlang_file_path),
                    "gui",
                    "reparent_language",
                    "Before modifying language parent topology",
                    None,
                    &HashSet::new(),
                    &mut mutations,
                )?;
                snap_id = Some(sid);
            }

            let bytes = serde_json::to_vec_pretty(&config).map_err(|e| format!("IO: {e}"))?;
            mutations.push(PlannedMutation::WriteFile {
                rel_path: ws_rel,
                bytes,
            });

            let op_id_owned = op_id.to_string();
            let snap_id_clone = snap_id.clone();

            Ok(TransactionPlan {
                expectations: vec![RevisionExpectation::file(
                    "workspace",
                    ws_target,
                    expected_revision,
                )],
                mutations,
                audit_summary: "Saved workspace configuration".to_string(),
                language_id: None,
                snapshot_id: snap_id,
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("workspace").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: snap_id_clone,
                    warnings,
                }),
            })
        },
    )
}

#[command]
pub fn create_language_dir(project_path: String, lang_path: String) -> Result<(), String> {
    let project_dir = Path::new(&project_path);
    let payload = serde_json::json!({ "lang_path": &lang_path });
    execute_project_transaction(
        project_dir,
        "create_language_dir",
        "gui",
        None,
        &payload,
        None,
        |_proj, _op_id, _ctx| {
            let rel = normalize_rel_path(&lang_path)?;
            Ok(TransactionPlan {
                expectations: Vec::new(),
                mutations: vec![PlannedMutation::CreateDir { rel_path: rel.clone() }],
                audit_summary: format!("Created language directory '{rel}'"),
                language_id: None,
                snapshot_id: None,
                build_response: Box::new(|_, _| ()),
            })
        },
    )
}

/// Create a brand-new project:
/// 1. Acquires coordination lock on target parent directory
/// 2. Creates `{lang_name}-{random8}` directory + `.conlang` config + root language scaffold
#[command]
pub fn create_new_project(
    project_path: String,
    lang_name: String,
) -> Result<CreateProjectResult, String> {
    let parent_dir = Path::new(&project_path);
    fs::create_dir_all(parent_dir).map_err(|e| e.to_string())?;
    let parent_lock_dir = parent_dir.join(".conlang-maker-create.lock");

    let res = with_custom_lock_dir(&parent_lock_dir, "create_new_project", None, |_| {
        let safe_name = sanitize_filename(&lang_name);
        let random_id = generate_short_id();
        let project_dir_name = format!("{safe_name}-{random_id}");
        let project_root = parent_dir.join(&project_dir_name);
        if project_root.exists() {
            return Err(format!(
                "Project directory already exists: {}",
                project_root.display()
            ));
        }
        fs::create_dir_all(&project_root).map_err(|e| e.to_string())?;

        let lang_id = format!("lang_{random_id}");
        let lang_dir_name = "proto_language".to_string();

        let config = WorkspaceConfig {
            workspace_version: "3.0".to_string(),
            languages: vec![LanguageEntry {
                language_id: lang_id.clone(),
                name: lang_name.clone(),
                path: lang_dir_name.clone(),
                parent_id: None,
                extra: BTreeMap::new(),
            }],
            custom_concepts: Vec::new(),
            extra: BTreeMap::new(),
        };

        let lang_dir = project_root.join(&lang_dir_name);
        fs::create_dir_all(&lang_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(lang_dir.join("lexicon")).map_err(|e| e.to_string())?;
        fs::create_dir_all(lang_dir.join("corpus")).map_err(|e| e.to_string())?;

        let phonology_json = serde_json::json!({
            "language_id": lang_id,
            "phoneme_inventory": {
                "consonants": [],
                "vowels": []
            },
            "romanization_maps": [],
            "phonotactics": {
                "macros": {},
                "syllable_structure": "(C)V(C)",
                "blacklist_patterns": [],
                "vowel_harmony": {
                    "enabled": false,
                    "group_a": [],
                    "group_b": []
                },
                "tone_system": {
                    "enabled": false,
                    "tones": []
                }
            },
            "allophony_rules": []
        });
        atomic_write(
            &lang_dir.join("phonology.json"),
            &serde_json::to_string_pretty(&phonology_json).map_err(|e| e.to_string())?,
        )?;

        let mut grammar = GrammarConfig::default();
        grammar.language_id = format!("lang_{random_id}");
        atomic_write(
            &lang_dir.join("grammar.json"),
            &serde_json::to_string_pretty(&grammar).map_err(|e| e.to_string())?,
        )?;

        let mut sca = SCAConfig::default();
        sca.language_id = format!("lang_{random_id}");
        atomic_write(
            &lang_dir.join("sca_rules.json"),
            &serde_json::to_string_pretty(&sca).map_err(|e| e.to_string())?,
        )?;

        let conlang_filename = format!("{safe_name}-{random_id}.conlang");
        let conlang_path = project_root.join(&conlang_filename);

        let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        atomic_write(&conlang_path, &content)?;

        let conlang_file_path = conlang_path
            .to_str()
            .ok_or_else(|| "Invalid path encoding".to_string())?
            .to_string();

        Ok(CreateProjectResult {
            config,
            conlang_file_path,
        })
    });

    let _ = fs::remove_dir(&parent_lock_dir);
    res
}

/// Copy an entire project to a new location (Save As), acquiring a consistent read lock on source.
#[command]
pub fn copy_project(
    source_conlang_file_path: String,
    dest_dir: String,
    new_name: String,
) -> Result<String, String> {
    let source_conlang = Path::new(&source_conlang_file_path);
    let source_project_dir = source_conlang
        .parent()
        .ok_or_else(|| "Cannot determine source project directory".to_string())?;

    let dest = Path::new(&dest_dir);
    if dest.exists() {
        return Err(format!("Destination directory already exists: {dest_dir}"));
    }

    let source_abs = source_project_dir
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let dest_parent = dest
        .parent()
        .ok_or_else(|| "Invalid destination directory".to_string())?;
    fs::create_dir_all(dest_parent).map_err(|e| e.to_string())?;
    let dest_parent_abs = dest_parent.canonicalize().map_err(|e| e.to_string())?;
    let dest_abs = dest_parent_abs.join(
        dest.file_name()
            .ok_or_else(|| "Invalid destination directory".to_string())?,
    );

    if dest_abs.starts_with(&source_abs) {
        return Err("Destination cannot be inside the source project directory".to_string());
    }

    with_consistent_read(source_project_dir, "copy_project", true, None, |_, _| {
        copy_dir_recursive_clean(source_project_dir, dest)
    })?;

    let old_conlang_name = source_conlang
        .file_name()
        .ok_or_else(|| "Cannot determine source .conlang filename".to_string())?;
    let old_dest_conlang = dest.join(old_conlang_name);

    let safe_name = sanitize_filename(&new_name);
    let random_id = generate_short_id();
    let new_conlang_filename = format!("{safe_name}-{random_id}.conlang");
    let new_dest_conlang = dest.join(&new_conlang_filename);

    if old_dest_conlang.exists() {
        fs::rename(&old_dest_conlang, &new_dest_conlang).map_err(|e| e.to_string())?;
    }

    new_dest_conlang
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path encoding".to_string())
}

fn generate_short_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut value = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    const CHARS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out: [u8; 8] = [b'0'; 8];
    for i in (0..8).rev() {
        let idx = (value % 36) as usize;
        out[i] = CHARS[idx];
        value /= 36;
    }
    String::from_utf8(out.to_vec()).unwrap_or_else(|_| "00000000".to_string())
}

fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || ('\u{4e00}'..='\u{9fff}').contains(&c)
            {
                c
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "conlang".to_string()
    } else {
        sanitized
    }
}

fn copy_dir_recursive_clean(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let fname = entry.file_name();
        let fname_str = fname.to_string_lossy();
        if fname_str == ".conlang.lock" || fname_str.ends_with(".tmp") {
            continue;
        }
        let src_path = entry.path();
        let dst_path = dst.join(&fname);
        if src_path.is_dir() {
            // Skip ephemeral `.conlang-maker/lock` and `.conlang-maker/transactions`
            if fname_str == "lock" || fname_str == "transactions" {
                if src
                    .file_name()
                    .is_some_and(|p| p == ".conlang-maker")
                {
                    continue;
                }
            }
            copy_dir_recursive_clean(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Opens the specified language folder in the system's default file manager.
#[command]
pub fn show_in_folder(project_path: String, language_path: String) -> Result<(), String> {
    use std::process::Command;

    let path = Path::new(&project_path).join(&language_path);
    if !path.exists() {
        return Err(format!("Path does not exist: {:?}", path));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
