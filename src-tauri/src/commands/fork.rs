use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use tauri::command;

use crate::commands::oplog::record_project_snapshot_in_tx;
use crate::commands::transaction::{
    execute_project_transaction, with_consistent_read, PlannedMutation, RevisionExpectation,
    TransactionPlan,
};
use crate::models::{
    LanguageEntry, RestoreLanguageResult, TrashedLanguageEntry, WordEntry, WorkspaceConfig,
    WriteResult,
};
use crate::utils::fs_util::{generate_uuid_v4, now_compact_utc, now_rfc3339};
use crate::utils::revision::{file_revision, normalize_rel_path};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TrashMetaRecord {
    pub trash_id: String,
    pub language_id: String,
    pub name: String,
    pub original_path: String,
    pub parent_id: Option<String>,
    pub deleted_at: String,
    pub operation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_snapshot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_entry: Option<LanguageEntry>,
    #[serde(default)]
    pub dir_existed: bool,
}

impl TrashMetaRecord {
    fn to_trashed_entry(&self) -> TrashedLanguageEntry {
        TrashedLanguageEntry {
            trash_id: self.trash_id.clone(),
            language_id: self.language_id.clone(),
            name: self.name.clone(),
            original_path: self.original_path.clone(),
            parent_id: self.parent_id.clone(),
            deleted_at: self.deleted_at.clone(),
            operation_id: self.operation_id.clone(),
            project_snapshot_id: self.project_snapshot_id.clone(),
            original_entry: self.original_entry.clone(),
        }
    }

    fn resolved_language_entry(&self) -> LanguageEntry {
        self.original_entry.clone().unwrap_or_else(|| LanguageEntry {
            language_id: self.language_id.clone(),
            name: self.name.clone(),
            path: self.original_path.clone(),
            parent_id: self.parent_id.clone(),
            extra: BTreeMap::new(),
        })
    }
}

/// Copy a directory recursively
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn ws_rel_in_project(project_dir: &Path, ws_path: &Path) -> Result<String, String> {
    if let Ok(rel) = ws_path.strip_prefix(project_dir) {
        return normalize_rel_path(&rel.to_string_lossy().replace('\\', "/"));
    }
    let name = ws_path
        .file_name()
        .ok_or_else(|| "VALIDATION: Invalid conlang_file_path".to_string())?
        .to_string_lossy();
    normalize_rel_path(&name)
}

fn stage_dir_copy(
    src_dir: &Path,
    dst_rel_prefix: &str,
    mutations: &mut Vec<PlannedMutation>,
) -> Result<(), String> {
    if !src_dir.is_dir() {
        return Ok(());
    }
    mutations.push(PlannedMutation::CreateDir {
        rel_path: normalize_rel_path(dst_rel_prefix)?,
    });
    let mut entries: Vec<fs::DirEntry> = Vec::new();
    for e in fs::read_dir(src_dir).map_err(|e| format!("IO: {e}"))? {
        entries.push(e.map_err(|e| format!("IO: {e}"))?);
    }
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".tmp") {
            continue;
        }
        let child_src = entry.path();
        let child_dst = format!("{dst_rel_prefix}/{name}");
        let ft = entry.file_type().map_err(|e| format!("IO: {e}"))?;
        if ft.is_dir() {
            stage_dir_copy(&child_src, &child_dst, mutations)?;
        } else if ft.is_file() {
            let bytes = fs::read(&child_src).map_err(|e| format!("IO: {e}"))?;
            mutations.push(PlannedMutation::WriteFile {
                rel_path: normalize_rel_path(&child_dst)?,
                bytes,
            });
        }
    }
    Ok(())
}

