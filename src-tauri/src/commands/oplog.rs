use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

use crate::commands::fork::copy_dir_recursive;
use crate::commands::lexicon::atomic_write;
use crate::models::{OperationLog, OperationLogEntry};

// ── Helpers ──────────────────────────────────────────────

fn oplog_dir(language_dir: &Path) -> PathBuf {
    language_dir.join(".oplog")
}

fn oplog_file(language_dir: &Path) -> PathBuf {
    oplog_dir(language_dir).join("oplog.json")
}

fn now_iso() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    // Simple ISO-ish timestamp: seconds since epoch (frontend will format)
    format!("{}", secs)
}

fn generate_log_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let s = RandomState::new();
    let mut h = s.build_hasher();
    h.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
    );
    format!("{:016x}", h.finish())
}

// ── Commands ─────────────────────────────────────────────

/// Load the operation log for a language directory.
#[command]
pub fn load_operation_log(
    project_path: String,
    language_path: String,
) -> Result<OperationLog, String> {
    let lang_dir = Path::new(&project_path).join(&language_path);
    let file = oplog_file(&lang_dir);
    if !file.exists() {
        return Ok(OperationLog::default());
    }
    let content = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let log: OperationLog = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(log)
}

/// Create a snapshot of the language's lexicon directory before a destructive operation.
/// Returns the updated OperationLog.
#[command]
pub fn create_snapshot(
    project_path: String,
    language_path: String,
    operation_type: String,
    source_language_id: String,
    target_language_id: String,
    description: String,
) -> Result<OperationLog, String> {
    let lang_dir = Path::new(&project_path).join(&language_path);
    let oplog_base = oplog_dir(&lang_dir);
    fs::create_dir_all(&oplog_base).map_err(|e| e.to_string())?;

    // Load existing log
    let file = oplog_file(&lang_dir);
    let mut log: OperationLog = if file.exists() {
        let content = fs::read_to_string(&file).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        OperationLog::default()
    };

    let log_id = generate_log_id();
    let snapshot_dir_name = format!("snap_{}", &log_id);
    let snapshot_path = oplog_base.join(&snapshot_dir_name);
    fs::create_dir_all(&snapshot_path).map_err(|e| e.to_string())?;

    // Snapshot the lexicon directory
    let lexicon_dir = lang_dir.join("lexicon");
    if lexicon_dir.exists() {
        let snap_lexicon = snapshot_path.join("lexicon");
        copy_dir_recursive(&lexicon_dir, &snap_lexicon)?;
    }

    // Add entry
    let entry = OperationLogEntry {
        log_id: log_id.clone(),
        operation_type,
        timestamp: now_iso(),
        source_language_id,
        target_language_id,
        description,
        snapshot_dir: snapshot_dir_name,
    };
    log.entries.push(entry);

    // Enforce max_snapshots: remove oldest entries if over limit
    while log.entries.len() > log.max_snapshots as usize {
        let removed = log.entries.remove(0);
        let old_snap = oplog_base.join(&removed.snapshot_dir);
        if old_snap.exists() {
            let _ = fs::remove_dir_all(&old_snap);
        }
    }

    // Save log
    let content = serde_json::to_string_pretty(&log).map_err(|e| e.to_string())?;
    atomic_write(&file, &content)?;

    Ok(log)
}

/// Rollback to a specific snapshot, restoring the lexicon directory.
/// Returns the updated OperationLog with entries after the rolled-back one removed.
#[command]
pub fn rollback_to_snapshot(
    project_path: String,
    language_path: String,
    log_id: String,
) -> Result<OperationLog, String> {
    let lang_dir = Path::new(&project_path).join(&language_path);
    let oplog_base = oplog_dir(&lang_dir);
    let file = oplog_file(&lang_dir);

    if !file.exists() {
        return Err("No operation log found".to_string());
    }

    let content = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let mut log: OperationLog = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Find the entry index
    let idx = log
        .entries
        .iter()
        .position(|e| e.log_id == log_id)
        .ok_or_else(|| format!("Snapshot {} not found in log", log_id))?;

    let entry = &log.entries[idx];
    let snapshot_path = oplog_base.join(&entry.snapshot_dir);
    if !snapshot_path.exists() {
        return Err(format!("Snapshot directory {} does not exist", entry.snapshot_dir));
    }

    // Restore lexicon from snapshot
    let lexicon_dir = lang_dir.join("lexicon");
    if lexicon_dir.exists() {
        fs::remove_dir_all(&lexicon_dir).map_err(|e| e.to_string())?;
    }
    let snap_lexicon = snapshot_path.join("lexicon");
    if snap_lexicon.exists() {
        copy_dir_recursive(&snap_lexicon, &lexicon_dir)?;
    } else {
        // Snapshot had no lexicon — ensure the dir is clean
        fs::create_dir_all(&lexicon_dir).map_err(|e| e.to_string())?;
    }

    // Remove this entry and all entries after it (they are invalidated),
    // and clean up their snapshot directories
    let removed_entries: Vec<OperationLogEntry> = log.entries.drain(idx..).collect();
    for removed in &removed_entries {
        let snap = oplog_base.join(&removed.snapshot_dir);
        if snap.exists() {
            let _ = fs::remove_dir_all(&snap);
        }
    }

    // Save updated log
    let updated_content = serde_json::to_string_pretty(&log).map_err(|e| e.to_string())?;
    atomic_write(&file, &updated_content)?;

    Ok(log)
}

/// Update the maximum number of snapshots to keep.
#[command]
pub fn set_max_snapshots(
    project_path: String,
    language_path: String,
    max_snapshots: u32,
) -> Result<OperationLog, String> {
    let lang_dir = Path::new(&project_path).join(&language_path);
    let oplog_base = oplog_dir(&lang_dir);
    fs::create_dir_all(&oplog_base).map_err(|e| e.to_string())?;

    let file = oplog_file(&lang_dir);
    let mut log: OperationLog = if file.exists() {
        let content = fs::read_to_string(&file).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        OperationLog::default()
    };

    log.max_snapshots = max_snapshots;

    // Enforce new limit
    while log.entries.len() > log.max_snapshots as usize {
        let removed = log.entries.remove(0);
        let old_snap = oplog_base.join(&removed.snapshot_dir);
        if old_snap.exists() {
            let _ = fs::remove_dir_all(&old_snap);
        }
    }

    let content = serde_json::to_string_pretty(&log).map_err(|e| e.to_string())?;
    atomic_write(&file, &content)?;

    Ok(log)
}
