use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

use crate::commands::oplog::{collect_protected_snapshot_ids, record_language_snapshot_in_tx};
use crate::commands::transaction::{
    execute_project_transaction, with_consistent_read, PlannedMutation, RevisionExpectation,
    TransactionPlan,
};
use crate::models::{LexiconLoadResult, LexiconSkippedLine, WordEntry, WriteResult};
use crate::utils::revision::{lexicon_revision, normalize_rel_path};

pub fn is_valid_word_entry(word: &WordEntry) -> bool {
    let romanized = word.con_word_romanized.trim();
    if romanized.is_empty() || romanized == "new_word" {
        return false;
    }
    word.senses.iter().any(|s| !s.gloss.trim().is_empty())
}

/// Atomic single-file write delegating to `utils::fs_util::atomic_write` (`T1.8`).
pub fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    crate::utils::fs_util::atomic_write(path, content)
}

pub fn bucket_filename(word: &str) -> String {
    let first_char = word
        .chars()
        .next()
        .and_then(|c| c.to_lowercase().next())
        .unwrap_or('_');
    if first_char.is_ascii_alphabetic() {
        format!("lexicon_{first_char}.ndjson")
    } else {
        "lexicon_others.ndjson".to_string()
    }
}

#[allow(dead_code)]
fn bucket_path(lexicon_dir: &Path, word: &str) -> PathBuf {
    lexicon_dir.join(bucket_filename(word))
}

fn read_all_buckets(
    lexicon_dir: &Path,
) -> Result<(BTreeMap<String, Vec<WordEntry>>, Vec<LexiconSkippedLine>), String> {
    let mut buckets: BTreeMap<String, Vec<WordEntry>> = BTreeMap::new();
    let mut skipped: Vec<LexiconSkippedLine> = Vec::new();

    if !lexicon_dir.is_dir() {
        return Ok((buckets, skipped));
    }

    let mut files: Vec<(String, PathBuf)> = Vec::new();
    for entry in fs::read_dir(lexicon_dir).map_err(|e| format!("IO: {e}"))? {
        let entry = entry.map_err(|e| format!("IO: {e}"))?;
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|e| e == "ndjson") {
            let name = entry.file_name().to_string_lossy().into_owned();
            files.push((name, path));
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));

    for (fname, path) in files {
        let content = fs::read_to_string(&path).map_err(|e| format!("IO: {e}"))?;
        let mut bucket_words = Vec::new();
        for (idx, raw_line) in content.lines().enumerate() {
            let line_no = idx + 1;
            let trimmed = raw_line.trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<WordEntry>(trimmed) {
                Ok(word) => {
                    if is_valid_word_entry(&word) {
                        bucket_words.push(word);
                    } else {
                        skipped.push(LexiconSkippedLine {
                            file: fname.clone(),
                            line: line_no,
                            reason: "invalid_entry: missing non-empty sense gloss or placeholder 'new_word'".to_string(),
                        });
                    }
                }
                Err(e) => {
                    eprintln!("解析词条失败，跳过该行 ({fname}:{line_no}): {e}");
                    skipped.push(LexiconSkippedLine {
                        file: fname.clone(),
                        line: line_no,
                        reason: format!("invalid_json: {e}"),
                    });
                }
            }
        }
        buckets.insert(fname, bucket_words);
    }

    Ok((buckets, skipped))
}

fn serialize_bucket_words(words: &mut [WordEntry]) -> Result<Vec<u8>, String> {
    words.sort_by(|a, b| a.con_word_romanized.cmp(&b.con_word_romanized));
    let mut lines = Vec::with_capacity(words.len());
    for w in words.iter() {
        lines.push(serde_json::to_string(w).map_err(|e| format!("IO: {e}"))?);
    }
    let text = lines.join("\n") + "\n";
    Ok(text.into_bytes())
}

#[command]
pub fn load_all_words_with_revision(
    project_path: String,
    language_path: String,
) -> Result<LexiconLoadResult, String> {
    let project_dir = Path::new(&project_path);
    with_consistent_read(
        project_dir,
        "load_all_words_with_revision",
        true,
        None,
        |proj, _| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let lexicon_dir = proj.join(&lang_rel).join("lexicon");
            let rev = lexicon_revision(&lexicon_dir)?;
            let (buckets, skipped) = read_all_buckets(&lexicon_dir)?;
            let mut words: Vec<WordEntry> = buckets.into_values().flatten().collect();
            words.sort_by(|a, b| a.con_word_romanized.cmp(&b.con_word_romanized));
            Ok(LexiconLoadResult {
                words,
                revision: rev,
                skipped,
            })
        },
    )
}

