use std::path::{Path, PathBuf};
use tauri::{command, AppHandle};

use crate::commands::registry::load_registry;
use crate::commands::transaction::read_audit_logs;
use crate::models::McpAuditLogEntry;
use crate::utils::revision::resolve_project_root;

fn sidecar_binary_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "conlang-mcp.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "conlang-mcp"
    }
}

fn dev_target_sidecar_candidates(manifest_dir: &Path) -> Vec<PathBuf> {
    let bin_dir = manifest_dir.join("binaries");
    let mut out = Vec::new();

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    out.push(bin_dir.join("conlang-mcp-aarch64-apple-darwin"));

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    out.push(bin_dir.join("conlang-mcp-x86_64-apple-darwin"));

    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    out.push(bin_dir.join("conlang-mcp-x86_64-pc-windows-msvc.exe"));

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    out.push(bin_dir.join("conlang-mcp-x86_64-unknown-linux-gnu"));

    out.push(bin_dir.join(sidecar_binary_name()));
    out
}

/// Locates the `conlang-mcp` executable (`T5.2`, T-R2):
/// 1. sibling binary next to the running executable (production bundle),
/// 2. dev builds: `src-tauri/binaries/conlang-mcp-<target-triple>`.
///
/// Returns `None` when neither exists.
pub fn resolve_mcp_binary() -> Option<PathBuf> {
    let current = tauri::utils::platform::current_exe()
        .or_else(|_| std::env::current_exe())
        .ok()?;
    let exe_dir = current.parent()?;
    let bundled_sidecar = exe_dir.join(sidecar_binary_name());
    if bundled_sidecar.is_file() {
        return Some(bundled_sidecar);
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    dev_target_sidecar_candidates(&manifest_dir)
        .into_iter()
        .find(|candidate| candidate.is_file())
}

/// Resolve the path to the `conlang-mcp` executable (`T5.2`).
/// Falls back to the expected sidecar path next to the current executable when nothing
/// was built yet, so the settings page can still show where the binary belongs.
#[command]
pub fn get_mcp_binary_path() -> Result<String, String> {
    if let Some(found) = resolve_mcp_binary() {
        return Ok(found.to_string_lossy().into_owned());
    }

    let current = tauri::utils::platform::current_exe()
        .or_else(|_| std::env::current_exe())
        .map_err(|e| format!("IO: Cannot determine current executable path: {e}"))?;
    let exe_dir = current
        .parent()
        .ok_or_else(|| "IO: Executable has no parent directory".to_string())?;
    Ok(exe_dir
        .join(sidecar_binary_name())
        .to_string_lossy()
        .into_owned())
}

/// Read recent MCP / workspace audit log entries (`<project>/.conlang-maker/mcp_audit.ndjson`),
/// newest first, capped to `limit.unwrap_or(50)` (`T5.2`).
#[command]
pub fn get_mcp_audit_logs(
    app: AppHandle,
    project_path: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<McpAuditLogEntry>, String> {
    let max_entries = limit.unwrap_or(50).clamp(1, 500);

    if let Some(raw_proj) = project_path {
        let trimmed = raw_proj.trim();
        if !trimmed.is_empty() {
            let root = resolve_project_root(Path::new(trimmed));
            return read_audit_logs(&root, max_entries);
        }
    }

    // If no explicit `project_path` was passed, aggregate across registered families in GlobalRegistry
    let registry = load_registry(app)?;
    let mut combined: Vec<McpAuditLogEntry> = Vec::new();
    for fam in &registry.families {
        let root = resolve_project_root(Path::new(&fam.conlang_file_path));
        if let Ok(entries) = read_audit_logs(&root, max_entries) {
            combined.extend(entries);
        }
    }
    combined.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    combined.truncate(max_entries);
    Ok(combined)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t5_2_get_mcp_binary_path_returns_non_empty_sidecar_path() {
        let path = get_mcp_binary_path().unwrap();
        assert!(path.contains("conlang-mcp"));
    }
}