#[command]
#[allow(clippy::too_many_arguments)]
pub fn fork_language(
    project_path: String,
    conlang_file_path: String,
    parent_id: String,
    new_name: String,
    new_id: String,
    new_path: String,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    let project = Path::new(&project_path);
    let payload = serde_json::json!({
        "conlang_file_path": &conlang_file_path,
        "parent_id": &parent_id,
        "new_name": &new_name,
        "new_id": &new_id,
        "new_path": &new_path,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project,
        "fork_language",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let ws_abs = Path::new(&conlang_file_path);
            let ws_target = if ws_abs.is_absolute() {
                ws_abs.to_path_buf()
            } else {
                proj.join(ws_abs)
            };
            let ws_rel = ws_rel_in_project(proj, &ws_target)?;

            let ws_config: WorkspaceConfig = if ws_target.is_file() {
                let content = fs::read_to_string(&ws_target).map_err(|e| format!("IO: {e}"))?;
                serde_json::from_str(&content).map_err(|e| format!("IO: {e}"))?
            } else {
                WorkspaceConfig::default()
            };

            if ws_config.languages.iter().any(|l| l.language_id == new_id) {
                return Err(format!(
                    "VALIDATION: Language ID '{new_id}' already exists in workspace"
                ));
            }

            let parent_entry = ws_config
                .languages
                .iter()
                .find(|l| l.language_id == parent_id)
                .ok_or_else(|| format!("NOT_FOUND: Parent language '{parent_id}' not found in workspace"))?;

            let parent_rel = normalize_rel_path(&parent_entry.path)?;
            let new_rel = normalize_rel_path(&new_path)?;
            let parent_dir = proj.join(&parent_rel);
            let new_dir = proj.join(&new_rel);

            if new_dir.exists() {
                return Err(format!("CONFLICT: Directory '{new_path}' already exists"));
            }

            let mut mutations: Vec<PlannedMutation> = Vec::new();

            // 1. Take automatic project-level snapshot before mutating topology
            let (snap_id, _) = record_project_snapshot_in_tx(
                proj,
                Some(&conlang_file_path),
                "gui",
                "fork_language",
                &format!("Before forking '{new_name}' ({new_id}) from '{parent_id}'"),
                None,
                &HashSet::new(),
                &mut mutations,
            )?;

            mutations.push(PlannedMutation::CreateDir {
                rel_path: new_rel.clone(),
            });

            // 2. Copy phonology.json (preserving all unknown fields; note: inherited glyph_annotations
            // remain controlled by local phonology.json if parent had local ones, matching existing fork semantics)
            let phono_src = parent_dir.join("phonology.json");
            if phono_src.is_file() {
                let content = fs::read_to_string(&phono_src).map_err(|e| format!("IO: {e}"))?;
                let bytes = if let Ok(mut phono) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(obj) = phono.as_object_mut() {
                        obj.insert(
                            "language_id".to_string(),
                            serde_json::Value::String(new_id.clone()),
                        );
                    }
                    serde_json::to_vec_pretty(&phono).map_err(|e| format!("IO: {e}"))?
                } else {
                    content
                        .replace(
                            &format!("\"language_id\":\"{parent_id}\","),
                            &format!("\"language_id\":\"{new_id}\","),
                        )
                        .into_bytes()
                };
                mutations.push(PlannedMutation::WriteFile {
                    rel_path: format!("{new_rel}/phonology.json"),
                    bytes,
                });
            }

            // 3. Copy grammar.json (preserving unknown fields)
            let grammar_src = parent_dir.join("grammar.json");
            if grammar_src.is_file() {
                let content = fs::read_to_string(&grammar_src).map_err(|e| format!("IO: {e}"))?;
                if let Ok(mut grammar) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(obj) = grammar.as_object_mut() {
                        obj.insert(
                            "language_id".to_string(),
                            serde_json::Value::String(new_id.clone()),
                        );
                    }
                    let bytes =
                        serde_json::to_vec_pretty(&grammar).map_err(|e| format!("IO: {e}"))?;
                    mutations.push(PlannedMutation::WriteFile {
                        rel_path: format!("{new_rel}/grammar.json"),
                        bytes,
                    });
                }
            }

            // 4. Create empty sca_rules.json for the new language
            let sca_val = serde_json::json!({
                "language_id": &new_id,
                "rule_sets": [],
            });
            let sca_bytes = serde_json::to_vec_pretty(&sca_val).map_err(|e| format!("IO: {e}"))?;
            mutations.push(PlannedMutation::WriteFile {
                rel_path: format!("{new_rel}/sca_rules.json"),
                bytes: sca_bytes,
            });

            // 5. Copy lexicon/ and update word entries (preserving all unknown `extra` fields on WordEntry!)
            let lexicon_src = parent_dir.join("lexicon");
            if lexicon_src.is_dir() {
                mutations.push(PlannedMutation::CreateDir {
                    rel_path: format!("{new_rel}/lexicon"),
                });
                let mut entries: Vec<fs::DirEntry> = Vec::new();
                for e in fs::read_dir(&lexicon_src).map_err(|e| format!("IO: {e}"))? {
                    entries.push(e.map_err(|e| format!("IO: {e}"))?);
                }
                entries.sort_by_key(|e| e.file_name());

                for entry in entries {
                    let src_file = entry.path();
                    if src_file.extension().is_some_and(|e| e == "ndjson") {
                        let content =
                            fs::read_to_string(&src_file).map_err(|e| format!("IO: {e}"))?;
                        let mut updated_lines: Vec<String> = Vec::new();
                        for line in content.lines() {
                            let line = line.trim();
                            if line.is_empty() {
                                continue;
                            }
                            match serde_json::from_str::<WordEntry>(line) {
                                Ok(mut word) => {
                                    // Keep inherited entry_id stable across parent/child for deterministic sync.
                                    let original_entry_id = word.entry_id.clone();
                                    word.language_id = new_id.clone();
                                    word.etymology.origin_type = "evolved".to_string();
                                    word.etymology.parent_entry_id = Some(original_entry_id);
                                    word.etymology.source_language_id = Some(parent_id.clone());
                                    if let Ok(json) = serde_json::to_string(&word) {
                                        updated_lines.push(json);
                                    }
                                }
                                Err(e) => {
                                    eprintln!("Fork: skipping malformed word entry: {e}");
                                }
                            }
                        }
                        if !updated_lines.is_empty() {
                            let new_content = updated_lines.join("\n") + "\n";
                            let fname = entry.file_name().to_string_lossy().into_owned();
                            mutations.push(PlannedMutation::WriteFile {
                                rel_path: format!("{new_rel}/lexicon/{fname}"),
                                bytes: new_content.into_bytes(),
                            });
                        }
                    }
                }
            }

            // 6. Copy corpus/ directory (if exists)
            let corpus_src = parent_dir.join("corpus");
            if corpus_src.is_dir() {
                stage_dir_copy(&corpus_src, &format!("{new_rel}/corpus"), &mut mutations)?;
            }

            // 7. Update workspace config
            let mut updated_ws = ws_config;
            updated_ws.languages.push(LanguageEntry {
                language_id: new_id.clone(),
                name: new_name.clone(),
                path: new_path.clone(),
                parent_id: Some(parent_id.clone()),
                extra: BTreeMap::new(),
            });
            let ws_bytes =
                serde_json::to_vec_pretty(&updated_ws).map_err(|e| format!("IO: {e}"))?;
            mutations.push(PlannedMutation::WriteFile {
                rel_path: ws_rel,
                bytes: ws_bytes,
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
                audit_summary: format!("Forked language '{new_name}' ({new_id}) from '{parent_id}'"),
                language_id: Some(new_id),
                snapshot_id: Some(snap_id),
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("workspace").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: Some(snap_id_clone),
                    warnings,
                }),
            })
        },
    )
}