#[command]
pub fn load_all_words(
    project_path: String,
    language_path: String,
) -> Result<Vec<WordEntry>, String> {
    load_all_words_with_revision(project_path, language_path).map(|res| res.words)
}

#[command]
pub fn save_word(
    project_path: String,
    language_path: String,
    word: WordEntry,
    old_romanized: Option<String>,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    let project_dir = Path::new(&project_path);
    if !is_valid_word_entry(&word) {
        return with_consistent_read(project_dir, "save_word_skip_draft", true, None, |proj, _| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let rev = lexicon_revision(&proj.join(&lang_rel).join("lexicon"))?;
            Ok(WriteResult {
                operation_id: operation_id.unwrap_or_else(|| "noop_draft".to_string()),
                revision: rev,
                revisions: None,
                snapshot_id: None,
                warnings: vec!["Skipped draft/invalid word entry".to_string()],
            })
        });
    }

    let payload = serde_json::json!({
        "language_path": &language_path,
        "word": &word,
        "old_romanized": &old_romanized,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project_dir,
        "save_word",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let lexicon_rel = format!("{lang_rel}/lexicon");
            let lexicon_dir = proj.join(&lexicon_rel);

            let (mut buckets, _skipped) = read_all_buckets(&lexicon_dir)?;
            let target_bucket = bucket_filename(&word.con_word_romanized);

            let mut dirty_buckets: HashSet<String> = HashSet::new();

            // Remove `word.entry_id` from any other bucket (handles both explicit `old_romanized`
            // and implicit cross-bucket renames cleanly)
            if let Some(ref old_spell) = old_romanized {
                let hinted = bucket_filename(old_spell);
                if hinted != target_bucket {
                    dirty_buckets.insert(hinted);
                }
            }
            for (bname, bwords) in &mut buckets {
                if bname != &target_bucket {
                    let before = bwords.len();
                    bwords.retain(|w| w.entry_id != word.entry_id);
                    if bwords.len() < before {
                        dirty_buckets.insert(bname.clone());
                    }
                }
            }

            let dest = buckets.entry(target_bucket.clone()).or_default();
            match dest.iter().position(|w| w.entry_id == word.entry_id) {
                Some(idx) => dest[idx] = word.clone(),
                None => dest.push(word.clone()),
            }
            dirty_buckets.insert(target_bucket);

            let mut mutations: Vec<PlannedMutation> = Vec::new();
            mutations.push(PlannedMutation::CreateDir {
                rel_path: lexicon_rel.clone(),
            });

            let mut sorted_dirty: Vec<String> = dirty_buckets.into_iter().collect();
            sorted_dirty.sort();
            for bname in sorted_dirty {
                let rel = format!("{lexicon_rel}/{bname}");
                match buckets.get_mut(&bname) {
                    Some(bwords) if !bwords.is_empty() => {
                        let bytes = serialize_bucket_words(bwords)?;
                        mutations.push(PlannedMutation::WriteFile {
                            rel_path: rel,
                            bytes,
                        });
                    }
                    _ => {
                        if lexicon_dir.join(&bname).exists() {
                            mutations.push(PlannedMutation::DeletePath { rel_path: rel });
                        }
                    }
                }
            }

            let op_id_owned = op_id.to_string();
            let lang_id_opt = if word.language_id.is_empty() {
                None
            } else {
                Some(word.language_id.clone())
            };

            Ok(TransactionPlan {
                expectations: vec![RevisionExpectation::lexicon(
                    "lexicon",
                    lexicon_dir,
                    expected_revision,
                )],
                mutations,
                audit_summary: format!(
                    "Saved word '{}' ({})",
                    word.con_word_romanized, word.entry_id
                ),
                language_id: lang_id_opt,
                snapshot_id: None,
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("lexicon").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: None,
                    warnings,
                }),
            })
        },
    )
}

