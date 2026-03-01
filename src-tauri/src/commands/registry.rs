use crate::commands::lexicon::atomic_write;
use crate::models::{FamilyEntry, GlobalRegistry, WorkspaceConfig};
use std::fs;
use std::path::PathBuf;
use tauri::{command, AppHandle, Manager};

/// Get the path to the global registry file in the app data directory.
fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("registry.json"))
}

/// Load the global registry from the app data directory.
#[command]
pub fn load_registry(app: AppHandle) -> Result<GlobalRegistry, String> {
    let path = registry_path(&app)?;
    if !path.exists() {
        return Ok(GlobalRegistry::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Save the global registry to the app data directory.
#[command]
pub fn save_registry(app: AppHandle, registry: GlobalRegistry) -> Result<(), String> {
    let path = registry_path(&app)?;
    let content = serde_json::to_string_pretty(&registry).map_err(|e| e.to_string())?;
    atomic_write(&path, &content)
}

/// Register a new language family in the global registry.
/// Returns the updated registry.
#[command]
pub fn register_family(
    app: AppHandle,
    name: String,
    conlang_file_path: String,
) -> Result<GlobalRegistry, String> {
    let mut registry = load_registry(app.clone())?;

    // Check if already registered
    if registry
        .families
        .iter()
        .any(|f| f.conlang_file_path == conlang_file_path)
    {
        // Update existing entry
        for family in &mut registry.families {
            if family.conlang_file_path == conlang_file_path {
                family.name = name.clone();
                family.last_opened = now_iso();
            }
        }
    } else {
        // Add new entry
        registry.families.push(FamilyEntry {
            name,
            conlang_file_path: conlang_file_path.clone(),
            last_opened: now_iso(),
        });
    }

    // Set active to the (possibly new) entry
    if let Some(idx) = registry
        .families
        .iter()
        .position(|f| f.conlang_file_path == conlang_file_path)
    {
        registry.active_family_index = Some(idx);
    }

    save_registry(app, registry.clone())?;
    Ok(registry)
}

/// Unregister a language family from the global registry (does NOT delete files).
/// Returns the updated registry.
#[command]
pub fn unregister_family(app: AppHandle, index: usize) -> Result<GlobalRegistry, String> {
    let mut registry = load_registry(app.clone())?;

    if index >= registry.families.len() {
        return Err("Family index out of range".to_string());
    }

    registry.families.remove(index);

    // Adjust active_family_index
    if registry.families.is_empty() {
        registry.active_family_index = None;
    } else if let Some(active) = registry.active_family_index {
        if active >= registry.families.len() {
            registry.active_family_index = Some(registry.families.len() - 1);
        } else if active > index {
            registry.active_family_index = Some(active - 1);
        } else if active == index {
            registry.active_family_index = Some(0);
        }
    }

    save_registry(app, registry.clone())?;
    Ok(registry)
}

/// Set the active family in the global registry.
#[command]
pub fn set_active_family(app: AppHandle, index: usize) -> Result<GlobalRegistry, String> {
    let mut registry = load_registry(app.clone())?;

    if index >= registry.families.len() {
        return Err("Family index out of range".to_string());
    }

    registry.active_family_index = Some(index);
    registry.families[index].last_opened = now_iso();

    save_registry(app, registry.clone())?;
    Ok(registry)
}

/// Validate a .conlang file — check that it's valid JSON with the expected schema
/// and that all language directories exist.
/// Returns a list of missing language paths (empty = all valid).
#[command]
pub fn validate_conlang_file(conlang_file_path: String) -> Result<Vec<String>, String> {
    let path = std::path::Path::new(&conlang_file_path);

    if !path.exists() {
        return Err(format!("File not found: {}", conlang_file_path));
    }

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let config: WorkspaceConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid .conlang file format: {}", e))?;

    let project_dir = path
        .parent()
        .ok_or_else(|| "Cannot determine project directory".to_string())?;

    let mut missing: Vec<String> = Vec::new();
    for lang in &config.languages {
        let lang_dir = project_dir.join(&lang.path);
        if !lang_dir.exists() {
            missing.push(lang.path.clone());
        }
    }

    Ok(missing)
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Simple ISO-ish timestamp (good enough for sorting)
    let days = secs / 86400;
    let years = 1970 + days / 365;
    let remaining_days = days % 365;
    let months = remaining_days / 30 + 1;
    let day = remaining_days % 30 + 1;
    let hours = (secs % 86400) / 3600;
    let minutes = (secs % 3600) / 60;
    let seconds = secs % 60;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        years, months, day, hours, minutes, seconds
    )
}
