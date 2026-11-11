use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::command;

use crate::commands::oplog::record_project_snapshot_in_tx;
use crate::commands::transaction::{
    execute_project_transaction, with_consistent_read, PlannedMutation, RevisionExpectation,
    TransactionPlan,
};
use crate::models::{
    CorpusIndexEntry, CorpusText, ExtraFields, GrammarConfig, PhonologyConfig, SCAConfig,
    WordEntry, WorkspaceConfig, WriteResult,
};
use crate::utils::fs_util::atomic_write;
use crate::utils::revision::{file_revision, normalize_rel_path};

/// Bundle format for exporting/importing entire workspace
#[derive(Serialize, Deserialize)]
pub struct WorkspaceBundle {
    #[serde(default)]
    pub bundle_version: u32,
    pub conlang_maker_version: String,
    pub workspace: WorkspaceConfig,
    pub languages: HashMap<String, LanguageBundle>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
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
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Serialize, Deserialize)]
pub struct FontAsset {
    pub file_name: String,
    pub bytes_base64: String,
}

fn configuration_value<T: serde::de::DeserializeOwned + Serialize + Default>(
    value: &serde_json::Value,
    name: &str,
) -> Result<serde_json::Value, String> {
    if value.as_object().is_some_and(|object| object.is_empty()) {
        return serde_json::to_value(T::default()).map_err(|error| error.to_string());
    }
    serde_json::from_value::<T>(value.clone())
        .map_err(|error| format!("Invalid {name} configuration ({error})"))?;
    Ok(value.clone())
}

