use crate::models::{LanguageEntry, WorkspaceConfig};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::command;
use base64::Engine;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

pub(crate) const MAX_FONT_BYTES: u64 = 20 * 1024 * 1024;
pub(crate) static FONT_WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, serde::Serialize, Clone, PartialEq, Eq)]
pub struct LanguageFontStatus {
    pub language_id: String,
    pub has_own: bool,
    pub own_file_name: Option<String>,
    pub resolved_owner_id: Option<String>,
    pub resolved_owner_name: Option<String>,
    pub resolved_file_name: Option<String>,
}

#[derive(Debug, serde::Serialize, Clone, PartialEq, Eq)]
pub struct FontInspection {
    pub present: bool,
    pub has_own: bool,
    pub inherited: bool,
    pub owner_language_id: Option<String>,
    pub owner_name: Option<String>,
    pub owner_path: Option<String>,
    pub file_name: Option<String>,
    pub family_name: Option<String>,
    pub version: Option<String>,
    pub codepoints: Vec<u32>,
    pub glyphs: Vec<Vec<u32>>,
    pub warning: Option<String>,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct ResolvedFontBytes {
    pub owner_language_id: String,
    pub owner_name: String,
    pub inherited: bool,
    pub file_name: String,
    pub bytes_base64: String,
}

struct OwnedFont {
    language_id: String,
    language_name: String,
    path: PathBuf,
}

fn load_workspace(conlang_file_path: &str) -> Result<WorkspaceConfig, String> {
    let path = Path::new(conlang_file_path);
    if !path.exists() {
        return Ok(WorkspaceConfig::default());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub(crate) fn language_dir(project_path: &str, language_path: &str) -> Result<PathBuf, String> {
    if language_path.trim().is_empty() {
        return Err("Invalid language path".to_string());
    }
    let rel = Path::new(language_path);
    if rel.is_absolute()
        || rel
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Invalid language path".to_string());
    }

    let project = Path::new(project_path);
    let dir = project.join(rel);
    if project.exists() {
        let project_abs = project.canonicalize().map_err(|e| e.to_string())?;
        let mut existing = dir.as_path();
        while !existing.exists() {
            existing = existing.parent().ok_or_else(|| "Invalid language path".to_string())?;
        }
        let anchor = existing.canonicalize().map_err(|error| error.to_string())?;
        if !anchor.starts_with(&project_abs) {
            return Err("Language path escapes the project".to_string());
        }
    }
    Ok(dir)
}

fn find_font_file(dir: &Path) -> Option<PathBuf> {
    for name in ["font.otf", "font.ttf"] {
        let path = dir.join(name);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

/// Walk from `language_id` through `parent_id`. The first language directory
/// that contains `font.otf` or `font.ttf` owns the face used for display.
fn resolve_owned_font(
    project_path: &str,
    languages: &[LanguageEntry],
    language_id: &str,
) -> Option<OwnedFont> {
    let mut current = Some(language_id.to_string());
    let mut seen = HashSet::new();
    while let Some(id) = current {
        if !seen.insert(id.clone()) {
            break;
        }
        let lang = languages.iter().find(|item| item.language_id == id)?;
        let dir = Path::new(project_path).join(&lang.path);
        if let Some(path) = find_font_file(&dir) {
            return Some(OwnedFont {
                language_id: lang.language_id.clone(),
                language_name: lang.name.clone(),
                path,
            });
        }
        current = lang.parent_id.clone();
    }
    None
}

fn status_for(project_path: &str, languages: &[LanguageEntry], lang: &LanguageEntry) -> LanguageFontStatus {
    let own = find_font_file(&Path::new(project_path).join(&lang.path));
    let resolved = resolve_owned_font(project_path, languages, &lang.language_id);
    LanguageFontStatus {
        language_id: lang.language_id.clone(),
        has_own: own.is_some(),
        own_file_name: own.as_ref().and_then(|path| file_name(path)),
        resolved_owner_id: resolved.as_ref().map(|item| item.language_id.clone()),
        resolved_owner_name: resolved.as_ref().map(|item| item.language_name.clone()),
        resolved_file_name: resolved.as_ref().and_then(|item| file_name(&item.path)),
    }
}

fn file_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
}

fn font_extension(source: &Path) -> Result<&'static str, String> {
    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "otf" => Ok("otf"),
        "ttf" => Ok("ttf"),
        _ => Err("Only .otf and .ttf fonts can be imported".to_string()),
    }
}

fn is_single_font_face(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }
    let magic = &bytes[..4];
    magic == b"OTTO" || magic == [0x00, 0x01, 0x00, 0x00] || magic == b"true" || magic == b"typ1"
}

