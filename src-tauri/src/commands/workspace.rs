use crate::commands::lexicon::atomic_write;
use crate::models::{CreateProjectResult, GrammarConfig, SCAConfig, WorkspaceConfig};
use std::fs;
use std::path::Path;
use tauri::command;

/// Load workspace config from a .conlang file (absolute path).
#[command]
pub fn load_workspace(conlang_file_path: String) -> Result<WorkspaceConfig, String> {
    let path = Path::new(&conlang_file_path);
    if !path.exists() {
        return Ok(WorkspaceConfig::default());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Save workspace config to a .conlang file (absolute path).
#[command]
pub fn save_workspace(conlang_file_path: String, config: WorkspaceConfig) -> Result<(), String> {
    let path = Path::new(&conlang_file_path);
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write(path, &content)
}

#[command]
pub fn create_language_dir(project_path: String, lang_path: String) -> Result<(), String> {
    let dir = Path::new(&project_path).join(&lang_path);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())
}

/// Create a brand-new project:
/// 1. Creates the project directory
/// 2. Creates a `{lang_name}-{random8}.conlang` config file
/// 3. Creates the root language subdirectory
/// Returns the WorkspaceConfig and the absolute path to the .conlang file.
#[command]
pub fn create_new_project(
    project_path: String,
    lang_name: String,
) -> Result<CreateProjectResult, String> {
    fs::create_dir_all(&project_path).map_err(|e| e.to_string())?;

    let safe_name = sanitize_filename(&lang_name);
    let random_id = generate_short_id();
    let project_dir_name = format!("{}-{}", safe_name, random_id);
    let project_root = Path::new(&project_path).join(&project_dir_name);
    if project_root.exists() {
        return Err(format!(
            "Project directory already exists: {}",
            project_root.display()
        ));
    }
    fs::create_dir_all(&project_root).map_err(|e| e.to_string())?;

    let lang_id = format!("lang_{}", random_id);
    let lang_dir_name = "proto_language".to_string();

    let config = WorkspaceConfig {
        workspace_version: "3.0".to_string(),
        languages: vec![crate::models::LanguageEntry {
            language_id: lang_id.clone(),
            name: lang_name.clone(),
            path: lang_dir_name.clone(),
            parent_id: None,
        }],
    };

    // Create language data directory scaffold
    let lang_dir = project_root.join(&lang_dir_name);
    fs::create_dir_all(&lang_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(lang_dir.join("lexicon")).map_err(|e| e.to_string())?;
    fs::create_dir_all(lang_dir.join("corpus")).map_err(|e| e.to_string())?;

    let phonology_json = serde_json::json!({
        "language_id": lang_id,
        "phoneme_inventory": {
            "consonants": [],
            "vowels": []
        },
        "romanization_maps": [],
        "phonotactics": {
            "macros": {},
            "syllable_structure": "(C)V(C)",
            "blacklist_patterns": [],
            "vowel_harmony": {
                "enabled": false,
                "group_a": [],
                "group_b": []
            },
            "tone_system": {
                "enabled": false,
                "tones": []
            }
        },
        "allophony_rules": []
    });
    atomic_write(
        &lang_dir.join("phonology.json"),
        &serde_json::to_string_pretty(&phonology_json).map_err(|e| e.to_string())?,
    )?;

    let mut grammar = GrammarConfig::default();
    grammar.language_id = format!("lang_{}", random_id);
    atomic_write(
        &lang_dir.join("grammar.json"),
        &serde_json::to_string_pretty(&grammar).map_err(|e| e.to_string())?,
    )?;

    let mut sca = SCAConfig::default();
    sca.language_id = format!("lang_{}", random_id);
    atomic_write(
        &lang_dir.join("sca_rules.json"),
        &serde_json::to_string_pretty(&sca).map_err(|e| e.to_string())?,
    )?;

    // Generate .conlang filename: sanitized_name-random8.conlang
    let conlang_filename = format!("{}-{}.conlang", safe_name, random_id);
    let conlang_path = project_root.join(&conlang_filename);

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write(&conlang_path, &content)?;

    let conlang_file_path = conlang_path
        .to_str()
        .ok_or_else(|| "Invalid path encoding".to_string())?
        .to_string();

    Ok(CreateProjectResult {
        config,
        conlang_file_path,
    })
}

/// Copy an entire project to a new location (Save As).
/// Creates a new directory at `dest_dir`, copies all source files,
/// and generates a new .conlang file with the new name.
/// Returns the absolute path to the new .conlang file.
#[command]
pub fn copy_project(
    source_conlang_file_path: String,
    dest_dir: String,
    new_name: String,
) -> Result<String, String> {
    let source_conlang = Path::new(&source_conlang_file_path);
    let source_project_dir = source_conlang
        .parent()
        .ok_or_else(|| "Cannot determine source project directory".to_string())?;

    let dest = Path::new(&dest_dir);
    if dest.exists() {
        return Err(format!(
            "Destination directory already exists: {}",
            dest_dir
        ));
    }

    let source_abs = source_project_dir
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let dest_parent = dest
        .parent()
        .ok_or_else(|| "Invalid destination directory".to_string())?;
    let dest_parent_abs = dest_parent.canonicalize().map_err(|e| e.to_string())?;
    let dest_abs = dest_parent_abs.join(
        dest.file_name()
            .ok_or_else(|| "Invalid destination directory".to_string())?,
    );

    if dest_abs.starts_with(&source_abs) {
        return Err("Destination cannot be inside the source project directory".to_string());
    }

    // Deep copy entire project directory
    copy_dir_recursive(source_project_dir, dest)?;

    // Find and rename the .conlang file in the destination
    let old_conlang_name = source_conlang
        .file_name()
        .ok_or_else(|| "Cannot determine source .conlang filename".to_string())?;
    let old_dest_conlang = dest.join(old_conlang_name);

    // Generate new .conlang filename
    let safe_name = sanitize_filename(&new_name);
    let random_id = generate_short_id();
    let new_conlang_filename = format!("{}-{}.conlang", safe_name, random_id);
    let new_dest_conlang = dest.join(&new_conlang_filename);

    if old_dest_conlang.exists() {
        fs::rename(&old_dest_conlang, &new_dest_conlang).map_err(|e| e.to_string())?;
    }

    new_dest_conlang
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path encoding".to_string())
}

/// Generate an 8-character lowercase alphanumeric ID.
fn generate_short_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut value = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    const CHARS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out: [u8; 8] = [b'0'; 8];
    for i in (0..8).rev() {
        let idx = (value % 36) as usize;
        out[i] = CHARS[idx];
        value /= 36;
    }
    String::from_utf8(out.to_vec()).unwrap_or_else(|_| "00000000".to_string())
}

/// Sanitize a name for use in filenames.
fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || (c >= '\u{4e00}' && c <= '\u{9fff}') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "conlang".to_string()
    } else {
        sanitized
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
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

/// Opens the specified language folder in the system's default file manager.
#[command]
pub fn show_in_folder(project_path: String, language_path: String) -> Result<(), String> {
    use std::process::Command;

    let path = Path::new(&project_path).join(&language_path);
    if !path.exists() {
        return Err(format!("Path does not exist: {:?}", path));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