/// Delete a leaf language by moving its directory into `.conlang-maker/trash/<trash_id>/`
/// and recording a project snapshot inside one atomic project transaction (§3.7).
#[command]
pub fn delete_language(
    project_path: String,
    conlang_file_path: String,
    language_id: String,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    let project = Path::new(&project_path);
    let payload = serde_json::json!({
        "conlang_file_path": &conlang_file_path,
        "language_id": &language_id,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project,
        "delete_language",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let ws_abs = Path::new(&conlang_file_path);
            let ws_target = if ws_abs.is_absolute() {
                ws_abs.to_path_buf()
            } else {
                proj.join(ws_abs)
            };
            let ws_rel = ws_rel_in_project(proj, &ws_target)?;

            let ws_config: WorkspaceConfig = if ws_target.is_file() {
                let content = fs::read_to_string(&ws_target).map_err(|e| format!("IO: {e}"))?;
                serde_json::from_str(&content).map_err(|e| format!("IO: {e}"))?
            } else {
                return Err("NOT_FOUND: Workspace config not found".to_string());
            };

            let lang_entry = ws_config
                .languages
                .iter()
                .find(|l| l.language_id == language_id)
                .cloned()
                .ok_or_else(|| format!("NOT_FOUND: Language '{language_id}' not found in workspace"))?;

            let has_children = ws_config
                .languages
                .iter()
                .any(|l| l.parent_id.as_deref() == Some(language_id.as_str()));
            if has_children {
                return Err(
                    "VALIDATION: Cannot delete a language that has child languages. Delete children first."
                        .to_string(),
                );
            }

            if ws_config.languages.len() <= 1 {
                return Err(
                    "VALIDATION: Cannot delete the last language in the workspace.".to_string(),
                );
            }

            let mut mutations: Vec<PlannedMutation> = Vec::new();

            // 1. Project snapshot before deletion (protected by trash meta reference!)
            let (snap_id, _) = record_project_snapshot_in_tx(
                proj,
                Some(&conlang_file_path),
                "gui",
                "delete_language",
                &format!("Before deleting language '{}' ({language_id})", lang_entry.name),
                None,
                &HashSet::new(),
                &mut mutations,
            )?;

            // 2. Move language directory to `.conlang-maker/trash/<trash_id>/data` (§3.7)
            let uuid_short: String = generate_uuid_v4().chars().take(8).collect();
            let trash_id = format!("trash_{}_{}", now_compact_utc(), uuid_short);
            let trash_rel = format!(".conlang-maker/trash/{trash_id}");
            let lang_rel = normalize_rel_path(&lang_entry.path)?;
            let dir_existed = proj.join(&lang_rel).is_dir();

            mutations.push(PlannedMutation::CreateDir {
                rel_path: trash_rel.clone(),
            });
            if dir_existed {
                mutations.push(PlannedMutation::MoveDir {
                    from_rel_path: lang_rel.clone(),
                    to_rel_path: format!("{trash_rel}/data"),
                });
            }

            let meta = TrashMetaRecord {
                trash_id: trash_id.clone(),
                language_id: lang_entry.language_id.clone(),
                name: lang_entry.name.clone(),
                original_path: lang_entry.path.clone(),
                parent_id: lang_entry.parent_id.clone(),
                deleted_at: now_rfc3339(),
                operation_id: op_id.to_string(),
                project_snapshot_id: Some(snap_id.clone()),
                original_entry: Some(lang_entry.clone()),
                dir_existed,
            };
            let meta_bytes = serde_json::to_vec_pretty(&meta).map_err(|e| format!("IO: {e}"))?;
            mutations.push(PlannedMutation::WriteFile {
                rel_path: format!("{trash_rel}/meta.json"),
                bytes: meta_bytes,
            });

            // 3. Remove language from `.conlang`
            let mut updated_ws = ws_config;
            updated_ws.languages.retain(|l| l.language_id != language_id);
            let ws_bytes =
                serde_json::to_vec_pretty(&updated_ws).map_err(|e| format!("IO: {e}"))?;
            mutations.push(PlannedMutation::WriteFile {
                rel_path: ws_rel,
                bytes: ws_bytes,
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
                audit_summary: format!(
                    "Moved language '{}' ({language_id}) to trash {trash_id}",
                    lang_entry.name
                ),
                language_id: Some(language_id.clone()),
                snapshot_id: Some(snap_id),
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("workspace").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: Some(snap_id_clone),
                    warnings,
                }),
            })
        },
    )
}

