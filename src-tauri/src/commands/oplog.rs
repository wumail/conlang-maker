use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Deserializer, Serialize};
use tauri::command;

use crate::commands::transaction::{
    execute_project_transaction, with_consistent_read, PlannedMutation, RevisionExpectation,
    TransactionPlan,
};
use crate::models::{
    LanguageEntry, OperationLog, OperationLogEntry, SnapshotDiffSummary, SnapshotRollbackResult,
    SnapshotSummary, WorkspaceConfig,
};
use crate::utils::fs_util::{atomic_write, atomic_write_bytes, generate_nonce_hex, now_rfc3339};
use crate::utils::revision::{
    canonicalize_best_effort, file_revision, find_conlang_file, lexicon_revision,
    normalize_rel_path, sha256_hex,
};

// ── Manifest & Index Types (§3.6) ────────────────────────

fn default_v1() -> u32 {
    1
}
fn default_v2() -> u32 {
    2
}
fn default_level_language() -> String {
    "language".to_string()
}
fn default_level_project() -> String {
    "project".to_string()
}
fn default_scope_lexicon() -> String {
    "lexicon".to_string()
}
fn default_scope_project() -> String {
    "project".to_string()
}
fn default_origin_gui() -> String {
    "gui".to_string()
}
fn default_max_snapshots() -> u32 {
    10
}

