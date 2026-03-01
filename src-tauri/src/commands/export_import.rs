use std::fs;
use std::path::Path;
use std::collections::HashMap;
use tauri::command;
use serde::{Deserialize, Serialize};
use crate::models::{WorkspaceConfig, WordEntry, CorpusText, CorpusIndexEntry};
use crate::commands::lexicon::atomic_write;

/// Bundle format for exporting/importing entire workspace
#[derive(Serialize, Deserialize)]
pub struct WorkspaceBundle {
    pub conlang_maker_version: String,
    pub workspace: WorkspaceConfig,
    pub languages: HashMap<String, LanguageBundle>,
}

#[derive(Serialize, Deserialize)]
pub struct LanguageBundle {
    pub phonology: serde_json::Value,
    pub grammar: serde_json::Value,
    pub sca: serde_json::Value,
    pub words: Vec<WordEntry>,
    #[serde(default)]
    pub corpus_index: Vec<CorpusIndexEntry>,
    #[serde(default)]
    pub corpus_texts: HashMap<String, CorpusText>,
}

/// Export entire workspace as a JSON bundle string
#[command]
pub fn export_workspace_bundle(project_path: String, conlang_file_path: String) -> Result<String, String> {
    let project = Path::new(&project_path);

    // 1. Load workspace config
    let ws_path = Path::new(&conlang_file_path);
    let ws_content = fs::read_to_string(ws_path).map_err(|e| e.to_string())?;
    let ws_config: WorkspaceConfig = serde_json::from_str(&ws_content).map_err(|e| e.to_string())?;

    // 2. For each language, read all data
    let mut languages = HashMap::new();
    for lang in &ws_config.languages {
        let lang_dir = project.join(&lang.path);

        // Phonology
        let phono_path = lang_dir.join("phonology.json");
        let phonology: serde_json::Value = if phono_path.exists() {
            let content = fs::read_to_string(&phono_path).map_err(|e| e.to_string())?;
            serde_json::from_str(&content).map_err(|e| e.to_string())?
        } else {
            serde_json::Value::Object(serde_json::Map::new())
        };

        // Grammar
        let grammar_path = lang_dir.join("grammar.json");
        let grammar: serde_json::Value = if grammar_path.exists() {
            let content = fs::read_to_string(&grammar_path).map_err(|e| e.to_string())?;
            serde_json::from_str(&content).map_err(|e| e.to_string())?
        } else {
            serde_json::Value::Object(serde_json::Map::new())
        };

        // SCA
        let sca_path = lang_dir.join("sca_rules.json");
        let sca: serde_json::Value = if sca_path.exists() {
            let content = fs::read_to_string(&sca_path).map_err(|e| e.to_string())?;
            serde_json::from_str(&content).map_err(|e| e.to_string())?
        } else {
            serde_json::Value::Object(serde_json::Map::new())
        };

        // Lexicon (all NDJSON files)
        let lexicon_dir = lang_dir.join("lexicon");
        let mut words: Vec<WordEntry> = Vec::new();
        if lexicon_dir.exists() {
            for entry in fs::read_dir(&lexicon_dir).map_err(|e| e.to_string())? {
                let path = entry.map_err(|e| e.to_string())?.path();
                if path.extension().map_or(false, |e| e == "ndjson") {
                    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                    for line in content.lines() {
                        let line = line.trim();
                        if !line.is_empty() {
                            if let Ok(word) = serde_json::from_str::<WordEntry>(line) {
                                words.push(word);
                            }
                        }
                    }
                }
            }
        }

        // Corpus
        let corpus_dir = lang_dir.join("corpus");
        let mut corpus_index: Vec<CorpusIndexEntry> = Vec::new();
        let mut corpus_texts: HashMap<String, CorpusText> = HashMap::new();
        if corpus_dir.exists() {
            let index_path = corpus_dir.join("corpus_index.json");
            if index_path.exists() {
                let content = fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
                corpus_index = serde_json::from_str(&content).unwrap_or_default();
            }
            for idx_entry in &corpus_index {
                let text_path = corpus_dir.join(format!("{}.json", idx_entry.corpus_id));
                if text_path.exists() {
                    let content = fs::read_to_string(&text_path).map_err(|e| e.to_string())?;
                    if let Ok(text) = serde_json::from_str::<CorpusText>(&content) {
                        corpus_texts.insert(idx_entry.corpus_id.clone(), text);
                    }
                }
            }
        }

        languages.insert(lang.language_id.clone(), LanguageBundle {
            phonology,
            grammar,
            sca,
            words,
            corpus_index,
            corpus_texts,
        });
    }

    let bundle = WorkspaceBundle {
        conlang_maker_version: "1.0".to_string(),
        workspace: ws_config,
        languages,
    };

    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

/// Import a workspace bundle JSON string, writing all files to disk
#[command]
pub fn import_workspace_bundle(project_path: String, conlang_file_path: String, bundle_json: String) -> Result<(), String> {
    let project = Path::new(&project_path);
    let bundle: WorkspaceBundle = serde_json::from_str(&bundle_json).map_err(|e| format!("Invalid bundle format: {}", e))?;

    // 1. Write workspace config
    let ws_path = Path::new(&conlang_file_path);
    let ws_content = serde_json::to_string_pretty(&bundle.workspace).map_err(|e| e.to_string())?;
    atomic_write(ws_path, &ws_content)?;

    // 2. Write each language's data
    for lang in &bundle.workspace.languages {
        let lang_dir = project.join(&lang.path);
        fs::create_dir_all(&lang_dir).map_err(|e| e.to_string())?;

        let lang_bundle = match bundle.languages.get(&lang.language_id) {
            Some(b) => b,
            None => continue,
        };

        // Phonology
        let phono_content = serde_json::to_string_pretty(&lang_bundle.phonology).map_err(|e| e.to_string())?;
        atomic_write(&lang_dir.join("phonology.json"), &phono_content)?;

        // Grammar
        let grammar_content = serde_json::to_string_pretty(&lang_bundle.grammar).map_err(|e| e.to_string())?;
        atomic_write(&lang_dir.join("grammar.json"), &grammar_content)?;

        // SCA
        let sca_content = serde_json::to_string_pretty(&lang_bundle.sca).map_err(|e| e.to_string())?;
        atomic_write(&lang_dir.join("sca_rules.json"), &sca_content)?;

        // Lexicon — write words into NDJSON buckets
        let lexicon_dir = lang_dir.join("lexicon");
        fs::create_dir_all(&lexicon_dir).map_err(|e| e.to_string())?;

        // Group words by bucket
        let mut buckets: HashMap<String, Vec<String>> = HashMap::new();
        for word in &lang_bundle.words {
            let first_char = word.con_word_romanized.chars().next()
                .map(|c| c.to_lowercase().next().unwrap_or('_'))
                .unwrap_or('_');
            let bucket_name = if first_char.is_ascii_alphabetic() {
                format!("lexicon_{}.ndjson", first_char)
            } else {
                "lexicon_others.ndjson".to_string()
            };
            let json_line = serde_json::to_string(word).map_err(|e| e.to_string())?;
            buckets.entry(bucket_name).or_default().push(json_line);
        }
        for (filename, lines) in &buckets {
            let content = lines.join("\n") + "\n";
            atomic_write(&lexicon_dir.join(filename), &content)?;
        }

        // Corpus
        if !lang_bundle.corpus_index.is_empty() {
            let corpus_dir = lang_dir.join("corpus");
            fs::create_dir_all(&corpus_dir).map_err(|e| e.to_string())?;

            let index_content = serde_json::to_string_pretty(&lang_bundle.corpus_index).map_err(|e| e.to_string())?;
            atomic_write(&corpus_dir.join("corpus_index.json"), &index_content)?;

            for (corpus_id, text) in &lang_bundle.corpus_texts {
                let text_content = serde_json::to_string_pretty(text).map_err(|e| e.to_string())?;
                atomic_write(&corpus_dir.join(format!("{}.json", corpus_id)), &text_content)?;
            }
        }
    }

    Ok(())
}

/// Write text content to a file path (used with frontend dialog for export)
#[command]
pub fn write_text_file(file_path: String, content: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    atomic_write(path, &content)
}
