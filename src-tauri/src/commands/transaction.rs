use crate::commands::lock::{with_project_lock, LockContext};
use crate::models::McpAuditLogEntry;
use crate::utils::fs_util::{
    atomic_write, atomic_write_bytes, generate_uuid_v4, now_rfc3339, sync_dir_best_effort,
};
use crate::utils::revision::{
    file_revision, lexicon_revision, normalize_rel_path, resolve_project_root, sha256_hex,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const COMPLETED_RETENTION_SECS: i64 = 7 * 24 * 60 * 60;

#[derive(Debug, Clone)]
pub enum PlannedMutation {
    WriteFile {
        rel_path: String,
        bytes: Vec<u8>,
    },
    DeletePath {
        rel_path: String,
    },
    CreateDir {
        rel_path: String,
    },
    MoveDir {
        from_rel_path: String,
        to_rel_path: String,
    },
}

#[derive(Debug, Clone)]
pub struct RevisionExpectation {
    pub label: String,
    pub target_path: PathBuf,
    pub is_lexicon_dir: bool,
    /// If `Some(rev)`, CAS verifies current disk revision equals `rev`.
    /// If `None` (legacy GUI caller without CAS yet), records revision without rejecting.
    pub expected_revision: Option<String>,
}

impl RevisionExpectation {
    pub fn file(label: impl Into<String>, target_path: PathBuf, expected_revision: Option<String>) -> Self {
        Self {
            label: label.into(),
            target_path,
            is_lexicon_dir: false,
            expected_revision,
        }
    }

    pub fn lexicon(label: impl Into<String>, lexicon_dir: PathBuf, expected_revision: Option<String>) -> Self {
        Self {
            label: label.into(),
            target_path: lexicon_dir,
            is_lexicon_dir: true,
            expected_revision,
        }
    }

    pub fn actual_revision(&self) -> Result<String, String> {
        if self.is_lexicon_dir {
            lexicon_revision(&self.target_path)
        } else {
            file_revision(&self.target_path)
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TxTargetEntry {
    pub rel_path: String,
    /// `"file" | "dir_create" | "dir_move" | "delete"`
    pub kind: String,
    pub existed_before: bool,
    pub before_sha256: Option<String>,
    pub after_sha256: Option<String>,
    pub preimage_rel: Option<String>,
    pub staged_rel: Option<String>,
    pub move_from_rel: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TxManifest {
    pub version: u32,
    pub operation_id: String,
    pub origin: String,
    pub tool: String,
    pub request_digest: String,
    pub created_at: String,
    pub targets: Vec<TxTargetEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TxResultRecord {
    pub operation_id: String,
    pub request_digest: String,
    pub committed_at: String,
    pub response: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audit_entry: Option<McpAuditLogEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaultStage {
    AfterManifest,
    MidApply,
    BeforeCommitted,
    BeforeAudit,
}

pub struct TransactionPlan<T> {
    pub expectations: Vec<RevisionExpectation>,
    pub mutations: Vec<PlannedMutation>,
    pub audit_summary: String,
    pub language_id: Option<String>,
    pub snapshot_id: Option<String>,
    pub build_response: Box<dyn FnOnce(&BTreeMap<String, String>, Vec<String>) -> T>,
}

pub fn transactions_root(project_dir: &Path) -> PathBuf {
    project_dir.join(".conlang-maker").join("transactions")
}

pub fn completed_ops_root(project_dir: &Path) -> PathBuf {
    project_dir.join(".conlang-maker").join("completed_ops")
}

pub fn audit_log_path(project_dir: &Path) -> PathBuf {
    project_dir.join(".conlang-maker").join("mcp_audit.ndjson")
}

pub fn sanitize_op_id(op_id: &str) -> Result<String, String> {
    let trimmed = op_id.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err(format!(
            "VALIDATION: Invalid operation_id '{op_id}': must be 1..=128 ASCII chars"
        ));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
    {
        return Err(format!(
            "VALIDATION: Invalid characters in operation_id '{op_id}'"
        ));
    }
    Ok(trimmed.replace(':', "_"))
}

#[derive(Serialize)]
struct DigestEnvelope<'a> {
    tool: &'a str,
    payload: serde_json::Value,
}

/// Compute canonical SHA-256 request digest matching `mcp/storage/transaction.ts`.
pub fn compute_request_digest<P: Serialize>(tool_name: &str, payload: &P) -> Result<String, String> {
    let val = serde_json::to_value(payload).map_err(|e| format!("VALIDATION: {e}"))?;
    let canonical = serde_json::to_string(&DigestEnvelope {
        tool: tool_name,
        payload: val,
    })
    .map_err(|e| format!("VALIDATION: {e}"))?;
    Ok(sha256_hex(canonical.as_bytes()))
}

fn copy_dir_recursive_atomic(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("IO: {e}"))?;
    for entry in fs::read_dir(src).map_err(|e| format!("IO: {e}"))? {
        let entry = entry.map_err(|e| format!("IO: {e}"))?;
        let s = entry.path();
        let d = dst.join(entry.file_name());
        let ft = entry.file_type().map_err(|e| format!("IO: {e}"))?;
        if ft.is_dir() {
            copy_dir_recursive_atomic(&s, &d)?;
        } else if ft.is_file() {
            let bytes = fs::read(&s).map_err(|e| format!("IO: {e}"))?;
            atomic_write_bytes(&d, &bytes)?;
        }
    }
    Ok(())
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if meta.is_dir() {
                fs::remove_dir_all(path).map_err(|e| format!("IO: {e}"))
            } else {
                fs::remove_file(path).map_err(|e| format!("IO: {e}"))
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("IO: {e}")),
    }
}

/// Append an audit entry to `<project>/.conlang-maker/mcp_audit.ndjson`, deduplicated by `operation_id`.
pub fn append_audit_log_deduped(project_dir: &Path, entry: &McpAuditLogEntry) -> Result<(), String> {
    let path = audit_log_path(project_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("IO: {e}"))?;
    }

    if path.is_file() {
        let existing = fs::read_to_string(&path).map_err(|e| format!("IO: {e}"))?;
        let lines: Vec<&str> = existing.lines().filter(|l| !l.trim().is_empty()).collect();
        let start = lines.len().saturating_sub(200);
        for line in &lines[start..] {
            if let Ok(parsed) = serde_json::from_str::<McpAuditLogEntry>(line) {
                if parsed.operation_id == entry.operation_id {
                    return Ok(());
                }
            }
        }
    }

    let mut serialized = serde_json::to_string(entry).map_err(|e| format!("IO: {e}"))?;
    serialized.push('\n');

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("IO: {e}"))?;
    file.write_all(serialized.as_bytes())
        .map_err(|e| format!("IO: {e}"))?;
    file.sync_all().map_err(|e| format!("IO: {e}"))?;
    Ok(())
}

/// Read up to `limit` newest valid `McpAuditLogEntry` records from `mcp_audit.ndjson`.
pub fn read_audit_logs(project_dir: &Path, limit: usize) -> Result<Vec<McpAuditLogEntry>, String> {
    let path = audit_log_path(project_dir);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("IO: {e}"))?;
    let mut out = Vec::new();
    for line in text.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<McpAuditLogEntry>(trimmed) {
            out.push(entry);
            if out.len() >= limit {
                break;
            }
        }
    }
    Ok(out)
}