/// Export entire workspace as a JSON bundle string inside a consistent read view.
#[command]
pub fn export_workspace_bundle(
    project_path: String,
    conlang_file_path: String,
) -> Result<String, String> {
    let _font_guard = super::font::FONT_WRITE_LOCK
        .lock()
        .map_err(|error| error.to_string())?;
    let project = Path::new(&project_path);

    with_consistent_read(project, "export_workspace_bundle", true, None, |_, _| {
        let ws_path = Path::new(&conlang_file_path);
        let ws_content = fs::read_to_string(ws_path).map_err(|e| e.to_string())?;
        let ws_config: WorkspaceConfig =
            serde_json::from_str(&ws_content).map_err(|e| e.to_string())?;

        let mut languages = HashMap::new();
        for lang in &ws_config.languages {
            let lang_dir = super::font::language_dir(&project_path, &lang.path)?;
            let mut font = None;
            for file_name in ["font.otf", "font.ttf"] {
                let path = lang_dir.join(file_name);
                if path.is_file() {
                    let bytes = fs::read(path).map_err(|error| error.to_string())?;
                    super::font::validate_font_bytes(&bytes)?;
                    font = Some(FontAsset {
                        file_name: file_name.to_string(),
                        bytes_base64: super::font::encode_base64(&bytes),
                    });
                    break;
                }
            }

            let phono_path = lang_dir.join("phonology.json");
            let phonology: serde_json::Value = if phono_path.exists() {
                let content = fs::read_to_string(&phono_path).map_err(|e| e.to_string())?;
                serde_json::from_str(&content).map_err(|e| e.to_string())?
            } else {
                serde_json::Value::Object(serde_json::Map::new())
            };

            let grammar_path = lang_dir.join("grammar.json");
            let grammar: serde_json::Value = if grammar_path.exists() {
                let content = fs::read_to_string(&grammar_path).map_err(|e| e.to_string())?;
                serde_json::from_str(&content).map_err(|e| e.to_string())?
            } else {
                serde_json::Value::Object(serde_json::Map::new())
            };

            let sca_path = lang_dir.join("sca_rules.json");
            let sca: serde_json::Value = if sca_path.exists() {
                let content = fs::read_to_string(&sca_path).map_err(|e| e.to_string())?;
                serde_json::from_str(&content).map_err(|e| e.to_string())?
            } else {
                serde_json::Value::Object(serde_json::Map::new())
            };

            let lexicon_dir = lang_dir.join("lexicon");
            let mut words: Vec<WordEntry> = Vec::new();
            if lexicon_dir.exists() {
                let mut entries: Vec<fs::DirEntry> = Vec::new();
                for e in fs::read_dir(&lexicon_dir).map_err(|e| e.to_string())? {
                    entries.push(e.map_err(|e| e.to_string())?);
                }
                entries.sort_by_key(|e| e.file_name());
                for entry in entries {
                    let path = entry.path();
                    if path.extension().is_some_and(|e| e == "ndjson") {
                        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                        for line in content.lines() {
                            let line = line.trim();
                            if !line.is_empty() {
                                let word =
                                    serde_json::from_str::<WordEntry>(line).map_err(|error| {
                                        format!("Invalid word in {} ({error})", path.display())
                                    })?;
                                words.push(word);
                            }
                        }
                    }
                }
            }

            let corpus_dir = lang_dir.join("corpus");
            let mut corpus_index: Vec<CorpusIndexEntry> = Vec::new();
            let mut corpus_texts: HashMap<String, CorpusText> = HashMap::new();
            if corpus_dir.exists() {
                let index_path = corpus_dir.join("corpus_index.json");
                if index_path.exists() {
                    let content = fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
                    corpus_index = serde_json::from_str(&content).map_err(|error| {
                        format!("Invalid corpus index in {} ({error})", index_path.display())
                    })?;
                }
                for idx_entry in &corpus_index {
                    let text_path = corpus_dir.join(format!("{}.json", idx_entry.corpus_id));
                    let content = fs::read_to_string(&text_path).map_err(|error| {
                        format!("Cannot read corpus {} ({error})", text_path.display())
                    })?;
                    let text = serde_json::from_str::<CorpusText>(&content).map_err(|error| {
                        format!("Invalid corpus {} ({error})", text_path.display())
                    })?;
                    corpus_texts.insert(idx_entry.corpus_id.clone(), text);
                }
            }

            languages.insert(
                lang.language_id.clone(),
                LanguageBundle {
                    font,
                    phonology: configuration_value::<PhonologyConfig>(&phonology, "phonology")?,
                    grammar: configuration_value::<GrammarConfig>(&grammar, "grammar")?,
                    sca: configuration_value::<SCAConfig>(&sca, "SCA")?,
                    words,
                    corpus_index,
                    corpus_texts,
                    extra: ExtraFields::new(),
                },
            );
        }

        let bundle = WorkspaceBundle {
            bundle_version: 2,
            conlang_maker_version: env!("CARGO_PKG_VERSION").to_string(),
            workspace: ws_config,
            languages,
            extra: ExtraFields::new(),
        };

        serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
    })
}