pub(crate) fn validate_font_bytes(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 > MAX_FONT_BYTES || !is_single_font_face(bytes) {
        return Err("File is not a valid .otf or .ttf font".to_string());
    }
    let face = ttf_parser::Face::parse(bytes, 0)
        .map_err(|error| format!("File is not a valid font: {error}"))?;
    let tables = face.tables();
    if face.number_of_glyphs() == 0 || tables.cmap.is_none()
        || (tables.glyf.is_none() && tables.cff.is_none() && tables.cff2.is_none()) {
        return Err("Font is missing a readable character map or outline table".to_string());
    }
    Ok(())
}

pub(crate) fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    static NEXT_WRITE: AtomicU64 = AtomicU64::new(0);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?.as_nanos();
    let id = format!("{timestamp}-{}", NEXT_WRITE.fetch_add(1, Ordering::Relaxed));
    let tmp_path = path.with_extension(format!("{id}.tmp"));
    if let Err(err) = fs::write(&tmp_path, bytes) {
        let _ = fs::remove_file(&tmp_path);
        return Err(err.to_string());
    }
    if fs::rename(&tmp_path, path).is_ok() { return Ok(()); }
    let backup = path.with_extension(format!("{id}.backup"));
    let had_original = path.is_file();
    if had_original {
        fs::rename(path, &backup).map_err(|error| {
            let _ = fs::remove_file(&tmp_path);
            error.to_string()
        })?;
    }
    if let Err(error) = fs::rename(&tmp_path, path) {
        let rollback = if had_original { fs::rename(&backup, path) } else { Ok(()) };
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("File write failed ({error}). Rollback result {rollback:?}"));
    }
    if had_original { let _ = fs::remove_file(backup); }
    Ok(())
}

