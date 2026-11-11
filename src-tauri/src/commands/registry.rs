use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager};

use crate::commands::lock::with_custom_lock_dir;
use crate::commands::transaction::with_consistent_read;
use crate::models::{FamilyEntry, GlobalRegistry, WorkspaceConfig, WriteResult};
use crate::utils::fs_util::{atomic_write, generate_uuid_v4, now_rfc3339};
use crate::utils::revision::file_revision;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RegistryLoadResult {
    pub registry: GlobalRegistry,
    pub revision: String,
}

fn registry_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok((data_dir.join("registry.json"), data_dir.join("registry.lock")))
}

fn read_registry_unlocked(path: &Path) -> Result<GlobalRegistry, String> {
    if !path.is_file() {
        return Ok(GlobalRegistry::default());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[command]
pub fn load_registry_with_revision(app: AppHandle) -> Result<RegistryLoadResult, String> {
    let (path, lock_dir) = registry_paths(&app)?;
    with_custom_lock_dir(&lock_dir, "load_registry_with_revision", None, |_| {
        let rev = file_revision(&path)?;
        let registry = read_registry_unlocked(&path)?;
        Ok(RegistryLoadResult {
            registry,
            revision: rev,
        })
    })
}

/// Load the global registry from the app data directory.
#[command]
pub fn load_registry(app: AppHandle) -> Result<GlobalRegistry, String> {
    load_registry_with_revision(app).map(|res| res.registry)
}

/// Save the global registry to the app data directory under §3.2 owner lock + optional CAS.
#[command]
pub fn save_registry(
    app: AppHandle,
    registry: GlobalRegistry,
    expected_revision: Option<String>,
) -> Result<WriteResult, String> {
    let (path, lock_dir) = registry_paths(&app)?;
    with_custom_lock_dir(&lock_dir, "save_registry", None, |_| {
        if let Some(ref exp) = expected_revision {
            let trimmed = exp.trim();
            if !trimmed.is_empty() {
                let actual = file_revision(&path)?;
                if trimmed != actual {
                    return Err(format!(
                        "CONFLICT: Registry revision mismatch: expected '{trimmed}', actual '{actual}'"
                    ));
                }
            }
        }
        let content = serde_json::to_string_pretty(&registry).map_err(|e| e.to_string())?;
        atomic_write(&path, &content)?;
        let rev = file_revision(&path)?;
        Ok(WriteResult {
            operation_id: generate_uuid_v4(),
            revision: rev,
            revisions: None,
            snapshot_id: None,
            warnings: Vec::new(),
        })
    })
}

/// Register a new language family in the global registry.
/// Returns the updated registry.
#[command]
pub fn register_family(
    app: AppHandle,
    name: String,
    conlang_file_path: String,
) -> Result<GlobalRegistry, String> {
    let (path, lock_dir) = registry_paths(&app)?;
    with_custom_lock_dir(&lock_dir, "register_family", None, |_| {
        let mut registry = read_registry_unlocked(&path)?;
        let ts = now_rfc3339();

        if registry
            .families
            .iter()
            .any(|f| f.conlang_file_path == conlang_file_path)
        {
            for family in &mut registry.families {
                if family.conlang_file_path == conlang_file_path {
                    family.name = name.clone();
                    family.last_opened = ts.clone();
                }
            }
        } else {
            registry.families.push(FamilyEntry {
                name,
                conlang_file_path: conlang_file_path.clone(),
                last_opened: ts,
                extra: BTreeMap::new(),
            });
        }

        if let Some(idx) = registry
            .families
            .iter()
            .position(|f| f.conlang_file_path == conlang_file_path)
        {
            registry.active_family_index = Some(idx);
        }

        let content = serde_json::to_string_pretty(&registry).map_err(|e| e.to_string())?;
        atomic_write(&path, &content)?;
        Ok(registry)
    })
}

/// Unregister a language family from the global registry (does NOT delete files).
/// Returns the updated registry.
#[command]
pub fn unregister_family(app: AppHandle, index: usize) -> Result<GlobalRegistry, String> {
    let (path, lock_dir) = registry_paths(&app)?;
    with_custom_lock_dir(&lock_dir, "unregister_family", None, |_| {
        let mut registry = read_registry_unlocked(&path)?;

        if index >= registry.families.len() {
            return Err("Family index out of range".to_string());
        }

        registry.families.remove(index);

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

        let content = serde_json::to_string_pretty(&registry).map_err(|e| e.to_string())?;
        atomic_write(&path, &content)?;
        Ok(registry)
    })
}

/// Set the active family in the global registry.
#[command]
pub fn set_active_family(app: AppHandle, index: usize) -> Result<GlobalRegistry, String> {
    let (path, lock_dir) = registry_paths(&app)?;
    with_custom_lock_dir(&lock_dir, "set_active_family", None, |_| {
        let mut registry = read_registry_unlocked(&path)?;

        if index >= registry.families.len() {
            return Err("Family index out of range".to_string());
        }

        registry.active_family_index = Some(index);
        registry.families[index].last_opened = now_rfc3339();

        let content = serde_json::to_string_pretty(&registry).map_err(|e| e.to_string())?;
        atomic_write(&path, &content)?;
        Ok(registry)
    })
}

/// Validate a .conlang file — check that it's valid JSON with the expected schema
/// and that all language directories exist.
#[command]
pub fn validate_conlang_file(conlang_file_path: String) -> Result<Vec<String>, String> {
    let path = Path::new(&conlang_file_path);

    if !path.exists() {
        return Err(format!("File not found: {conlang_file_path}"));
    }

    with_consistent_read(path, "validate_conlang_file", true, None, |project_dir, _| {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let config: WorkspaceConfig = serde_json::from_str(&content)
            .map_err(|e| format!("Invalid .conlang file format: {e}"))?;

        let mut missing: Vec<String> = Vec::new();
        for lang in &config.languages {
            let lang_dir = project_dir.join(&lang.path);
            if !lang_dir.exists() {
                missing.push(lang.path.clone());
            }
        }

        Ok(missing)
    })
}
