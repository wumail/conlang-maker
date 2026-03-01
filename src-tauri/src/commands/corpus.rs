use std::fs;
use std::path::Path;
use tauri::command;
use crate::models::{CorpusText, CorpusIndexEntry, CorpusTextMeta};
use crate::commands::lexicon::atomic_write;

/// Load corpus index (list of all corpus texts with metadata only)
#[command]
pub fn load_corpus_index(project_path: String, language_path: String) -> Result<Vec<CorpusIndexEntry>, String> {
    let corpus_dir = Path::new(&project_path).join(&language_path).join("corpus");
    if !corpus_dir.exists() {
        return Ok(Vec::new());
    }

    let index_path = corpus_dir.join("corpus_index.json");
    if !index_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
    let entries: Vec<CorpusIndexEntry> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(entries)
}

/// Load a single corpus text by ID
#[command]
pub fn load_corpus_text(project_path: String, language_path: String, corpus_id: String) -> Result<CorpusText, String> {
    let corpus_dir = Path::new(&project_path).join(&language_path).join("corpus");
    let file_path = corpus_dir.join(format!("{}.json", corpus_id));

    if !file_path.exists() {
        return Err(format!("Corpus text '{}' not found", corpus_id));
    }

    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Save a corpus text (create or update) and update the index
#[command]
pub fn save_corpus_text(project_path: String, language_path: String, text: CorpusText) -> Result<(), String> {
    let corpus_dir = Path::new(&project_path).join(&language_path).join("corpus");
    fs::create_dir_all(&corpus_dir).map_err(|e| e.to_string())?;

    // Save the individual corpus file
    let file_path = corpus_dir.join(format!("{}.json", text.corpus_id));
    let content = serde_json::to_string_pretty(&text).map_err(|e| e.to_string())?;
    atomic_write(&file_path, &content)?;

    // Update the index
    let index_path = corpus_dir.join("corpus_index.json");
    let mut index: Vec<CorpusIndexEntry> = if index_path.exists() {
        let idx_content = fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&idx_content).unwrap_or_default()
    } else {
        Vec::new()
    };

    // Upsert index entry
    let new_entry = CorpusIndexEntry {
        corpus_id: text.corpus_id.clone(),
        title: text.title.clone(),
        description: text.description.clone(),
        metadata: CorpusTextMeta {
            tags: text.metadata.tags.clone(),
            created_at: text.metadata.created_at.clone(),
            updated_at: text.metadata.updated_at.clone(),
        },
    };

    if let Some(pos) = index.iter().position(|e| e.corpus_id == text.corpus_id) {
        index[pos] = new_entry;
    } else {
        index.push(new_entry);
    }

    // Sort index by corpus_id for deterministic serialization
    index.sort_by(|a, b| a.corpus_id.cmp(&b.corpus_id));

    let idx_content = serde_json::to_string_pretty(&index).map_err(|e| e.to_string())?;
    atomic_write(&index_path, &idx_content)?;

    Ok(())
}

/// Delete a corpus text and update the index
#[command]
pub fn delete_corpus_text(project_path: String, language_path: String, corpus_id: String) -> Result<(), String> {
    let corpus_dir = Path::new(&project_path).join(&language_path).join("corpus");

    // Delete the individual file
    let file_path = corpus_dir.join(format!("{}.json", corpus_id));
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }

    // Update the index
    let index_path = corpus_dir.join("corpus_index.json");
    if index_path.exists() {
        let idx_content = fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
        let mut index: Vec<CorpusIndexEntry> = serde_json::from_str(&idx_content).unwrap_or_default();
        index.retain(|e| e.corpus_id != corpus_id);
        let idx_content = serde_json::to_string_pretty(&index).map_err(|e| e.to_string())?;
        atomic_write(&index_path, &idx_content)?;
    }

    Ok(())
}