/// Batch upsert multiple words in a single project transaction.
/// Automatically creates a `"lexicon"` language snapshot when `valid_words.len() >= 20` (PRD §7.3).
#[command]
pub fn save_words_batch(
    project_path: String,
    language_path: String,
    words: Vec<WordEntry>,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    let project_dir = Path::new(&project_path);
    let payload = serde_json::json!({
        "language_path": &language_path,
        "words": &words,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project_dir,
        "save_words_batch",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let lexicon_rel = format!("{lang_rel}/lexicon");
            let lexicon_dir = proj.join(&lexicon_rel);

            let valid_words: Vec<WordEntry> =
                words.iter().filter(|w| is_valid_word_entry(w)).cloned().collect();

            let mut mutations: Vec<PlannedMutation> = Vec::new();
            let mut snap_id: Option<String> = None;

            let lang_id_str = valid_words
                .first()
                .map(|w| w.language_id.as_str())
                .unwrap_or("");

            if valid_words.len() >= 20 {
                let protected = collect_protected_snapshot_ids(proj);
                let (sid, _) = record_language_snapshot_in_tx(
                    proj,
                    &lang_rel,
                    "lexicon",
                    "gui",
                    "batch_save_words",
                    lang_id_str,
                    lang_id_str,
                    &format!("Before batch saving {} words", valid_words.len()),
                    None,
                    &protected,
                    &mut mutations,
                )?;
                snap_id = Some(sid);
            }

            let (mut buckets, _skipped) = read_all_buckets(&lexicon_dir)?;
            let mut dirty_buckets: HashSet<String> = HashSet::new();

            for word in &valid_words {
                let target_bucket = bucket_filename(&word.con_word_romanized);
                for (bname, bwords) in &mut buckets {
                    if bname != &target_bucket {
                        let before = bwords.len();
                        bwords.retain(|w| w.entry_id != word.entry_id);
                        if bwords.len() < before {
                            dirty_buckets.insert(bname.clone());
                        }
                    }
                }
                let dest = buckets.entry(target_bucket.clone()).or_default();
                match dest.iter().position(|w| w.entry_id == word.entry_id) {
                    Some(idx) => dest[idx] = word.clone(),
                    None => dest.push(word.clone()),
                }
                dirty_buckets.insert(target_bucket);
            }

            if !valid_words.is_empty() {
                mutations.push(PlannedMutation::CreateDir {
                    rel_path: lexicon_rel.clone(),
                });
            }

            let mut sorted_dirty: Vec<String> = dirty_buckets.into_iter().collect();
            sorted_dirty.sort();
            for bname in sorted_dirty {
                let rel = format!("{lexicon_rel}/{bname}");
                match buckets.get_mut(&bname) {
                    Some(bwords) if !bwords.is_empty() => {
                        let bytes = serialize_bucket_words(bwords)?;
                        mutations.push(PlannedMutation::WriteFile {
                            rel_path: rel,
                            bytes,
                        });
                    }
                    _ => {
                        if lexicon_dir.join(&bname).exists() {
                            mutations.push(PlannedMutation::DeletePath { rel_path: rel });
                        }
                    }
                }
            }

            let op_id_owned = op_id.to_string();
            let snap_id_clone = snap_id.clone();
            let lang_id_opt = if lang_id_str.is_empty() {
                None
            } else {
                Some(lang_id_str.to_string())
            };

            Ok(TransactionPlan {
                expectations: vec![RevisionExpectation::lexicon(
                    "lexicon",
                    lexicon_dir,
                    expected_revision,
                )],
                mutations,
                audit_summary: format!("Batch saved {} words in '{lang_rel}'", valid_words.len()),
                language_id: lang_id_opt,
                snapshot_id: snap_id,
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("lexicon").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: snap_id_clone,
                    warnings,
                }),
            })
        },
    )
}

#[command]
pub fn delete_word(
    project_path: String,
    language_path: String,
    entry_id: String,
    con_word_romanized: String,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    let project_dir = Path::new(&project_path);
    let payload = serde_json::json!({
        "language_path": &language_path,
        "entry_id": &entry_id,
        "con_word_romanized": &con_word_romanized,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project_dir,
        "delete_word",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let lexicon_rel = format!("{lang_rel}/lexicon");
            let lexicon_dir = proj.join(&lexicon_rel);

            let (mut buckets, _skipped) = read_all_buckets(&lexicon_dir)?;
            let mut mutations: Vec<PlannedMutation> = Vec::new();

            for (bname, bwords) in &mut buckets {
                let before = bwords.len();
                bwords.retain(|w| w.entry_id != entry_id);
                if bwords.len() < before {
                    let rel = format!("{lexicon_rel}/{bname}");
                    if bwords.is_empty() {
                        mutations.push(PlannedMutation::DeletePath { rel_path: rel });
                    } else {
                        let bytes = serialize_bucket_words(bwords)?;
                        mutations.push(PlannedMutation::WriteFile {
                            rel_path: rel,
                            bytes,
                        });
                    }
                }
            }

            let op_id_owned = op_id.to_string();

            Ok(TransactionPlan {
                expectations: vec![RevisionExpectation::lexicon(
                    "lexicon",
                    lexicon_dir,
                    expected_revision,
                )],
                mutations,
                audit_summary: format!("Deleted word '{con_word_romanized}' ({entry_id})"),
                language_id: None,
                snapshot_id: None,
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("lexicon").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: None,
                    warnings,
                }),
            })
        },
    )
}