/// Restore a bundle atomically inside a project transaction after all resources
/// and target paths have been validated (`T1.15`, `T4.5`).
#[command]
pub fn import_workspace_bundle(
    project_path: String,
    conlang_file_path: String,
    bundle_json: String,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    static IMPORT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = IMPORT_LOCK.lock().map_err(|error| error.to_string())?;
    let _font_guard = super::font::FONT_WRITE_LOCK
        .lock()
        .map_err(|error| error.to_string())?;

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

    // Validate all bundle assets UPFRONT before starting a transaction on disk!
    struct ValidatedLangPlan {
        rel_path: String,
        writes: Vec<(String, Vec<u8>)>,
        deletes: Vec<String>,
        keep_buckets: HashSet<String>,
        keep_corpora: HashSet<String>,
    }

    let mut lang_plans: Vec<ValidatedLangPlan> = Vec::new();
    let mut paths = HashSet::new();
    let mut ids = HashSet::new();

    for language in &bundle.workspace.languages {
        let dir = super::font::language_dir(&project_path, &language.path)?;
        if !paths.insert(dir.clone()) || !ids.insert(language.language_id.clone()) {
            return Err("Bundle contains duplicate language IDs or directories".to_string());
        }
        let lang_rel = normalize_rel_path(&language.path)?;
        let data = bundle
            .languages
            .get(&language.language_id)
            .ok_or_else(|| format!("Missing language data for {}", language.language_id))?;

        let mut writes: Vec<(String, Vec<u8>)> = Vec::new();
        let mut deletes: Vec<String> = Vec::new();

        if let Some(font) = &data.font {
            if !["font.otf", "font.ttf"].contains(&font.file_name.as_str()) {
                return Err("Invalid font asset filename".to_string());
            }
            if font.bytes_base64.len() as u64 > super::font::MAX_FONT_BYTES.div_ceil(3) * 4 {
                return Err("Bundled font exceeds the 20 MiB limit".to_string());
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&font.bytes_base64)
                .map_err(|error| format!("Invalid bundled font encoding ({error})"))?;
            super::font::validate_font_bytes(&bytes)?;
            writes.push((format!("{lang_rel}/{}", font.file_name), bytes));
            let other = if font.file_name == "font.otf" {
                "font.ttf"
            } else {
                "font.otf"
            };
            deletes.push(format!("{lang_rel}/{other}"));
        } else if bundle.bundle_version >= 2 {
            deletes.push(format!("{lang_rel}/font.otf"));
            deletes.push(format!("{lang_rel}/font.ttf"));
        }

        let configurations = [
            (
                "phonology.json",
                configuration_value::<PhonologyConfig>(&data.phonology, "phonology")?,
            ),
            (
                "grammar.json",
                configuration_value::<GrammarConfig>(&data.grammar, "grammar")?,
            ),
            (
                "sca_rules.json",
                configuration_value::<SCAConfig>(&data.sca, "SCA")?,
            ),
        ];
        for (name, value) in configurations {
            let bytes = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
            writes.push((format!("{lang_rel}/{name}"), bytes));
        }

        let mut buckets: HashMap<String, Vec<WordEntry>> = HashMap::new();
        for word in &data.words {
            let first = word
                .con_word_romanized
                .chars()
                .next()
                .and_then(|c| c.to_lowercase().next())
                .unwrap_or('_');
            let name = if first.is_ascii_alphabetic() {
                format!("lexicon_{first}.ndjson")
            } else {
                "lexicon_others.ndjson".to_string()
            };
            buckets.entry(name).or_default().push(word.clone());
        }

        let keep_buckets: HashSet<String> = buckets.keys().cloned().collect();
        let mut bucket_names: Vec<String> = buckets.keys().cloned().collect();
        bucket_names.sort();
        for name in bucket_names {
            if let Some(mut bwords) = buckets.remove(&name) {
                bwords.sort_by(|a, b| a.con_word_romanized.cmp(&b.con_word_romanized));
                let mut lines = Vec::with_capacity(bwords.len());
                for w in &bwords {
                    lines.push(serde_json::to_string(w).map_err(|error| error.to_string())?);
                }
                writes.push((
                    format!("{lang_rel}/lexicon/{name}"),
                    (lines.join("\n") + "\n").into_bytes(),
                ));
            }
        }

        let mut corpus_ids = HashSet::new();
        for entry in &data.corpus_index {
            if !corpus_ids.insert(&entry.corpus_id)
                || !data.corpus_texts.contains_key(&entry.corpus_id)
            {
                return Err("Corpus index contains duplicate or missing texts".to_string());
            }
        }
        writes.push((
            format!("{lang_rel}/corpus/corpus_index.json"),
            serde_json::to_vec_pretty(&data.corpus_index).map_err(|error| error.to_string())?,
        ));
        let mut keep_corpora: HashSet<String> = HashSet::new();
        keep_corpora.insert("corpus_index.json".to_string());
        for (id, text) in &data.corpus_texts {
            if id.is_empty()
                || id.contains('/')
                || id.contains('\\')
                || id == "."
                || id == ".."
                || text.corpus_id != *id
            {
                return Err("Invalid corpus ID in bundle".to_string());
            }
            let fname = format!("{id}.json");
            keep_corpora.insert(fname.clone());
            writes.push((
                format!("{lang_rel}/corpus/{fname}"),
                serde_json::to_vec_pretty(text).map_err(|error| error.to_string())?,
            ));
        }

        lang_plans.push(ValidatedLangPlan {
            rel_path: lang_rel,
            writes,
            deletes,
            keep_buckets,
            keep_corpora,
        });
    }

    let ws_bytes =
        serde_json::to_vec_pretty(&bundle.workspace).map_err(|error| error.to_string())?;
    let ws_fname = ws_path
        .file_name()
        .ok_or_else(|| "Invalid workspace filename".to_string())?
        .to_string_lossy()
        .into_owned();
    let ws_rel = normalize_rel_path(&ws_fname)?;

    let bundle_sha = crate::utils::revision::sha256_hex(bundle_json.as_bytes());
    let payload = serde_json::json!({
        "conlang_file_path": &conlang_file_path,
        "bundle_sha256": bundle_sha,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project,
        "import_workspace_bundle",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let ws_abs = proj.join(&ws_rel);
            let mut mutations: Vec<PlannedMutation> = Vec::new();
            let mut snap_id: Option<String> = None;

            // Take automatic project snapshot if importing over an existing workspace (§3.6 / T4.5)
            if ws_abs.is_file() {
                let (sid, _) = record_project_snapshot_in_tx(
                    proj,
                    Some(&conlang_file_path),
                    "gui",
                    "import_workspace_bundle",
                    "Before importing workspace bundle",
                    None,
                    &HashSet::new(),
                    &mut mutations,
                )?;
                snap_id = Some(sid);

                // Remove directories of languages that existed in old `.conlang` but are absent in imported bundle
                if let Ok(old_ws_text) = fs::read_to_string(&ws_abs) {
                    if let Ok(old_ws) = serde_json::from_str::<WorkspaceConfig>(&old_ws_text) {
                        let new_rels: HashSet<&str> =
                            lang_plans.iter().map(|p| p.rel_path.as_str()).collect();
                        for old_lang in &old_ws.languages {
                            if let Ok(old_rel) = normalize_rel_path(&old_lang.path) {
                                if !new_rels.contains(old_rel.as_str()) && proj.join(&old_rel).exists()
                                {
                                    mutations.push(PlannedMutation::DeletePath {
                                        rel_path: old_rel,
                                    });
                                }
                            }
                        }
                    }
                }
            }

            for lp in &lang_plans {
                mutations.push(PlannedMutation::CreateDir {
                    rel_path: lp.rel_path.clone(),
                });
                mutations.push(PlannedMutation::CreateDir {
                    rel_path: format!("{}/lexicon", lp.rel_path),
                });
                mutations.push(PlannedMutation::CreateDir {
                    rel_path: format!("{}/corpus", lp.rel_path),
                });

                // Delete stale lexicon buckets in surviving language directory
                let lex_abs = proj.join(&lp.rel_path).join("lexicon");
                if lex_abs.is_dir() {
                    for entry in fs::read_dir(&lex_abs).map_err(|e| e.to_string())? {
                        let entry = entry.map_err(|e| e.to_string())?;
                        let name = entry.file_name().to_string_lossy().into_owned();
                        if entry.path().is_file()
                            && name.starts_with("lexicon_")
                            && name.ends_with(".ndjson")
                            && !lp.keep_buckets.contains(&name)
                        {
                            mutations.push(PlannedMutation::DeletePath {
                                rel_path: format!("{}/lexicon/{name}", lp.rel_path),
                            });
                        }
                    }
                }

                // Delete stale corpus files in surviving language directory
                let corp_abs = proj.join(&lp.rel_path).join("corpus");
                if corp_abs.is_dir() {
                    for entry in fs::read_dir(&corp_abs).map_err(|e| e.to_string())? {
                        let entry = entry.map_err(|e| e.to_string())?;
                        let name = entry.file_name().to_string_lossy().into_owned();
                        if entry.path().is_file()
                            && name.ends_with(".json")
                            && !lp.keep_corpora.contains(&name)
                        {
                            mutations.push(PlannedMutation::DeletePath {
                                rel_path: format!("{}/corpus/{name}", lp.rel_path),
                            });
                        }
                    }
                }

                for del_rel in &lp.deletes {
                    if proj.join(del_rel).exists() {
                        mutations.push(PlannedMutation::DeletePath {
                            rel_path: del_rel.clone(),
                        });
                    }
                }

                for (w_rel, bytes) in &lp.writes {
                    mutations.push(PlannedMutation::WriteFile {
                        rel_path: w_rel.clone(),
                        bytes: bytes.clone(),
                    });
                }
            }

            mutations.push(PlannedMutation::WriteFile {
                rel_path: ws_rel.clone(),
                bytes: ws_bytes.clone(),
            });

            let op_id_owned = op_id.to_string();
            let snap_id_clone = snap_id.clone();

            Ok(TransactionPlan {
                expectations: vec![RevisionExpectation::file(
                    "workspace",
                    ws_abs,
                    expected_revision,
                )],
                mutations,
                audit_summary: format!(
                    "Imported workspace bundle ({} languages)",
                    lang_plans.len()
                ),
                language_id: None,
                snapshot_id: snap_id,
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("workspace").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: snap_id_clone,
                    warnings,
                }),
            })
        },
    )
}