pub fn persist_completed_operation(project_dir: &Path, record: &TxResultRecord) -> Result<(), String> {
    let root = completed_ops_root(project_dir);
    fs::create_dir_all(&root).map_err(|e| format!("IO: {e}"))?;
    let safe_id = sanitize_op_id(&record.operation_id)?;
    let content = serde_json::to_string_pretty(record).map_err(|e| format!("IO: {e}"))?;
    atomic_write(&root.join(format!("{safe_id}.json")), &content)?;
    prune_expired_completed_ops(&root);
    Ok(())
}

fn prune_expired_completed_ops(root: &Path) {
    let Ok(rd) = fs::read_dir(root) else {
        return;
    };
    let cutoff = std::time::Duration::from_secs((COMPLETED_RETENTION_SECS * 2) as u64);
    for entry in rd.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if let Ok(mtime) = meta.modified() {
                if let Ok(age) = std::time::SystemTime::now().duration_since(mtime) {
                    if age > cutoff {
                        let _ = fs::remove_file(path);
                    }
                }
            }
        }
    }
}

pub fn lookup_completed_operation(
    project_dir: &Path,
    operation_id: &str,
    request_digest: &str,
) -> Result<Option<TxResultRecord>, String> {
    let safe_id = sanitize_op_id(operation_id)?;
    let path = completed_ops_root(project_dir).join(format!("{safe_id}.json"));
    if !path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("IO: {e}"))?;
    let record: TxResultRecord =
        serde_json::from_str(&content).map_err(|e| format!("IO: Corrupted completed_op: {e}"))?;

    if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(&record.committed_at) {
        let age = chrono::Utc::now().signed_duration_since(ts.with_timezone(&chrono::Utc));
        if age.num_seconds() > COMPLETED_RETENTION_SECS {
            return Err(format!(
                "VALIDATION: operation_id '{operation_id}' has expired its 7-day retention window"
            ));
        }
    }

    if record.request_digest != request_digest {
        return Err(format!(
            "VALIDATION: operation_id '{operation_id}' reused with different payload"
        ));
    }

    Ok(Some(record))
}