fn deserialize_flexible_scope<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum ScopeValue {
        Single(String),
        Multi(Vec<String>),
    }
    match Option::<ScopeValue>::deserialize(deserializer)? {
        Some(ScopeValue::Single(s)) if !s.trim().is_empty() => Ok(s),
        Some(ScopeValue::Multi(v)) => Ok(v
            .into_iter()
            .next()
            .unwrap_or_else(default_scope_lexicon)),
        _ => Ok(default_scope_lexicon()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotFileRecord {
    pub rel_path: String,
    pub existed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stored_rel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanguageSnapshotManifest {
    #[serde(default = "default_v1")]
    pub version: u32,
    #[serde(default = "default_level_language")]
    pub level: String,
    #[serde(default, alias = "logId")]
    pub log_id: String,
    #[serde(
        default = "default_scope_lexicon",
        deserialize_with = "deserialize_flexible_scope"
    )]
    pub scope: String,
    #[serde(default = "default_origin_gui")]
    pub origin: String,
    #[serde(default, alias = "createdAt")]
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dir_existed: Option<bool>,
    #[serde(default)]
    pub files: Vec<SnapshotFileRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSnapshotLangRecord {
    pub language_id: String,
    pub entry: LanguageEntry,
    pub rel_path: String,
    pub dir_existed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSnapshotManifest {
    #[serde(default = "default_v2")]
    pub version: u32,
    pub snapshot_id: String,
    #[serde(default = "default_level_project")]
    pub level: String,
    #[serde(default = "default_scope_project")]
    pub scope: String,
    #[serde(default = "default_origin_gui")]
    pub origin: String,
    pub operation_type: String,
    pub description: String,
    pub created_at: String,
    pub timestamp: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restored_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conlang_rel_path: Option<String>,
    #[serde(default)]
    pub conlang_existed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_config: Option<WorkspaceConfig>,
    #[serde(default)]
    pub affected_languages: Vec<ProjectSnapshotLangRecord>,
    #[serde(default)]
    pub files: Vec<SnapshotFileRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSnapshotIndex {
    #[serde(default = "default_max_snapshots")]
    pub max_snapshots: u32,
    #[serde(default)]
    pub entries: Vec<ProjectSnapshotIndexEntry>,
}

impl Default for ProjectSnapshotIndex {
    fn default() -> Self {
        Self {
            max_snapshots: 20,
            entries: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSnapshotIndexEntry {
    pub snapshot_id: String,
    pub operation_type: String,
    pub description: String,
    pub timestamp: String,
    pub created_at: String,
    #[serde(default = "default_origin_gui")]
    pub origin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restored_from: Option<String>,
    pub snapshot_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchivedLanguageMeta {
    pub language_id: String,
    pub operation_id: String,
    pub archived_at: String,
    pub original_entry: LanguageEntry,
    pub original_path: String,
    pub baseline_snapshot_id: String,
}

// ── Path Helpers ─────────────────────────────────────────

fn oplog_dir(language_dir: &Path) -> PathBuf {
    language_dir.join(".oplog")
}

fn oplog_file(language_dir: &Path) -> PathBuf {
    oplog_dir(language_dir).join("oplog.json")
}

fn project_snapshots_root(project_dir: &Path) -> PathBuf {
    project_dir.join(".conlang-maker").join("snapshots")
}

fn project_snapshots_index_file(project_dir: &Path) -> PathBuf {
    project_snapshots_root(project_dir).join("index.json")
}

fn archived_languages_root(project_dir: &Path) -> PathBuf {
    project_snapshots_root(project_dir).join("archived_languages")
}

fn now_epoch_secs_str() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{secs}")
}

pub fn generate_snapshot_id() -> String {
    let nonce = generate_nonce_hex();
    nonce.chars().take(16).collect()
}

fn validate_scope(scope: &str) -> Result<&str, String> {
    match scope {
        "lexicon" | "phonology" | "grammar" | "sca" | "corpus" | "font" => Ok(scope),
        other => Err(format!("VALIDATION: Unsupported language snapshot scope '{other}'")),
    }
}

fn normalize_timestamp_for_summary(ts: &str, fallback_created_at: Option<&str>) -> String {
    if let Some(c) = fallback_created_at {
        if !c.trim().is_empty() {
            return c.to_string();
        }
    }
    if let Ok(secs) = ts.trim().parse::<i64>() {
        if let Some(dt) = chrono::DateTime::from_timestamp(secs, 0) {
            return dt.to_rfc3339();
        }
    }
    ts.to_string()
}

fn resolve_conlang_path_in_project(
    project_dir: &Path,
    conlang_file_path: Option<&str>,
) -> Option<PathBuf> {
    if let Some(p) = conlang_file_path {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            let candidate = PathBuf::from(trimmed);
            if candidate.is_absolute() {
                return Some(canonicalize_best_effort(&candidate));
            }
            return Some(project_dir.join(candidate));
        }
    }
    find_conlang_file(project_dir)
}

fn load_workspace_if_present(
    project_dir: &Path,
    conlang_file_path: Option<&str>,
) -> Result<(Option<PathBuf>, Option<WorkspaceConfig>), String> {
    let Some(ws_path) = resolve_conlang_path_in_project(project_dir, conlang_file_path) else {
        return Ok((None, None));
    };
    if !ws_path.is_file() {
        return Ok((Some(ws_path), None));
    }
    let content = fs::read_to_string(&ws_path).map_err(|e| format!("IO: {e}"))?;
    let cfg: WorkspaceConfig =
        serde_json::from_str(&content).map_err(|e| format!("IO: Invalid .conlang JSON: {e}"))?;
    Ok((Some(ws_path), Some(cfg)))
}

/// Collect snapshot IDs referenced by `archived_languages` or `trash` so `max_snapshots`
/// never evicts active recovery baselines (§3.6).
pub fn collect_protected_snapshot_ids(project_dir: &Path) -> HashSet<String> {
    let mut protected = HashSet::new();

    // 1. Baselines referenced by archived_languages/<lang>/<op>/archive_meta.json
    let arch_root = archived_languages_root(project_dir);
    if let Ok(lang_dirs) = fs::read_dir(&arch_root) {
        for lang_entry in lang_dirs.flatten() {
            if let Ok(op_dirs) = fs::read_dir(lang_entry.path()) {
                for op_entry in op_dirs.flatten() {
                    let meta_path = op_entry.path().join("archive_meta.json");
                    if let Ok(text) = fs::read_to_string(&meta_path) {
                        if let Ok(meta) = serde_json::from_str::<ArchivedLanguageMeta>(&text) {
                            protected.insert(meta.baseline_snapshot_id);
                        }
                    }
                }
            }
        }
    }

    // 2. Project snapshots referenced by trash/<trash_id>/meta.json
    let trash_root = project_dir.join(".conlang-maker").join("trash");
    if let Ok(trash_dirs) = fs::read_dir(&trash_root) {
        for entry in trash_dirs.flatten() {
            let meta_path = entry.path().join("meta.json");
            if let Ok(text) = fs::read_to_string(&meta_path) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(snap_id) = val.get("project_snapshot_id").and_then(|v| v.as_str()) {
                        protected.insert(snap_id.to_string());
                    }
                }
            }
        }
    }

    protected
}

// ── Language Snapshot Creation & Inspection ──────────────

fn write_language_snapshot_files(
    lang_dir: &Path,
    snap_dir: &Path,
    log_id: &str,
    scope: &str,
    origin: &str,
    language_id: Option<&str>,
    language_rel_path: Option<&str>,
) -> Result<LanguageSnapshotManifest, String> {
    let scope = validate_scope(scope)?;
    fs::create_dir_all(snap_dir).map_err(|e| format!("IO: {e}"))?;
    let files_root = snap_dir.join("files");
    fs::create_dir_all(&files_root).map_err(|e| format!("IO: {e}"))?;

    let mut records: Vec<SnapshotFileRecord> = Vec::new();
    let mut font_file: Option<String> = None;
    let mut dir_existed: Option<bool> = None;

    let capture_single_file =
        |rel: &str, records: &mut Vec<SnapshotFileRecord>| -> Result<(), String> {
            let src = lang_dir.join(rel);
            if src.is_file() {
                let bytes = fs::read(&src).map_err(|e| format!("IO: {e}"))?;
                let sha = sha256_hex(&bytes);
                let stored = format!("files/{rel}");
                atomic_write_bytes(&snap_dir.join(&stored), &bytes)?;
                records.push(SnapshotFileRecord {
                    rel_path: rel.to_string(),
                    existed: true,
                    sha256: Some(sha),
                    stored_rel: Some(stored),
                });
            } else {
                records.push(SnapshotFileRecord {
                    rel_path: rel.to_string(),
                    existed: false,
                    sha256: None,
                    stored_rel: None,
                });
            }
            Ok(())
        };

    match scope {
        "phonology" => capture_single_file("phonology.json", &mut records)?,
        "grammar" => capture_single_file("grammar.json", &mut records)?,
        "sca" => capture_single_file("sca_rules.json", &mut records)?,
        "font" => {
            if lang_dir.join("font.otf").is_file() {
                font_file = Some("font.otf".to_string());
            } else if lang_dir.join("font.ttf").is_file() {
                font_file = Some("font.ttf".to_string());
            }
            capture_single_file("font.otf", &mut records)?;
            capture_single_file("font.ttf", &mut records)?;
        }
        "lexicon" | "corpus" => {
            let sub = lang_dir.join(scope);
            let exists = sub.is_dir();
            dir_existed = Some(exists);
            if exists {
                let mut names: Vec<String> = Vec::new();
                for entry in fs::read_dir(&sub).map_err(|e| format!("IO: {e}"))? {
                    let entry = entry.map_err(|e| format!("IO: {e}"))?;
                    if entry.file_type().map_err(|e| format!("IO: {e}"))?.is_file() {
                        names.push(entry.file_name().to_string_lossy().into_owned());
                    }
                }
                names.sort();
                for name in names {
                    let rel = format!("{scope}/{name}");
                    capture_single_file(&rel, &mut records)?;
                }
            }
        }
        _ => unreachable!(),
    }

    let manifest = LanguageSnapshotManifest {
        version: 1,
        level: "language".to_string(),
        log_id: log_id.to_string(),
        scope: scope.to_string(),
        origin: origin.to_string(),
        created_at: now_rfc3339(),
        language_id: language_id.map(str::to_string),
        language_path: language_rel_path.map(str::to_string),
        font_file,
        dir_existed,
        files: records,
    };

    let manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("IO: {e}"))?;
    atomic_write(&snap_dir.join("manifest.json"), &manifest_json)?;

    Ok(manifest)
}

/// Record a language-scoped snapshot inside an active transaction `plan_fn`.
/// Writes immutable `snap_<id>` files under `<lang>/.oplog/` and appends the `oplog.json`
/// update to `mutations` so `oplog.json` commits/rolls back atomically with the transaction.
#[allow(clippy::too_many_arguments)]
pub fn record_language_snapshot_in_tx(
    project_dir: &Path,
    language_rel_path: &str,
    scope: &str,
    origin: &str,
    operation_type: &str,
    source_language_id: &str,
    target_language_id: &str,
    description: &str,
    restored_from: Option<String>,
    protected_ids: &HashSet<String>,
    mutations: &mut Vec<PlannedMutation>,
) -> Result<(String, OperationLog), String> {
    let scope = validate_scope(scope)?;
    let lang_rel = normalize_rel_path(language_rel_path)?;
    let lang_dir = project_dir.join(&lang_rel);
    let oplog_base = oplog_dir(&lang_dir);
    fs::create_dir_all(&oplog_base).map_err(|e| format!("IO: {e}"))?;

    let file = oplog_file(&lang_dir);
    let mut log: OperationLog = if file.is_file() {
        let content = fs::read_to_string(&file).map_err(|e| format!("IO: {e}"))?;
        serde_json::from_str(&content).map_err(|e| format!("IO: {e}"))?
    } else {
        OperationLog::default()
    };

    let log_id = generate_snapshot_id();
    let snapshot_dir_name = format!("snap_{log_id}");
    let snapshot_path = oplog_base.join(&snapshot_dir_name);

    write_language_snapshot_files(
        &lang_dir,
        &snapshot_path,
        &log_id,
        scope,
        origin,
        if target_language_id.is_empty() {
            None
        } else {
            Some(target_language_id)
        },
        Some(&lang_rel),
    )?;

    let entry = OperationLogEntry {
        log_id: log_id.clone(),
        operation_type: operation_type.to_string(),
        timestamp: now_epoch_secs_str(),
        source_language_id: source_language_id.to_string(),
        target_language_id: target_language_id.to_string(),
        description: description.to_string(),
        snapshot_dir: snapshot_dir_name,
        origin: Some(origin.to_string()),
        scope: Some(scope.to_string()),
        level: Some("language".to_string()),
        restored_from,
        extra: BTreeMap::new(),
    };
    log.entries.push(entry);

    prune_language_oplog_entries(&mut log, &oplog_base, protected_ids, &log_id);

    let oplog_rel = format!("{lang_rel}/.oplog/oplog.json");
    let oplog_bytes = serde_json::to_vec_pretty(&log).map_err(|e| format!("IO: {e}"))?;
    mutations.push(PlannedMutation::WriteFile {
        rel_path: oplog_rel,
        bytes: oplog_bytes,
    });

    Ok((log_id, log))
}

fn prune_language_oplog_entries(
    log: &mut OperationLog,
    oplog_base: &Path,
    protected_ids: &HashSet<String>,
    just_created_id: &str,
) {
    let max_keep = log.max_snapshots.max(1) as usize;
    let mut i = 0;
    while log.entries.len() > max_keep && i < log.entries.len() {
        let candidate_id = &log.entries[i].log_id;
        if candidate_id == just_created_id || protected_ids.contains(candidate_id) {
            i += 1;
            continue;
        }
        let removed = log.entries.remove(i);
        let old_snap = oplog_base.join(&removed.snapshot_dir);
        if old_snap.exists() {
            let _ = fs::remove_dir_all(&old_snap);
        }
    }
}

fn read_language_snapshot_manifest_or_legacy(
    snap_dir: &Path,
    fallback_entry: Option<&OperationLogEntry>,
) -> Result<LanguageSnapshotManifest, String> {
    let manifest_path = snap_dir.join("manifest.json");
    if manifest_path.is_file() {
        let text = fs::read_to_string(&manifest_path).map_err(|e| format!("IO: {e}"))?;
        let mut manifest: LanguageSnapshotManifest =
            serde_json::from_str(&text).map_err(|e| format!("IO: Invalid manifest: {e}"))?;
        // Support manifest v1 files written by external tools where files stood directly under snap_dir/<scope>
        if manifest.files.is_empty() && (manifest.scope == "lexicon" || manifest.scope == "corpus") {
            let direct_sub = snap_dir.join(&manifest.scope);
            if direct_sub.is_dir() {
                manifest.dir_existed = Some(true);
                let mut names: Vec<String> = Vec::new();
                for entry in fs::read_dir(&direct_sub).map_err(|e| format!("IO: {e}"))? {
                    let entry = entry.map_err(|e| format!("IO: {e}"))?;
                    if entry.file_type().map_err(|e| format!("IO: {e}"))?.is_file() {
                        names.push(entry.file_name().to_string_lossy().into_owned());
                    }
                }
                names.sort();
                for name in names {
                    let bytes =
                        fs::read(direct_sub.join(&name)).map_err(|e| format!("IO: {e}"))?;
                    manifest.files.push(SnapshotFileRecord {
                        rel_path: format!("{}/{name}", manifest.scope),
                        existed: true,
                        sha256: Some(sha256_hex(&bytes)),
                        stored_rel: Some(format!("{}/{name}", manifest.scope)),
                    });
                }
            }
        }
        return Ok(manifest);
    }

    // Legacy manifest-less snapshot (<snap_dir>/lexicon/*.ndjson) -> treat as scope "lexicon"
    let legacy_lex = snap_dir.join("lexicon");
    let mut files = Vec::new();
    let existed = legacy_lex.is_dir();
    if existed {
        let mut names: Vec<String> = Vec::new();
        for entry in fs::read_dir(&legacy_lex).map_err(|e| format!("IO: {e}"))? {
            let entry = entry.map_err(|e| format!("IO: {e}"))?;
            if entry.file_type().map_err(|e| format!("IO: {e}"))?.is_file() {
                names.push(entry.file_name().to_string_lossy().into_owned());
            }
        }
        names.sort();
        for name in names {
            let bytes = fs::read(legacy_lex.join(&name)).map_err(|e| format!("IO: {e}"))?;
            files.push(SnapshotFileRecord {
                rel_path: format!("lexicon/{name}"),
                existed: true,
                sha256: Some(sha256_hex(&bytes)),
                stored_rel: Some(format!("lexicon/{name}")),
            });
        }
    }

    Ok(LanguageSnapshotManifest {
        version: 0,
        level: "language".to_string(),
        log_id: fallback_entry
            .map(|e| e.log_id.clone())
            .unwrap_or_default(),
        scope: "lexicon".to_string(),
        origin: fallback_entry
            .and_then(|e| e.origin.clone())
            .unwrap_or_else(default_origin_gui),
        created_at: fallback_entry
            .map(|e| normalize_timestamp_for_summary(&e.timestamp, None))
            .unwrap_or_else(now_rfc3339),
        language_id: fallback_entry.map(|e| e.target_language_id.clone()),
        language_path: None,
        font_file: None,
        dir_existed: Some(true), // Legacy rollback ensured clean lexicon dir if snap had no lexicon
        files,
    })
}

/// Build diff & restore mutations for applying `manifest` (from `snap_dir`) onto `lang_rel_path`
/// inside `project_dir`. `virtual_current` optionally supplies baseline file hashes when
/// previewing/restoring an archived language whose directory is also being rebuilt in the same tx.
fn plan_apply_language_manifest(
    project_dir: &Path,
    lang_rel_path: &str,
    snap_dir: &Path,
    manifest: &LanguageSnapshotManifest,
    virtual_current: Option<&BTreeMap<String, Vec<u8>>>,
) -> Result<(SnapshotDiffSummary, Vec<PlannedMutation>), String> {
    let lang_rel = normalize_rel_path(lang_rel_path)?;
    let lang_dir = project_dir.join(&lang_rel);

    let mut changed_files = Vec::new();
    let mut added_files = Vec::new();
    let mut removed_files = Vec::new();
    let mut mutations = Vec::new();

    let current_sha_of = |proj_rel: &str| -> Result<Option<String>, String> {
        if let Some(vmap) = virtual_current {
            return Ok(vmap.get(proj_rel).map(|b| sha256_hex(b)));
        }
        let p = project_dir.join(proj_rel);
        if p.is_file() {
            let bytes = fs::read(&p).map_err(|e| format!("IO: {e}"))?;
            Ok(Some(sha256_hex(&bytes)))
        } else {
            Ok(None)
        }
    };

    if manifest.scope == "lexicon" || manifest.scope == "corpus" {
        let sub_rel = format!("{lang_rel}/{}", manifest.scope);
        let snap_existing: HashSet<String> = manifest
            .files
            .iter()
            .filter(|f| f.existed)
            .map(|f| format!("{lang_rel}/{}", f.rel_path))
            .collect();

        // Find current files in `<lang>/<scope>/` that did not exist in the snapshot
        let mut current_sub_files: Vec<String> = Vec::new();
        if let Some(vmap) = virtual_current {
            let prefix = format!("{sub_rel}/");
            for k in vmap.keys() {
                if k.starts_with(&prefix) {
                    current_sub_files.push(k.clone());
                }
            }
        } else {
            let sub_abs = lang_dir.join(&manifest.scope);
            if sub_abs.is_dir() {
                for entry in fs::read_dir(&sub_abs).map_err(|e| format!("IO: {e}"))? {
                    let entry = entry.map_err(|e| format!("IO: {e}"))?;
                    if entry.file_type().map_err(|e| format!("IO: {e}"))?.is_file() {
                        let name = entry.file_name().to_string_lossy().into_owned();
                        current_sub_files.push(format!("{sub_rel}/{name}"));
                    }
                }
            }
        }
        current_sub_files.sort();

        for cur_rel in current_sub_files {
            if !snap_existing.contains(&cur_rel) {
                removed_files.push(cur_rel.clone());
                mutations.push(PlannedMutation::DeletePath { rel_path: cur_rel });
            }
        }

        if manifest.dir_existed == Some(false) && snap_existing.is_empty() {
            mutations.push(PlannedMutation::DeletePath { rel_path: sub_rel });
        } else if snap_existing.is_empty() {
            mutations.push(PlannedMutation::CreateDir { rel_path: sub_rel });
        }
    }

    for rec in &manifest.files {
        let proj_rel = format!("{lang_rel}/{}", rec.rel_path);
        let cur_sha = current_sha_of(&proj_rel)?;
        if rec.existed {
            let stored_rel = rec
                .stored_rel
                .as_deref()
                .ok_or_else(|| format!("IO: Missing stored_rel for {}", rec.rel_path))?;
            let bytes = fs::read(snap_dir.join(stored_rel)).map_err(|e| format!("IO: {e}"))?;
            let target_sha = sha256_hex(&bytes);
            match cur_sha {
                None => added_files.push(proj_rel.clone()),
                Some(ref s) if s != &target_sha => changed_files.push(proj_rel.clone()),
                _ => {}
            }
            mutations.push(PlannedMutation::WriteFile {
                rel_path: proj_rel,
                bytes,
            });
        } else if cur_sha.is_some() {
            removed_files.push(proj_rel.clone());
            mutations.push(PlannedMutation::DeletePath { rel_path: proj_rel });
        }
    }

    changed_files.sort();
    added_files.sort();
    removed_files.sort();

    let diff = SnapshotDiffSummary {
        snapshot_id: manifest.log_id.clone(),
        level: "language".to_string(),
        scope: manifest.scope.clone(),
        changed_files,
        added_files,
        removed_files,
        conflicts: Vec::new(),
    };

    Ok((diff, mutations))
}

// ── Project Snapshot Creation & Inspection ───────────────

fn is_excluded_project_rel(rel: &str) -> bool {
    if rel.ends_with(".tmp") {
        return true;
    }
    if rel == ".conlang-maker" || rel.starts_with(".conlang-maker/") {
        return true;
    }
    // Exclude historical language snapshot directories (`<lang>/.oplog/snap_*`) to prevent recursive bloat;
    // `.oplog/oplog.json` is also managed per-language rather than overwritten by project snapshots.
    if rel.contains("/.oplog/") || rel.ends_with("/.oplog") || rel.starts_with(".oplog/") {
        return true;
    }
    if rel == ".git" || rel.starts_with(".git/") || rel == ".DS_Store" || rel.ends_with("/.DS_Store")
    {
        return true;
    }
    false
}

fn collect_project_business_files_recursive(
    project_dir: &Path,
    cur_dir: &Path,
    out_rels: &mut Vec<String>,
) -> Result<(), String> {
    if !cur_dir.is_dir() {
        return Ok(());
    }
    let mut entries: Vec<fs::DirEntry> = Vec::new();
    for e in fs::read_dir(cur_dir).map_err(|e| format!("IO: {e}"))? {
        entries.push(e.map_err(|e| format!("IO: {e}"))?);
    }
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let abs = entry.path();
        let rel_os = abs
            .strip_prefix(project_dir)
            .map_err(|e| format!("IO: {e}"))?;
        let rel = normalize_rel_path(&rel_os.to_string_lossy().replace('\\', "/"))?;
        if is_excluded_project_rel(&rel) {
            continue;
        }
        let ft = entry.file_type().map_err(|e| format!("IO: {e}"))?;
        if ft.is_dir() {
            collect_project_business_files_recursive(project_dir, &abs, out_rels)?;
        } else if ft.is_file() {
            out_rels.push(rel);
        }
    }
    Ok(())
}

/// Record a full project-level snapshot (`manifest.json` v2) inside an active transaction `plan_fn`.
#[allow(clippy::too_many_arguments)]
pub fn record_project_snapshot_in_tx(
    project_dir: &Path,
    conlang_file_path: Option<&str>,
    origin: &str,
    operation_type: &str,
    description: &str,
    restored_from: Option<String>,
    extra_protected: &HashSet<String>,
    mutations: &mut Vec<PlannedMutation>,
) -> Result<(String, SnapshotSummary), String> {
    let snaps_root = project_snapshots_root(project_dir);
    fs::create_dir_all(&snaps_root).map_err(|e| format!("IO: {e}"))?;

    let index_path = project_snapshots_index_file(project_dir);
    let mut index: ProjectSnapshotIndex = if index_path.is_file() {
        let text = fs::read_to_string(&index_path).map_err(|e| format!("IO: {e}"))?;
        serde_json::from_str(&text).map_err(|e| format!("IO: {e}"))?
    } else {
        ProjectSnapshotIndex::default()
    };

    let (ws_path_opt, ws_cfg_opt) = load_workspace_if_present(project_dir, conlang_file_path)?;
    let conlang_rel_path = match &ws_path_opt {
        Some(p) => {
            if let Ok(rel) = p.strip_prefix(project_dir) {
                Some(normalize_rel_path(&rel.to_string_lossy().replace('\\', "/"))?)
            } else {
                p.file_name().map(|n| n.to_string_lossy().into_owned())
            }
        }
        None => None,
    };
    let conlang_existed = ws_path_opt.as_ref().is_some_and(|p| p.is_file());

    let mut affected_languages: Vec<ProjectSnapshotLangRecord> = Vec::new();
    if let Some(ref cfg) = ws_cfg_opt {
        for lang in &cfg.languages {
            let rel = normalize_rel_path(&lang.path)?;
            let dir_existed = project_dir.join(&rel).is_dir();
            affected_languages.push(ProjectSnapshotLangRecord {
                language_id: lang.language_id.clone(),
                entry: lang.clone(),
                rel_path: rel,
                dir_existed,
            });
        }
    }

    let snapshot_id = generate_snapshot_id();
    let snap_dir_name = format!("snap_{snapshot_id}");
    let snap_dir = snaps_root.join(&snap_dir_name);
    let files_dir = snap_dir.join("files");
    fs::create_dir_all(&files_dir).map_err(|e| format!("IO: {e}"))?;

    let mut business_rels: Vec<String> = Vec::new();
    collect_project_business_files_recursive(project_dir, project_dir, &mut business_rels)?;
    business_rels.sort();
    business_rels.dedup();

    let mut file_records: Vec<SnapshotFileRecord> = Vec::with_capacity(business_rels.len());
    for rel in business_rels {
        let src = project_dir.join(&rel);
        let bytes = fs::read(&src).map_err(|e| format!("IO: {e}"))?;
        let sha = sha256_hex(&bytes);
        let stored_rel = format!("files/{rel}");
        atomic_write_bytes(&snap_dir.join(&stored_rel), &bytes)?;
        file_records.push(SnapshotFileRecord {
            rel_path: rel,
            existed: true,
            sha256: Some(sha),
            stored_rel: Some(stored_rel),
        });
    }

    let created_at = now_rfc3339();
    let ts_epoch = now_epoch_secs_str();

    let manifest = ProjectSnapshotManifest {
        version: 2,
        snapshot_id: snapshot_id.clone(),
        level: "project".to_string(),
        scope: "project".to_string(),
        origin: origin.to_string(),
        operation_type: operation_type.to_string(),
        description: description.to_string(),
        created_at: created_at.clone(),
        timestamp: ts_epoch.clone(),
        restored_from: restored_from.clone(),
        conlang_rel_path,
        conlang_existed,
        workspace_config: ws_cfg_opt,
        affected_languages,
        files: file_records,
    };

    let manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("IO: {e}"))?;
    atomic_write(&snap_dir.join("manifest.json"), &manifest_json)?;

    index.entries.push(ProjectSnapshotIndexEntry {
        snapshot_id: snapshot_id.clone(),
        operation_type: operation_type.to_string(),
        description: description.to_string(),
        timestamp: ts_epoch,
        created_at: created_at.clone(),
        origin: origin.to_string(),
        restored_from: restored_from.clone(),
        snapshot_dir: snap_dir_name,
    });

    let mut protected = collect_protected_snapshot_ids(project_dir);
    protected.extend(extra_protected.iter().cloned());
    prune_project_snapshot_entries(&mut index, &snaps_root, &protected, &snapshot_id);

    let index_bytes = serde_json::to_vec_pretty(&index).map_err(|e| format!("IO: {e}"))?;
    mutations.push(PlannedMutation::WriteFile {
        rel_path: ".conlang-maker/snapshots/index.json".to_string(),
        bytes: index_bytes,
    });

    let summary = SnapshotSummary {
        snapshot_id: snapshot_id.clone(),
        level: "project".to_string(),
        scope: "project".to_string(),
        origin: origin.to_string(),
        language_id: None,
        operation_type: operation_type.to_string(),
        description: description.to_string(),
        timestamp: created_at,
        restored_from,
        archived_language: Some(false),
    };

    Ok((snapshot_id, summary))
}

fn prune_project_snapshot_entries(
    index: &mut ProjectSnapshotIndex,
    snaps_root: &Path,
    protected: &HashSet<String>,
    just_created_id: &str,
) {
    let max_keep = index.max_snapshots.max(1) as usize;
    let mut i = 0;
    while index.entries.len() > max_keep && i < index.entries.len() {
        let cid = &index.entries[i].snapshot_id;
        if cid == just_created_id || protected.contains(cid) {
            i += 1;
            continue;
        }
        let removed = index.entries.remove(i);
        let snap_path = snaps_root.join(&removed.snapshot_dir);
        if snap_path.exists() {
            let _ = fs::remove_dir_all(&snap_path);
        }
    }
}

fn load_project_snapshot_manifest(
    project_dir: &Path,
    snapshot_id: &str,
) -> Result<(PathBuf, ProjectSnapshotManifest), String> {
    let snaps_root = project_snapshots_root(project_dir);
    let snap_dir = snaps_root.join(format!("snap_{snapshot_id}"));
    let manifest_path = snap_dir.join("manifest.json");
    if !manifest_path.is_file() {
        return Err(format!(
            "NOT_FOUND: Project snapshot '{snapshot_id}' does not exist"
        ));
    }
    let text = fs::read_to_string(&manifest_path).map_err(|e| format!("IO: {e}"))?;
    let manifest: ProjectSnapshotManifest =
        serde_json::from_str(&text).map_err(|e| format!("IO: Invalid project snapshot: {e}"))?;
    Ok((snap_dir, manifest))
}

fn find_latest_archived_language(
    project_dir: &Path,
    language_id: &str,
) -> Result<Option<(PathBuf, ArchivedLanguageMeta)>, String> {
    let lang_arch_dir = archived_languages_root(project_dir).join(language_id);
    if !lang_arch_dir.is_dir() {
        return Ok(None);
    }
    let mut candidates: Vec<(String, PathBuf, ArchivedLanguageMeta)> = Vec::new();
    for entry in fs::read_dir(&lang_arch_dir).map_err(|e| format!("IO: {e}"))? {
        let entry = entry.map_err(|e| format!("IO: {e}"))?;
        let dir = entry.path();
        let meta_path = dir.join("archive_meta.json");
        if meta_path.is_file() {
            let text = fs::read_to_string(&meta_path).map_err(|e| format!("IO: {e}"))?;
            let meta: ArchivedLanguageMeta =
                serde_json::from_str(&text).map_err(|e| format!("IO: {e}"))?;
            candidates.push((meta.archived_at.clone(), dir, meta));
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(candidates.into_iter().next().map(|(_, d, m)| (d, m)))
}

// ── Tauri Commands ───────────────────────────────────────

/// Load the operation log for a language directory.
#[command]
pub fn load_operation_log(
    project_path: String,
    language_path: String,
) -> Result<OperationLog, String> {
    let project = Path::new(&project_path);
    with_consistent_read(project, "load_operation_log", true, None, |proj, _| {
        let lang_dir = proj.join(normalize_rel_path(&language_path)?);
        let file = oplog_file(&lang_dir);
        if !file.is_file() {
            return Ok(OperationLog::default());
        }
        let content = fs::read_to_string(&file).map_err(|e| format!("IO: {e}"))?;
        let log: OperationLog =
            serde_json::from_str(&content).map_err(|e| format!("IO: {e}"))?;
        Ok(log)
    })
}

/// Create a snapshot of a language scope (defaults to `"lexicon"` for GUI backward compatibility).
#[command]
#[allow(clippy::too_many_arguments)]
pub fn create_snapshot(
    project_path: String,
    language_path: String,
    operation_type: String,
    source_language_id: String,
    target_language_id: String,
    description: String,
    scope: Option<String>,
    origin: Option<String>,
    operation_id: Option<String>,
) -> Result<OperationLog, String> {
    let project = Path::new(&project_path);
    let resolved_scope = scope.unwrap_or_else(default_scope_lexicon);
    let resolved_origin = origin.unwrap_or_else(default_origin_gui);
    validate_scope(&resolved_scope)?;

    let payload = serde_json::json!({
        "language_path": &language_path,
        "operation_type": &operation_type,
        "source_language_id": &source_language_id,
        "target_language_id": &target_language_id,
        "description": &description,
        "scope": &resolved_scope,
    });

    execute_project_transaction(
        project,
        "create_snapshot",
        &resolved_origin,
        operation_id,
        &payload,
        None,
        |proj, _op_id, _ctx| {
            let protected = collect_protected_snapshot_ids(proj);
            let mut mutations = Vec::new();
            let (snap_id, log) = record_language_snapshot_in_tx(
                proj,
                &language_path,
                &resolved_scope,
                &resolved_origin,
                &operation_type,
                &source_language_id,
                &target_language_id,
                &description,
                None,
                &protected,
                &mut mutations,
            )?;

            let lang_id_opt = if target_language_id.is_empty() {
                None
            } else {
                Some(target_language_id.clone())
            };

            Ok(TransactionPlan {
                expectations: Vec::new(),
                mutations,
                audit_summary: format!("Created {resolved_scope} snapshot {snap_id}: {description}"),
                language_id: lang_id_opt,
                snapshot_id: Some(snap_id),
                build_response: Box::new(move |_, _| log),
            })
        },
    )
}

/// Non-destructively roll back a language snapshot, creating a recovery point first and
/// preserving all snapshots (including interleaved snapshots of other scopes).
#[command]
pub fn rollback_to_snapshot(
    project_path: String,
    language_path: String,
    log_id: String,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<OperationLog, String> {
    let project = Path::new(&project_path);
    let payload = serde_json::json!({
        "language_path": &language_path,
        "log_id": &log_id,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project,
        "rollback_to_snapshot",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, _op_id, _ctx| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let lang_dir = proj.join(&lang_rel);
            let oplog_base = oplog_dir(&lang_dir);
            let file = oplog_file(&lang_dir);
            if !file.is_file() {
                return Err("NOT_FOUND: No operation log found".to_string());
            }

            let content = fs::read_to_string(&file).map_err(|e| format!("IO: {e}"))?;
            let log_before: OperationLog =
                serde_json::from_str(&content).map_err(|e| format!("IO: {e}"))?;
            let target_entry = log_before
                .entries
                .iter()
                .find(|e| e.log_id == log_id)
                .cloned()
                .ok_or_else(|| format!("NOT_FOUND: Snapshot {log_id} not found in log"))?;

            let snap_dir = oplog_base.join(&target_entry.snapshot_dir);
            if !snap_dir.is_dir() {
                return Err(format!(
                    "NOT_FOUND: Snapshot directory {} does not exist",
                    target_entry.snapshot_dir
                ));
            }

            let manifest = read_language_snapshot_manifest_or_legacy(&snap_dir, Some(&target_entry))?;
            let scope = manifest.scope.clone();

            let mut expectations = Vec::new();
            if let Some(ref exp) = expected_revision {
                expectations.push(scope_revision_expectation(proj, &lang_rel, &scope, Some(exp.clone())));
            }

            let mut protected = collect_protected_snapshot_ids(proj);
            protected.insert(log_id.clone());

            let mut mutations = Vec::new();
            // 1. Create non-destructive recovery snapshot of the same scope BEFORE restoring
            let (rec_id, updated_log) = record_language_snapshot_in_tx(
                proj,
                &lang_rel,
                &scope,
                "gui",
                "rollback_recovery",
                &target_entry.source_language_id,
                &target_entry.target_language_id,
                &format!("Before rollback to {}", target_entry.log_id),
                Some(target_entry.log_id.clone()),
                &protected,
                &mut mutations,
            )?;

            // 2. Plan restore mutations strictly for `manifest.scope`
            let (_diff, restore_mutations) =
                plan_apply_language_manifest(proj, &lang_rel, &snap_dir, &manifest, None)?;
            mutations.extend(restore_mutations);

            let lang_id_opt = if target_entry.target_language_id.is_empty() {
                None
            } else {
                Some(target_entry.target_language_id.clone())
            };

            Ok(TransactionPlan {
                expectations,
                mutations,
                audit_summary: format!("Rolled back {scope} to snapshot {log_id}"),
                language_id: lang_id_opt,
                snapshot_id: Some(rec_id),
                build_response: Box::new(move |_, _| updated_log),
            })
        },
    )
}

/// Update the maximum number of snapshots to keep (protecting active/referenced snapshots).
#[command]
pub fn set_max_snapshots(
    project_path: String,
    language_path: String,
    max_snapshots: u32,
    operation_id: Option<String>,
) -> Result<OperationLog, String> {
    let project = Path::new(&project_path);
    let payload = serde_json::json!({
        "language_path": &language_path,
        "max_snapshots": max_snapshots,
    });

    execute_project_transaction(
        project,
        "set_max_snapshots",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, _op_id, _ctx| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let lang_dir = proj.join(&lang_rel);
            let oplog_base = oplog_dir(&lang_dir);
            fs::create_dir_all(&oplog_base).map_err(|e| format!("IO: {e}"))?;

            let file = oplog_file(&lang_dir);
            let mut log: OperationLog = if file.is_file() {
                let content = fs::read_to_string(&file).map_err(|e| format!("IO: {e}"))?;
                serde_json::from_str(&content).map_err(|e| format!("IO: {e}"))?
            } else {
                OperationLog::default()
            };

            log.max_snapshots = max_snapshots.max(1);
            let protected = collect_protected_snapshot_ids(proj);
            prune_language_oplog_entries(&mut log, &oplog_base, &protected, "");

            let bytes = serde_json::to_vec_pretty(&log).map_err(|e| format!("IO: {e}"))?;
            let mutations = vec![PlannedMutation::WriteFile {
                rel_path: format!("{lang_rel}/.oplog/oplog.json"),
                bytes,
            }];

            Ok(TransactionPlan {
                expectations: Vec::new(),
                mutations,
                audit_summary: format!("Set max_snapshots to {}", log.max_snapshots),
                language_id: None,
                snapshot_id: None,
                build_response: Box::new(move |_, _| log),
            })
        },
    )
}

/// Create a project-level snapshot (`manifest.json` v2).
#[command]
pub fn create_project_snapshot(
    project_path: String,
    conlang_file_path: Option<String>,
    operation_type: String,
    description: String,
    origin: Option<String>,
    operation_id: Option<String>,
) -> Result<SnapshotSummary, String> {
    let project = Path::new(&project_path);
    let resolved_origin = origin.unwrap_or_else(default_origin_gui);
    let payload = serde_json::json!({
        "conlang_file_path": &conlang_file_path,
        "operation_type": &operation_type,
        "description": &description,
    });

    execute_project_transaction(
        project,
        "create_project_snapshot",
        &resolved_origin,
        operation_id,
        &payload,
        None,
        |proj, _op_id, _ctx| {
            let mut mutations = Vec::new();
            let (snap_id, summary) = record_project_snapshot_in_tx(
                proj,
                conlang_file_path.as_deref(),
                &resolved_origin,
                &operation_type,
                &description,
                None,
                &HashSet::new(),
                &mut mutations,
            )?;

            Ok(TransactionPlan {
                expectations: Vec::new(),
                mutations,
                audit_summary: format!("Created project snapshot {snap_id}: {description}"),
                language_id: None,
                snapshot_id: Some(snap_id),
                build_response: Box::new(move |_, _| summary),
            })
        },
    )
}

/// List project-level snapshots, active language snapshots, and archived language snapshots.
#[command]
pub fn list_all_snapshots(
    project_path: String,
    conlang_file_path: Option<String>,
    language_id: Option<String>,
) -> Result<Vec<SnapshotSummary>, String> {
    let project = Path::new(&project_path);
    with_consistent_read(project, "list_all_snapshots", true, None, |proj, _| {
        let mut out: Vec<SnapshotSummary> = Vec::new();
        let filter_lang = language_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());

        // 1. Project-level snapshots (included when language_id filter is None)
        if filter_lang.is_none() {
            let index_path = project_snapshots_index_file(proj);
            if index_path.is_file() {
                let text = fs::read_to_string(&index_path).map_err(|e| format!("IO: {e}"))?;
                let index: ProjectSnapshotIndex =
                    serde_json::from_str(&text).map_err(|e| format!("IO: {e}"))?;
                for e in index.entries {
                    out.push(SnapshotSummary {
                        snapshot_id: e.snapshot_id,
                        level: "project".to_string(),
                        scope: "project".to_string(),
                        origin: e.origin,
                        language_id: None,
                        operation_type: e.operation_type,
                        description: e.description,
                        timestamp: e.created_at,
                        restored_from: e.restored_from,
                        archived_language: Some(false),
                    });
                }
            }
        }

        // 2. Active language snapshots from `.conlang`
        let (_, ws_opt) = load_workspace_if_present(proj, conlang_file_path.as_deref())?;
        let mut seen_active_langs = HashSet::new();
        if let Some(ws) = ws_opt {
            for lang in ws.languages {
                seen_active_langs.insert(lang.language_id.clone());
                if let Some(wanted) = filter_lang {
                    if lang.language_id != wanted {
                        continue;
                    }
                }
                let lang_dir = proj.join(normalize_rel_path(&lang.path)?);
                collect_language_summaries_from_oplog(
                    &oplog_dir(&lang_dir),
                    &lang.language_id,
                    false,
                    &mut out,
                )?;
            }
        }

        // 3. Archived language snapshots (for languages removed by project rollback)
        let arch_root = archived_languages_root(proj);
        if arch_root.is_dir() {
            for entry in fs::read_dir(&arch_root).map_err(|e| format!("IO: {e}"))? {
                let entry = entry.map_err(|e| format!("IO: {e}"))?;
                if !entry.file_type().map_err(|e| format!("IO: {e}"))?.is_dir() {
                    continue;
                }
                let arch_lang_id = entry.file_name().to_string_lossy().into_owned();
                if seen_active_langs.contains(&arch_lang_id) {
                    continue;
                }
                if let Some(wanted) = filter_lang {
                    if arch_lang_id != wanted {
                        continue;
                    }
                }
                if let Some((arch_dir, _meta)) = find_latest_archived_language(proj, &arch_lang_id)? {
                    collect_language_summaries_from_oplog(
                        &arch_dir.join(".oplog"),
                        &arch_lang_id,
                        true,
                        &mut out,
                    )?;
                }
            }
        }

        out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        Ok(out)
    })
}

fn collect_language_summaries_from_oplog(
    oplog_base: &Path,
    language_id: &str,
    archived: bool,
    out: &mut Vec<SnapshotSummary>,
) -> Result<(), String> {
    let file = oplog_base.join("oplog.json");
    if !file.is_file() {
        return Ok(());
    }
    let text = fs::read_to_string(&file).map_err(|e| format!("IO: {e}"))?;
    let log: OperationLog = serde_json::from_str(&text).map_err(|e| format!("IO: {e}"))?;
    for entry in log.entries {
        let snap_dir = oplog_base.join(&entry.snapshot_dir);
        let manifest_opt = read_language_snapshot_manifest_or_legacy(&snap_dir, Some(&entry)).ok();
        let scope = entry
            .scope
            .clone()
            .or_else(|| manifest_opt.as_ref().map(|m| m.scope.clone()))
            .unwrap_or_else(default_scope_lexicon);
        let origin = entry
            .origin
            .clone()
            .or_else(|| manifest_opt.as_ref().map(|m| m.origin.clone()))
            .unwrap_or_else(default_origin_gui);
        let created_at = manifest_opt.as_ref().map(|m| m.created_at.as_str());
        let ts = normalize_timestamp_for_summary(&entry.timestamp, created_at);

        out.push(SnapshotSummary {
            snapshot_id: entry.log_id,
            level: "language".to_string(),
            scope,
            origin,
            language_id: Some(language_id.to_string()),
            operation_type: entry.operation_type,
            description: entry.description,
            timestamp: ts,
            restored_from: entry.restored_from,
            archived_language: Some(archived),
        });
    }
    Ok(())
}

/// Preview the file diff and potential conflicts of rolling back any language, archived-language,
/// or project snapshot without mutating the workspace.
#[command]
pub fn preview_snapshot_rollback(
    project_path: String,
    conlang_file_path: Option<String>,
    snapshot_id: String,
    language_id: Option<String>,
) -> Result<SnapshotDiffSummary, String> {
    let res = rollback_any_snapshot(
        project_path,
        conlang_file_path,
        snapshot_id,
        language_id,
        Some(true),
        None,
        None,
    )?;
    Ok(res.diff)
}

/// Unified rollback supporting:
/// 1. Project-level snapshots (`level == "project"`, archiving `.oplog` of any removed language),
/// 2. Active language snapshots (non-destructive scope restore), and
/// 3. Archived language snapshots (rebuilding removed language from baseline + applying scope + restoring `.conlang` entry).
#[command]
pub fn rollback_any_snapshot(
    project_path: String,
    conlang_file_path: Option<String>,
    snapshot_id: String,
    language_id: Option<String>,
    dry_run: Option<bool>,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<SnapshotRollbackResult, String> {
    let project = Path::new(&project_path);
    let is_dry_run = dry_run.unwrap_or(false);

    if is_dry_run {
        return with_consistent_read(project, "preview_snapshot_rollback", true, None, |proj, _| {
            let plan = build_unified_rollback_plan(
                proj,
                conlang_file_path.as_deref(),
                &snapshot_id,
                language_id.as_deref(),
                "preview",
                true,
                expected_revision.clone(),
            )?;
            let ws_rev = resolve_conlang_path_in_project(proj, conlang_file_path.as_deref())
                .and_then(|p| file_revision(&p).ok())
                .unwrap_or_else(|| "missing".to_string());
            Ok(SnapshotRollbackResult {
                dry_run: true,
                operation_id: "dry_run".to_string(),
                recovery_snapshot_id: None,
                revision: ws_rev,
                revisions: None,
                diff: plan.diff,
            })
        });
    }

    let payload = serde_json::json!({
        "conlang_file_path": &conlang_file_path,
        "snapshot_id": &snapshot_id,
        "language_id": &language_id,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project,
        "rollback_any_snapshot",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let built = build_unified_rollback_plan(
                proj,
                conlang_file_path.as_deref(),
                &snapshot_id,
                language_id.as_deref(),
                op_id,
                false,
                expected_revision.clone(),
            )?;

            if !built.diff.conflicts.is_empty() {
                return Err(format!(
                    "CONFLICT: {}",
                    built.diff.conflicts.join("; ")
                ));
            }

            let op_id_owned = op_id.to_string();
            let rec_id = built.recovery_snapshot_id.clone();
            let diff = built.diff.clone();
            let primary_label = built.primary_revision_label.clone();

            Ok(TransactionPlan {
                expectations: built.expectations,
                mutations: built.mutations,
                audit_summary: format!("Rolled back {} snapshot {}", diff.scope, snapshot_id),
                language_id: language_id.clone(),
                snapshot_id: rec_id.clone(),
                build_response: Box::new(move |revs, _warnings| SnapshotRollbackResult {
                    dry_run: false,
                    operation_id: op_id_owned,
                    recovery_snapshot_id: rec_id,
                    revision: revs
                        .get(&primary_label)
                        .or_else(|| revs.values().next())
                        .cloned()
                        .unwrap_or_else(|| "missing".to_string()),
                    revisions: Some(revs.clone()),
                    diff,
                }),
            })
        },
    )
}

struct UnifiedRollbackPlan {
    diff: SnapshotDiffSummary,
    expectations: Vec<RevisionExpectation>,
    mutations: Vec<PlannedMutation>,
    recovery_snapshot_id: Option<String>,
    primary_revision_label: String,
}

fn scope_revision_expectation(
    project_dir: &Path,
    lang_rel: &str,
    scope: &str,
    expected: Option<String>,
) -> RevisionExpectation {
    let lang_dir = project_dir.join(lang_rel);
    match scope {
        "phonology" => {
            RevisionExpectation::file("phonology", lang_dir.join("phonology.json"), expected)
        }
        "grammar" => RevisionExpectation::file("grammar", lang_dir.join("grammar.json"), expected),
        "sca" => RevisionExpectation::file("sca", lang_dir.join("sca_rules.json"), expected),
        "lexicon" => RevisionExpectation::lexicon("lexicon", lang_dir.join("lexicon"), expected),
        "corpus" => RevisionExpectation::file(
            "corpus_index",
            lang_dir.join("corpus/corpus_index.json"),
            expected,
        ),
        "font" => {
            let p = if lang_dir.join("font.otf").is_file() {
                lang_dir.join("font.otf")
            } else {
                lang_dir.join("font.ttf")
            };
            RevisionExpectation::file("font", p, expected)
        }
        _ => RevisionExpectation::file("workspace", lang_dir, expected),
    }
}

fn build_unified_rollback_plan(
    project_dir: &Path,
    conlang_file_path: Option<&str>,
    snapshot_id: &str,
    language_id_opt: Option<&str>,
    op_id: &str,
    dry_run: bool,
    expected_revision: Option<String>,
) -> Result<UnifiedRollbackPlan, String> {
    let (ws_path_opt, ws_opt) = load_workspace_if_present(project_dir, conlang_file_path)?;

    // Case A: If no language_id specified AND project snapshot exists -> project rollback
    let proj_snap_candidate = project_snapshots_root(project_dir)
        .join(format!("snap_{snapshot_id}"))
        .join("manifest.json");
    if language_id_opt.is_none() && proj_snap_candidate.is_file() {
        return build_project_rollback_plan(
            project_dir,
            conlang_file_path,
            ws_path_opt.as_deref(),
            ws_opt.as_ref(),
            snapshot_id,
            op_id,
            dry_run,
            expected_revision,
        );
    }

    // Case B: Active language snapshot
    if let Some(ref ws) = ws_opt {
        for lang in &ws.languages {
            if let Some(wanted) = language_id_opt {
                if lang.language_id != wanted {
                    continue;
                }
            }
            let lang_rel = normalize_rel_path(&lang.path)?;
            let oplog_base = oplog_dir(&project_dir.join(&lang_rel));
            let oplog_json = oplog_base.join("oplog.json");
            if !oplog_json.is_file() {
                continue;
            }
            let text = fs::read_to_string(&oplog_json).map_err(|e| format!("IO: {e}"))?;
            let log: OperationLog =
                serde_json::from_str(&text).map_err(|e| format!("IO: {e}"))?;
            if let Some(target_entry) = log.entries.iter().find(|e| e.log_id == snapshot_id) {
                let snap_dir = oplog_base.join(&target_entry.snapshot_dir);
                let manifest =
                    read_language_snapshot_manifest_or_legacy(&snap_dir, Some(target_entry))?;
                let scope = manifest.scope.clone();
                let exp = scope_revision_expectation(
                    project_dir,
                    &lang_rel,
                    &scope,
                    expected_revision.clone(),
                );
                let primary_label = exp.label.clone();

                let mut mutations = Vec::new();
                let mut rec_id = None;
                if !dry_run {
                    let mut protected = collect_protected_snapshot_ids(project_dir);
                    protected.insert(snapshot_id.to_string());
                    let (rid, _) = record_language_snapshot_in_tx(
                        project_dir,
                        &lang_rel,
                        &scope,
                        "gui",
                        "rollback_recovery",
                        &target_entry.source_language_id,
                        &lang.language_id,
                        &format!("Before rollback to {snapshot_id}"),
                        Some(snapshot_id.to_string()),
                        &protected,
                        &mut mutations,
                    )?;
                    rec_id = Some(rid);
                }

                let (diff, restore_muts) =
                    plan_apply_language_manifest(project_dir, &lang_rel, &snap_dir, &manifest, None)?;
                mutations.extend(restore_muts);

                return Ok(UnifiedRollbackPlan {
                    diff,
                    expectations: vec![exp],
                    mutations,
                    recovery_snapshot_id: rec_id,
                    primary_revision_label: primary_label,
                });
            }
        }
    }

    // Case C: Archived language snapshot (language removed by an earlier project rollback)
    let arch_lang_id_opt: Option<String> = if let Some(wanted) = language_id_opt {
        Some(wanted.to_string())
    } else {
        find_archived_lang_containing_snapshot(project_dir, snapshot_id)?
    };

    if let Some(arch_lang_id) = arch_lang_id_opt {
        if let Some((arch_dir, arch_meta)) =
            find_latest_archived_language(project_dir, &arch_lang_id)?
        {
            return build_archived_language_rollback_plan(
                project_dir,
                conlang_file_path,
                ws_path_opt.as_deref(),
                ws_opt.as_ref(),
                &arch_dir,
                &arch_meta,
                snapshot_id,
                dry_run,
                expected_revision,
            );
        }
    }

    // Fallback: check project snapshot even if language_id was passed erroneously
    if proj_snap_candidate.is_file() {
        return build_project_rollback_plan(
            project_dir,
            conlang_file_path,
            ws_path_opt.as_deref(),
            ws_opt.as_ref(),
            snapshot_id,
            op_id,
            dry_run,
            expected_revision,
        );
    }

    Err(format!("NOT_FOUND: Snapshot '{snapshot_id}' not found"))
}

fn find_archived_lang_containing_snapshot(
    project_dir: &Path,
    snapshot_id: &str,
) -> Result<Option<String>, String> {
    let arch_root = archived_languages_root(project_dir);
    if !arch_root.is_dir() {
        return Ok(None);
    }
    for entry in fs::read_dir(&arch_root).map_err(|e| format!("IO: {e}"))? {
        let entry = entry.map_err(|e| format!("IO: {e}"))?;
        if !entry.file_type().map_err(|e| format!("IO: {e}"))?.is_dir() {
            continue;
        }
        let lid = entry.file_name().to_string_lossy().into_owned();
        if let Some((arch_dir, _)) = find_latest_archived_language(project_dir, &lid)? {
            let oplog_json = arch_dir.join(".oplog").join("oplog.json");
            if oplog_json.is_file() {
                let text = fs::read_to_string(&oplog_json).map_err(|e| format!("IO: {e}"))?;
                if let Ok(log) = serde_json::from_str::<OperationLog>(&text) {
                    if log.entries.iter().any(|e| e.log_id == snapshot_id) {
                        return Ok(Some(lid));
                    }
                }
            }
        }
    }
    Ok(None)
}

#[allow(clippy::too_many_arguments)]
fn build_project_rollback_plan(
    project_dir: &Path,
    conlang_file_path: Option<&str>,
    ws_path_opt: Option<&Path>,
    current_ws_opt: Option<&WorkspaceConfig>,
    snapshot_id: &str,
    op_id: &str,
    dry_run: bool,
    expected_revision: Option<String>,
) -> Result<UnifiedRollbackPlan, String> {
    let (snap_dir, manifest) = load_project_snapshot_manifest(project_dir, snapshot_id)?;

    let mut mutations: Vec<PlannedMutation> = Vec::new();
    let mut rec_id: Option<String> = None;

    // 1. Create a pre-rollback project recovery snapshot (which also serves as `baseline_snapshot_id`
    // for any newly-created language whose directory is about to be removed!).
    if !dry_run {
        let mut protected = HashSet::new();
        protected.insert(snapshot_id.to_string());
        let (rid, _) = record_project_snapshot_in_tx(
            project_dir,
            conlang_file_path,
            "gui",
            "rollback_recovery",
            &format!("Before project rollback to {snapshot_id}"),
            Some(snapshot_id.to_string()),
            &protected,
            &mut mutations,
        )?;
        rec_id = Some(rid);
    }

    let snap_lang_ids: HashSet<String> = manifest
        .affected_languages
        .iter()
        .filter(|l| l.dir_existed)
        .map(|l| l.language_id.clone())
        .collect();

    // 2. Archive `.oplog` of any language currently in `.conlang` whose directory did NOT exist in target snapshot (§3.6)
    let mut langs_to_remove_dirs: Vec<String> = Vec::new();
    if let Some(cur_ws) = current_ws_opt {
        for cur_lang in &cur_ws.languages {
            if !snap_lang_ids.contains(&cur_lang.language_id) {
                let cur_rel = normalize_rel_path(&cur_lang.path)?;
                let cur_dir = project_dir.join(&cur_rel);
                if cur_dir.is_dir() {
                    langs_to_remove_dirs.push(cur_rel.clone());
                    let cur_oplog = oplog_dir(&cur_dir);
                    if !dry_run && cur_oplog.is_dir() {
                        let baseline_id = rec_id
                            .clone()
                            .unwrap_or_else(|| snapshot_id.to_string());
                        let arch_base_rel = format!(
                            ".conlang-maker/snapshots/archived_languages/{}/{}",
                            cur_lang.language_id, op_id
                        );
                        stage_copy_dir_into_mutations(
                            &cur_oplog,
                            &format!("{arch_base_rel}/.oplog"),
                            &mut mutations,
                        )?;
                        let arch_meta = ArchivedLanguageMeta {
                            language_id: cur_lang.language_id.clone(),
                            operation_id: op_id.to_string(),
                            archived_at: now_rfc3339(),
                            original_entry: cur_lang.clone(),
                            original_path: cur_rel.clone(),
                            baseline_snapshot_id: baseline_id,
                        };
                        let meta_bytes =
                            serde_json::to_vec_pretty(&arch_meta).map_err(|e| format!("IO: {e}"))?;
                        mutations.push(PlannedMutation::WriteFile {
                            rel_path: format!("{arch_base_rel}/archive_meta.json"),
                            bytes: meta_bytes,
                        });
                    }
                }
            }
        }
    }

    // 3. Diff current business files vs snapshot business files
    let mut current_rels = Vec::new();
    collect_project_business_files_recursive(project_dir, project_dir, &mut current_rels)?;
    let current_set: HashSet<String> = current_rels.into_iter().collect();

    let snap_map: BTreeMap<String, &SnapshotFileRecord> = manifest
        .files
        .iter()
        .filter(|f| f.existed)
        .map(|f| (f.rel_path.clone(), f))
        .collect();

    let mut changed_files = Vec::new();
    let mut added_files = Vec::new();
    let mut removed_files = Vec::new();

    for cur_rel in &current_set {
        if !snap_map.contains_key(cur_rel) {
            removed_files.push(cur_rel.clone());
            mutations.push(PlannedMutation::DeletePath {
                rel_path: cur_rel.clone(),
            });
        }
    }

    // Remove entire directories of languages that did not exist in the target snapshot
    for rem_dir_rel in langs_to_remove_dirs {
        mutations.push(PlannedMutation::DeletePath {
            rel_path: rem_dir_rel,
        });
    }

    // Ensure directories exist for languages whose `dir_existed == true` in target snapshot
    for lang_rec in &manifest.affected_languages {
        if lang_rec.dir_existed {
            mutations.push(PlannedMutation::CreateDir {
                rel_path: lang_rec.rel_path.clone(),
            });
        }
    }

    for (rel, rec) in &snap_map {
        let stored_rel = rec
            .stored_rel
            .as_deref()
            .ok_or_else(|| format!("IO: Missing stored_rel for {rel}"))?;
        let bytes = fs::read(snap_dir.join(stored_rel)).map_err(|e| format!("IO: {e}"))?;
        let target_sha = sha256_hex(&bytes);
        let abs_cur = project_dir.join(rel);
        if abs_cur.is_file() {
            let cur_bytes = fs::read(&abs_cur).map_err(|e| format!("IO: {e}"))?;
            if sha256_hex(&cur_bytes) != target_sha {
                changed_files.push(rel.clone());
            }
        } else {
            added_files.push(rel.clone());
        }
        mutations.push(PlannedMutation::WriteFile {
            rel_path: rel.clone(),
            bytes,
        });
    }

    changed_files.sort();
    added_files.sort();
    removed_files.sort();

    let ws_target_path = ws_path_opt
        .map(Path::to_path_buf)
        .or_else(|| {
            manifest
                .conlang_rel_path
                .as_ref()
                .map(|r| project_dir.join(r))
        })
        .unwrap_or_else(|| project_dir.join("workspace.conlang"));

    let expectations = vec![RevisionExpectation::file(
        "workspace",
        ws_target_path,
        expected_revision,
    )];

    Ok(UnifiedRollbackPlan {
        diff: SnapshotDiffSummary {
            snapshot_id: snapshot_id.to_string(),
            level: "project".to_string(),
            scope: "project".to_string(),
            changed_files,
            added_files,
            removed_files,
            conflicts: Vec::new(),
        },
        expectations,
        mutations,
        recovery_snapshot_id: rec_id,
        primary_revision_label: "workspace".to_string(),
    })
}

#[allow(clippy::too_many_arguments)]
fn build_archived_language_rollback_plan(
    project_dir: &Path,
    conlang_file_path: Option<&str>,
    ws_path_opt: Option<&Path>,
    current_ws_opt: Option<&WorkspaceConfig>,
    arch_dir: &Path,
    arch_meta: &ArchivedLanguageMeta,
    snapshot_id: &str,
    dry_run: bool,
    expected_revision: Option<String>,
) -> Result<UnifiedRollbackPlan, String> {
    let oplog_base = arch_dir.join(".oplog");
    let oplog_json = oplog_base.join("oplog.json");
    if !oplog_json.is_file() {
        return Err(format!(
            "NOT_FOUND: Archived operation log missing for language '{}'",
            arch_meta.language_id
        ));
    }
    let log_text = fs::read_to_string(&oplog_json).map_err(|e| format!("IO: {e}"))?;
    let log: OperationLog =
        serde_json::from_str(&log_text).map_err(|e| format!("IO: {e}"))?;
    let target_entry = log
        .entries
        .iter()
        .find(|e| e.log_id == snapshot_id)
        .ok_or_else(|| {
            format!(
                "NOT_FOUND: Snapshot '{snapshot_id}' not found in archived history of '{}'",
                arch_meta.language_id
            )
        })?;

    let snap_dir = oplog_base.join(&target_entry.snapshot_dir);
    let lang_manifest =
        read_language_snapshot_manifest_or_legacy(&snap_dir, Some(target_entry))?;

    // Check topology / workspace conflicts (§3.6)
    let mut conflicts: Vec<String> = Vec::new();
    let Some(cur_ws) = current_ws_opt else {
        conflicts.push("Workspace .conlang configuration does not exist".to_string());
        return Ok(UnifiedRollbackPlan {
            diff: SnapshotDiffSummary {
                snapshot_id: snapshot_id.to_string(),
                level: "language".to_string(),
                scope: lang_manifest.scope,
                changed_files: Vec::new(),
                added_files: Vec::new(),
                removed_files: Vec::new(),
                conflicts,
            },
            expectations: Vec::new(),
            mutations: Vec::new(),
            recovery_snapshot_id: None,
            primary_revision_label: "workspace".to_string(),
        });
    };

    let lang_rel = normalize_rel_path(&arch_meta.original_path)?;
    if let Some(ref pid) = arch_meta.original_entry.parent_id {
        if !cur_ws.languages.iter().any(|l| &l.language_id == pid) {
            conflicts.push(format!(
                "Parent language '{pid}' does not exist in active workspace"
            ));
        }
    }
    if cur_ws
        .languages
        .iter()
        .any(|l| l.language_id == arch_meta.language_id)
    {
        conflicts.push(format!(
            "Language ID '{}' already exists in active workspace",
            arch_meta.language_id
        ));
    }
    if project_dir.join(&lang_rel).exists()
        || cur_ws
            .languages
            .iter()
            .any(|l| normalize_rel_path(&l.path).ok().as_deref() == Some(lang_rel.as_str()))
    {
        conflicts.push(format!("Target language path '{lang_rel}' is already occupied"));
    }

    // Load baseline project snapshot to reconstruct full language directory before applying `lang_manifest`
    let (base_snap_dir, base_manifest) =
        load_project_snapshot_manifest(project_dir, &arch_meta.baseline_snapshot_id)?;

    let mut mutations: Vec<PlannedMutation> = Vec::new();
    let mut rec_id: Option<String> = None;
    if !dry_run && conflicts.is_empty() {
        let mut protected = HashSet::new();
        protected.insert(arch_meta.baseline_snapshot_id.clone());
        let (rid, _) = record_project_snapshot_in_tx(
            project_dir,
            conlang_file_path,
            "gui",
            "rollback_recovery",
            &format!(
                "Before restoring archived language '{}' snapshot {snapshot_id}",
                arch_meta.language_id
            ),
            Some(snapshot_id.to_string()),
            &protected,
            &mut mutations,
        )?;
        rec_id = Some(rid);
    }

    mutations.push(PlannedMutation::CreateDir {
        rel_path: lang_rel.clone(),
    });

    let lang_prefix = format!("{lang_rel}/");
    let mut virtual_baseline: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    for rec in &base_manifest.files {
        if rec.existed && rec.rel_path.starts_with(&lang_prefix) {
            if let Some(ref srel) = rec.stored_rel {
                let bytes = fs::read(base_snap_dir.join(srel)).map_err(|e| format!("IO: {e}"))?;
                virtual_baseline.insert(rec.rel_path.clone(), bytes.clone());
                mutations.push(PlannedMutation::WriteFile {
                    rel_path: rec.rel_path.clone(),
                    bytes,
                });
            }
        }
    }

    // Restore `.oplog` directory into rebuilt language directory
    stage_copy_dir_into_mutations(
        &oplog_base,
        &format!("{lang_rel}/.oplog"),
        &mut mutations,
    )?;

    // Overlay target scope from `lang_manifest`
    let (_scope_diff, scope_muts) = plan_apply_language_manifest(
        project_dir,
        &lang_rel,
        &snap_dir,
        &lang_manifest,
        Some(&virtual_baseline),
    )?;
    mutations.extend(scope_muts);

    // Re-insert `original_entry` into `.conlang`
    let ws_path = ws_path_opt
        .ok_or_else(|| "IO: Workspace .conlang path not resolved".to_string())?;
    let ws_canon = canonicalize_best_effort(ws_path);
    let proj_canon = canonicalize_best_effort(project_dir);
    let ws_rel_raw = ws_canon
        .strip_prefix(&proj_canon)
        .or_else(|_| ws_path.strip_prefix(project_dir))
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| {
            ws_path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "workspace.conlang".to_string())
        });
    let ws_rel = normalize_rel_path(&ws_rel_raw)?;

    let mut updated_ws = cur_ws.clone();
    updated_ws.languages.push(arch_meta.original_entry.clone());
    let ws_bytes = serde_json::to_vec_pretty(&updated_ws).map_err(|e| format!("IO: {e}"))?;
    mutations.push(PlannedMutation::WriteFile {
        rel_path: ws_rel.clone(),
        bytes: ws_bytes,
    });

    // Collect effective added files for diff summary
    let mut final_added: HashSet<String> = virtual_baseline.keys().cloned().collect();
    for m in &mutations {
        match m {
            PlannedMutation::WriteFile { rel_path, .. }
                if rel_path.starts_with(&lang_prefix) =>
            {
                final_added.insert(rel_path.clone());
            }
            PlannedMutation::DeletePath { rel_path } if rel_path.starts_with(&lang_prefix) => {
                final_added.remove(rel_path);
            }
            _ => {}
        }
    }
    let mut added_files: Vec<String> = final_added.into_iter().collect();
    added_files.sort();

    let expectations = vec![RevisionExpectation::file(
        "workspace",
        ws_path.to_path_buf(),
        expected_revision,
    )];

    Ok(UnifiedRollbackPlan {
        diff: SnapshotDiffSummary {
            snapshot_id: snapshot_id.to_string(),
            level: "language".to_string(),
            scope: lang_manifest.scope,
            changed_files: vec![ws_rel],
            added_files,
            removed_files: Vec::new(),
            conflicts,
        },
        expectations,
        mutations,
        recovery_snapshot_id: rec_id,
        primary_revision_label: "workspace".to_string(),
    })
}

fn stage_copy_dir_into_mutations(
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
        let child_dst_rel = format!("{dst_rel_prefix}/{name}");
        let ft = entry.file_type().map_err(|e| format!("IO: {e}"))?;
        if ft.is_dir() {
            stage_copy_dir_into_mutations(&child_src, &child_dst_rel, mutations)?;
        } else if ft.is_file() {
            let bytes = fs::read(&child_src).map_err(|e| format!("IO: {e}"))?;
            mutations.push(PlannedMutation::WriteFile {
                rel_path: normalize_rel_path(&child_dst_rel)?,
                bytes,
            });
        }
    }
    Ok(())
}