#[allow(dead_code)]
fn restore_files(files: Vec<(PathBuf, Option<Vec<u8>>)>) -> Result<(), String> {
    let originals = files
        .iter()
        .map(|(path, _)| {
            let data = if path.exists() {
                Some(fs::read(path).map_err(|error| error.to_string())?)
            } else {
                None
            };
            Ok((path.clone(), data))
        })
        .collect::<Result<Vec<_>, String>>()?;
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
                    None if previous.exists() => {
                        fs::remove_file(previous).map_err(|error| error.to_string())
                    }
                    None => Ok(()),
                };
                if let Err(rollback) = restored {
                    failures.push(rollback);
                }
            }
            return Err(format!(
                "Project import failed ({error}). Rollback errors {failures:?}"
            ));
        }
    }
    Ok(())
}

/// Write text content atomically to a file path (used with frontend dialog for export),
/// optionally checking `expected_revision` (CAS).
#[command]
pub fn write_text_file(
    file_path: String,
    content: String,
    expected_revision: Option<String>,
) -> Result<WriteResult, String> {
    let path = Path::new(&file_path);
    if let Some(ref exp) = expected_revision {
        let trimmed = exp.trim();
        if !trimmed.is_empty() {
            let actual = file_revision(path)?;
            if trimmed != actual {
                return Err(format!(
                    "CONFLICT: Revision mismatch on '{file_path}': expected '{trimmed}', actual '{actual}'"
                ));
            }
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    atomic_write(path, &content)?;
    let rev = file_revision(path)?;
    Ok(WriteResult {
        operation_id: crate::utils::fs_util::generate_uuid_v4(),
        revision: rev,
        revisions: None,
        snapshot_id: None,
        warnings: Vec::new(),
    })
}

#[command]
pub fn save_text_file_atomic(
    file_path: String,
    content: String,
    expected_revision: Option<String>,
) -> Result<WriteResult, String> {
    write_text_file(file_path, content, expected_revision)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TempProject(PathBuf);

    impl TempProject {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "conlang-bundle-{timestamp}-{}",
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
        fn workspace(&self) -> String {
            self.0.join("family.conlang").to_string_lossy().into_owned()
        }
    }

    impl Drop for TempProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
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
        import_workspace_bundle(
            source.path(),
            source.workspace(),
            bundle().to_string(),
            None,
            None,
        )
        .unwrap();
        let exported = export_workspace_bundle(source.path(), source.workspace()).unwrap();
        let target = TempProject::new();
        import_workspace_bundle(target.path(), target.workspace(), exported, None, None).unwrap();
        assert_eq!(
            fs::read(target.0.join("root/font.ttf")).unwrap(),
            include_bytes!("../../tests/fixtures/regular.ttf")
        );
        let phonology: serde_json::Value =
            serde_json::from_slice(&fs::read(target.0.join("root/phonology.json")).unwrap())
                .unwrap();
        assert_eq!(phonology["glyph_annotations"][0]["label"], "pa");
        let loaded =
            super::super::phonology::load_phonology(target.path(), "root".to_string()).unwrap();
        assert_eq!(loaded.config.language_id, "root");
    }

    #[test]
    fn invalid_font_is_rejected_before_any_project_file_is_modified() {
        let project = TempProject::new();
        import_workspace_bundle(
            project.path(),
            project.workspace(),
            bundle().to_string(),
            None,
            None,
        )
        .unwrap();
        let original = fs::read(project.0.join("root/phonology.json")).unwrap();
        let font = fs::read(project.0.join("root/font.ttf")).unwrap();
        let mut invalid = bundle();
        invalid["languages"]["root"]["font"]["bytes_base64"] = serde_json::json!("T1RUTw==");
        invalid["languages"]["root"]["phonology"] = serde_json::json!({"changed": true});
        assert!(import_workspace_bundle(
            project.path(),
            project.workspace(),
            invalid.to_string(),
            None,
            None,
        )
        .is_err());
        assert_eq!(
            fs::read(project.0.join("root/phonology.json")).unwrap(),
            original
        );
        assert_eq!(fs::read(project.0.join("root/font.ttf")).unwrap(), font);
    }

    #[test]
    fn old_bundles_remain_readable_and_explicitly_absent_fonts_clear_new_bundle_assets() {
        let project = TempProject::new();
        import_workspace_bundle(
            project.path(),
            project.workspace(),
            bundle().to_string(),
            None,
            None,
        )
        .unwrap();
        let mut old = bundle();
        old.as_object_mut().unwrap().remove("bundle_version");
        old["languages"]["root"]
            .as_object_mut()
            .unwrap()
            .remove("font");
        import_workspace_bundle(
            project.path(),
            project.workspace(),
            old.to_string(),
            None,
            None,
        )
        .unwrap();
        assert!(project.0.join("root/font.ttf").is_file());
        old["bundle_version"] = serde_json::json!(2);
        import_workspace_bundle(
            project.path(),
            project.workspace(),
            old.to_string(),
            None,
            None,
        )
        .unwrap();
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
        import_workspace_bundle(
            project.path(),
            project.workspace(),
            bundle().to_string(),
            None,
            None,
        )
        .unwrap();
        let original = fs::read(project.0.join("root/phonology.json")).unwrap();
        for value in [
            serde_json::Value::Null,
            serde_json::json!({"glyph_annotations": "invalid"}),
        ] {
            let mut invalid = bundle();
            invalid["languages"]["root"]["phonology"] = value;
            assert!(import_workspace_bundle(
                project.path(),
                project.workspace(),
                invalid.to_string(),
                None,
                None,
            )
            .is_err());
            assert_eq!(
                fs::read(project.0.join("root/phonology.json")).unwrap(),
                original
            );
        }
    }

    #[test]
    fn incomplete_corpus_is_reported_instead_of_exported_as_a_success() {
        let project = TempProject::new();
        import_workspace_bundle(
            project.path(),
            project.workspace(),
            bundle().to_string(),
            None,
            None,
        )
        .unwrap();
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
