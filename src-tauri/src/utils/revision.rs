use sha2::{Digest, Sha256};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

pub const MISSING_REVISION: &str = "missing";

/// Full 64-character lowercase SHA-256 hex digest of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// §3.4 Revision prefix: first 16 lowercase hex characters of SHA-256(`bytes`).
pub fn bytes_revision(bytes: &[u8]) -> String {
    let full = sha256_hex(bytes);
    full[..16].to_string()
}

/// §3.4 Single-file revision: first 16 lowercase hex chars of SHA-256 of raw file bytes,
/// or `"missing"` if the file does not exist.
pub fn file_revision(path: &Path) -> Result<String, String> {
    match fs::metadata(path) {
        Ok(meta) => {
            if !meta.is_file() {
                return Ok(MISSING_REVISION.to_string());
            }
            let bytes = fs::read(path)
                .map_err(|e| format!("IO: Failed to read '{}': {e}", path.display()))?;
            Ok(bytes_revision(&bytes))
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(MISSING_REVISION.to_string()),
        Err(err) => Err(format!(
            "IO: Failed to stat '{}': {err}",
            path.display()
        )),
    }
}

/// §3.4 Composite lexicon revision for `<lang>/lexicon/`:
/// Collect existing `lexicon_*.ndjson` (and `.jsonl` if present) filenames, sort ascending
/// by ASCII byte order; if none exist -> `"missing"`; else build `"<filename>:<file_rev>\n"`
/// for each and return first 16 lowercase hex chars of SHA-256 of that UTF-8 string.
pub fn lexicon_revision(lexicon_dir: &Path) -> Result<String, String> {
    if !lexicon_dir.exists() || !lexicon_dir.is_dir() {
        return Ok(MISSING_REVISION.to_string());
    }

    let mut filenames: Vec<String> = Vec::new();
    for entry in fs::read_dir(lexicon_dir)
        .map_err(|e| format!("IO: Failed reading lexicon dir '{}': {e}", lexicon_dir.display()))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("lexicon_")
            && (name.ends_with(".ndjson") || name.ends_with(".jsonl"))
        {
            filenames.push(name);
        }
    }

    filenames.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
    if filenames.is_empty() {
        return Ok(MISSING_REVISION.to_string());
    }

    let mut sequence = String::new();
    for name in &filenames {
        let rev = file_revision(&lexicon_dir.join(name))?;
        sequence.push_str(name);
        sequence.push(':');
        sequence.push_str(&rev);
        sequence.push('\n');
    }

    Ok(bytes_revision(sequence.as_bytes()))
}

/// Own font revision for a language directory (`font.otf` prioritized over `font.ttf`, matching `font.rs`).
pub fn language_own_font_revision(lang_dir: &Path) -> Result<(Option<String>, String), String> {
    for name in ["font.otf", "font.ttf"] {
        let candidate = lang_dir.join(name);
        if candidate.is_file() {
            return Ok((Some(name.to_string()), file_revision(&candidate)?));
        }
    }
    Ok((None, MISSING_REVISION.to_string()))
}

/// Locate the `.conlang` (or `.conlang.json`) file inside `project_dir`, sorted deterministically.
pub fn find_conlang_file(project_dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(project_dir).ok()?;
    let mut candidates: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.ends_with(".conlang") || n.ends_with(".conlang.json"))
        })
        .collect();
    candidates.sort();
    candidates.into_iter().next()
}

/// Resolve a `.conlang` file path or project directory path to its canonical project root directory.
pub fn resolve_project_root(path: &Path) -> PathBuf {
    let raw_dir = if path.is_file()
        || path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(".conlang") || n.ends_with(".conlang.json"))
    {
        path.parent().unwrap_or(path)
    } else {
        path
    };

    canonicalize_best_effort(raw_dir)
}

/// Canonicalize `path` when it exists (or its nearest existing ancestor + remaining suffix).
pub fn canonicalize_best_effort(path: &Path) -> PathBuf {
    if let Ok(canon) = path.canonicalize() {
        return canon;
    }
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    };
    if let Some(parent) = abs.parent() {
        if let Some(name) = abs.file_name() {
            if let Ok(canon_parent) = parent.canonicalize() {
                return canon_parent.join(name);
            }
        }
    }
    abs
}

/// Normalize a project-relative path to forward slashes and reject traversal (`..`).
pub fn normalize_rel_path(rel: &str) -> Result<String, String> {
    let replaced = rel.replace('\\', "/");
    let trimmed = replaced.trim_start_matches('/').trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(format!("VALIDATION: Empty relative path '{rel}'"));
    }
    for seg in trimmed.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            return Err(format!(
                "VALIDATION: Invalid relative path segment in '{rel}'"
            ));
        }
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_file_and_composite_lexicon_revision_match_wire_spec() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("does_not_exist.json");
        assert_eq!(file_revision(&missing).unwrap(), "missing");

        let f = temp.path().join("phonology.json");
        fs::write(&f, b"{\"language_id\":\"root\"}").unwrap();
        let rev = file_revision(&f).unwrap();
        assert_eq!(rev.len(), 16);
        assert!(rev.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));

        let lex = temp.path().join("lexicon");
        assert_eq!(lexicon_revision(&lex).unwrap(), "missing");
        fs::create_dir_all(&lex).unwrap();
        assert_eq!(lexicon_revision(&lex).unwrap(), "missing");

        fs::write(lex.join("lexicon_s.ndjson"), b"{\"entry_id\":\"2\"}\n").unwrap();
        fs::write(lex.join("lexicon_a.ndjson"), b"{\"entry_id\":\"1\"}\n").unwrap();
        let rev_a = file_revision(&lex.join("lexicon_a.ndjson")).unwrap();
        let rev_s = file_revision(&lex.join("lexicon_s.ndjson")).unwrap();
        let expected_seq = format!("lexicon_a.ndjson:{rev_a}\nlexicon_s.ndjson:{rev_s}\n");
        assert_eq!(
            lexicon_revision(&lex).unwrap(),
            bytes_revision(expected_seq.as_bytes())
        );
    }
}