/// List all trashed languages in `<project>/.conlang-maker/trash/`, newest first (§3.7).
#[command]
pub fn list_language_trash(project_path: String) -> Result<Vec<TrashedLanguageEntry>, String> {
    let project = Path::new(&project_path);
    with_consistent_read(project, "list_language_trash", true, None, |proj, _| {
        let trash_root = proj.join(".conlang-maker").join("trash");
        if !trash_root.is_dir() {
            return Ok(Vec::new());
        }
        let mut items: Vec<TrashedLanguageEntry> = Vec::new();
        for entry in fs::read_dir(&trash_root).map_err(|e| format!("IO: {e}"))? {
            let entry = entry.map_err(|e| format!("IO: {e}"))?;
            let meta_path = entry.path().join("meta.json");
            if meta_path.is_file() {
                let text = fs::read_to_string(&meta_path).map_err(|e| format!("IO: {e}"))?;
                let record: TrashMetaRecord =
                    serde_json::from_str(&text).map_err(|e| format!("IO: {e}"))?;
                items.push(record.to_trashed_entry());
            }
        }
        items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
        Ok(items)
    })
}

fn evaluate_trash_restore(
    project_dir: &Path,
    ws_config: &WorkspaceConfig,
    trash_id: &str,
) -> Result<(TrashMetaRecord, Vec<String>), String> {
    let safe_trash = normalize_rel_path(&format!(".conlang-maker/trash/{trash_id}"))?;
    let meta_path = project_dir.join(&safe_trash).join("meta.json");
    if !meta_path.is_file() {
        return Err(format!("NOT_FOUND: Trash item '{trash_id}' does not exist"));
    }
    let text = fs::read_to_string(&meta_path).map_err(|e| format!("IO: {e}"))?;
    let record: TrashMetaRecord =
        serde_json::from_str(&text).map_err(|e| format!("IO: {e}"))?;

    let mut conflicts = Vec::new();
    if let Some(ref pid) = record.parent_id {
        if !ws_config.languages.iter().any(|l| &l.language_id == pid) {
            conflicts.push(format!(
                "Parent language '{pid}' does not exist in workspace"
            ));
        }
    }
    if ws_config
        .languages
        .iter()
        .any(|l| l.language_id == record.language_id)
    {
        conflicts.push(format!(
            "Language ID '{}' already exists in workspace",
            record.language_id
        ));
    }
    let target_rel = normalize_rel_path(&record.original_path)?;
    if project_dir.join(&target_rel).exists()
        || ws_config
            .languages
            .iter()
            .any(|l| normalize_rel_path(&l.path).ok().as_deref() == Some(target_rel.as_str()))
    {
        conflicts.push(format!("Language path '{}' already exists", record.original_path));
    }

    Ok((record, conflicts))
}