/// Convenience helper to compute current language scope revision string.
pub fn current_scope_revision(project_dir: &Path, lang_rel: &str, scope: &str) -> Result<String, String> {
    let lang_dir = project_dir.join(normalize_rel_path(lang_rel)?);
    match scope {
        "phonology" => file_revision(&lang_dir.join("phonology.json")),
        "grammar" => file_revision(&lang_dir.join("grammar.json")),
        "sca" => file_revision(&lang_dir.join("sca_rules.json")),
        "lexicon" => lexicon_revision(&lang_dir.join("lexicon")),
        "corpus" => file_revision(&lang_dir.join("corpus/corpus_index.json")),
        "font" => {
            if lang_dir.join("font.otf").is_file() {
                file_revision(&lang_dir.join("font.otf"))
            } else {
                file_revision(&lang_dir.join("font.ttf"))
            }
        }
        _ => Ok("missing".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t1_11_interleaved_scopes_and_missing_font_and_legacy_snapshot() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path();
        let proj_str = project.to_string_lossy().to_string();
        let lang_dir = project.join("roots/root");
        fs::create_dir_all(lang_dir.join("lexicon")).unwrap();

        // Initial lexicon v1 + phonology v1 + no font
        fs::write(
            lang_dir.join("lexicon/lexicon_a.ndjson"),
            b"{\"entry_id\":\"w1\",\"con_word_romanized\":\"ata\"}\n",
        )
        .unwrap();
        fs::write(lang_dir.join("phonology.json"), b"{\"v\":1}\n").unwrap();

        // Snapshot S_font (no own font!)
        let log_after_font = create_snapshot(
            proj_str.clone(),
            "roots/root".to_string(),
            "font_import".to_string(),
            "lang_root".to_string(),
            "lang_root".to_string(),
            "before font".to_string(),
            Some("font".to_string()),
            Some("gui".to_string()),
            None,
        )
        .unwrap();
        let s_font_id = log_after_font.entries.last().unwrap().log_id.clone();

        // Add own font.ttf, then take S1 (lexicon)
        fs::write(lang_dir.join("font.ttf"), b"DUMMY_TTF").unwrap();
        let log_s1 = create_snapshot(
            proj_str.clone(),
            "roots/root".to_string(),
            "lex_edit".to_string(),
            "lang_root".to_string(),
            "lang_root".to_string(),
            "S1 lexicon".to_string(),
            Some("lexicon".to_string()),
            Some("gui".to_string()),
            None,
        )
        .unwrap();
        let s1_id = log_s1.entries.last().unwrap().log_id.clone();

        // Mutate lexicon to v2, then take S2 (phonology v1) and mutate phonology to v2
        fs::write(
            lang_dir.join("lexicon/lexicon_b.ndjson"),
            b"{\"entry_id\":\"w2\",\"con_word_romanized\":\"bata\"}\n",
        )
        .unwrap();
        let log_s2 = create_snapshot(
            proj_str.clone(),
            "roots/root".to_string(),
            "phono_edit".to_string(),
            "lang_root".to_string(),
            "lang_root".to_string(),
            "S2 phonology".to_string(),
            Some("phonology".to_string()),
            Some("mcp".to_string()),
            None,
        )
        .unwrap();
        let s2_id = log_s2.entries.last().unwrap().log_id.clone();
        fs::write(lang_dir.join("phonology.json"), b"{\"v\":2}\n").unwrap();

        // Rollback S1 (lexicon): lexicon_b.ndjson removed, phonology v2 untouched, AND S2 still available!
        let after_rb_s1 = rollback_to_snapshot(
            proj_str.clone(),
            "roots/root".to_string(),
            s1_id.clone(),
            None,
            None,
        )
        .unwrap();
        assert!(lang_dir.join("lexicon/lexicon_a.ndjson").is_file());
        assert!(!lang_dir.join("lexicon/lexicon_b.ndjson").exists());
        assert_eq!(
            fs::read_to_string(lang_dir.join("phonology.json")).unwrap(),
            "{\"v\":2}\n"
        );
        assert!(after_rb_s1.entries.iter().any(|e| e.log_id == s2_id));
        assert_eq!(
            after_rb_s1.entries.last().unwrap().restored_from.as_deref(),
            Some(s1_id.as_str())
        );

        // Now rollback S2 (phonology): phonology returns to v1, lexicon stays at S1!
        rollback_to_snapshot(proj_str.clone(), "roots/root".to_string(), s2_id, None, None)
            .unwrap();
        assert_eq!(
            fs::read_to_string(lang_dir.join("phonology.json")).unwrap(),
            "{\"v\":1}\n"
        );

        // Rollback S_font: restores to NO own font (`font.ttf` removed)!
        rollback_to_snapshot(
            proj_str.clone(),
            "roots/root".to_string(),
            s_font_id,
            None,
            None,
        )
        .unwrap();
        assert!(!lang_dir.join("font.ttf").exists());

        // Legacy manifest-less snapshot compatibility
        let legacy_snap = lang_dir.join(".oplog/snap_legacy01/lexicon");
        fs::create_dir_all(&legacy_snap).unwrap();
        fs::write(
            legacy_snap.join("lexicon_z.ndjson"),
            b"{\"entry_id\":\"legacy\"}\n",
        )
        .unwrap();
        let mut cur_log = load_operation_log(proj_str.clone(), "roots/root".to_string()).unwrap();
        cur_log.entries.push(OperationLogEntry {
            log_id: "legacy01".to_string(),
            operation_type: "legacy".to_string(),
            timestamp: "1700000000".to_string(),
            source_language_id: "lang_root".to_string(),
            target_language_id: "lang_root".to_string(),
            description: "old snap without manifest".to_string(),
            snapshot_dir: "snap_legacy01".to_string(),
            origin: None,
            scope: None,
            level: None,
            restored_from: None,
            extra: BTreeMap::new(),
        });
        fs::write(
            lang_dir.join(".oplog/oplog.json"),
            serde_json::to_string_pretty(&cur_log).unwrap(),
        )
        .unwrap();

        rollback_to_snapshot(
            proj_str,
            "roots/root".to_string(),
            "legacy01".to_string(),
            None,
            None,
        )
        .unwrap();
        assert!(lang_dir.join("lexicon/lexicon_z.ndjson").is_file());
        assert!(!lang_dir.join("lexicon/lexicon_a.ndjson").exists());
    }

    #[test]
    fn t1_11_project_rollback_archives_new_language_oplog_and_supports_archived_restore() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path();
        let proj_str = project.to_string_lossy().to_string();
        let ws_path = project.join("test.conlang");
        let ws_str = ws_path.to_string_lossy().to_string();

        fs::create_dir_all(project.join("roots/root")).unwrap();
        fs::write(project.join("roots/root/phonology.json"), b"{\"root\":true}\n").unwrap();
        let ws_v1 = WorkspaceConfig {
            workspace_version: "3.0".to_string(),
            languages: vec![LanguageEntry {
                language_id: "lang_root".to_string(),
                name: "Root".to_string(),
                path: "roots/root".to_string(),
                parent_id: None,
                extra: BTreeMap::new(),
            }],
            extra: BTreeMap::new(),
        };
        fs::write(&ws_path, serde_json::to_string_pretty(&ws_v1).unwrap()).unwrap();

        // Take project snapshot P0 (only lang_root exists)
        let p0 = create_project_snapshot(
            proj_str.clone(),
            Some(ws_str.clone()),
            "fork_language".to_string(),
            "Before forking child".to_string(),
            Some("gui".to_string()),
            None,
        )
        .unwrap();

        // Simulate child language creation + child language snapshots S_child_1 (v1) and then edit to v2
        let child_dir = project.join("stages/child");
        fs::create_dir_all(&child_dir).unwrap();
        fs::write(child_dir.join("grammar.json"), b"{\"child_gram\":1}\n").unwrap();
        fs::write(child_dir.join("phonology.json"), b"{\"child_phono\":99}\n").unwrap();
        let mut ws_v2 = ws_v1.clone();
        ws_v2.languages.push(LanguageEntry {
            language_id: "lang_child".to_string(),
            name: "Child".to_string(),
            path: "stages/child".to_string(),
            parent_id: Some("lang_root".to_string()),
            extra: BTreeMap::new(),
        });
        fs::write(&ws_path, serde_json::to_string_pretty(&ws_v2).unwrap()).unwrap();

        let child_log = create_snapshot(
            proj_str.clone(),
            "stages/child".to_string(),
            "gram_edit".to_string(),
            "lang_child".to_string(),
            "lang_child".to_string(),
            "Child grammar v1".to_string(),
            Some("grammar".to_string()),
            Some("mcp".to_string()),
            None,
        )
        .unwrap();
        let child_snap_id = child_log.entries.last().unwrap().log_id.clone();
        // Later edit on child grammar before project rollback
        fs::write(child_dir.join("grammar.json"), b"{\"child_gram\":2}\n").unwrap();

        // Rollback project snapshot P0 -> `stages/child` is removed, `.conlang` restored to [lang_root],
        // AND `lang_child`'s `.oplog` is archived under `.conlang-maker/snapshots/archived_languages/lang_child/`!
        rollback_any_snapshot(
            proj_str.clone(),
            Some(ws_str.clone()),
            p0.snapshot_id.clone(),
            None,
            Some(false),
            None,
            Some("op_rb_p0".to_string()),
        )
        .unwrap();
        assert!(!child_dir.exists());

        // Query archived snapshots by `language_id = Some("lang_child")` even though child is no longer active!
        let archived_snaps = list_all_snapshots(
            proj_str.clone(),
            Some(ws_str.clone()),
            Some("lang_child".to_string()),
        )
        .unwrap();
        assert_eq!(archived_snaps.len(), 1);
        assert_eq!(archived_snaps[0].snapshot_id, child_snap_id);
        assert_eq!(archived_snaps[0].archived_language, Some(true));

        // Preview restoring `child_snap_id`
        let preview = preview_snapshot_rollback(
            proj_str.clone(),
            Some(ws_str.clone()),
            child_snap_id.clone(),
            Some("lang_child".to_string()),
        )
        .unwrap();
        assert!(preview.conflicts.is_empty());
        assert!(preview.added_files.contains(&"stages/child/grammar.json".to_string()));

        // Commit rollback of archived language snapshot `child_snap_id`:
        // Rebuilds `stages/child` from baseline (`phonology.json` = 99) AND applies `child_snap_id` (`grammar.json` = 1)
        // AND restores `lang_child` into `test.conlang`!
        rollback_any_snapshot(
            proj_str,
            Some(ws_str),
            child_snap_id,
            Some("lang_child".to_string()),
            Some(false),
            None,
            None,
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(child_dir.join("phonology.json")).unwrap(),
            "{\"child_phono\":99}\n"
        );
        assert_eq!(
            fs::read_to_string(child_dir.join("grammar.json")).unwrap(),
            "{\"child_gram\":1}\n"
        );
        let restored_ws: WorkspaceConfig =
            serde_json::from_str(&fs::read_to_string(&ws_path).unwrap()).unwrap();
        assert_eq!(restored_ws.languages.len(), 2);
        assert!(restored_ws
            .languages
            .iter()
            .any(|l| l.language_id == "lang_child"));
    }
}
