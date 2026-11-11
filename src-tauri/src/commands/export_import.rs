use std::fs;
use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};
use base64::Engine;
use tauri::command;
use serde::{Deserialize, Serialize};
use crate::models::{WorkspaceConfig, WordEntry, CorpusText, CorpusIndexEntry, PhonologyConfig, GrammarConfig, SCAConfig};
use crate::commands::lexicon::atomic_write;

/// Bundle format for exporting/importing entire workspace
#[derive(Serialize, Deserialize)]
pub struct WorkspaceBundle {
    #[serde(default)]
    pub bundle_version: u32,
    pub conlang_maker_version: String,
    pub workspace: WorkspaceConfig,
    pub languages: HashMap<String, LanguageBundle>,
}

#[derive(Serialize, Deserialize)]
pub struct LanguageBundle {
    #[serde(default)]
    pub font: Option<FontAsset>,
    pub phonology: serde_json::Value,
    pub grammar: serde_json::Value,
    pub sca: serde_json::Value,
    pub words: Vec<WordEntry>,
    #[serde(default)]
    pub corpus_index: Vec<CorpusIndexEntry>,
    #[serde(default)]
    pub corpus_texts: HashMap<String, CorpusText>,
}

#[derive(Serialize, Deserialize)]
pub struct FontAsset {
    pub file_name: String,
    pub bytes_base64: String,
}

fn configuration_value<T: serde::de::DeserializeOwned + Serialize + Default>(value: &serde_json::Value, name: &str) -> Result<serde_json::Value, String> {
    if value.as_object().is_some_and(|object| object.is_empty()) {
        return serde_json::to_value(T::default()).map_err(|error| error.to_string());
    }
    serde_json::from_value::<T>(value.clone())
        .map_err(|error| format!("Invalid {name} configuration ({error})"))?;
    Ok(value.clone())
}

/// Export entire workspace as a JSON bundle string
#[command]
pub fn export_workspace_bundle(project_path: String, conlang_file_path: String) -> Result<String, String> {
    let _font_guard = super::font::FONT_WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    // 1. Load workspace config
    let ws_path = Path::new(&conlang_file_path);
    let ws_content = fs::read_to_string(ws_path).map_err(|e| e.to_string())?;
    let ws_config: WorkspaceConfig = serde_json::from_str(&ws_content).map_err(|e| e.to_string())?;

    // 2. For each language, read all data
    let mut languages = HashMap::new();
    for lang in &ws_config.languages {
        let lang_dir = super::font::language_dir(&project_path, &lang.path)?;
        let mut font = None;
        for file_name in ["font.otf", "font.ttf"] {
            let path = lang_dir.join(file_name);
            if path.is_file() {
                let bytes = fs::read(path).map_err(|error| error.to_string())?;
                super::font::validate_font_bytes(&bytes)?;
                font = Some(FontAsset { file_name: file_name.to_string(), bytes_base64: super::font::encode_base64(&bytes) });
                break;
            }
        }

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
                            let word = serde_json::from_str::<WordEntry>(line).map_err(|error| format!("Invalid word in {} ({error})", path.display()))?;
                            words.push(word);
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
                corpus_index = serde_json::from_str(&content)
                    .map_err(|error| format!("Invalid corpus index in {} ({error})", index_path.display()))?;
            }
            for idx_entry in &corpus_index {
                let text_path = corpus_dir.join(format!("{}.json", idx_entry.corpus_id));
                let content = fs::read_to_string(&text_path)
                    .map_err(|error| format!("Cannot read corpus {} ({error})", text_path.display()))?;
                let text = serde_json::from_str::<CorpusText>(&content)
                    .map_err(|error| format!("Invalid corpus {} ({error})", text_path.display()))?;
                corpus_texts.insert(idx_entry.corpus_id.clone(), text);
            }
        }

        languages.insert(lang.language_id.clone(), LanguageBundle {
            font,
            phonology: configuration_value::<PhonologyConfig>(&phonology, "phonology")?,
            grammar: configuration_value::<GrammarConfig>(&grammar, "grammar")?,
            sca: configuration_value::<SCAConfig>(&sca, "SCA")?,
            words,
            corpus_index,
            corpus_texts,
        });
    }

    let bundle = WorkspaceBundle {
        bundle_version: 2,
        conlang_maker_version: env!("CARGO_PKG_VERSION").to_string(),
        workspace: ws_config,
        languages,
    };

    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

