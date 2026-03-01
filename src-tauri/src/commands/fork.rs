use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;
use crate::models::{WorkspaceConfig, LanguageEntry, WordEntry};
use crate::commands::lexicon::atomic_write;

/// Generate a unique entry_id (mirrors frontend's crypto.randomUUID style)
fn generate_entry_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("entry_{}_{}", ts, seq)
}

/// Copy a directory recursively
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
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

#[command]
pub fn fork_language(
    project_path: String,
    conlang_file_path: String,
    parent_id: String,
    new_name: String,
    new_id: String,
    new_path: String,
) -> Result<(), String> {
    let project = Path::new(&project_path);
    let ws_path = Path::new(&conlang_file_path);

    // 1. Load workspace config to find parent path
    let ws_config: WorkspaceConfig = if ws_path.exists() {
        let content = fs::read_to_string(ws_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        WorkspaceConfig::default()
    };

    let parent_entry = ws_config
        .languages
        .iter()
        .find(|l| l.language_id == parent_id)
        .ok_or_else(|| format!("Parent language '{}' not found in workspace", parent_id))?;

    let parent_dir = project.join(&parent_entry.path);
    let new_dir = project.join(&new_path);

    if new_dir.exists() {
        return Err(format!("Directory '{}' already exists", new_path));
    }

    // 2. Copy phonology.json
    let phono_src = parent_dir.join("phonology.json");
    fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
    if phono_src.exists() {
        let content = fs::read_to_string(&phono_src).map_err(|e| e.to_string())?;
        let updated = content.replace(
            &format!("\"language_id\":\"{}\",", parent_id),
            &format!("\"language_id\":\"{}\",", new_id),
        );
        // Use serde to properly update language_id
        if let Ok(mut phono) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(obj) = phono.as_object_mut() {
                obj.insert("language_id".to_string(), serde_json::Value::String(new_id.clone()));
            }
            let pretty = serde_json::to_string_pretty(&phono).map_err(|e| e.to_string())?;
            atomic_write(&new_dir.join("phonology.json"), &pretty)?;
        } else {
            // fallback: write as-is with string replacement
            atomic_write(&new_dir.join("phonology.json"), &updated)?;
        }
    }

    // 3. Copy grammar.json
    let grammar_src = parent_dir.join("grammar.json");
    if grammar_src.exists() {
        let content = fs::read_to_string(&grammar_src).map_err(|e| e.to_string())?;
        if let Ok(mut grammar) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(obj) = grammar.as_object_mut() {
                obj.insert("language_id".to_string(), serde_json::Value::String(new_id.clone()));
            }
            let pretty = serde_json::to_string_pretty(&grammar).map_err(|e| e.to_string())?;
            atomic_write(&new_dir.join("grammar.json"), &pretty)?;
        }
    }

    // 4. Create empty sca_rules.json for the new language
    let sca_content = format!(
        "{{\"language_id\":\"{}\",\"rule_sets\":[]}}",
        new_id
    );
    let sca_pretty: serde_json::Value = serde_json::from_str(&sca_content).map_err(|e| e.to_string())?;
    atomic_write(
        &new_dir.join("sca_rules.json"),
        &serde_json::to_string_pretty(&sca_pretty).map_err(|e| e.to_string())?,
    )?;

    // 5. Copy lexicon/ and update word entries
    let lexicon_src = parent_dir.join("lexicon");
    let lexicon_dst = new_dir.join("lexicon");
    if lexicon_src.exists() {
        fs::create_dir_all(&lexicon_dst).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(&lexicon_src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let src_file = entry.path();
            if src_file.extension().map_or(false, |e| e == "ndjson") {
                let content = fs::read_to_string(&src_file).map_err(|e| e.to_string())?;
                let mut updated_lines: Vec<String> = Vec::new();
                for line in content.lines() {
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<WordEntry>(line) {
                        Ok(mut word) => {
                            // Generate new entry_id for child; keep original as parent reference
                            let original_entry_id = word.entry_id.clone();
                            word.entry_id = generate_entry_id();
                            word.language_id = new_id.clone();
                            word.etymology.origin_type = "evolved".to_string();
                            word.etymology.parent_entry_id = Some(original_entry_id);
                            word.etymology.source_language_id = Some(parent_id.clone());
                            if let Ok(json) = serde_json::to_string(&word) {
                                updated_lines.push(json);
                            }
                        }
                        Err(e) => {
                            eprintln!("Fork: skipping malformed word entry: {}", e);
                        }
                    }
                }
                if !updated_lines.is_empty() {
                    let new_content = updated_lines.join("\n") + "\n";
                    let dst_file = lexicon_dst.join(entry.file_name());
                    atomic_write(&dst_file, &new_content)?;
                }
            }
        }
    }

    // 6. Copy corpus/ directory (if exists)
    let corpus_src = parent_dir.join("corpus");
    let corpus_dst = new_dir.join("corpus");
    if corpus_src.exists() {
        copy_dir_recursive(&corpus_src, &corpus_dst)?;
    }

    // 7. Update workspace config
    let mut updated_ws = ws_config;
    updated_ws.languages.push(LanguageEntry {
        language_id: new_id,
        name: new_name,
        path: new_path,
        parent_id: Some(parent_id),
    });
    let ws_content = serde_json::to_string_pretty(&updated_ws).map_err(|e| e.to_string())?;
    atomic_write(ws_path, &ws_content)?;

    Ok(())
}

/// Delete a language and its data directory
fn remove_dir_recursive(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
pub fn delete_language(
    project_path: String,
    conlang_file_path: String,
    language_id: String,
) -> Result<(), String> {
    let project = Path::new(&project_path);
    let ws_path = Path::new(&conlang_file_path);

    // 1. Load workspace config
    let ws_config: WorkspaceConfig = if ws_path.exists() {
        let content = fs::read_to_string(ws_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err("Workspace config not found".to_string());
    };

    // 2. Find the language entry
    let lang_entry = ws_config
        .languages
        .iter()
        .find(|l| l.language_id == language_id)
        .ok_or_else(|| format!("Language '{}' not found in workspace", language_id))?;

    // 3. Prevent deleting languages that have children
    let has_children = ws_config
        .languages
        .iter()
        .any(|l| l.parent_id.as_deref() == Some(&language_id));
    if has_children {
        return Err("Cannot delete a language that has child languages. Delete children first.".to_string());
    }

    // 4. Prevent deleting the last language
    if ws_config.languages.len() <= 1 {
        return Err("Cannot delete the last language in the workspace.".to_string());
    }

    // 5. Delete data directory
    let lang_dir = project.join(&lang_entry.path);
    remove_dir_recursive(&lang_dir)?;

    // 6. Update workspace config — remove the language entry
    let mut updated_ws = ws_config;
    updated_ws.languages.retain(|l| l.language_id != language_id);
    let ws_content = serde_json::to_string_pretty(&updated_ws).map_err(|e| e.to_string())?;
    atomic_write(ws_path, &ws_content)?;

    Ok(())
}
