use crate::models::WordEntry;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

/// 安全写入：先写临时文件，再原子性 rename 替换，防止写入中途崩溃导致数据丢失
pub fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())?; // 同一文件系统上为原子操作
    Ok(())
}

fn bucket_path(lexicon_dir: &Path, word: &str) -> PathBuf {
    let first_char = word
        .chars()
        .next()
        .map(|c| c.to_lowercase().next().unwrap_or('_'))
        .unwrap_or('_');
    if first_char.is_ascii_alphabetic() {
        lexicon_dir.join(format!("lexicon_{}.ndjson", first_char))
    } else {
        lexicon_dir.join("lexicon_others.ndjson")
    }
}

use std::collections::HashMap;

#[command]
pub fn load_all_words(
    project_path: String,
    language_path: String,
) -> Result<Vec<WordEntry>, String> {
    let lexicon_dir = Path::new(&project_path)
        .join(&language_path)
        .join("lexicon");
    let mut all_words: Vec<WordEntry> = Vec::new();

    if !lexicon_dir.exists() {
        return Ok(all_words);
    }

    for entry in fs::read_dir(&lexicon_dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().map_or(false, |e| e == "ndjson") {
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            for line in content.lines() {
                let line = line.trim();
                if !line.is_empty() {
                    match serde_json::from_str::<WordEntry>(line) {
                        Ok(word) => all_words.push(word),
                        Err(e) => eprintln!("解析词条失败，跳过该行: {}", e),
                    }
                }
            }
        }
    }
    Ok(all_words)
}

#[command]
pub fn save_word(
    project_path: String,
    language_path: String,
    word: WordEntry,
    old_romanized: Option<String>,
) -> Result<(), String> {
    let lexicon_dir = Path::new(&project_path)
        .join(&language_path)
        .join("lexicon");
    let bucket = bucket_path(&lexicon_dir, &word.con_word_romanized);

    // Cross-bucket deduplication logic
    if let Some(old_spell) = old_romanized {
        let old_bucket = bucket_path(&lexicon_dir, &old_spell);
        if old_bucket != bucket && old_bucket.exists() {
            let content = fs::read_to_string(&old_bucket).unwrap_or_default();
            let mut old_words: Vec<WordEntry> = content
                .lines()
                .filter(|l| !l.trim().is_empty())
                .filter_map(|l| serde_json::from_str::<WordEntry>(l).ok())
                .collect();

            let initial_len = old_words.len();
            old_words.retain(|w| w.entry_id != word.entry_id);

            if old_words.len() < initial_len {
                if old_words.is_empty() {
                    let _ = fs::remove_file(&old_bucket);
                } else {
                    let lines: Result<Vec<String>, _> =
                        old_words.iter().map(|w| serde_json::to_string(w)).collect();
                    if let Ok(lines_str) = lines {
                        let _ = atomic_write(&old_bucket, &(lines_str.join("\n") + "\n"));
                    }
                }
            }
        }
    }

    // 读取现有词条
    let mut words: Vec<WordEntry> = if bucket.exists() {
        let content = fs::read_to_string(&bucket).map_err(|e| e.to_string())?;
        content
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str::<WordEntry>(l).ok())
            .collect()
    } else {
        Vec::new()
    };

    // 更新或插入
    let pos = words.iter().position(|w| w.entry_id == word.entry_id);
    match pos {
        Some(i) => words[i] = word,
        None => words.push(word),
    }

    // 强制按 con_word_romanized 字母序排序（保证 Git diff 干净）
    words.sort_by(|a, b| a.con_word_romanized.cmp(&b.con_word_romanized));

    // 序列化为 NDJSON
    let lines: Result<Vec<String>, _> = words.iter().map(|w| serde_json::to_string(w)).collect();
    let content = lines.map_err(|e| e.to_string())?.join("\n") + "\n";

    atomic_write(&bucket, &content)
}

#[command]
pub fn delete_word(
    project_path: String,
    language_path: String,
    entry_id: String,
    con_word_romanized: String,
) -> Result<(), String> {
    let lexicon_dir = Path::new(&project_path)
        .join(&language_path)
        .join("lexicon");
    let bucket = bucket_path(&lexicon_dir, &con_word_romanized);
    if !bucket.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&bucket).map_err(|e| e.to_string())?;
    let words: Vec<WordEntry> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<WordEntry>(l).ok())
        .filter(|w| w.entry_id != entry_id)
        .collect();

    let lines: Result<Vec<String>, _> = words.iter().map(|w| serde_json::to_string(w)).collect();
    let new_content = lines.map_err(|e| e.to_string())?.join("\n") + "\n";

    atomic_write(&bucket, &new_content)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct LanguageStats {
    pub word_count: usize,
    pub created_at: Option<u64>,
    pub updated_at: Option<u64>,
}

/// Count words and fetch timestamps for each language without fully deserializing them.
/// Returns a map of language_id → LanguageStats.
#[command]
pub fn count_words_all_languages(
    project_path: String,
    languages: Vec<(String, String)>, // Vec<(language_id, language_path)>
) -> Result<HashMap<String, LanguageStats>, String> {
    let project = Path::new(&project_path);
    let mut stats_map: HashMap<String, LanguageStats> = HashMap::new();

    for (lang_id, lang_path) in &languages {
        let lang_dir = project.join(lang_path);
        let lexicon_dir = lang_dir.join("lexicon");

        let mut count: usize = 0;
        if lexicon_dir.exists() {
            for entry in fs::read_dir(&lexicon_dir).map_err(|e| e.to_string())? {
                let path = entry.map_err(|e| e.to_string())?.path();
                if path.extension().map_or(false, |e| e == "ndjson") {
                    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                    count += content.lines().filter(|l| !l.trim().is_empty()).count();
                }
            }
        }

        // Fetch directory timestamps
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
}