/// Restore a bundle only after all resources and target paths have been validated.
#[command]
pub fn import_workspace_bundle(project_path: String, conlang_file_path: String, bundle_json: String) -> Result<(), String> {
    static IMPORT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = IMPORT_LOCK.lock().map_err(|error| error.to_string())?;
    let _font_guard = super::font::FONT_WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    let project = Path::new(&project_path);
    let ws_path = Path::new(&conlang_file_path);
    if ws_path.parent() != Some(project) {
        return Err("The workspace file must be inside the imported project".to_string());
    }
    let bundle: WorkspaceBundle = serde_json::from_str(&bundle_json)
        .map_err(|error| format!("Invalid bundle format ({error})"))?;
    if bundle.bundle_version > 2 {
        return Err("This project bundle requires a newer application".to_string());
    }
    let mut files: Vec<(PathBuf, Option<Vec<u8>>)> = Vec::new();
    let mut paths = HashSet::new();
    let mut ids = HashSet::new();
    for language in &bundle.workspace.languages {
        let dir = super::font::language_dir(&project_path, &language.path)?;
        if !paths.insert(dir.clone()) || !ids.insert(language.language_id.clone()) {
            return Err("Bundle contains duplicate language IDs or directories".to_string());
        }
        let data = bundle.languages.get(&language.language_id)
            .ok_or_else(|| format!("Missing language data for {}", language.language_id))?;
        if let Some(font) = &data.font {
            if !["font.otf", "font.ttf"].contains(&font.file_name.as_str()) {
                return Err("Invalid font asset filename".to_string());
            }
            if font.bytes_base64.len() as u64 > super::font::MAX_FONT_BYTES.div_ceil(3) * 4 {
                return Err("Bundled font exceeds the 20 MiB limit".to_string());
            }
            let bytes = base64::engine::general_purpose::STANDARD.decode(&font.bytes_base64)
                .map_err(|error| format!("Invalid bundled font encoding ({error})"))?;
            super::font::validate_font_bytes(&bytes)?;
            files.push((dir.join(&font.file_name), Some(bytes)));
            let other = if font.file_name == "font.otf" { "font.ttf" } else { "font.otf" };
            files.push((dir.join(other), None));
        } else if bundle.bundle_version >= 2 {
            files.push((dir.join("font.otf"), None));
            files.push((dir.join("font.ttf"), None));
        }
        let configurations = [
            ("phonology.json", configuration_value::<PhonologyConfig>(&data.phonology, "phonology")?),
            ("grammar.json", configuration_value::<GrammarConfig>(&data.grammar, "grammar")?),
            ("sca_rules.json", configuration_value::<SCAConfig>(&data.sca, "SCA")?),
        ];
        for (name, value) in configurations {
            files.push((dir.join(name), Some(serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?)));
        }
        let lexicon = dir.join("lexicon");
        let mut buckets: HashMap<String, Vec<String>> = HashMap::new();
        for word in &data.words {
            let first = word.con_word_romanized.chars().next()
                .map(|character| character.to_ascii_lowercase()).unwrap_or('_');
            let name = if first.is_ascii_alphabetic() { format!("lexicon_{first}.ndjson") } else { "lexicon_others.ndjson".to_string() };
            buckets.entry(name).or_default().push(serde_json::to_string(word).map_err(|error| error.to_string())?);
        }
        if lexicon.is_dir() {
            for entry in fs::read_dir(&lexicon).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if entry.path().is_file() && name.starts_with("lexicon_") && name.ends_with(".ndjson") && !buckets.contains_key(&name) {
                    files.push((entry.path(), None));
                }
            }
        }
        for (name, mut lines) in buckets {
            lines.sort();
            files.push((lexicon.join(name), Some((lines.join("\n") + "\n").into_bytes())));
        }
        let corpus = dir.join("corpus");
        let mut corpus_ids = HashSet::new();
        for entry in &data.corpus_index {
            if !corpus_ids.insert(&entry.corpus_id) || !data.corpus_texts.contains_key(&entry.corpus_id) {
                return Err("Corpus index contains duplicate or missing texts".to_string());
            }
        }
        files.push((corpus.join("corpus_index.json"), Some(serde_json::to_vec_pretty(&data.corpus_index).map_err(|error| error.to_string())?)));
        for (id, text) in &data.corpus_texts {
            if id.is_empty() || id.contains('/') || id.contains('\\') || id == "." || id == ".." || text.corpus_id != *id {
                return Err("Invalid corpus ID in bundle".to_string());
            }
            files.push((corpus.join(format!("{id}.json")), Some(serde_json::to_vec_pretty(text).map_err(|error| error.to_string())?)));
        }
    }
    files.push((ws_path.to_path_buf(), Some(serde_json::to_vec_pretty(&bundle.workspace).map_err(|error| error.to_string())?)));
    restore_files(files)
}