/// Batch delete words by `entry_ids`, automatically creating a `"lexicon"` snapshot first.
#[command]
pub fn delete_words_batch(
    project_path: String,
    language_path: String,
    entry_ids: Vec<String>,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    let project_dir = Path::new(&project_path);
    let payload = serde_json::json!({
        "language_path": &language_path,
        "entry_ids": &entry_ids,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project_dir,
        "delete_words_batch",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let lexicon_rel = format!("{lang_rel}/lexicon");
            let lexicon_dir = proj.join(&lexicon_rel);
            let id_set: HashSet<String> = entry_ids.iter().cloned().collect();

            let mut mutations: Vec<PlannedMutation> = Vec::new();
            let mut snap_id: Option<String> = None;

            if !id_set.is_empty() && lexicon_dir.is_dir() {
                let protected = collect_protected_snapshot_ids(proj);
                let (sid, _) = record_language_snapshot_in_tx(
                    proj,
                    &lang_rel,
                    "lexicon",
                    "gui",
                    "batch_delete_words",
                    "",
                    "",
                    &format!("Before deleting {} words", id_set.len()),
                    None,
                    &protected,
                    &mut mutations,
                )?;
                snap_id = Some(sid);
            }

            let (mut buckets, _skipped) = read_all_buckets(&lexicon_dir)?;
            for (bname, bwords) in &mut buckets {
                let before = bwords.len();
                bwords.retain(|w| !id_set.contains(&w.entry_id));
                if bwords.len() < before {
                    let rel = format!("{lexicon_rel}/{bname}");
                    if bwords.is_empty() {
                        mutations.push(PlannedMutation::DeletePath { rel_path: rel });
                    } else {
                        let bytes = serialize_bucket_words(bwords)?;
                        mutations.push(PlannedMutation::WriteFile {
                            rel_path: rel,
                            bytes,
                        });
                    }
                }
            }

            let op_id_owned = op_id.to_string();
            let snap_id_clone = snap_id.clone();

            Ok(TransactionPlan {
                expectations: vec![RevisionExpectation::lexicon(
                    "lexicon",
                    lexicon_dir,
                    expected_revision,
                )],
                mutations,
                audit_summary: format!("Batch deleted {} words in '{lang_rel}'", id_set.len()),
                language_id: None,
                snapshot_id: snap_id,
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("lexicon").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: snap_id_clone,
                    warnings,
                }),
            })
        },
    )
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct LanguageStats {
    pub word_count: usize,
    pub created_at: Option<u64>,
    pub updated_at: Option<u64>,
}

