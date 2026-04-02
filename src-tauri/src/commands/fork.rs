use std::fs;
use std::path::Path;
use std::collections::HashSet;
use tauri::command;
use crate::models::{WorkspaceConfig, LanguageEntry, WordEntry};
use crate::commands::lexicon::atomic_write;

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
                            // Keep inherited entry_id stable across parent/child for deterministic sync.
                            let original_entry_id = word.entry_id.clone();
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

#[derive(serde::Serialize, serde::Deserialize)]
pub struct MigrationStats {
    pub dry_run: bool,
    pub languages_processed: usize,
    pub words_scanned: usize,
    pub parent_link_filled: usize,
    pub source_language_filled: usize,
    pub origin_fixed: usize,
    pub files_changed: usize,
}

fn load_language_entry_ids(project: &Path, language_path: &str) -> Result<HashSet<String>, String> {
    let lexicon_dir = project.join(language_path).join("lexicon");
    let mut ids = HashSet::new();
    if !lexicon_dir.exists() {
        return Ok(ids);
    }

    for entry in fs::read_dir(&lexicon_dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().map_or(false, |e| e == "ndjson") {
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(word) = serde_json::from_str::<WordEntry>(trimmed) {
                    ids.insert(word.entry_id);
                }
            }
        }
    }

    Ok(ids)
}

#[command]
pub fn migrate_inherited_lexicon_links(
    project_path: String,
    conlang_file_path: String,
    dry_run: Option<bool>,
) -> Result<MigrationStats, String> {
    let project = Path::new(&project_path);
    let ws_path = Path::new(&conlang_file_path);

    let ws_config: WorkspaceConfig = if ws_path.exists() {
        let content = fs::read_to_string(ws_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err("Workspace config not found".to_string());
    };

    let is_dry_run = dry_run.unwrap_or(false);

    let mut stats = MigrationStats {
        dry_run: is_dry_run,
        languages_processed: 0,
        words_scanned: 0,
        parent_link_filled: 0,
        source_language_filled: 0,
        origin_fixed: 0,
        files_changed: 0,
    };

    for language in &ws_config.languages {
        let Some(parent_id) = &language.parent_id else {
            continue;
        };
        let Some(parent_lang) = ws_config.languages.iter().find(|l| &l.language_id == parent_id) else {
            continue;
        };

        let parent_ids = load_language_entry_ids(project, &parent_lang.path)?;
        let child_lexicon_dir = project.join(&language.path).join("lexicon");
        if !child_lexicon_dir.exists() {
            continue;
        }

        stats.languages_processed += 1;

        for entry in fs::read_dir(&child_lexicon_dir).map_err(|e| e.to_string())? {
            let file_path = entry.map_err(|e| e.to_string())?.path();
            if !file_path.extension().map_or(false, |e| e == "ndjson") {
                continue;
            }

            let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
            let mut file_changed = false;
            let mut new_lines: Vec<String> = Vec::new();

            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                match serde_json::from_str::<WordEntry>(trimmed) {
                    Ok(mut word) => {
                        let mut line_changed = false;
                        stats.words_scanned += 1;

                        let inherited_by_id = parent_ids.contains(&word.entry_id);
                        let has_parent_link = word.etymology.parent_entry_id.is_some();

                        if inherited_by_id && !has_parent_link {
                            word.etymology.parent_entry_id = Some(word.entry_id.clone());
                            stats.parent_link_filled += 1;
                            line_changed = true;
                        }

                        let linked_to_self =
                            word.etymology.parent_entry_id.as_deref() == Some(word.entry_id.as_str());

                        if inherited_by_id && linked_to_self && word.etymology.source_language_id.is_none() {
                            word.etymology.source_language_id = Some(parent_id.clone());
                            stats.source_language_filled += 1;
                            line_changed = true;
                        }

                        if inherited_by_id
                            && linked_to_self
                            && word.etymology.origin_type == "a_priori"
                        {
                            word.etymology.origin_type = "evolved".to_string();
                            stats.origin_fixed += 1;
                            line_changed = true;
                        }

                        if line_changed {
                            file_changed = true;
                            if let Ok(serialized) = serde_json::to_string(&word) {
                                new_lines.push(serialized);
                            } else {
                                new_lines.push(trimmed.to_string());
                            }
                        } else {
                            new_lines.push(trimmed.to_string());
                        }
                    }
                    Err(_) => {
                        new_lines.push(trimmed.to_string());
                    }
                }
            }

            if file_changed {
                stats.files_changed += 1;
                let new_content = if new_lines.is_empty() {
                    String::new()
                } else {
                    new_lines.join("\n") + "\n"
                };
                if !is_dry_run {
                    atomic_write(&file_path, &new_content)?;
                }
            }
        }
    }

    Ok(stats)
}