/// §3.9 Crash Recovery & Pending Transaction Inspection (MUST be called inside `with_project_lock`).
/// - If `allow_recovery == false` and any pending transaction exists: returns `Err("RECOVERY_REQUIRED: ...")`
///   without modifying business files.
/// - If `committed` exists: completes `completed_ops` + `mcp_audit.ndjson` projection (idempotent) and removes `<tx_dir>`.
/// - If `committed` does NOT exist: restores preimages in reverse target order, syncs, and removes `<tx_dir>`.
pub fn recover_pending_transactions(
    project_dir: &Path,
    allow_recovery: bool,
) -> Result<Vec<String>, String> {
    let tx_root = transactions_root(project_dir);
    let mut warnings = Vec::new();
    if !tx_root.is_dir() {
        return Ok(warnings);
    }

    let mut tx_dirs: Vec<String> = Vec::new();
    for entry in fs::read_dir(&tx_root).map_err(|e| format!("IO: {e}"))? {
        let entry = entry.map_err(|e| format!("IO: {e}"))?;
        if entry.file_type().map_err(|e| format!("IO: {e}"))?.is_dir() {
            tx_dirs.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    tx_dirs.sort();

    if tx_dirs.is_empty() {
        return Ok(warnings);
    }

    for dir_name in tx_dirs {
        let tx_dir = tx_root.join(&dir_name);
        let committed_path = tx_dir.join("committed");
        let manifest_path = tx_dir.join("manifest.json");
        let result_path = tx_dir.join("result.json");
        let is_committed = committed_path.exists();

        if !allow_recovery {
            return Err(format!(
                "RECOVERY_REQUIRED: Workspace has pending transaction '{dir_name}' (committed={is_committed}) that cannot be recovered in read-only mode"
            ));
        }

        let step_res = (|| -> Result<(), String> {
            if is_committed {
                if result_path.is_file() {
                    let text = fs::read_to_string(&result_path).map_err(|e| format!("IO: {e}"))?;
                    let record: TxResultRecord =
                        serde_json::from_str(&text).map_err(|e| format!("IO: {e}"))?;
                    persist_completed_operation(project_dir, &record)?;
                    if let Some(ref audit) = record.audit_entry {
                        if let Err(err) = append_audit_log_deduped(project_dir, audit) {
                            warnings.push(format!("Audit log projection warning ({dir_name}): {err}"));
                        }
                    }
                }
                fs::remove_dir_all(&tx_dir).map_err(|e| format!("IO: {e}"))?;
                sync_dir_best_effort(&tx_root);
                return Ok(());
            }

            // Uncommitted transaction: roll back in reverse target order using manifest + preimages
            if manifest_path.is_file() {
                let text = fs::read_to_string(&manifest_path).map_err(|e| format!("IO: {e}"))?;
                let manifest: TxManifest =
                    serde_json::from_str(&text).map_err(|e| format!("IO: {e}"))?;

                for target in manifest.targets.iter().rev() {
                    let rel = normalize_rel_path(&target.rel_path)?;
                    let abs_target = project_dir.join(&rel);

                    if target.kind == "dir_move" {
                        if let Some(ref from_rel_raw) = target.move_from_rel {
                            let from_rel = normalize_rel_path(from_rel_raw)?;
                            let abs_from = project_dir.join(&from_rel);
                            if abs_target.exists() && !abs_from.exists() {
                                if let Some(parent) = abs_from.parent() {
                                    fs::create_dir_all(parent).map_err(|e| format!("IO: {e}"))?;
                                }
                                fs::rename(&abs_target, &abs_from)
                                    .map_err(|e| format!("IO: {e}"))?;
                                if let Some(p) = abs_from.parent() {
                                    sync_dir_best_effort(p);
                                }
                                if let Some(p) = abs_target.parent() {
                                    sync_dir_best_effort(p);
                                }
                            } else if !target.existed_before && abs_target.exists() {
                                remove_path_if_exists(&abs_target)?;
                            }
                        }
                    } else if target.kind == "dir_create" {
                        if !target.existed_before {
                            remove_path_if_exists(&abs_target)?;
                            if let Some(p) = abs_target.parent() {
                                sync_dir_best_effort(p);
                            }
                        }
                    } else {
                        // "file" or "delete"
                        if target.existed_before {
                            if let Some(ref preimage_rel) = target.preimage_rel {
                                let preimage_path = tx_dir.join(preimage_rel);
                                if preimage_path.exists() {
                                    if preimage_path.is_dir() {
                                        remove_path_if_exists(&abs_target)?;
                                        copy_dir_recursive_atomic(&preimage_path, &abs_target)?;
                                    } else {
                                        let bytes = fs::read(&preimage_path)
                                            .map_err(|e| format!("IO: {e}"))?;
                                        atomic_write_bytes(&abs_target, &bytes)?;
                                    }
                                }
                            }
                        } else {
                            remove_path_if_exists(&abs_target)?;
                            if let Some(p) = abs_target.parent() {
                                sync_dir_best_effort(p);
                            }
                        }
                    }
                }
            }

            fs::remove_dir_all(&tx_dir).map_err(|e| format!("IO: {e}"))?;
            sync_dir_best_effort(&tx_root);
            Ok(())
        })();

        if let Err(err) = step_res {
            return Err(format!(
                "RECOVERY_REQUIRED: Failed recovering transaction '{dir_name}': {err}"
            ));
        }
    }

    Ok(warnings)
}

/// Consistent read helper: acquires the project lock, checks/recovers pending transactions,
/// runs `reader` inside the lock to capture consistent raw inputs + revisions, and releases the lock.
pub fn with_consistent_read<R, F>(
    project_or_conlang: &Path,
    tool_name: &str,
    allow_recovery: bool,
    ctx_opt: Option<&LockContext>,
    reader: F,
) -> Result<R, String>
where
    F: FnOnce(&Path, &LockContext) -> Result<R, String>,
{
    let project_root = resolve_project_root(project_or_conlang);
    if !project_root.exists() {
        let dummy = LockContext::default();
        return reader(&project_root, ctx_opt.unwrap_or(&dummy));
    }
    with_project_lock(&project_root, tool_name, ctx_opt, |ctx| {
        let _warnings = recover_pending_transactions(&project_root, allow_recovery)?;
        reader(&project_root, ctx)
    })
}

/// Execute a full ACID-like project transaction inside `with_project_lock`.
pub fn execute_project_transaction<T, P, PlanFn>(
    project_or_conlang: &Path,
    tool_name: &str,
    origin: &str,
    operation_id_opt: Option<String>,
    request_payload: &P,
    ctx_opt: Option<&LockContext>,
    plan_fn: PlanFn,
) -> Result<T, String>
where
    T: Serialize + DeserializeOwned,
    P: Serialize,
    PlanFn: FnOnce(&Path, &str, &LockContext) -> Result<TransactionPlan<T>, String>,
{
    execute_project_transaction_inner(
        project_or_conlang,
        tool_name,
        origin,
        operation_id_opt,
        request_payload,
        ctx_opt,
        #[cfg(test)]
        None,
        plan_fn,
    )
}

fn execute_project_transaction_inner<T, P, PlanFn>(
    project_or_conlang: &Path,
    tool_name: &str,
    origin: &str,
    operation_id_opt: Option<String>,
    request_payload: &P,
    ctx_opt: Option<&LockContext>,
    #[cfg(test)] fault_hook: Option<(FaultStage, &dyn Fn() -> Result<(), String>)>,
    plan_fn: PlanFn,
) -> Result<T, String>
where
    T: Serialize + DeserializeOwned,
    P: Serialize,
    PlanFn: FnOnce(&Path, &str, &LockContext) -> Result<TransactionPlan<T>, String>,
{
    let project_dir = resolve_project_root(project_or_conlang);
    fs::create_dir_all(&project_dir).map_err(|e| format!("IO: {e}"))?;

    let provided_op_id = operation_id_opt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let op_id = match &provided_op_id {
        Some(id) => {
            sanitize_op_id(id)?;
            id.clone()
        }
        None => generate_uuid_v4(),
    };

    let request_digest = compute_request_digest(tool_name, request_payload)?;

    with_project_lock(&project_dir, tool_name, ctx_opt, |ctx| {
        let mut warnings = recover_pending_transactions(&project_dir, true)?;

        if provided_op_id.is_some() {
            if let Some(prior) = lookup_completed_operation(&project_dir, &op_id, &request_digest)?
            {
                let parsed: T = serde_json::from_value(prior.response)
                    .map_err(|e| format!("IO: Failed decoding cached response: {e}"))?;
                return Ok(parsed);
            }
        }

        let plan = plan_fn(&project_dir, &op_id, ctx)?;

        // Verify expected revisions (CAS)
        for exp in &plan.expectations {
            if let Some(ref expected) = exp.expected_revision {
                let expected_trimmed = expected.trim();
                if !expected_trimmed.is_empty() {
                    let actual = exp.actual_revision()?;
                    if expected_trimmed != actual {
                        return Err(format!(
                            "CONFLICT: Revision mismatch on '{}': expected '{}', actual '{}'",
                            exp.label, expected_trimmed, actual
                        ));
                    }
                }
            }
        }

        let safe_id = sanitize_op_id(&op_id)?;
        let tx_dir = transactions_root(&project_dir).join(&safe_id);
        let preimages_dir = tx_dir.join("preimages");
        let staged_dir = tx_dir.join("staged");
        fs::create_dir_all(&preimages_dir).map_err(|e| format!("IO: {e}"))?;
        fs::create_dir_all(&staged_dir).map_err(|e| format!("IO: {e}"))?;

        let mut targets: Vec<TxTargetEntry> = Vec::with_capacity(plan.mutations.len());

        for (idx, mutation) in plan.mutations.iter().enumerate() {
            match mutation {
                PlannedMutation::WriteFile { rel_path, bytes } => {
                    let rel = normalize_rel_path(rel_path)?;
                    let abs_target = project_dir.join(&rel);
                    let existed = abs_target.exists();
                    let mut before_sha = None;
                    let mut preimage_rel = None;
                    if abs_target.is_file() {
                        let old_bytes = fs::read(&abs_target).map_err(|e| format!("IO: {e}"))?;
                        before_sha = Some(sha256_hex(&old_bytes));
                        let p_rel = format!("preimages/{idx}");
                        atomic_write_bytes(&tx_dir.join(&p_rel), &old_bytes)?;
                        preimage_rel = Some(p_rel);
                    }
                    let after_sha = Some(sha256_hex(bytes));
                    let s_rel = format!("staged/{idx}");
                    atomic_write_bytes(&tx_dir.join(&s_rel), bytes)?;
                    targets.push(TxTargetEntry {
                        rel_path: rel,
                        kind: "file".to_string(),
                        existed_before: existed,
                        before_sha256: before_sha,
                        after_sha256: after_sha,
                        preimage_rel,
                        staged_rel: Some(s_rel),
                        move_from_rel: None,
                    });
                }
                PlannedMutation::DeletePath { rel_path } => {
                    let rel = normalize_rel_path(rel_path)?;
                    let abs_target = project_dir.join(&rel);
                    let existed = abs_target.exists();
                    let mut before_sha = None;
                    let mut preimage_rel = None;
                    if existed {
                        let p_rel = format!("preimages/{idx}");
                        let preimage_abs = tx_dir.join(&p_rel);
                        if abs_target.is_dir() {
                            copy_dir_recursive_atomic(&abs_target, &preimage_abs)?;
                        } else {
                            let old_bytes =
                                fs::read(&abs_target).map_err(|e| format!("IO: {e}"))?;
                            before_sha = Some(sha256_hex(&old_bytes));
                            atomic_write_bytes(&preimage_abs, &old_bytes)?;
                        }
                        preimage_rel = Some(p_rel);
                    }
                    targets.push(TxTargetEntry {
                        rel_path: rel,
                        kind: "delete".to_string(),
                        existed_before: existed,
                        before_sha256: before_sha,
                        after_sha256: None,
                        preimage_rel,
                        staged_rel: None,
                        move_from_rel: None,
                    });
                }
                PlannedMutation::CreateDir { rel_path } => {
                    let rel = normalize_rel_path(rel_path)?;
                    let abs_target = project_dir.join(&rel);
                    targets.push(TxTargetEntry {
                        rel_path: rel,
                        kind: "dir_create".to_string(),
                        existed_before: abs_target.exists(),
                        before_sha256: None,
                        after_sha256: None,
                        preimage_rel: None,
                        staged_rel: None,
                        move_from_rel: None,
                    });
                }
                PlannedMutation::MoveDir {
                    from_rel_path,
                    to_rel_path,
                } => {
                    let from_rel = normalize_rel_path(from_rel_path)?;
                    let to_rel = normalize_rel_path(to_rel_path)?;
                    let abs_to = project_dir.join(&to_rel);
                    targets.push(TxTargetEntry {
                        rel_path: to_rel,
                        kind: "dir_move".to_string(),
                        existed_before: abs_to.exists(),
                        before_sha256: None,
                        after_sha256: None,
                        preimage_rel: None,
                        staged_rel: None,
                        move_from_rel: Some(from_rel),
                    });
                }
            }
        }

        let manifest = TxManifest {
            version: 1,
            operation_id: op_id.clone(),
            origin: origin.to_string(),
            tool: tool_name.to_string(),
            request_digest: request_digest.clone(),
            created_at: now_rfc3339(),
            targets: targets.clone(),
        };
        let manifest_json =
            serde_json::to_string_pretty(&manifest).map_err(|e| format!("IO: {e}"))?;
        atomic_write(&tx_dir.join("manifest.json"), &manifest_json)?;
        sync_dir_best_effort(&tx_dir);

        #[cfg(test)]
        if let Some((FaultStage::AfterManifest, trigger)) = fault_hook {
            trigger()?;
        }

        // Apply all staged targets
        let mut affected_dirs: HashSet<PathBuf> = HashSet::new();
        for (_idx, target) in targets.iter().enumerate() {
            let abs_target = project_dir.join(&target.rel_path);
            if let Some(parent) = abs_target.parent() {
                affected_dirs.insert(parent.to_path_buf());
            }

            match target.kind.as_str() {
                "file" => {
                    if let Some(ref staged_rel) = target.staged_rel {
                        let bytes =
                            fs::read(tx_dir.join(staged_rel)).map_err(|e| format!("IO: {e}"))?;
                        atomic_write_bytes(&abs_target, &bytes)?;
                    }
                }
                "delete" => {
                    remove_path_if_exists(&abs_target)?;
                }
                "dir_create" => {
                    fs::create_dir_all(&abs_target).map_err(|e| format!("IO: {e}"))?;
                }
                "dir_move" => {
                    if let Some(ref from_rel) = target.move_from_rel {
                        let abs_from = project_dir.join(from_rel);
                        if let Some(parent) = abs_from.parent() {
                            affected_dirs.insert(parent.to_path_buf());
                        }
                        if let Some(parent) = abs_target.parent() {
                            fs::create_dir_all(parent).map_err(|e| format!("IO: {e}"))?;
                        }
                        if abs_target.exists() {
                            remove_path_if_exists(&abs_target)?;
                        }
                        fs::rename(&abs_from, &abs_target).map_err(|e| format!("IO: {e}"))?;
                    }
                }
                _ => {}
            }

            #[cfg(test)]
            if _idx == 0 {
                if let Some((FaultStage::MidApply, trigger)) = fault_hook {
                    trigger()?;
                }
            }
        }

        for dir in &affected_dirs {
            sync_dir_best_effort(dir);
        }

        let mut new_revisions = BTreeMap::new();
        for exp in &plan.expectations {
            new_revisions.insert(exp.label.clone(), exp.actual_revision()?);
        }

        let committed_at = now_rfc3339();
        let response = (plan.build_response)(&new_revisions, warnings.clone());
        let response_val = serde_json::to_value(&response).map_err(|e| format!("IO: {e}"))?;

        let audit_entry = McpAuditLogEntry {
            timestamp: committed_at.clone(),
            operation_id: op_id.clone(),
            tool: tool_name.to_string(),
            origin: origin.to_string(),
            family_path: Some(project_dir.to_string_lossy().into_owned()),
            language_id: plan.language_id,
            summary: plan.audit_summary,
            snapshot_id: plan.snapshot_id,
            status: "committed".to_string(),
        };

        let result_record = TxResultRecord {
            operation_id: op_id.clone(),
            request_digest,
            committed_at: committed_at.clone(),
            response: response_val,
            audit_entry: Some(audit_entry.clone()),
        };

        let result_json =
            serde_json::to_string_pretty(&result_record).map_err(|e| format!("IO: {e}"))?;
        atomic_write(&tx_dir.join("result.json"), &result_json)?;

        #[cfg(test)]
        if let Some((FaultStage::BeforeCommitted, trigger)) = fault_hook {
            trigger()?;
        }

        atomic_write(&tx_dir.join("committed"), &committed_at)?;
        sync_dir_best_effort(&tx_dir);

        #[cfg(test)]
        if let Some((FaultStage::BeforeAudit, trigger)) = fault_hook {
            trigger()?;
        }

        persist_completed_operation(&project_dir, &result_record)?;
        if let Err(err) = append_audit_log_deduped(&project_dir, &audit_entry) {
            warnings.push(format!("Audit log projection warning: {err}"));
        }

        if let Err(err) = fs::remove_dir_all(&tx_dir) {
            eprintln!("Non-fatal transaction cleanup warning: {err}");
        } else {
            sync_dir_best_effort(&transactions_root(&project_dir));
        }

        Ok(response)
    })
}

/// Inspect recent `completed_ops/*.json` records to identify whether `current_revisions`
/// matches a committed GUI or MCP transaction. If no committed op matches the current
/// disk revisions, returns `(None, "external")`.
pub fn match_committed_op_for_revisions(
    project_dir: &Path,
    current_revisions: &BTreeMap<String, String>,
) -> (Option<String>, String) {
    if current_revisions.is_empty() {
        return (None, "external".to_string());
    }
    let root = completed_ops_root(project_dir);
    let Ok(rd) = fs::read_dir(&root) else {
        return (None, "external".to_string());
    };

    let mut files: Vec<(std::time::SystemTime, PathBuf)> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                return None;
            }
            let mtime = e
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(std::time::UNIX_EPOCH);
            Some((mtime, p))
        })
        .collect();

    // Sort newest first, check up to 30 recent completed ops
    files.sort_by(|a, b| b.0.cmp(&a.0));

    for (_, path) in files.into_iter().take(30) {
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<TxResultRecord>(&content) else {
            continue;
        };

        let mut committed_revs: HashSet<String> = HashSet::new();
        if let Some(rev) = record.response.get("revision").and_then(|v| v.as_str()) {
            committed_revs.insert(rev.to_string());
        }
        if let Some(revs_obj) = record.response.get("revisions").and_then(|v| v.as_object()) {
            for val in revs_obj.values() {
                if let Some(s) = val.as_str() {
                    committed_revs.insert(s.to_string());
                }
            }
        }

        if committed_revs.is_empty() {
            continue;
        }

        // All current non-missing revisions (or at least one primary revision and none contradicting)
        let matches = current_revisions
            .values()
            .all(|cur| committed_revs.contains(cur));
        if matches {
            let origin = record
                .audit_entry
                .as_ref()
                .map(|a| a.origin.clone())
                .unwrap_or_else(|| "gui".to_string());
            return (Some(record.operation_id), origin);
        }
    }

    (None, "external".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::WriteResult;

    #[test]
    fn t1_15_fault_injection_mid_apply_rolls_back_and_recovery_is_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path();
        let file_a = project.join("root/lexicon/lexicon_a.ndjson");
        let file_b = project.join("root/lexicon/lexicon_b.ndjson");
        fs::create_dir_all(file_a.parent().unwrap()).unwrap();
        fs::write(&file_a, b"{\"entry_id\":\"1\",\"con_word_romanized\":\"ata\"}\n").unwrap();

        let hook = || -> Result<(), String> { Err("SIMULATED_CRASH_MID_APPLY".to_string()) };

        let err = execute_project_transaction_inner(
            project,
            "save_word",
            "gui",
            Some("op_crash_1".to_string()),
            &serde_json::json!({"move": "ata->bata"}),
            None,
            Some((FaultStage::MidApply, &hook)),
            |proj, op_id, _ctx| {
                Ok(TransactionPlan {
                    expectations: vec![RevisionExpectation::lexicon(
                        "lexicon",
                        proj.join("root/lexicon"),
                        None,
                    )],
                    mutations: vec![
                        PlannedMutation::DeletePath {
                            rel_path: "root/lexicon/lexicon_a.ndjson".to_string(),
                        },
                        PlannedMutation::WriteFile {
                            rel_path: "root/lexicon/lexicon_b.ndjson".to_string(),
                            bytes: b"{\"entry_id\":\"1\",\"con_word_romanized\":\"bata\"}\n".to_vec(),
                        },
                    ],
                    audit_summary: "move word".to_string(),
                    language_id: Some("root".to_string()),
                    snapshot_id: None,
                    build_response: Box::new({
                        let id = op_id.to_string();
                        move |revs, warnings| WriteResult {
                            operation_id: id,
                            revision: revs.get("lexicon").cloned().unwrap_or_default(),
                            revisions: Some(revs.clone()),
                            snapshot_id: None,
                            warnings,
                        }
                    }),
                })
            },
        )
        .unwrap_err();
        assert!(err.contains("SIMULATED_CRASH_MID_APPLY"));

        // Mid-apply deleted file_a and did not reach file_b, leaving uncommitted journal
        assert!(!file_a.exists());
        assert!(!file_b.exists());

        // Read-only mode MUST refuse with RECOVERY_REQUIRED without modifying disk
        let ro_err = with_consistent_read(project, "read_only_probe", false, None, |_, _| Ok(()))
            .unwrap_err();
        assert!(ro_err.starts_with("RECOVERY_REQUIRED:"));
        assert!(!file_a.exists());

        // Recovery in write/GUI mode restores file_a and removes uncommitted tx dir; repeating is a no-op
        with_project_lock(project, "recover_1", None, |_| {
            recover_pending_transactions(project, true)
        })
        .unwrap();
        assert!(file_a.is_file());
        assert!(!file_b.exists());

        with_project_lock(project, "recover_2", None, |_| {
            recover_pending_transactions(project, true)
        })
        .unwrap();
        assert_eq!(
            fs::read_to_string(&file_a).unwrap(),
            "{\"entry_id\":\"1\",\"con_word_romanized\":\"ata\"}\n"
        );
    }

    #[test]
    fn t1_15_post_commit_crash_completes_projection_and_deduplicates_retries() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path();
        let target = project.join("root/grammar.json");

        let hook = || -> Result<(), String> { Err("CRASH_AFTER_COMMITTED_MARKER".to_string()) };
        let payload = serde_json::json!({"language_id": "root"});

        let err = execute_project_transaction_inner(
            project,
            "save_grammar",
            "gui",
            Some("op_commit_retry".to_string()),
            &payload,
            None,
            Some((FaultStage::BeforeAudit, &hook)),
            |proj, op_id, _ctx| {
                Ok(TransactionPlan {
                    expectations: vec![RevisionExpectation::file(
                        "grammar",
                        proj.join("root/grammar.json"),
                        Some("missing".to_string()),
                    )],
                    mutations: vec![PlannedMutation::WriteFile {
                        rel_path: "root/grammar.json".to_string(),
                        bytes: b"{\"language_id\":\"root\"}\n".to_vec(),
                    }],
                    audit_summary: "save grammar".to_string(),
                    language_id: Some("root".to_string()),
                    snapshot_id: None,
                    build_response: Box::new({
                        let id = op_id.to_string();
                        move |revs, warnings| WriteResult {
                            operation_id: id,
                            revision: revs.get("grammar").cloned().unwrap_or_default(),
                            revisions: Some(revs.clone()),
                            snapshot_id: None,
                            warnings,
                        }
                    }),
                })
            },
        )
        .unwrap_err();
        assert!(err.contains("CRASH_AFTER_COMMITTED_MARKER"));
        assert!(target.is_file());

        // Client retries the SAME operation_id with the SAME payload (even though disk is no longer "missing"!)
        // Recovery projects result.json -> completed_ops + audit, and retry returns the original WriteResult!
        let retried: WriteResult = execute_project_transaction(
            project,
            "save_grammar",
            "gui",
            Some("op_commit_retry".to_string()),
            &payload,
            None,
            |_proj, _op_id, _ctx| panic!("Plan should not re-run for already-committed operation_id!"),
        )
        .unwrap();
        assert_eq!(retried.operation_id, "op_commit_retry");
        assert_eq!(retried.revision, file_revision(&target).unwrap());

        // Reusing the SAME operation_id with a DIFFERENT payload MUST fail with VALIDATION!
        let diff_err = execute_project_transaction::<WriteResult, _, _>(
            project,
            "save_grammar",
            "gui",
            Some("op_commit_retry".to_string()),
            &serde_json::json!({"language_id": "different"}),
            None,
            |_proj, _op_id, _ctx| unreachable!(),
        )
        .unwrap_err();
        assert!(diff_err.starts_with("VALIDATION:"));

        // Audit log has exactly 1 entry (deduplicated)
        let audits = read_audit_logs(project, 50).unwrap();
        assert_eq!(audits.len(), 1);
        assert_eq!(audits[0].operation_id, "op_commit_retry");
    }
}
