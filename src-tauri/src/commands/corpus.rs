use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use tauri::command;

use crate::commands::oplog::{collect_protected_snapshot_ids, record_language_snapshot_in_tx};
use crate::commands::transaction::{
    execute_project_transaction, with_consistent_read, PlannedMutation, RevisionExpectation,
    TransactionPlan,
};
use crate::models::{
    CorpusIndexEntry, CorpusIndexLoadResult, CorpusText, CorpusTextLoadResult, CorpusTextMeta,
    WriteResult,
};
use crate::utils::revision::{file_revision, normalize_rel_path};

fn sanitize_corpus_id(corpus_id: &str) -> Result<&str, String> {
    let trimmed = corpus_id.trim();
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err(format!("VALIDATION: Invalid corpus_id '{corpus_id}'"));
    }
    Ok(trimmed)
}

#[command]
pub fn load_corpus_index_with_revision(
    project_path: String,
    language_path: String,
) -> Result<CorpusIndexLoadResult, String> {
    let project_dir = Path::new(&project_path);
    with_consistent_read(
        project_dir,
        "load_corpus_index_with_revision",
        true,
        None,
        |proj, _| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let index_path = proj.join(&lang_rel).join("corpus").join("corpus_index.json");
            let rev = file_revision(&index_path)?;
            let entries = if index_path.is_file() {
                let content = fs::read_to_string(&index_path).map_err(|e| format!("IO: {e}"))?;
                serde_json::from_str(&content).map_err(|e| e.to_string())?
            } else {
                Vec::new()
            };
            Ok(CorpusIndexLoadResult {
                entries,
                revision: rev,
            })
        },
    )
}

/// Load corpus index (list of all corpus texts with metadata only)
#[command]
pub fn load_corpus_index(
    project_path: String,
    language_path: String,
) -> Result<Vec<CorpusIndexEntry>, String> {
    load_corpus_index_with_revision(project_path, language_path).map(|res| res.entries)
}

#[command]
pub fn load_corpus_text_with_revision(
    project_path: String,
    language_path: String,
    corpus_id: String,
) -> Result<CorpusTextLoadResult, String> {
    let project_dir = Path::new(&project_path);
    with_consistent_read(
        project_dir,
        "load_corpus_text_with_revision",
        true,
        None,
        |proj, _| {
            let cid = sanitize_corpus_id(&corpus_id)?;
            let lang_rel = normalize_rel_path(&language_path)?;
            let corpus_dir = proj.join(&lang_rel).join("corpus");
            let file_path = corpus_dir.join(format!("{cid}.json"));
            if !file_path.is_file() {
                return Err(format!("NOT_FOUND: Corpus text '{cid}' not found"));
            }
            let rev = file_revision(&file_path)?;
            let index_rev = file_revision(&corpus_dir.join("corpus_index.json"))?;
            let content = fs::read_to_string(&file_path).map_err(|e| format!("IO: {e}"))?;
            let corpus: CorpusText =
                serde_json::from_str(&content).map_err(|e| e.to_string())?;
            Ok(CorpusTextLoadResult {
                corpus,
                revision: rev,
                index_revision: index_rev,
            })
        },
    )
}

/// Load a single corpus text by ID
#[command]
pub fn load_corpus_text(
    project_path: String,
    language_path: String,
    corpus_id: String,
) -> Result<CorpusText, String> {
    load_corpus_text_with_revision(project_path, language_path, corpus_id).map(|res| res.corpus)
}