/// Count words and fetch timestamps for each language inside a consistent read view.
#[command]
pub fn count_words_all_languages(
    project_path: String,
    languages: Vec<(String, String)>, // Vec<(language_id, language_path)>
) -> Result<HashMap<String, LanguageStats>, String> {
    let project = Path::new(&project_path);
    with_consistent_read(
        project,
        "count_words_all_languages",
        true,
        None,
        |proj, _| {
            let mut stats_map: HashMap<String, LanguageStats> = HashMap::new();

            for (lang_id, lang_path) in &languages {
                let lang_dir = proj.join(normalize_rel_path(lang_path)?);
                let lexicon_dir = lang_dir.join("lexicon");

                let mut count: usize = 0;
                if lexicon_dir.is_dir() {
                    for entry in fs::read_dir(&lexicon_dir).map_err(|e| format!("IO: {e}"))? {
                        let path = entry.map_err(|e| format!("IO: {e}"))?.path();
                        if path.extension().is_some_and(|e| e == "ndjson") {
                            let content =
                                fs::read_to_string(&path).map_err(|e| format!("IO: {e}"))?;
                            count += content.lines().filter(|l| !l.trim().is_empty()).count();
                        }
                    }
                }

                let created_at = lang_dir.metadata().ok().and_then(|m| {
                    m.created().ok().and_then(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .ok()
                            .map(|d| d.as_secs())
                    })
                });
                let updated_at = lang_dir.metadata().ok().and_then(|m| {
                    m.modified().ok().and_then(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .ok()
                            .map(|d| d.as_secs())
                    })
                });

                stats_map.insert(
                    lang_id.clone(),
                    LanguageStats {
                        word_count: count,
                        created_at,
                        updated_at,
                    },
                );
            }

            Ok(stats_map)
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t1_13_lexicon_preserves_sibling_unknown_fields_and_reports_skipped_lines() {
        let temp = tempfile::tempdir().unwrap();
        let proj = temp.path();
        let proj_str = proj.to_string_lossy().to_string();
        let lex_dir = proj.join("stages/child/lexicon");
        fs::create_dir_all(&lex_dir).unwrap();

        // 4 lines: 2 valid with unknown sentinels, 1 missing gloss, 1 broken JSON
        let bucket_a = concat!(
            "{\"entry_id\":\"w_keep\",\"language_id\":\"c\",\"con_word_romanized\":\"ama\",\"phonemic_ipa\":\"ama\",\"phonetic_override\":false,\"senses\":[{\"sense_id\":\"s1\",\"pos_id\":\"n\",\"gloss\":\"mother\",\"definitions\":[],\"examples\":[],\"__sibling_sense_ext\":123}],\"etymology\":{\"origin_type\":\"a_priori\",\"parent_entry_id\":null,\"source_language_id\":null,\"applied_sound_changes\":[],\"semantic_shift_note\":\"\"},\"metadata\":{\"tags\":[],\"created_at\":\"0\",\"updated_at\":\"0\"},\"__sibling_ext\":\"untouched\"}\n",
            "{\"entry_id\":\"w_edit\",\"language_id\":\"c\",\"con_word_romanized\":\"ata\",\"phonemic_ipa\":\"ata\",\"phonetic_override\":false,\"senses\":[{\"sense_id\":\"s2\",\"pos_id\":\"n\",\"gloss\":\"water\",\"definitions\":[],\"examples\":[]}],\"etymology\":{\"origin_type\":\"a_priori\",\"parent_entry_id\":null,\"source_language_id\":null,\"applied_sound_changes\":[],\"semantic_shift_note\":\"\"},\"metadata\":{\"tags\":[],\"created_at\":\"0\",\"updated_at\":\"0\"},\"__edited_ext\":\"survives\"}\n",
            "{\"entry_id\":\"w_bad_gloss\",\"language_id\":\"c\",\"con_word_romanized\":\"aka\",\"phonemic_override\":false,\"senses\":[{\"sense_id\":\"s3\",\"pos_id\":\"n\",\"gloss\":\"   \"}]}\n",
            "{corrupted_json_line\n"
        );
        fs::write(lex_dir.join("lexicon_a.ndjson"), bucket_a).unwrap();

        let loaded =
            load_all_words_with_revision(proj_str.clone(), "stages/child".to_string()).unwrap();
        assert_eq!(loaded.words.len(), 2);
        assert_eq!(loaded.skipped.len(), 2);

        // Move `w_edit` from `ata` (bucket a) -> `bata` (bucket b) with CAS expected_revision
        let mut w_edit = loaded
            .words
            .iter()
            .find(|w| w.entry_id == "w_edit")
            .unwrap()
            .clone();
        w_edit.con_word_romanized = "bata".to_string();

        let write_res = save_word(
            proj_str.clone(),
            "stages/child".to_string(),
            w_edit,
            Some("ata".to_string()),
            Some(loaded.revision.clone()),
            None,
        )
        .unwrap();
        assert_ne!(write_res.revision, loaded.revision);

        // Stale revision MUST fail with CONFLICT!
        let stale_err = delete_word(
            proj_str.clone(),
            "stages/child".to_string(),
            "w_keep".to_string(),
            "ama".to_string(),
            Some(loaded.revision),
            None,
        )
        .unwrap_err();
        assert!(stale_err.starts_with("CONFLICT:"));

        // Verify `w_keep` in `lexicon_a.ndjson` kept `__sibling_ext` and `__sibling_sense_ext`,
        // and `w_edit` in `lexicon_b.ndjson` kept `__edited_ext`!
        let disk_a: serde_json::Value = serde_json::from_str(
            fs::read_to_string(lex_dir.join("lexicon_a.ndjson"))
                .unwrap()
                .lines()
                .next()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(disk_a["entry_id"], "w_keep");
        assert_eq!(disk_a["__sibling_ext"], "untouched");
        assert_eq!(disk_a["senses"][0]["__sibling_sense_ext"], 123);

        let disk_b: serde_json::Value = serde_json::from_str(
            fs::read_to_string(lex_dir.join("lexicon_b.ndjson"))
                .unwrap()
                .lines()
                .next()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(disk_b["entry_id"], "w_edit");
        assert_eq!(disk_b["__edited_ext"], "survives");
    }
}