fn restore_files(files: Vec<(PathBuf, Option<Vec<u8>>)>) -> Result<(), String> {
    let originals = files.iter().map(|(path, _)| {
        let data = if path.exists() { Some(fs::read(path).map_err(|error| error.to_string())?) } else { None };
        Ok((path.clone(), data))
    }).collect::<Result<Vec<_>, String>>()?;
    for (index, (path, content)) in files.iter().enumerate() {
        let result = match content {
            Some(bytes) => super::font::atomic_write_bytes(path, bytes),
            None if path.exists() => fs::remove_file(path).map_err(|error| error.to_string()),
            None => Ok(()),
        };
        if let Err(error) = result {
            let mut failures = Vec::new();
            for (previous, original) in originals[..index].iter().rev() {
                let restored = match original {
                    Some(bytes) => super::font::atomic_write_bytes(previous, bytes),
                    None if previous.exists() => fs::remove_file(previous).map_err(|error| error.to_string()),
                    None => Ok(()),
                };
                if let Err(rollback) = restored { failures.push(rollback); }
            }
            return Err(format!("Project import failed ({error}). Rollback errors {failures:?}"));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TempProject(PathBuf);

    impl TempProject {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let path = std::env::temp_dir().join(format!("conlang-bundle-{timestamp}-{}", NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> String { self.0.to_string_lossy().into_owned() }
        fn workspace(&self) -> String { self.0.join("family.conlang").to_string_lossy().into_owned() }
    }

    impl Drop for TempProject {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    fn bundle() -> serde_json::Value {
        serde_json::json!({
            "bundle_version": 2,
            "conlang_maker_version": env!("CARGO_PKG_VERSION"),
            "workspace": {
                "workspace_version": "3.0",
                "languages": [{ "language_id": "root", "name": "Root", "path": "root", "parent_id": null }]
            },
            "languages": {
                "root": {
                    "font": {
                        "file_name": "font.ttf",
                        "bytes_base64": super::super::font::encode_base64(include_bytes!("../../tests/fixtures/regular.ttf"))
                    },
                    "phonology": {
                        "language_id": "root",
                        "phoneme_inventory": {"consonants": [], "vowels": []},
                        "phonotactics": {"macros": {}, "syllable_structure": "CV"},
                        "glyph_annotations": [{
                            "codepoint": 59136, "label": "pa", "kind": "base", "phonemes": ["p", "a"]
                        }]
                    },
                    "grammar": {}, "sca": {}, "words": [],
                    "corpus_index": [], "corpus_texts": {}
                }
            }
        })
    }

    #[test]
    fn bundle_round_trip_keeps_font_bytes_and_writing_configuration() {
        let source = TempProject::new();
        import_workspace_bundle(source.path(), source.workspace(), bundle().to_string()).unwrap();
        let exported = export_workspace_bundle(source.path(), source.workspace()).unwrap();
        let target = TempProject::new();
        import_workspace_bundle(target.path(), target.workspace(), exported).unwrap();
        assert_eq!(fs::read(target.0.join("root/font.ttf")).unwrap(), include_bytes!("../../tests/fixtures/regular.ttf"));
        let phonology: serde_json::Value = serde_json::from_slice(&fs::read(target.0.join("root/phonology.json")).unwrap()).unwrap();
        assert_eq!(phonology["glyph_annotations"][0]["label"], "pa");
        let loaded = super::super::phonology::load_phonology(target.path(), "root".to_string()).unwrap();
        assert_eq!(loaded.language_id, "root");
    }

    #[test]
    fn invalid_font_is_rejected_before_any_project_file_is_modified() {
        let project = TempProject::new();
        import_workspace_bundle(project.path(), project.workspace(), bundle().to_string()).unwrap();
        let original = fs::read(project.0.join("root/phonology.json")).unwrap();
        let font = fs::read(project.0.join("root/font.ttf")).unwrap();
        let mut invalid = bundle();
        invalid["languages"]["root"]["font"]["bytes_base64"] = serde_json::json!("T1RUTw==");
        invalid["languages"]["root"]["phonology"] = serde_json::json!({"changed": true});
        assert!(import_workspace_bundle(project.path(), project.workspace(), invalid.to_string()).is_err());
        assert_eq!(fs::read(project.0.join("root/phonology.json")).unwrap(), original);
        assert_eq!(fs::read(project.0.join("root/font.ttf")).unwrap(), font);
    }

    #[test]
    fn old_bundles_remain_readable_and_explicitly_absent_fonts_clear_new_bundle_assets() {
        let project = TempProject::new();
        import_workspace_bundle(project.path(), project.workspace(), bundle().to_string()).unwrap();
        let mut old = bundle();
        old.as_object_mut().unwrap().remove("bundle_version");
        old["languages"]["root"].as_object_mut().unwrap().remove("font");
        import_workspace_bundle(project.path(), project.workspace(), old.to_string()).unwrap();
        assert!(project.0.join("root/font.ttf").is_file());
        old["bundle_version"] = serde_json::json!(2);
        import_workspace_bundle(project.path(), project.workspace(), old.to_string()).unwrap();
        assert!(!project.0.join("root/font.ttf").exists());
    }

    #[test]
    fn failed_import_rolls_back_written_and_deleted_files() {
        let project = TempProject::new();
        let changed = project.0.join("changed.json");
        let removed = project.0.join("removed.ttf");
        let blocked = project.0.join("blocked");
        fs::write(&changed, b"original").unwrap();
        fs::write(&removed, b"font").unwrap();
        fs::write(&blocked, b"file").unwrap();
        let result = restore_files(vec![
            (changed.clone(), Some(b"new".to_vec())),
            (removed.clone(), None),
            (blocked.join("cannot-write.json"), Some(b"fail".to_vec())),
        ]);
        assert!(result.is_err());
        assert_eq!(fs::read(changed).unwrap(), b"original");
        assert_eq!(fs::read(removed).unwrap(), b"font");
    }
    #[test]
    fn malformed_writing_configuration_never_overwrites_a_project() {
        let project = TempProject::new();
        import_workspace_bundle(project.path(), project.workspace(), bundle().to_string()).unwrap();
        let original = fs::read(project.0.join("root/phonology.json")).unwrap();
        for value in [serde_json::Value::Null, serde_json::json!({"glyph_annotations": "invalid"})] {
            let mut invalid = bundle();
            invalid["languages"]["root"]["phonology"] = value;
            assert!(import_workspace_bundle(project.path(), project.workspace(), invalid.to_string()).is_err());
            assert_eq!(fs::read(project.0.join("root/phonology.json")).unwrap(), original);
        }
    }

    #[test]
    fn incomplete_corpus_is_reported_instead_of_exported_as_a_success() {
        let project = TempProject::new();
        import_workspace_bundle(project.path(), project.workspace(), bundle().to_string()).unwrap();
        let corpus = project.0.join("root/corpus");
        fs::write(corpus.join("corpus_index.json"), b"invalid JSON").unwrap();
        assert!(export_workspace_bundle(project.path(), project.workspace()).is_err());
        let index = serde_json::json!([{
            "corpus_id": "missing", "title": "Missing", "line_count": 0,
            "token_count": 0, "created_at": "", "updated_at": ""
        }]);
        fs::write(corpus.join("corpus_index.json"), index.to_string()).unwrap();
        assert!(export_workspace_bundle(project.path(), project.workspace()).is_err());
    }

}
