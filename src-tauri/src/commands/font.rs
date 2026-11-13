use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use base64::Engine;
use tauri::command;

use crate::commands::oplog::{collect_protected_snapshot_ids, record_language_snapshot_in_tx};
use crate::commands::transaction::{
    execute_project_transaction, with_consistent_read, PlannedMutation, RevisionExpectation,
    TransactionPlan,
};
use crate::models::{LanguageEntry, WorkspaceConfig, WriteResult};
use crate::utils::revision::{file_revision, language_own_font_revision, normalize_rel_path};

pub(crate) const MAX_FONT_BYTES: u64 = 20 * 1024 * 1024;
pub(crate) static FONT_WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, serde::Serialize, Clone, PartialEq, Eq)]
pub struct LanguageFontStatus {
    pub language_id: String,
    pub has_own: bool,
    pub own_file_name: Option<String>,
    pub revision: String,
    pub resolved_owner_id: Option<String>,
    pub resolved_owner_name: Option<String>,
    pub resolved_file_name: Option<String>,
    pub resolved_revision: Option<String>,
}

#[derive(Debug, serde::Serialize, Clone, PartialEq, Eq)]
pub struct FontInspection {
    pub present: bool,
    pub has_own: bool,
    pub inherited: bool,
    pub revision: String,
    pub resolved_revision: Option<String>,
    pub owner_language_id: Option<String>,
    pub owner_name: Option<String>,
    pub owner_path: Option<String>,
    pub file_name: Option<String>,
    pub family_name: Option<String>,
    pub version: Option<String>,
    pub codepoints: Vec<u32>,
    pub glyphs: Vec<Vec<u32>>,
    // NOTE: 这两个布局特性字段由 GUI（FontPanel 的 ss01 传统/现代切换）消费。
    // 空 Vec 不输出键；非空时如实序列化。leaf 语言字体（Conlang Liga Test）含 GSUB liga
    // 特性，tests/golden/font_inspect_lang_leaf.json 已同步包含该键（F1.2 修复时更新）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub substitution_features: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub positioning_features: Vec<String>,
    pub warning: Option<String>,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct ResolvedFontBytes {
    pub owner_language_id: String,
    pub owner_name: String,
    pub inherited: bool,
    pub file_name: String,
    pub revision: String,
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
            existing = existing
                .parent()
                .ok_or_else(|| "Invalid language path".to_string())?;
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

fn status_for(
    project_path: &str,
    languages: &[LanguageEntry],
    lang: &LanguageEntry,
) -> LanguageFontStatus {
    let lang_dir = Path::new(project_path).join(&lang.path);
    let own = find_font_file(&lang_dir);
    let own_rev = own
        .as_ref()
        .and_then(|p| file_revision(p).ok())
        .unwrap_or_else(|| "missing".to_string());
    let resolved = resolve_owned_font(project_path, languages, &lang.language_id);
    let resolved_rev = resolved
        .as_ref()
        .and_then(|item| file_revision(&item.path).ok());
    LanguageFontStatus {
        language_id: lang.language_id.clone(),
        has_own: own.is_some(),
        own_file_name: own.as_ref().and_then(|path| file_name(path)),
        revision: own_rev,
        resolved_owner_id: resolved.as_ref().map(|item| item.language_id.clone()),
        resolved_owner_name: resolved.as_ref().map(|item| item.language_name.clone()),
        resolved_file_name: resolved.as_ref().and_then(|item| file_name(&item.path)),
        resolved_revision: resolved_rev,
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
    if face.number_of_glyphs() == 0
        || tables.cmap.is_none()
        || (tables.glyf.is_none() && tables.cff.is_none() && tables.cff2.is_none())
    {
        return Err("Font is missing a readable character map or outline table".to_string());
    }
    Ok(())
}

pub(crate) fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    crate::utils::fs_util::atomic_write_bytes(path, bytes)
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
    let project = Path::new(&project_path);
    with_consistent_read(project, "list_language_fonts", true, None, |_, _| {
        let workspace = load_workspace(&conlang_file_path)?;
        Ok(workspace
            .languages
            .iter()
            .map(|lang| status_for(&project_path, &workspace.languages, lang))
            .collect())
    })
}

#[command]
pub fn read_resolved_font(
    project_path: String,
    conlang_file_path: String,
    language_id: String,
) -> Result<Option<ResolvedFontBytes>, String> {
    let project = Path::new(&project_path);
    with_consistent_read(project, "read_resolved_font", true, None, |_, _| {
        let workspace = load_workspace(&conlang_file_path)?;
        let Some(owned) = resolve_owned_font(&project_path, &workspace.languages, &language_id)
        else {
            return Ok(None);
        };
        let bytes = fs::read(&owned.path).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_FONT_BYTES {
            return Err("Resolved font exceeds the 20 MiB limit".to_string());
        }
        let rev = file_revision(&owned.path)?;
        Ok(Some(ResolvedFontBytes {
            inherited: owned.language_id != language_id,
            owner_language_id: owned.language_id,
            owner_name: owned.language_name,
            file_name: file_name(&owned.path).unwrap_or_else(|| "font.otf".to_string()),
            revision: rev,
            bytes_base64: encode_base64(&bytes),
        }))
    })
}

#[command]
pub fn import_language_font(
    project_path: String,
    language_path: String,
    source_path: String,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    import_font_checked(
        project_path,
        language_path,
        source_path,
        None,
        expected_revision,
        operation_id,
    )
}

#[command]
pub fn read_font_candidate(source_path: String) -> Result<String, String> {
    let source = PathBuf::from(source_path);
    font_extension(&source)?;
    let length = fs::metadata(&source).map_err(|error| error.to_string())?.len();
    if length > MAX_FONT_BYTES {
        return Err("Font exceeds the 20 MiB limit".to_string());
    }
    let bytes = fs::read(source).map_err(|error| error.to_string())?;
    validate_font_bytes(&bytes)?;
    Ok(encode_base64(&bytes))
}

#[command]
pub fn import_checked_language_font(
    project_path: String,
    language_path: String,
    source_path: String,
    expected_base64: String,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    import_font_checked(
        project_path,
        language_path,
        source_path,
        Some(expected_base64),
        expected_revision,
        operation_id,
    )
}

fn import_font_checked(
    project_path: String,
    language_path: String,
    source_path: String,
    expected_base64: Option<String>,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    let _guard = FONT_WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    // Validate path & font bytes BEFORE touching project files or creating transaction journals
    let _ = language_dir(&project_path, &language_path)?;
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
    if let Some(ref expected) = expected_base64 {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(expected)
            .map_err(|error| error.to_string())?;
        if decoded != bytes {
            return Err("Font changed during validation. Please choose the file again.".to_string());
        }
    }

    let project = Path::new(&project_path);
    let source_sha = crate::utils::revision::sha256_hex(&bytes);
    let payload = serde_json::json!({
        "language_path": &language_path,
        "ext": ext,
        "source_sha256": source_sha,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project,
        "import_language_font",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let lang_dir = proj.join(&lang_rel);

            // Check CAS against current own font (whichever of font.otf / font.ttf exists, else missing)
            if let Some(ref exp_rev) = expected_revision {
                let (_, actual_rev) = language_own_font_revision(&lang_dir)?;
                let trimmed = exp_rev.trim();
                if !trimmed.is_empty() && trimmed != actual_rev {
                    return Err(format!(
                        "CONFLICT: Revision mismatch on 'font': expected '{trimmed}', actual '{actual_rev}'"
                    ));
                }
            }

            let mut mutations: Vec<PlannedMutation> = Vec::new();
            mutations.push(PlannedMutation::CreateDir {
                rel_path: lang_rel.clone(),
            });

            // Automatic `"font"` language snapshot (captures previous font OR `font_file: None`!)
            let protected = collect_protected_snapshot_ids(proj);
            let (snap_id, _) = record_language_snapshot_in_tx(
                proj,
                &lang_rel,
                "font",
                "gui",
                "import_font",
                "",
                "",
                &format!("Before importing font.{ext}"),
                None,
                &protected,
                &mut mutations,
            )?;

            let dest_rel = format!("{lang_rel}/font.{ext}");
            let dest_abs = proj.join(&dest_rel);
            mutations.push(PlannedMutation::WriteFile {
                rel_path: dest_rel,
                bytes: bytes.clone(),
            });

            let other = if ext == "otf" { "font.ttf" } else { "font.otf" };
            let other_rel = format!("{lang_rel}/{other}");
            if proj.join(&other_rel).exists() {
                mutations.push(PlannedMutation::DeletePath {
                    rel_path: other_rel,
                });
            }

            let op_id_owned = op_id.to_string();
            let snap_id_clone = snap_id.clone();

            Ok(TransactionPlan {
                expectations: vec![RevisionExpectation::file("font", dest_abs, None)],
                mutations,
                audit_summary: format!("Imported font.{ext} into '{lang_rel}'"),
                language_id: None,
                snapshot_id: Some(snap_id),
                build_response: Box::new(move |revs, warnings| WriteResult {
                    operation_id: op_id_owned,
                    revision: revs.get("font").cloned().unwrap_or_default(),
                    revisions: Some(revs.clone()),
                    snapshot_id: Some(snap_id_clone),
                    warnings,
                }),
            })
        },
    )
}

fn empty_inspection(own_rev: String) -> FontInspection {
    FontInspection {
        present: false,
        has_own: false,
        inherited: false,
        revision: own_rev,
        resolved_revision: None,
        owner_language_id: None,
        owner_name: None,
        owner_path: None,
        file_name: None,
        family_name: None,
        version: None,
        codepoints: Vec::new(),
        glyphs: Vec::new(),
        substitution_features: Vec::new(),
        positioning_features: Vec::new(),
        warning: None,
    }
}

#[command]
pub fn inspect_language_font(
    project_path: String,
    conlang_file_path: String,
    language_id: String,
) -> Result<FontInspection, String> {
    let project = Path::new(&project_path);
    with_consistent_read(project, "inspect_language_font", true, None, |_, _| {
        let workspace = load_workspace(&conlang_file_path)?;
        let lang = workspace
            .languages
            .iter()
            .find(|item| item.language_id == language_id)
            .ok_or_else(|| "Language not found".to_string())?;
        let lang_dir = Path::new(&project_path).join(&lang.path);
        let own_file = find_font_file(&lang_dir);
        let has_own = own_file.is_some();
        let own_rev = own_file
            .as_ref()
            .and_then(|p| file_revision(p).ok())
            .unwrap_or_else(|| "missing".to_string());
        let Some(owned) = resolve_owned_font(&project_path, &workspace.languages, &language_id)
        else {
            return Ok(empty_inspection(own_rev));
        };
        let resolved_rev = file_revision(&owned.path).ok();
        let owner_path = workspace
            .languages
            .iter()
            .find(|item| item.language_id == owned.language_id)
            .map(|item| item.path.clone());
        let mut inspection = FontInspection {
            present: true,
            has_own,
            inherited: owned.language_id != language_id,
            revision: own_rev,
            resolved_revision: resolved_rev,
            owner_language_id: Some(owned.language_id),
            owner_name: Some(owned.language_name),
            owner_path,
            file_name: file_name(&owned.path),
            family_name: None,
            version: None,
            codepoints: Vec::new(),
            glyphs: Vec::new(),
            substitution_features: Vec::new(),
            positioning_features: Vec::new(),
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
                inspection.substitution_features = info.substitution_features;
                inspection.positioning_features = info.positioning_features;
            }
            Err(err) => inspection.warning = Some(err),
        }
        Ok(inspection)
    })
}

#[command]
pub fn clear_language_font(
    project_path: String,
    language_path: String,
    expected_revision: Option<String>,
    operation_id: Option<String>,
) -> Result<WriteResult, String> {
    let _guard = FONT_WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    let _ = language_dir(&project_path, &language_path)?;
    let project = Path::new(&project_path);
    let payload = serde_json::json!({
        "language_path": &language_path,
        "expected_revision": &expected_revision,
    });

    execute_project_transaction(
        project,
        "clear_language_font",
        "gui",
        operation_id,
        &payload,
        None,
        |proj, op_id, _ctx| {
            let lang_rel = normalize_rel_path(&language_path)?;
            let lang_dir = proj.join(&lang_rel);

            let (_, actual_rev) = language_own_font_revision(&lang_dir)?;
            if let Some(ref exp_rev) = expected_revision {
                let trimmed = exp_rev.trim();
                if !trimmed.is_empty() && trimmed != actual_rev {
                    return Err(format!(
                        "CONFLICT: Revision mismatch on 'font': expected '{trimmed}', actual '{actual_rev}'"
                    ));
                }
            }

            let mut mutations: Vec<PlannedMutation> = Vec::new();
            let mut snap_id: Option<String> = None;

            if actual_rev != "missing" {
                let protected = collect_protected_snapshot_ids(proj);
                let (sid, _) = record_language_snapshot_in_tx(
                    proj,
                    &lang_rel,
                    "font",
                    "gui",
                    "clear_font",
                    "",
                    "",
                    "Before clearing language own font",
                    None,
                    &protected,
                    &mut mutations,
                )?;
                snap_id = Some(sid);
            }

            for name in ["font.otf", "font.ttf"] {
                let rel = format!("{lang_rel}/{name}");
                if proj.join(&rel).is_file() {
                    mutations.push(PlannedMutation::DeletePath { rel_path: rel });
                }
            }

            let op_id_owned = op_id.to_string();
            let snap_id_clone = snap_id.clone();

            Ok(TransactionPlan {
                expectations: Vec::new(),
                mutations,
                audit_summary: format!("Cleared own font in '{lang_rel}'"),
                language_id: None,
                snapshot_id: snap_id,
                build_response: Box::new(move |_, warnings| {
                    let mut revs = BTreeMap::new();
                    revs.insert("font".to_string(), "missing".to_string());
                    WriteResult {
                        operation_id: op_id_owned,
                        revision: "missing".to_string(),
                        revisions: Some(revs),
                        snapshot_id: snap_id_clone,
                        warnings,
                    }
                }),
            })
        },
    )
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
                extra: BTreeMap::new(),
            })
            .collect();
        let config = WorkspaceConfig {
            workspace_version: "3.0".to_string(),
            languages: entries,
            custom_concepts: Vec::new(),
            extra: BTreeMap::new(),
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
        fs::write(
            project.dir.join("middle").join("font.ttf"),
            fake_face(b"true"),
        )
        .unwrap();

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
            &[("root", "Root", None), ("child", "Child", Some("root"))],
        );
        let outside = TempProject::new();
        let source = write_source(&outside.dir, "Custom.otf", &fake_face(b"OTTO"));
        fs::write(project.dir.join("root").join("font.otf"), fake_face(b"OTTO")).unwrap();
        fs::write(
            project.dir.join("child").join("font.ttf"),
            fake_face(b"true"),
        )
        .unwrap();

        import_language_font(project.path(), "child".to_string(), source, None, None).unwrap();

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
            &[("root", "Root", None), ("child", "Child", Some("root"))],
        );
        fs::write(project.dir.join("root").join("font.otf"), fake_face(b"OTTO")).unwrap();
        fs::write(project.dir.join("child").join("font.otf"), fake_face(b"OTTO")).unwrap();

        clear_language_font(project.path(), "child".to_string(), None, None).unwrap();

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
        assert!(statuses
            .iter()
            .all(|item| item.resolved_owner_id.is_none()));
    }

    #[test]
    fn import_rejects_invalid_files_and_escaping_paths() {
        let project = TempProject::new();
        let outside = TempProject::new();
        let text = write_source(&outside.dir, "notes.otf", b"this is not a font");
        let err =
            import_language_font(project.path(), "root".to_string(), text, None, None).unwrap_err();
        assert!(err.contains("not a valid"));

        let font = write_source(&outside.dir, "Face.otf", &fake_face(b"OTTO"));
        let escaped = import_language_font(
            project.path(),
            "../outside".to_string(),
            font,
            None,
            None,
        )
        .unwrap_err();
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
        assert!(
            import_language_font(project.path(), "root".to_string(), truncated, None, None)
                .is_err()
        );
        assert_eq!(fs::read(dir.join("font.ttf")).unwrap(), previous);
        assert!(!dir.join("font.otf").exists());
        let valid = write_source(&sources.dir, "valid.otf", &previous);
        let candidate = read_font_candidate(valid.clone()).unwrap();
        assert_eq!(candidate, encode_base64(&previous));
        assert!(import_checked_language_font(
            project.path(),
            "root".to_string(),
            valid,
            encode_base64(b"changed"),
            None,
            None,
        )
        .is_err());
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
    fn inspection_serializes_non_empty_feature_lists() {
        let mut inspection = empty_inspection("rev-1".to_string());
        inspection.substitution_features = vec!["ss01".to_string()];
        inspection.positioning_features = vec!["kern".to_string()];
        let serialized = serde_json::to_string(&inspection).unwrap();
        assert!(
            serialized.contains("\"substitution_features\":[\"ss01\"]"),
            "expected substitution_features in {serialized}"
        );
        assert!(
            serialized.contains("\"positioning_features\":[\"kern\"]"),
            "expected positioning_features in {serialized}"
        );
    }

    #[test]
    fn inspection_omits_empty_feature_lists_to_keep_golden_bytes() {
        let inspection = empty_inspection("rev-1".to_string());
        let serialized = serde_json::to_string(&inspection).unwrap();
        assert!(!serialized.contains("substitution_features"));
        assert!(!serialized.contains("positioning_features"));
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
            None,
            None,
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
            None,
            None,
        )
        .unwrap();
        let own =
            inspect_language_font(project.path(), conlang.clone(), "child".to_string()).unwrap();
        assert!(own.has_own && !own.inherited);
        assert_eq!(own.file_name.as_deref(), Some("font.ttf"));
        assert_eq!(own.family_name.as_deref(), Some("Conlang Test"));
        assert!(!project.dir.join("child").join("font.otf").exists());

        clear_language_font(project.path(), "child".to_string(), None, None).unwrap();
        let restored =
            inspect_language_font(project.path(), conlang, "child".to_string()).unwrap();
        assert!(restored.inherited && !restored.has_own);
        assert_eq!(restored.codepoints.len(), 2);
    }
}