/// Save a corpus text (create or update) AND update `corpus_index.json` atomically
/// inside a single project transaction (`T1.13`, `T1.15`).
#[command]
pub fn save_corpus_text(
    project_path: String,
    language_path: String,
    text: CorpusText,
    expected_revision: Option<String>,
    expected_index_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    let project_dir = Path::new(&project_path);
    let payload = serde_json::json!({
        "language_path": &language_path,
        "text": &text,
        "expected_revision": &expected_revision,
        "expected_index_revision": &expected_index_revision,
    });

    execute_project_transaction(
        project_dir,
        "save_corpus_text",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let cid = sanitize_corpus_id(&text.corpus_id)?;
            let lang_rel = normalize_rel_path(&language_path)?;
            let corpus_rel = format!("{lang_rel}/corpus");
            let file_rel = format!("{corpus_rel}/{cid}.json");
            let index_rel = format!("{corpus_rel}/corpus_index.json");

            let file_abs = proj.join(&file_rel);
            let index_abs = proj.join(&index_rel);

            let mut index: Vec<CorpusIndexEntry> = if index_abs.is_file() {
                let idx_content = fs::read_to_string(&index_abs).map_err(|e| format!("IO: {e}"))?;
                serde_json::from_str(&idx_content).unwrap_or_default()
            } else {
                Vec::new()
            };

            let existing_pos = index.iter().position(|e| e.corpus_id == cid);
            let (preserved_entry_extra, mut preserved_meta_extra) = match existing_pos {
                Some(pos) => (
                    index[pos].extra.clone(),
                    index[pos].metadata.extra.clone(),
                ),
                None => (BTreeMap::new(), BTreeMap::new()),
            };
            for (k, v) in &text.metadata.extra {
                preserved_meta_extra.insert(k.clone(), v.clone());
            }

            let new_entry = CorpusIndexEntry {
                corpus_id: text.corpus_id.clone(),
                title: text.title.clone(),
                description: text.description.clone(),
                metadata: CorpusTextMeta {
                    tags: text.metadata.tags.clone(),
                    created_at: text.metadata.created_at.clone(),
                    updated_at: text.metadata.updated_at.clone(),
                    auto_gloss_report: text.metadata.auto_gloss_report.clone(),
                    extra: preserved_meta_extra,
                },
                extra: preserved_entry_extra,
            };

            match existing_pos {
                Some(pos) => index[pos] = new_entry,
                None => index.push(new_entry),
            }
            index.sort_by(|a, b| a.corpus_id.cmp(&b.corpus_id));

            let text_bytes = serde_json::to_vec_pretty(&text).map_err(|e| format!("IO: {e}"))?;
            let index_bytes = serde_json::to_vec_pretty(&index).map_err(|e| format!("IO: {e}"))?;

            let mutations = vec![
                PlannedMutation::CreateDir {
                    rel_path: corpus_rel,
                },
                PlannedMutation::WriteFile {
                    rel_path: file_rel,
                    bytes: text_bytes,
                },
                PlannedMutation::WriteFile {
                    rel_path: index_rel,
                    bytes: index_bytes,
                },
            ];

            let lang_id_opt = if text.language_id.is_empty() {
                None
            } else {
                Some(text.language_id.clone())
            };
            let op_id_owned = op_id.to_string();

            Ok(TransactionPlan {
                expectations: vec![
                    RevisionExpectation::file("corpus", file_abs, expected_revision),
                    RevisionExpectation::file(
                        "corpus_index",
                        index_abs,
                        expected_index_revision,
                    ),
                ],
                mutations,
                audit_summary: format!("Saved corpus '{}' ({cid})", text.title),
                language_id: lang_id_opt,
                snapshot_id: None,
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("corpus").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: None,
                    warnings,
                }),
            })
        },
    )
}

/// Delete a corpus text and update `corpus_index.json` atomically in one project transaction,
/// taking an automatic `"corpus"` language snapshot first.
#[command]
pub fn delete_corpus_text(
    project_path: String,
    language_path: String,
    corpus_id: String,
    expected_revision: Option<String>,
    expected_index_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    let project_dir = Path::new(&project_path);
    let payload = serde_json::json!({
        "language_path": &language_path,
        "corpus_id": &corpus_id,
        "expected_revision": &expected_revision,
        "expected_index_revision": &expected_index_revision,
    });

    execute_project_transaction(
        project_dir,
        "delete_corpus_text",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let cid = sanitize_corpus_id(&corpus_id)?;
            let lang_rel = normalize_rel_path(&language_path)?;
            let corpus_rel = format!("{lang_rel}/corpus");
            let file_rel = format!("{corpus_rel}/{cid}.json");
            let index_rel = format!("{corpus_rel}/corpus_index.json");

            let file_abs = proj.join(&file_rel);
            let index_abs = proj.join(&index_rel);

            let mut mutations: Vec<PlannedMutation> = Vec::new();
            let mut snap_id: Option<String> = None;

            if file_abs.is_file() {
                let protected = collect_protected_snapshot_ids(proj);
                let (sid, _) = record_language_snapshot_in_tx(
                    proj,
                    &lang_rel,
                    "corpus",
                    "gui",
                    "delete_corpus",
                    "",
                    "",
                    &format!("Before deleting corpus '{cid}'"),
                    None,
                    &protected,
                    &mut mutations,
                )?;
                snap_id = Some(sid);
                mutations.push(PlannedMutation::DeletePath { rel_path: file_rel });
            }

            if index_abs.is_file() {
                let idx_content = fs::read_to_string(&index_abs).map_err(|e| format!("IO: {e}"))?;
                let mut index: Vec<CorpusIndexEntry> =
                    serde_json::from_str(&idx_content).unwrap_or_default();
                index.retain(|e| e.corpus_id != cid);
                let idx_bytes =
                    serde_json::to_vec_pretty(&index).map_err(|e| format!("IO: {e}"))?;
                mutations.push(PlannedMutation::WriteFile {
                    rel_path: index_rel,
                    bytes: idx_bytes,
                });
            }

            let op_id_owned = op_id.to_string();
            let snap_id_clone = snap_id.clone();

            Ok(TransactionPlan {
                expectations: vec![
                    RevisionExpectation::file("corpus", file_abs, expected_revision),
                    RevisionExpectation::file(
                        "corpus_index",
                        index_abs,
                        expected_index_revision,
                    ),
                ],
                mutations,
                audit_summary: format!("Deleted corpus '{cid}'"),
                language_id: None,
                snapshot_id: snap_id,
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("corpus_index").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: snap_id_clone,
                    warnings,
                }),
            })
        },
    )
}