pub(crate) fn encode_base64(data: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    let mut index = 0;
    while index + 3 <= data.len() {
        let value = ((data[index] as u32) << 16)
            | ((data[index + 1] as u32) << 8)
            | (data[index + 2] as u32);
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push(TABLE[((value >> 6) & 63) as usize] as char);
        out.push(TABLE[(value & 63) as usize] as char);
        index += 3;
    }
    let remaining = data.len() - index;
    if remaining == 1 {
        let value = (data[index] as u32) << 16;
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if remaining == 2 {
        let value = ((data[index] as u32) << 16) | ((data[index + 1] as u32) << 8);
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push(TABLE[((value >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

#[command]
pub fn list_language_fonts(
    project_path: String,
    conlang_file_path: String,
) -> Result<Vec<LanguageFontStatus>, String> {
    let workspace = load_workspace(&conlang_file_path)?;
    Ok(workspace
        .languages
        .iter()
        .map(|lang| status_for(&project_path, &workspace.languages, lang))
        .collect())
}

#[command]
pub fn read_resolved_font(
    project_path: String,
    conlang_file_path: String,
    language_id: String,
) -> Result<Option<ResolvedFontBytes>, String> {
    let workspace = load_workspace(&conlang_file_path)?;
    let Some(owned) = resolve_owned_font(&project_path, &workspace.languages, &language_id) else {
        return Ok(None);
    };
    let bytes = fs::read(&owned.path).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FONT_BYTES {
        return Err("Resolved font exceeds the 20 MiB limit".to_string());
    }
    Ok(Some(ResolvedFontBytes {
        inherited: owned.language_id != language_id,
        owner_language_id: owned.language_id,
        owner_name: owned.language_name,
        file_name: file_name(&owned.path).unwrap_or_else(|| "font.otf".to_string()),
        bytes_base64: encode_base64(&bytes),
    }))
}

#[command]
pub fn import_language_font(
    project_path: String,
    language_path: String,
    source_path: String,
) -> Result<(), String> {
    import_font_checked(project_path, language_path, source_path, None)
}

#[command]
pub fn read_font_candidate(source_path: String) -> Result<String, String> {
    let source = PathBuf::from(source_path);
    font_extension(&source)?;
    let length = fs::metadata(&source).map_err(|error| error.to_string())?.len();
    if length > MAX_FONT_BYTES { return Err("Font exceeds the 20 MiB limit".to_string()); }
    let bytes = fs::read(source).map_err(|error| error.to_string())?;
    validate_font_bytes(&bytes)?;
    Ok(encode_base64(&bytes))
}

#[command]
pub fn import_checked_language_font(project_path: String, language_path: String, source_path: String, expected_base64: String) -> Result<(), String> {
    import_font_checked(project_path, language_path, source_path, Some(expected_base64))
}

fn import_font_checked(project_path: String, language_path: String, source_path: String, expected_base64: Option<String>) -> Result<(), String> {
    let _guard = FONT_WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    let source = PathBuf::from(&source_path);
    let ext = font_extension(&source)?;
    let meta = fs::metadata(&source).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Choose a font file".to_string());
    }
    if meta.len() == 0 {
        return Err("Font file is empty".to_string());
    }
    if meta.len() > MAX_FONT_BYTES {
        return Err(format!(
            "Font file is {} bytes, over the 20 MiB limit",
            meta.len()
        ));
    }
    let bytes = fs::read(&source).map_err(|e| e.to_string())?;
    validate_font_bytes(&bytes)?;
    if let Some(expected) = expected_base64 {
        let decoded = base64::engine::general_purpose::STANDARD.decode(expected).map_err(|error| error.to_string())?;
        if decoded != bytes { return Err("Font changed during validation. Please choose the file again.".to_string()); }
    }

    let dir = language_dir(&project_path, &language_path)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("font.{ext}"));
    let original = if dest.is_file() { Some(fs::read(&dest).map_err(|error| error.to_string())?) } else { None };
    atomic_write_bytes(&dest, &bytes)?;

    let other = if ext == "otf" { "font.ttf" } else { "font.otf" };
    let other_path = dir.join(other);
    if other_path.is_file() {
        if let Err(error) = fs::remove_file(other_path) {
            let rollback = match original {
                Some(previous) => atomic_write_bytes(&dest, &previous),
                None => fs::remove_file(&dest).map_err(|error| error.to_string()),
            };
            return Err(format!("Could not replace the previous font ({error}). Rollback result {rollback:?}"));
        }
    }
    Ok(())
}

fn empty_inspection() -> FontInspection {
    FontInspection {
        present: false,
        has_own: false,
        inherited: false,
        owner_language_id: None,
        owner_name: None,
        owner_path: None,
        file_name: None,
        family_name: None,
        version: None,
        codepoints: Vec::new(),
        glyphs: Vec::new(),
        warning: None,
    }
}

#[command]
pub fn inspect_language_font(
    project_path: String,
    conlang_file_path: String,
    language_id: String,
) -> Result<FontInspection, String> {
    let workspace = load_workspace(&conlang_file_path)?;
    let lang = workspace
        .languages
        .iter()
        .find(|item| item.language_id == language_id)
        .ok_or_else(|| "Language not found".to_string())?;
    let has_own = find_font_file(&Path::new(&project_path).join(&lang.path)).is_some();
    let Some(owned) = resolve_owned_font(&project_path, &workspace.languages, &language_id) else {
        return Ok(empty_inspection());
    };
    let owner_path = workspace
        .languages
        .iter()
        .find(|item| item.language_id == owned.language_id)
        .map(|item| item.path.clone());
    let mut inspection = FontInspection {
        present: true,
        has_own,
        inherited: owned.language_id != language_id,
        owner_language_id: Some(owned.language_id),
        owner_name: Some(owned.language_name),
        owner_path,
        file_name: file_name(&owned.path),
        family_name: None,
        version: None,
        codepoints: Vec::new(),
        glyphs: Vec::new(),
        warning: None,
    };
    let bytes = fs::read(&owned.path).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FONT_BYTES {
        inspection.warning = Some("Resolved font exceeds the 20 MiB limit".to_string());
        return Ok(inspection);
    }
    match super::font_info::inspect_font_bytes(&bytes) {
        Ok(info) => {
            inspection.family_name = info.family_name;
            inspection.version = info.version;
            inspection.codepoints = info.codepoints;
            inspection.glyphs = info.glyphs;
        }
        Err(err) => inspection.warning = Some(err),
    }
    Ok(inspection)
}

#[command]
pub fn clear_language_font(project_path: String, language_path: String) -> Result<(), String> {
    let _guard = FONT_WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    let dir = language_dir(&project_path, &language_path)?;
    for name in ["font.otf", "font.ttf"] {
        let path = dir.join(name);
        if path.is_file() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempProject {
        dir: PathBuf,
    }

    impl TempProject {
        fn new() -> Self {
            use std::sync::atomic::{AtomicU64, Ordering};
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("conlang-font-{nanos}-{n}"));
            fs::create_dir_all(&dir).unwrap();
            Self { dir }
        }

        fn path(&self) -> String {
            self.dir.to_str().unwrap().to_string()
        }
    }

    impl Drop for TempProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn write_workspace(project: &Path, languages: &[(&str, &str, Option<&str>)]) -> String {
        let entries = languages
            .iter()
            .map(|(id, name, parent)| LanguageEntry {
                language_id: (*id).to_string(),
                name: (*name).to_string(),
                path: (*id).to_string(),
                parent_id: parent.map(|value| value.to_string()),
            })
            .collect();
        let config = WorkspaceConfig {
            workspace_version: "3.0".to_string(),
            languages: entries,
        };
        let conlang = project.join("family.conlang");
        fs::write(&conlang, serde_json::to_string(&config).unwrap()).unwrap();
        for (id, _, _) in languages {
            fs::create_dir_all(project.join(id)).unwrap();
        }
        conlang.to_str().unwrap().to_string()
    }

    fn fake_face(_magic: &[u8]) -> Vec<u8> {
        include_bytes!("../../tests/fixtures/regular.ttf").to_vec()
    }

    fn write_source(dir: &Path, name: &str, bytes: &[u8]) -> String {
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path.to_str().unwrap().to_string()
    }

    #[test]
    fn walks_up_until_a_language_has_its_own_font() {
        let project = TempProject::new();
        let conlang = write_workspace(
            &project.dir,
            &[
                ("root", "Root", None),
                ("child", "Child", Some("root")),
                ("middle", "Middle", Some("root")),
                ("grandchild", "Grandchild", Some("middle")),
                ("sibling", "Sibling", Some("root")),
            ],
        );
        fs::write(project.dir.join("root").join("font.otf"), fake_face(b"OTTO")).unwrap();
        fs::write(project.dir.join("middle").join("font.ttf"), fake_face(b"true")).unwrap();

        let statuses = list_language_fonts(project.path(), conlang).unwrap();
        let by_id = |id: &str| statuses.iter().find(|item| item.language_id == id).unwrap();

        let root = by_id("root");
        assert!(root.has_own);
        assert_eq!(root.resolved_owner_id.as_deref(), Some("root"));

        let child = by_id("child");
        assert!(!child.has_own);
        assert_eq!(child.resolved_owner_id.as_deref(), Some("root"));
        assert_eq!(child.resolved_owner_name.as_deref(), Some("Root"));

        let grandchild = by_id("grandchild");
        assert!(!grandchild.has_own);
        assert_eq!(grandchild.resolved_owner_id.as_deref(), Some("middle"));
        assert_eq!(grandchild.resolved_file_name.as_deref(), Some("font.ttf"));

        let sibling = by_id("sibling");
        assert_eq!(sibling.resolved_owner_id.as_deref(), Some("root"));
    }

    #[test]
    fn own_font_replaces_the_ancestor_font() {
        let project = TempProject::new();
        let conlang = write_workspace(
            &project.dir,
            &[
                ("root", "Root", None),
                ("child", "Child", Some("root")),
            ],
        );
        let outside = TempProject::new();
        let source = write_source(&outside.dir, "Custom.otf", &fake_face(b"OTTO"));
        fs::write(project.dir.join("root").join("font.otf"), fake_face(b"OTTO")).unwrap();
        fs::write(project.dir.join("child").join("font.ttf"), fake_face(b"true")).unwrap();

        import_language_font(project.path(), "child".to_string(), source).unwrap();

        assert!(project.dir.join("child").join("font.otf").is_file());
        assert!(!project.dir.join("child").join("font.ttf").is_file());
        let loaded = read_resolved_font(project.path(), conlang, "child".to_string())
            .unwrap()
            .unwrap();
        assert!(!loaded.inherited);
        assert_eq!(loaded.owner_language_id, "child");
        assert_eq!(loaded.file_name, "font.otf");
        assert_eq!(loaded.bytes_base64, encode_base64(&fake_face(b"OTTO")));
    }

    #[test]
    fn clearing_a_font_falls_back_to_the_parent() {
        let project = TempProject::new();
        let conlang = write_workspace(
            &project.dir,
            &[
                ("root", "Root", None),
                ("child", "Child", Some("root")),
            ],
        );
        fs::write(project.dir.join("root").join("font.otf"), fake_face(b"OTTO")).unwrap();
        fs::write(project.dir.join("child").join("font.otf"), fake_face(b"OTTO")).unwrap();

        clear_language_font(project.path(), "child".to_string()).unwrap();

        let loaded = read_resolved_font(project.path(), conlang, "child".to_string())
            .unwrap()
            .unwrap();
        assert!(loaded.inherited);
        assert_eq!(loaded.owner_language_id, "root");
        assert!(!project.dir.join("child").join("font.otf").exists());
    }

    #[test]
    fn missing_chain_and_cycles_resolve_to_none() {
        let project = TempProject::new();
        let conlang = write_workspace(
            &project.dir,
            &[
                ("a", "A", Some("b")),
                ("b", "B", Some("a")),
                ("orphan", "Orphan", Some("missing")),
            ],
        );
        let statuses = list_language_fonts(project.path(), conlang).unwrap();
        assert!(statuses.iter().all(|item| item.resolved_owner_id.is_none()));
    }

    #[test]
    fn import_rejects_invalid_files_and_escaping_paths() {
        let project = TempProject::new();
        let outside = TempProject::new();
        let text = write_source(&outside.dir, "notes.otf", b"this is not a font");
        let err = import_language_font(project.path(), "root".to_string(), text).unwrap_err();
        assert!(err.contains("not a valid"));

        let font = write_source(&outside.dir, "Face.otf", &fake_face(b"OTTO"));
        let escaped = import_language_font(project.path(), "../outside".to_string(), font).unwrap_err();
        assert!(escaped.contains("Invalid language path"));
    }

    #[test]
    fn truncated_font_and_changed_candidate_preserve_the_previous_font() {
        let project = TempProject::new();
        let sources = TempProject::new();
        let dir = project.dir.join("root");
        fs::create_dir_all(&dir).unwrap();
        let previous = fake_face(b"true");
        fs::write(dir.join("font.ttf"), &previous).unwrap();
        let truncated = write_source(&sources.dir, "truncated.otf", b"OTTO");
        assert!(import_language_font(project.path(), "root".to_string(), truncated).is_err());
        assert_eq!(fs::read(dir.join("font.ttf")).unwrap(), previous);
        assert!(!dir.join("font.otf").exists());
        let valid = write_source(&sources.dir, "valid.otf", &previous);
        let candidate = read_font_candidate(valid.clone()).unwrap();
        assert_eq!(candidate, encode_base64(&previous));
        assert!(import_checked_language_font(project.path(), "root".to_string(), valid, encode_base64(b"changed")).is_err());
        assert_eq!(fs::read(dir.join("font.ttf")).unwrap(), previous);
        assert!(!dir.join("font.otf").exists());
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(encode_base64(b""), "");
        assert_eq!(encode_base64(b"A"), "QQ==");
        assert_eq!(encode_base64(b"hello"), "aGVsbG8=");
    }

    #[test]
    fn font_fixture_is_inherited_until_the_child_imports_its_own() {
        let sources = TempProject::new();
        let otf = sources.dir.join("fixture.otf");
        let ttf = sources.dir.join("fixture.ttf");
        fs::write(&otf, fake_face(b"OTTO")).unwrap();
        fs::write(&ttf, fake_face(b"true")).unwrap();
        let project = TempProject::new();
        let conlang = write_workspace(
            &project.dir,
            &[
                ("parent", "Parent", None),
                ("child", "Child", Some("parent")),
            ],
        );
        import_language_font(
            project.path(),
            "parent".to_string(),
            otf.to_str().unwrap().to_string(),
        )
        .unwrap();

        let parent =
            inspect_language_font(project.path(), conlang.clone(), "parent".to_string()).unwrap();
        assert!(parent.present && parent.has_own && !parent.inherited);
        assert_eq!(parent.family_name.as_deref(), Some("Conlang Test"));
        assert_eq!(parent.version.as_deref(), Some("Version 1.0"));
        assert_eq!(parent.file_name.as_deref(), Some("font.otf"));
        assert_eq!(parent.codepoints.len(), 2);
        assert!(parent.warning.is_none());
        assert!(parent.codepoints.contains(&0x61));
        assert!(!parent.codepoints.contains(&('c' as u32)));

        let child =
            inspect_language_font(project.path(), conlang.clone(), "child".to_string()).unwrap();
        assert!(child.present && child.inherited && !child.has_own);
        assert_eq!(child.owner_language_id.as_deref(), Some("parent"));
        assert_eq!(child.codepoints, parent.codepoints);

        import_language_font(
            project.path(),
            "child".to_string(),
            ttf.to_str().unwrap().to_string(),
        )
        .unwrap();
        let own =
            inspect_language_font(project.path(), conlang.clone(), "child".to_string()).unwrap();
        assert!(own.has_own && !own.inherited);
        assert_eq!(own.file_name.as_deref(), Some("font.ttf"));
        assert_eq!(own.family_name.as_deref(), Some("Conlang Test"));
        assert!(!project.dir.join("child").join("font.otf").exists());

        clear_language_font(project.path(), "child".to_string()).unwrap();
        let restored =
            inspect_language_font(project.path(), conlang, "child".to_string()).unwrap();
        assert!(restored.inherited && !restored.has_own);
        assert_eq!(restored.codepoints.len(), 2);
    }
}