/// Restore (or preview restoring via `dry_run: Some(true)`) a deleted language from trash (§3.7).
#[command]
pub fn restore_language(
    project_path: String,
    conlang_file_path: String,
    trash_id: String,
    dry_run: Option<bool>,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<RestoreLanguageResult, String> {
    let project = Path::new(&project_path);
    let is_dry_run = dry_run.unwrap_or(false);

    if is_dry_run {
        return with_consistent_read(project, "restore_language_preview", true, None, |proj, _| {
            let ws_abs = Path::new(&conlang_file_path);
            let ws_target = if ws_abs.is_absolute() {
                ws_abs.to_path_buf()
            } else {
                proj.join(ws_abs)
            };
            if !ws_target.is_file() {
                return Err("NOT_FOUND: Workspace config not found".to_string());
            }
            let ws_rev = file_revision(&ws_target)?;
            let content = fs::read_to_string(&ws_target).map_err(|e| format!("IO: {e}"))?;
            let ws_config: WorkspaceConfig =
                serde_json::from_str(&content).map_err(|e| format!("IO: {e}"))?;
            let (record, conflicts) = evaluate_trash_restore(proj, &ws_config, &trash_id)?;
            let restored = if conflicts.is_empty() {
                Some(record.resolved_language_entry())
            } else {
                None
            };
            Ok(RestoreLanguageResult {
                dry_run: true,
                restored,
                conflicts,
                revision: ws_rev,
                operation_id: "dry_run".to_string(),
            })
        });
    }

    let payload = serde_json::json!({
        "conlang_file_path": &conlang_file_path,
        "trash_id": &trash_id,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project,
        "restore_language",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let ws_abs = Path::new(&conlang_file_path);
            let ws_target = if ws_abs.is_absolute() {
                ws_abs.to_path_buf()
            } else {
                proj.join(ws_abs)
            };
            if !ws_target.is_file() {
                return Err("NOT_FOUND: Workspace config not found".to_string());
            }
            let ws_rel = ws_rel_in_project(proj, &ws_target)?;
            let content = fs::read_to_string(&ws_target).map_err(|e| format!("IO: {e}"))?;
            let ws_config: WorkspaceConfig =
                serde_json::from_str(&content).map_err(|e| format!("IO: {e}"))?;

            let (record, conflicts) = evaluate_trash_restore(proj, &ws_config, &trash_id)?;
            if !conflicts.is_empty() {
                return Err(format!("CONFLICT: {}", conflicts.join("; ")));
            }

            let restored_entry = record.resolved_language_entry();
            let target_rel = normalize_rel_path(&record.original_path)?;
            let trash_rel = normalize_rel_path(&format!(".conlang-maker/trash/{trash_id}"))?;
            let trash_data_rel = format!("{trash_rel}/data");

            let mut mutations: Vec<PlannedMutation> = Vec::new();
            let (snap_id, _) = record_project_snapshot_in_tx(
                proj,
                Some(&conlang_file_path),
                "gui",
                "restore_language",
                &format!(
                    "Before restoring language '{}' ({}) from trash",
                    restored_entry.name, restored_entry.language_id
                ),
                None,
                &HashSet::new(),
                &mut mutations,
            )?;

            if proj.join(&trash_data_rel).is_dir() {
                mutations.push(PlannedMutation::MoveDir {
                    from_rel_path: trash_data_rel,
                    to_rel_path: target_rel,
                });
            } else if record.dir_existed {
                mutations.push(PlannedMutation::CreateDir {
                    rel_path: target_rel,
                });
            }

            mutations.push(PlannedMutation::DeletePath {
                rel_path: trash_rel,
            });

            let mut updated_ws = ws_config;
            updated_ws.languages.push(restored_entry.clone());
            let ws_bytes =
                serde_json::to_vec_pretty(&updated_ws).map_err(|e| format!("IO: {e}"))?;
            mutations.push(PlannedMutation::WriteFile {
                rel_path: ws_rel,
                bytes: ws_bytes,
            });

            let op_id_owned = op_id.to_string();
            let restored_for_resp = restored_entry.clone();

            Ok(TransactionPlan {
                expectations: vec![RevisionExpectation::file(
                    "workspace",
                    ws_target,
                    expected_revision,
                )],
                mutations,
                audit_summary: format!(
                    "Restored language '{}' ({}) from trash {trash_id}",
                    restored_entry.name, restored_entry.language_id
                ),
                language_id: Some(restored_entry.language_id),
                snapshot_id: Some(snap_id),
                build_response: Box::new(move |revs, _warnings| RestoreLanguageResult {
                    dry_run: false,
                    restored: Some(restored_for_resp),
                    conflicts: Vec::new(),
                    revision: revs.get("workspace").cloned().unwrap_or_default(),
                    operation_id: op_id_owned,
                }),
            })
        },
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationStats {
    pub dry_run: bool,
    pub languages_processed: usize,
    pub words_scanned: usize,
    pub parent_link_filled: usize,
    pub source_language_filled: usize,
    pub origin_fixed: usize,
    pub files_changed: usize,
}

fn load_language_entry_ids(project: &Path, language_path: &str) -> Result<HashSet<String>, String> {
    let lexicon_dir = project
        .join(normalize_rel_path(language_path)?)
        .join("lexicon");
    let mut ids = HashSet::new();
    if !lexicon_dir.is_dir() {
        return Ok(ids);
    }

    for entry in fs::read_dir(&lexicon_dir).map_err(|e| format!("IO: {e}"))? {
        let path = entry.map_err(|e| format!("IO: {e}"))?.path();
        if path.extension().is_some_and(|e| e == "ndjson") {
            let content = fs::read_to_string(&path).map_err(|e| format!("IO: {e}"))?;
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(word) = serde_json::from_str::<WordEntry>(trimmed) {
                    ids.insert(word.entry_id);
                }
            }
        }
    }

    Ok(ids)
}

fn compute_inherited_link_migration(
    project: &Path,
    ws_path: &Path,
    is_dry_run: bool,
) -> Result<(MigrationStats, Vec<PlannedMutation>), String> {
    let ws_config: WorkspaceConfig = if ws_path.is_file() {
        let content = fs::read_to_string(ws_path).map_err(|e| format!("IO: {e}"))?;
        serde_json::from_str(&content).map_err(|e| format!("IO: {e}"))?
    } else {
        return Err("NOT_FOUND: Workspace config not found".to_string());
    };

    let mut stats = MigrationStats {
        dry_run: is_dry_run,
        languages_processed: 0,
        words_scanned: 0,
        parent_link_filled: 0,
        source_language_filled: 0,
        origin_fixed: 0,
        files_changed: 0,
    };
    let mut mutations: Vec<PlannedMutation> = Vec::new();

    for language in &ws_config.languages {
        let Some(parent_id) = &language.parent_id else {
            continue;
        };
        let Some(parent_lang) = ws_config
            .languages
            .iter()
            .find(|l| &l.language_id == parent_id)
        else {
            continue;
        };

        let parent_ids = load_language_entry_ids(project, &parent_lang.path)?;
        let child_rel = normalize_rel_path(&language.path)?;
        let child_lexicon_dir = project.join(&child_rel).join("lexicon");
        if !child_lexicon_dir.is_dir() {
            continue;
        }

        stats.languages_processed += 1;

        let mut entries: Vec<fs::DirEntry> = Vec::new();
        for e in fs::read_dir(&child_lexicon_dir).map_err(|e| format!("IO: {e}"))? {
            entries.push(e.map_err(|e| format!("IO: {e}"))?);
        }
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            let file_path = entry.path();
            if !file_path.extension().is_some_and(|e| e == "ndjson") {
                continue;
            }

            let content = fs::read_to_string(&file_path).map_err(|e| format!("IO: {e}"))?;
            let mut file_changed = false;
            let mut new_lines: Vec<String> = Vec::new();

            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                match serde_json::from_str::<WordEntry>(trimmed) {
                    Ok(mut word) => {
                        let mut line_changed = false;
                        stats.words_scanned += 1;

                        let inherited_by_id = parent_ids.contains(&word.entry_id);
                        let has_parent_link = word.etymology.parent_entry_id.is_some();

                        if inherited_by_id && !has_parent_link {
                            word.etymology.parent_entry_id = Some(word.entry_id.clone());
                            stats.parent_link_filled += 1;
                            line_changed = true;
                        }

                        let linked_to_self = word.etymology.parent_entry_id.as_deref()
                            == Some(word.entry_id.as_str());

                        if inherited_by_id
                            && linked_to_self
                            && word.etymology.source_language_id.is_none()
                        {
                            word.etymology.source_language_id = Some(parent_id.clone());
                            stats.source_language_filled += 1;
                            line_changed = true;
                        }

                        if inherited_by_id
                            && linked_to_self
                            && word.etymology.origin_type == "a_priori"
                        {
                            word.etymology.origin_type = "evolved".to_string();
                            stats.origin_fixed += 1;
                            line_changed = true;
                        }

                        if line_changed {
                            file_changed = true;
                            if let Ok(serialized) = serde_json::to_string(&word) {
                                new_lines.push(serialized);
                            } else {
                                new_lines.push(trimmed.to_string());
                            }
                        } else {
                            new_lines.push(trimmed.to_string());
                        }
                    }
                    Err(_) => {
                        new_lines.push(trimmed.to_string());
                    }
                }
            }

            if file_changed {
                stats.files_changed += 1;
                if !is_dry_run {
                    let new_content = if new_lines.is_empty() {
                        String::new()
                    } else {
                        new_lines.join("\n") + "\n"
                    };
                    let fname = entry.file_name().to_string_lossy().into_owned();
                    mutations.push(PlannedMutation::WriteFile {
                        rel_path: format!("{child_rel}/lexicon/{fname}"),
                        bytes: new_content.into_bytes(),
                    });
                }
            }
        }
    }

    Ok((stats, mutations))
}

