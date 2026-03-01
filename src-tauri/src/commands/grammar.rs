use std::fs;
use std::path::Path;
use tauri::command;
use crate::models::GrammarConfig;
use crate::commands::lexicon::atomic_write;

#[command]
pub fn load_grammar(project_path: String, language_path: String) -> Result<GrammarConfig, String> {
    let path = Path::new(&project_path).join(&language_path).join("grammar.json");
    if !path.exists() {
        return Ok(GrammarConfig::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[command]
pub fn save_grammar(project_path: String, language_path: String, config: GrammarConfig) -> Result<(), String> {
    let dir = Path::new(&project_path).join(&language_path);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("grammar.json");
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write(&path, &content)
}
