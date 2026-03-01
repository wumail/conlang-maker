use std::fs;
use std::path::Path;
use tauri::command;
use crate::models::{PhonologyConfig, PhonemeInventory, Phonotactics, VowelHarmony, ToneSystem};
use crate::commands::lexicon::atomic_write;

#[command]
pub fn load_phonology(project_path: String, language_path: String) -> Result<PhonologyConfig, String> {
    let path = Path::new(&project_path).join(&language_path).join("phonology.json");
    if !path.exists() {
        return Ok(PhonologyConfig {
            language_id: "lang_proto".to_string(),
            phoneme_inventory: PhonemeInventory {
                consonants: Vec::new(),
                vowels: Vec::new(),
            },
            romanization_maps: Vec::new(),
            phonotactics: Phonotactics {
                macros: std::collections::HashMap::new(),
                syllable_structure: "(C)V(C)".to_string(),
                blacklist_patterns: Vec::new(),
                vowel_harmony: VowelHarmony::default(),
                tone_system: ToneSystem::default(),
            },
            allophony_rules: Vec::new(),
        });
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[command]
pub fn save_phonology(project_path: String, language_path: String, config: PhonologyConfig) -> Result<(), String> {
    let dir = Path::new(&project_path).join(&language_path);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("phonology.json");
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write(&path, &content)
}