#[command]
pub fn migrate_inherited_lexicon_links(
    project_path: String,
    conlang_file_path: String,
    dry_run: Option<bool>,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<MigrationStats, String> {
    let project = Path::new(&project_path);
    let is_dry_run = dry_run.unwrap_or(false);

    if is_dry_run {
        return with_consistent_read(
            project,
            "migrate_inherited_lexicon_links_preview",
            true,
            None,
            |proj, _| {
                let ws_abs = Path::new(&conlang_file_path);
                let ws_target = if ws_abs.is_absolute() {
                    ws_abs.to_path_buf()
                } else {
                    proj.join(ws_abs)
                };
                let (stats, _) = compute_inherited_link_migration(proj, &ws_target, true)?;
                Ok(stats)
            },
        );
    }

    let payload = serde_json::json!({
        "conlang_file_path": &conlang_file_path,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project,
        "migrate_inherited_lexicon_links",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, _op_id, _ctx| {
            let ws_abs = Path::new(&conlang_file_path);
            let ws_target = if ws_abs.is_absolute() {
                ws_abs.to_path_buf()
            } else {
                proj.join(ws_abs)
            };
            let (stats, mutations) = compute_inherited_link_migration(proj, &ws_target, false)?;
            let summary = format!(
                "Migrated inherited lexicon links across {} files ({} words scanned)",
                stats.files_changed, stats.words_scanned
            );
            Ok(TransactionPlan {
                expectations: vec![RevisionExpectation::file(
                    "workspace",
                    ws_target,
                    expected_revision,
                )],
                mutations,
                audit_summary: summary,
                language_id: None,
                snapshot_id: None,
                build_response: Box::new(move |_, _| stats),
            })
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::oplog::{list_all_snapshots, rollback_any_snapshot};

    #[test]
    fn t1_11_fork_preserves_unknown_fields_and_trash_restore_roundtrip() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path();
        let proj_str = project.to_string_lossy().to_string();
        let ws_path = project.join("family.conlang");
        let ws_str = ws_path.to_string_lossy().to_string();

        // Set up root language with unknown sentinel fields in phonology, grammar, lexicon, and .conlang
        let root_dir = project.join("roots/root");
        fs::create_dir_all(root_dir.join("lexicon")).unwrap();
        fs::write(
            root_dir.join("phonology.json"),
            r#"{"language_id":"lang_root","__phono_sentinel":42}"#,
        )
        .unwrap();
        fs::write(
            root_dir.join("grammar.json"),
            r#"{"language_id":"lang_root","__gram_sentinel":"keep"}"#,
        )
        .unwrap();
        fs::write(
            root_dir.join("lexicon/lexicon_a.ndjson"),
            "{\"entry_id\":\"w1\",\"language_id\":\"lang_root\",\"con_word_romanized\":\"ata\",\"phonemic_ipa\":\"ata\",\"phonetic_override\":false,\"senses\":[{\"sense_id\":\"s1\",\"pos_id\":\"n\",\"gloss\":\"water\",\"definitions\":[],\"examples\":[],\"__sense_sentinel\":true}],\"etymology\":{\"origin_type\":\"a_priori\",\"parent_entry_id\":null,\"source_language_id\":null,\"applied_sound_changes\":[],\"semantic_shift_note\":\"\"},\"metadata\":{\"tags\":[],\"created_at\":\"0\",\"updated_at\":\"0\"},\"__word_sentinel\":\"ok\"}\n",
        )
        .unwrap();
        fs::write(
            &ws_path,
            r#"{"version":"1.0","workspace_version":"2.0","name":"Fam","__ws_sentinel":99,"languages":[{"language_id":"lang_root","name":"Root","path":"roots/root","parent_id":null,"__lang_sentinel":"r"}]}"#,
        )
        .unwrap();

        // 1. Fork child language
        let fork_res = fork_language(
            proj_str.clone(),
            ws_str.clone(),
            "lang_root".to_string(),
            "Child".to_string(),
            "lang_child".to_string(),
            "stages/child".to_string(),
            None,
            None,
        )
        .unwrap();
        assert!(fork_res.snapshot_id.is_some());

        // Verify unknown sentinels preserved on forked files & workspace!
        let child_phono: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(project.join("stages/child/phonology.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(child_phono["language_id"], "lang_child");
        assert_eq!(child_phono["__phono_sentinel"], 42);

        let child_word: serde_json::Value = serde_json::from_str(
            fs::read_to_string(project.join("stages/child/lexicon/lexicon_a.ndjson"))
                .unwrap()
                .lines()
                .next()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(child_word["__word_sentinel"], "ok");
        assert_eq!(child_word["senses"][0]["__sense_sentinel"], true);
        assert_eq!(child_word["etymology"]["origin_type"], "evolved");
        assert_eq!(child_word["etymology"]["parent_entry_id"], "w1");

        // 2. Delete child -> moves into `.conlang-maker/trash/<trash_id>/data`
        let del_res = delete_language(
            proj_str.clone(),
            ws_str.clone(),
            "lang_child".to_string(),
            None,
            None,
        )
        .unwrap();
        let pre_del_snap = del_res.snapshot_id.unwrap();
        assert!(!project.join("stages/child").exists());

        let trashed = list_language_trash(proj_str.clone()).unwrap();
        assert_eq!(trashed.len(), 1);
        assert_eq!(trashed[0].language_id, "lang_child");
        let trash_id = trashed[0].trash_id.clone();

        // Project snapshots remain addressable even after language deletion!
        let all_snaps = list_all_snapshots(proj_str.clone(), Some(ws_str.clone()), None).unwrap();
        assert!(all_snaps.iter().any(|s| s.snapshot_id == pre_del_snap));

        // 3. Dry-run restore succeeds with 0 conflicts
        let preview = restore_language(
            proj_str.clone(),
            ws_str.clone(),
            trash_id.clone(),
            Some(true),
            None,
            None,
        )
        .unwrap();
        assert!(preview.dry_run);
        assert!(preview.conflicts.is_empty());
        assert!(!project.join("stages/child").exists());

        // Simulate path conflict -> dry_run reports conflict accurately
        fs::create_dir_all(project.join("stages/child")).unwrap();
        let conflict_preview = restore_language(
            proj_str.clone(),
            ws_str.clone(),
            trash_id.clone(),
            Some(true),
            None,
            None,
        )
        .unwrap();
        assert_eq!(conflict_preview.conflicts.len(), 1);
        fs::remove_dir_all(project.join("stages/child")).unwrap();

        // 4. Commit restore_language -> restores directory + `.conlang` entry!
        let restored = restore_language(
            proj_str.clone(),
            ws_str.clone(),
            trash_id,
            Some(false),
            None,
            None,
        )
        .unwrap();
        assert!(!restored.dry_run);
        assert!(project.join("stages/child/phonology.json").is_file());
        assert!(list_language_trash(proj_str.clone()).unwrap().is_empty());

        // 5. Also verify project snapshot rollback after a deletion restores deleted language!
        delete_language(
            proj_str.clone(),
            ws_str.clone(),
            "lang_child".to_string(),
            None,
            None,
        )
        .unwrap();
        assert!(!project.join("stages/child").exists());
        rollback_any_snapshot(
            proj_str,
            Some(ws_str.clone()),
            pre_del_snap,
            None,
            Some(false),
            None,
            None,
        )
        .unwrap();
        assert!(project.join("stages/child/phonology.json").is_file());
    }
}
