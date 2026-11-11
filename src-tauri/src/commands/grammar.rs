use std::fs;
use std::path::Path;
use tauri::command;

use crate::commands::transaction::{
    execute_project_transaction, with_consistent_read, PlannedMutation, RevisionExpectation,
    TransactionPlan,
};
use crate::models::{GrammarConfig, GrammarLoadResult, WriteResult};
use crate::utils::revision::{file_revision, normalize_rel_path};

#[command]
pub fn load_grammar_with_revision(
    project_path: String,
    language_path: String,
) -> Result<GrammarLoadResult, String> {
    let project_dir = Path::new(&project_path);
    with_consistent_read(
        project_dir,
        "load_grammar_with_revision",
        true,
        None,
        |proj, _| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let path = proj.join(&lang_rel).join("grammar.json");
            let rev = file_revision(&path)?;
            let config = if path.is_file() {
                let content = fs::read_to_string(&path).map_err(|e| format!("IO: {e}"))?;
                serde_json::from_str(&content).map_err(|e| e.to_string())?
            } else {
                GrammarConfig::default()
            };
            Ok(GrammarLoadResult {
                config,
                revision: rev,
            })
        },
    )
}

#[command]
pub fn load_grammar(project_path: String, language_path: String) -> Result<GrammarConfig, String> {
    load_grammar_with_revision(project_path, language_path).map(|res| res.config)
}

#[command]
pub fn save_grammar(
    project_path: String,
    language_path: String,
    config: GrammarConfig,
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
        "save_grammar",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let gram_rel = format!("{lang_rel}/grammar.json");
            let gram_abs = proj.join(&gram_rel);
            let bytes = serde_json::to_vec_pretty(&config).map_err(|e| format!("IO: {e}"))?;

            let mutations = vec![
                PlannedMutation::CreateDir {
                    rel_path: lang_rel.clone(),
                },
                PlannedMutation::WriteFile {
                    rel_path: gram_rel,
                    bytes,
                },
            ];

            let lang_id_opt = if config.language_id.is_empty() {
                None
            } else {
                Some(config.language_id.clone())
            };
            let op_id_owned = op_id.to_string();

            Ok(TransactionPlan {
                expectations: vec![RevisionExpectation::file(
                    "grammar",
                    gram_abs,
                    expected_revision,
                )],
                mutations,
                audit_summary: format!("Saved grammar for '{lang_rel}'"),
                language_id: lang_id_opt,
                snapshot_id: None,
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("grammar").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: None,
                    warnings,
                }),
            })
        },
    )
}
