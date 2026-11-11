use std::fs;
use std::path::Path;
use tauri::command;

use crate::commands::transaction::{
    execute_project_transaction, with_consistent_read, PlannedMutation, RevisionExpectation,
    TransactionPlan,
};
use crate::models::{SCAConfig, ScaLoadResult, WriteResult};
use crate::utils::revision::{file_revision, normalize_rel_path};

#[command]
pub fn load_sca_with_revision(
    project_path: String,
    language_path: String,
) -> Result<ScaLoadResult, String> {
    let project_dir = Path::new(&project_path);
    with_consistent_read(
        project_dir,
        "load_sca_with_revision",
        true,
        None,
        |proj, _| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let path = proj.join(&lang_rel).join("sca_rules.json");
            let rev = file_revision(&path)?;
            let config = if path.is_file() {
                let content = fs::read_to_string(&path).map_err(|e| format!("IO: {e}"))?;
                serde_json::from_str(&content).map_err(|e| e.to_string())?
            } else {
                SCAConfig::default()
            };
            Ok(ScaLoadResult {
                config,
                revision: rev,
            })
        },
    )
}

#[command]
pub fn load_sca(project_path: String, language_path: String) -> Result<SCAConfig, String> {
    load_sca_with_revision(project_path, language_path).map(|res| res.config)
}

#[command]
pub fn save_sca(
    project_path: String,
    language_path: String,
    config: SCAConfig,
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
        "save_sca",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let sca_rel = format!("{lang_rel}/sca_rules.json");
            let sca_abs = proj.join(&sca_rel);
            let bytes = serde_json::to_vec_pretty(&config).map_err(|e| format!("IO: {e}"))?;

            let mutations = vec![
                PlannedMutation::CreateDir {
                    rel_path: lang_rel.clone(),
                },
                PlannedMutation::WriteFile {
                    rel_path: sca_rel,
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
                    "sca",
                    sca_abs,
                    expected_revision,
                )],
                mutations,
                audit_summary: format!("Saved SCA rules for '{lang_rel}'"),
                language_id: lang_id_opt,
                snapshot_id: None,
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("sca").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: None,
                    warnings,
                }),
            })
        },
    )
}
