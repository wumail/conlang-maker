use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{command, AppHandle, Emitter};

use crate::commands::lock::with_project_lock;
use crate::commands::transaction::match_committed_op_for_revisions;
use crate::models::{
    LanguageEntry, WorkspaceChangeKind, WorkspaceConfig, WorkspaceFileChangedEvent,
};
use crate::utils::revision::{
    canonicalize_best_effort, file_revision, find_conlang_file, language_own_font_revision,
    lexicon_revision, normalize_rel_path, resolve_project_root,
};

const DEBOUNCE_WINDOW: Duration = Duration::from_millis(200);
const MAX_COALESCE_WAIT: Duration = Duration::from_millis(600);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassifiedChange {
    pub kind: WorkspaceChangeKind,
    pub language_path: Option<String>,
    pub language_id: Option<String>,
    pub sub_target: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CoalesceKey {
    pub kind_tag: &'static str,
    pub language_path: Option<String>,
}

fn kind_to_tag(kind: &WorkspaceChangeKind) -> &'static str {
    match kind {
        WorkspaceChangeKind::Workspace => "workspace",
        WorkspaceChangeKind::Phonology => "phonology",
        WorkspaceChangeKind::Lexicon => "lexicon",
        WorkspaceChangeKind::Grammar => "grammar",
        WorkspaceChangeKind::Sca => "sca",
        WorkspaceChangeKind::Corpus => "corpus",
        WorkspaceChangeKind::Font => "font",
        WorkspaceChangeKind::Snapshots => "snapshots",
        WorkspaceChangeKind::Trash => "trash",
    }
}

/// Pure, deterministic classifier for relative paths inside a project root (`T3.8`).
/// Filters out `.tmp` files, `.conlang-maker/lock`, transaction staging/preimages, and
/// snapshot payload noise while accurately classifying nested language paths.
pub fn classify_project_rel_path(
    raw_rel_path: &str,
    languages: &[LanguageEntry],
) -> Option<ClassifiedChange> {
    let cleaned = raw_rel_path.replace('\\', "/");
    let trimmed = cleaned.trim_start_matches("./").trim_matches('/');
    if trimmed.is_empty() {
        return None;
    }

    // Ignore atomic write temp files, OS noise, and legacy lock files anywhere in the tree
    let file_name = trimmed.rsplit('/').next().unwrap_or(trimmed);
    if file_name.ends_with(".tmp")
        || file_name.ends_with(".backup")
        || file_name == ".DS_Store"
        || file_name == ".conlang.lock"
    {
        return None;
    }
    if trimmed == ".git" || trimmed.starts_with(".git/") {
        return None;
    }

    // Handle `.conlang-maker/...` internal directories
    if trimmed == ".conlang-maker" || trimmed.starts_with(".conlang-maker/") {
        let rest = trimmed.strip_prefix(".conlang-maker").unwrap_or("").trim_start_matches('/');
        if rest.is_empty()
            || rest == "lock"
            || rest.starts_with("lock/")
            || rest == "completed_ops"
            || rest.starts_with("completed_ops/")
            || rest == "mcp_audit.ndjson"
            || rest == "transactions"
            || rest.starts_with("transactions/")
        {
            return None;
        }
        if rest == "snapshots/index.json" {
            return Some(ClassifiedChange {
                kind: WorkspaceChangeKind::Snapshots,
                language_path: None,
                language_id: None,
                sub_target: None,
            });
        }
        if rest == "snapshots" || rest.starts_with("snapshots/") {
            // Ignore `snap_*` payload writes and `archived_languages` internals
            return None;
        }
        if rest == "trash" || rest.starts_with("trash/") {
            // Ignore file-by-file noise inside `trash/<id>/data/...`, emit once on `meta.json` or `trash/<id>`
            let after_trash = rest.strip_prefix("trash").unwrap_or("").trim_start_matches('/');
            if after_trash.contains("/data/") {
                return None;
            }
            return Some(ClassifiedChange {
                kind: WorkspaceChangeKind::Trash,
                language_path: None,
                language_id: None,
                sub_target: None,
            });
        }
        return None;
    }

    // Ignore `<lang>/.conlang-maker/legacy/...` and `<lang>/.oplog/snap_*`
    if trimmed.contains("/.conlang-maker/") || trimmed.ends_with("/.conlang-maker") {
        return None;
    }
    if let Some((_, after_oplog)) = trimmed.split_once("/.oplog/") {
        if after_oplog.starts_with("snap_") {
            return None;
        }
    }

    // Project-root `.conlang` file
    if !trimmed.contains('/')
        && (trimmed.ends_with(".conlang") || trimmed.ends_with(".conlang.json"))
    {
        return Some(ClassifiedChange {
            kind: WorkspaceChangeKind::Workspace,
            language_path: None,
            language_id: None,
            sub_target: None,
        });
    }

    // Match against known languages (longest path prefix first for nested directories!)
    let mut normalized_langs: Vec<(String, &LanguageEntry)> = languages
        .iter()
        .filter_map(|l| normalize_rel_path(&l.path).ok().map(|p| (p, l)))
        .collect();
    normalized_langs.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

    for (lang_rel, lang_entry) in normalized_langs {
        if let Some(tail) = trimmed.strip_prefix(&format!("{lang_rel}/")) {
            return classify_language_tail(
                &lang_rel,
                Some(lang_entry.language_id.clone()),
                tail,
            );
        }
    }

    // Fallback heuristic if `.conlang` was not yet updated or unlisted language path edited
    infer_unlisted_language_change(trimmed)
}

fn classify_language_tail(
    lang_rel: &str,
    lang_id: Option<String>,
    tail: &str,
) -> Option<ClassifiedChange> {
    match tail {
        "phonology.json" => Some(ClassifiedChange {
            kind: WorkspaceChangeKind::Phonology,
            language_path: Some(lang_rel.to_string()),
            language_id: lang_id,
            sub_target: None,
        }),
        "grammar.json" => Some(ClassifiedChange {
            kind: WorkspaceChangeKind::Grammar,
            language_path: Some(lang_rel.to_string()),
            language_id: lang_id,
            sub_target: None,
        }),
        "sca_rules.json" => Some(ClassifiedChange {
            kind: WorkspaceChangeKind::Sca,
            language_path: Some(lang_rel.to_string()),
            language_id: lang_id,
            sub_target: None,
        }),
        "font.otf" | "font.ttf" => Some(ClassifiedChange {
            kind: WorkspaceChangeKind::Font,
            language_path: Some(lang_rel.to_string()),
            language_id: lang_id,
            sub_target: Some(tail.to_string()),
        }),
        ".oplog/oplog.json" => Some(ClassifiedChange {
            kind: WorkspaceChangeKind::Snapshots,
            language_path: Some(lang_rel.to_string()),
            language_id: lang_id,
            sub_target: None,
        }),
        "lexicon" => Some(ClassifiedChange {
            kind: WorkspaceChangeKind::Lexicon,
            language_path: Some(lang_rel.to_string()),
            language_id: lang_id,
            sub_target: None,
        }),
        "corpus" => Some(ClassifiedChange {
            kind: WorkspaceChangeKind::Corpus,
            language_path: Some(lang_rel.to_string()),
            language_id: lang_id,
            sub_target: None,
        }),
        _ => {
            if let Some(fname) = tail.strip_prefix("lexicon/") {
                if !fname.contains('/') && fname.ends_with(".ndjson") {
                    return Some(ClassifiedChange {
                        kind: WorkspaceChangeKind::Lexicon,
                        language_path: Some(lang_rel.to_string()),
                        language_id: lang_id,
                        sub_target: Some(fname.to_string()),
                    });
                }
            }
            if let Some(fname) = tail.strip_prefix("corpus/") {
                if !fname.contains('/') && fname.ends_with(".json") {
                    return Some(ClassifiedChange {
                        kind: WorkspaceChangeKind::Corpus,
                        language_path: Some(lang_rel.to_string()),
                        language_id: lang_id,
                        sub_target: Some(fname.to_string()),
                    });
                }
            }
            None
        }
    }
}

fn infer_unlisted_language_change(trimmed: &str) -> Option<ClassifiedChange> {
    for suffix in [
        "/phonology.json",
        "/grammar.json",
        "/sca_rules.json",
        "/font.otf",
        "/font.ttf",
        "/.oplog/oplog.json",
    ] {
        if let Some(lang_rel) = trimmed.strip_suffix(suffix) {
            if !lang_rel.is_empty() {
                return classify_language_tail(lang_rel, None, suffix.trim_start_matches('/'));
            }
        }
    }
    if let Some((lang_rel, fname)) = trimmed.rsplit_once("/lexicon/") {
        if !lang_rel.is_empty() && fname.ends_with(".ndjson") {
            return classify_language_tail(lang_rel, None, &format!("lexicon/{fname}"));
        }
    }
    if let Some((lang_rel, fname)) = trimmed.rsplit_once("/corpus/") {
        if !lang_rel.is_empty() && fname.ends_with(".json") {
            return classify_language_tail(lang_rel, None, &format!("corpus/{fname}"));
        }
    }
    None
}

/// Coalesce a batch of classified changes into deterministic groups (`(kind, language_path)`).
pub fn coalesce_changes(
    changes: impl IntoIterator<Item = ClassifiedChange>,
) -> BTreeMap<CoalesceKey, (WorkspaceChangeKind, Option<String>, HashSet<String>)> {
    let mut grouped: BTreeMap<CoalesceKey, (WorkspaceChangeKind, Option<String>, HashSet<String>)> =
        BTreeMap::new();
    for ch in changes {
        let key = CoalesceKey {
            kind_tag: kind_to_tag(&ch.kind),
            language_path: ch.language_path.clone(),
        };
        let entry = grouped
            .entry(key)
            .or_insert_with(|| (ch.kind, ch.language_id, HashSet::new()));
        if let Some(sub) = ch.sub_target {
            entry.2.insert(sub);
        }
    }
    grouped
}

/// Compute `affected_language_ids` when `kind` changes on `language_id`:
/// - `Workspace`: all languages in workspace (parent chains or tree may have changed)
/// - `Phonology` | `Font`: `language_id` + all transitive descendants in `languages`
/// - Other kinds: `[language_id]`
pub fn compute_affected_language_ids(
    kind: &WorkspaceChangeKind,
    language_id: Option<&str>,
    languages: &[LanguageEntry],
) -> Vec<String> {
    match kind {
        WorkspaceChangeKind::Workspace => languages.iter().map(|l| l.language_id.clone()).collect(),
        WorkspaceChangeKind::Phonology | WorkspaceChangeKind::Font => {
            let Some(start_id) = language_id else {
                return Vec::new();
            };
            let mut visited = HashSet::new();
            let mut queue = VecDeque::new();
            let mut ordered = Vec::new();
            visited.insert(start_id.to_string());
            queue.push_back(start_id.to_string());

            while let Some(cur) = queue.pop_front() {
                ordered.push(cur.clone());
                for lang in languages {
                    if lang.parent_id.as_deref() == Some(cur.as_str())
                        && visited.insert(lang.language_id.clone())
                    {
                        queue.push_back(lang.language_id.clone());
                    }
                }
            }
            ordered
        }
        _ => language_id.map(|id| vec![id.to_string()]).unwrap_or_default(),
    }
}

/// Build the full `WorkspaceFileChangedEvent` inside the project lock so revisions
/// and `completed_ops` correlation are 100% consistent (`T3.8`).
pub fn build_workspace_change_event(
    project_dir: &Path,
    kind: WorkspaceChangeKind,
    language_path: Option<String>,
    sub_targets: &HashSet<String>,
) -> Result<WorkspaceFileChangedEvent, String> {
    with_project_lock(project_dir, "watcher_inspect", None, |_| {
        let ws_file = find_conlang_file(project_dir);
        let ws_cfg = ws_file
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<WorkspaceConfig>(&s).ok());
        let languages: &[LanguageEntry] = ws_cfg
            .as_ref()
            .map(|c| c.languages.as_slice())
            .unwrap_or(&[]);

        let resolved_lang_id = language_path.as_ref().and_then(|lp| {
            languages
                .iter()
                .find(|l| normalize_rel_path(&l.path).ok().as_deref() == Some(lp.as_str()))
                .map(|l| l.language_id.clone())
        });

        let mut revisions: BTreeMap<String, String> = BTreeMap::new();
        match &kind {
            WorkspaceChangeKind::Workspace => {
                let rev = ws_file
                    .as_ref()
                    .and_then(|p| file_revision(p).ok())
                    .unwrap_or_else(|| "missing".to_string());
                revisions.insert("workspace".to_string(), rev);
            }
            WorkspaceChangeKind::Phonology => {
                if let Some(ref lp) = language_path {
                    revisions.insert(
                        "phonology".to_string(),
                        file_revision(&project_dir.join(lp).join("phonology.json"))?,
                    );
                }
            }
            WorkspaceChangeKind::Grammar => {
                if let Some(ref lp) = language_path {
                    revisions.insert(
                        "grammar".to_string(),
                        file_revision(&project_dir.join(lp).join("grammar.json"))?,
                    );
                }
            }
            WorkspaceChangeKind::Sca => {
                if let Some(ref lp) = language_path {
                    revisions.insert(
                        "sca".to_string(),
                        file_revision(&project_dir.join(lp).join("sca_rules.json"))?,
                    );
                }
            }
            WorkspaceChangeKind::Lexicon => {
                if let Some(ref lp) = language_path {
                    revisions.insert(
                        "lexicon".to_string(),
                        lexicon_revision(&project_dir.join(lp).join("lexicon"))?,
                    );
                }
            }
            WorkspaceChangeKind::Corpus => {
                if let Some(ref lp) = language_path {
                    let cdir = project_dir.join(lp).join("corpus");
                    revisions.insert(
                        "corpus_index".to_string(),
                        file_revision(&cdir.join("corpus_index.json"))?,
                    );
                    for sub in sub_targets {
                        if sub != "corpus_index.json" && sub.ends_with(".json") {
                            if let Some(cid) = sub.strip_suffix(".json") {
                                revisions.insert(
                                    format!("corpus:{cid}"),
                                    file_revision(&cdir.join(sub))?,
                                );
                            }
                        }
                    }
                }
            }
            WorkspaceChangeKind::Font => {
                if let Some(ref lp) = language_path {
                    let (_, frev) = language_own_font_revision(&project_dir.join(lp))?;
                    revisions.insert("font".to_string(), frev);
                }
            }
            WorkspaceChangeKind::Snapshots => {
                if let Some(ref lp) = language_path {
                    revisions.insert(
                        "oplog".to_string(),
                        file_revision(&project_dir.join(lp).join(".oplog/oplog.json"))?,
                    );
                } else {
                    revisions.insert(
                        "project_snapshots".to_string(),
                        file_revision(
                            &project_dir.join(".conlang-maker/snapshots/index.json"),
                        )?,
                    );
                }
            }
            WorkspaceChangeKind::Trash => {
                revisions.insert("trash".to_string(), "updated".to_string());
            }
        }

        // Determine origin ("gui" | "mcp" | "external") by matching current disk revisions
        // against committed transaction records in `completed_ops/`.
        let matchable_revs: BTreeMap<String, String> = revisions
            .iter()
            .filter(|(k, _)| !k.starts_with("corpus:") && *k != "trash" && *k != "oplog" && *k != "project_snapshots")
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let (operation_id, origin) = if matchable_revs.is_empty() {
            (None, "gui".to_string())
        } else {
            match_committed_op_for_revisions(project_dir, &matchable_revs)
        };

        let affected_language_ids = compute_affected_language_ids(
            &kind,
            resolved_lang_id.as_deref(),
            languages,
        );

        Ok(WorkspaceFileChangedEvent {
            project_path: project_dir.to_string_lossy().into_owned(),
            operation_id,
            origin,
            language_path,
            language_id: resolved_lang_id,
            kind,
            revisions,
            affected_language_ids,
        })
    })
}

// ── Runtime Watcher Registry (`watch_project` / `unwatch_project`) ──

enum WatcherMsg {
    FsEvent(PathBuf),
    Stop,
}

struct ActiveProjectWatcher {
    stop_tx: Sender<WatcherMsg>,
    _watcher: RecommendedWatcher,
}

fn watcher_registry() -> &'static Mutex<HashMap<PathBuf, ActiveProjectWatcher>> {
    static REGISTRY: OnceLock<Mutex<HashMap<PathBuf, ActiveProjectWatcher>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

#[command]
pub fn watch_project(app: AppHandle, project_path: String) -> Result<(), String> {
    let resolved = resolve_project_root(Path::new(&project_path));
    if !resolved.is_dir() {
        return Err(format!(
            "NOT_FOUND: Project directory does not exist: {}",
            resolved.display()
        ));
    }
    let canonical_root = canonicalize_best_effort(&resolved);

    // Stop any previous watcher on the same project root first
    unwatch_project_internal(&canonical_root)?;

    let (tx, rx) = mpsc::channel::<WatcherMsg>();
    let event_tx = tx.clone();

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            // Ignore pure Access (open/read) events to avoid feedback loops!
            if matches!(event.kind, notify::EventKind::Access(_)) {
                return;
            }
            for p in event.paths {
                let _ = event_tx.send(WatcherMsg::FsEvent(p));
            }
        }
    })
    .map_err(|e| format!("IO: Failed creating file watcher: {e}"))?;

    watcher
        .watch(&canonical_root, RecursiveMode::Recursive)
        .map_err(|e| format!("IO: Failed watching '{}': {e}", canonical_root.display()))?;

    let worker_root = canonical_root.clone();
    std::thread::spawn(move || {
        run_debounce_loop(app, worker_root, rx);
    });

    let mut guard = watcher_registry()
        .lock()
        .map_err(|_| "IO: Watcher registry poisoned".to_string())?;
    guard.insert(
        canonical_root,
        ActiveProjectWatcher {
            stop_tx: tx,
            _watcher: watcher,
        },
    );

    Ok(())
}

#[command]
pub fn unwatch_project(project_path: String) -> Result<(), String> {
    let resolved = resolve_project_root(Path::new(&project_path));
    let canonical_root = canonicalize_best_effort(&resolved);
    unwatch_project_internal(&canonical_root)
}

fn unwatch_project_internal(canonical_root: &Path) -> Result<(), String> {
    let mut guard = watcher_registry()
        .lock()
        .map_err(|_| "IO: Watcher registry poisoned".to_string())?;
    if let Some(existing) = guard.remove(canonical_root) {
        let _ = existing.stop_tx.send(WatcherMsg::Stop);
    }
    Ok(())
}

fn run_debounce_loop(app: AppHandle, project_root: PathBuf, rx: mpsc::Receiver<WatcherMsg>) {
    let mut pending_paths: HashSet<PathBuf> = HashSet::new();
    let mut first_event_at: Option<Instant> = None;
    let mut last_event_at: Option<Instant> = None;

    loop {
        let timeout = if let (Some(first), Some(last)) = (first_event_at, last_event_at) {
            let now = Instant::now();
            let since_last = now.saturating_duration_since(last);
            let since_first = now.saturating_duration_since(first);
            if since_last >= DEBOUNCE_WINDOW || since_first >= MAX_COALESCE_WAIT {
                Duration::ZERO
            } else {
                let rem_debounce = DEBOUNCE_WINDOW.saturating_sub(since_last);
                let rem_max = MAX_COALESCE_WAIT.saturating_sub(since_first);
                rem_debounce.min(rem_max)
            }
        } else {
            Duration::from_secs(3600)
        };

        match rx.recv_timeout(timeout) {
            Ok(WatcherMsg::Stop) | Err(RecvTimeoutError::Disconnected) => break,
            Ok(WatcherMsg::FsEvent(path)) => {
                let now = Instant::now();
                if first_event_at.is_none() {
                    first_event_at = Some(now);
                }
                last_event_at = Some(now);
                pending_paths.insert(path);
            }
            Err(RecvTimeoutError::Timeout) => {
                if !pending_paths.is_empty() {
                    let batch: Vec<PathBuf> = pending_paths.drain().collect();
                    first_event_at = None;
                    last_event_at = None;
                    flush_watcher_batch(&app, &project_root, &batch);
                } else {
                    first_event_at = None;
                    last_event_at = None;
                }
            }
        }
    }
}

fn flush_watcher_batch(app: &AppHandle, project_root: &Path, paths: &[PathBuf]) {
    let ws_cfg = find_conlang_file(project_root)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<WorkspaceConfig>(&s).ok());
    let languages: &[LanguageEntry] = ws_cfg
        .as_ref()
        .map(|c| c.languages.as_slice())
        .unwrap_or(&[]);

    let mut classified = Vec::new();
    for raw_path in paths {
        let norm_p = canonicalize_best_effort(raw_path);
        let rel_opt = norm_p
            .strip_prefix(project_root)
            .ok()
            .or_else(|| raw_path.strip_prefix(project_root).ok());
        if let Some(rel) = rel_opt {
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            if let Some(ch) = classify_project_rel_path(&rel_str, languages) {
                classified.push(ch);
            }
        }
    }

    if classified.is_empty() {
        return;
    }

    let groups = coalesce_changes(classified);
    for (key, (kind, _lang_id, sub_targets)) in groups {
        if let Ok(event) =
            build_workspace_change_event(project_root, kind, key.language_path, &sub_targets)
        {
            let _ = app.emit("workspace-file-changed", &event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::grammar::save_grammar;
    use std::collections::BTreeMap;

    fn sample_languages() -> Vec<LanguageEntry> {
        vec![
            LanguageEntry {
                language_id: "lang_root".to_string(),
                name: "Root".to_string(),
                path: "roots/root".to_string(),
                parent_id: None,
                extra: BTreeMap::new(),
            },
            LanguageEntry {
                language_id: "lang_child".to_string(),
                name: "Child".to_string(),
                path: "stages/child".to_string(),
                parent_id: Some("lang_root".to_string()),
                extra: BTreeMap::new(),
            },
            LanguageEntry {
                language_id: "lang_leaf".to_string(),
                name: "Leaf".to_string(),
                path: "branches/leaf".to_string(),
                parent_id: Some("lang_child".to_string()),
                extra: BTreeMap::new(),
            },
        ]
    }

    #[test]
    fn t3_8_path_classification_filters_noise_and_handles_nested_paths() {
        let langs = sample_languages();

        // Noise MUST be ignored
        assert!(classify_project_rel_path("roots/root/grammar.json.123.abc.tmp", &langs).is_none());
        assert!(classify_project_rel_path(".conlang-maker/lock/owner-a-1-b.json", &langs).is_none());
        assert!(classify_project_rel_path(
            ".conlang-maker/transactions/op1/staged/0",
            &langs
        )
        .is_none());
        assert!(classify_project_rel_path(
            ".conlang-maker/snapshots/snap_123/manifest.json",
            &langs
        )
        .is_none());
        assert!(classify_project_rel_path(
            "stages/child/.oplog/snap_999/files/phonology.json",
            &langs
        )
        .is_none());

        // Business files in nested language dirs MUST classify accurately
        let g = classify_project_rel_path("branches/leaf/grammar.json", &langs).unwrap();
        assert_eq!(g.kind, WorkspaceChangeKind::Grammar);
        assert_eq!(g.language_path.as_deref(), Some("branches/leaf"));
        assert_eq!(g.language_id.as_deref(), Some("lang_leaf"));

        let ws = classify_project_rel_path("family.conlang", &langs).unwrap();
        assert_eq!(ws.kind, WorkspaceChangeKind::Workspace);

        // Coalescing merges cross-bucket lexicon edits into 1 event
        let c1 = classify_project_rel_path("roots/root/lexicon/lexicon_a.ndjson", &langs).unwrap();
        let c2 = classify_project_rel_path("roots/root/lexicon/lexicon_b.ndjson", &langs).unwrap();
        let merged = coalesce_changes(vec![c1, c2]);
        assert_eq!(merged.len(), 1);

        // Ancestor font / phonology change propagates to all descendants!
        let affected = compute_affected_language_ids(
            &WorkspaceChangeKind::Font,
            Some("lang_root"),
            &langs,
        );
        assert_eq!(affected, vec!["lang_root", "lang_child", "lang_leaf"]);
    }

    #[test]
    fn t3_8_origin_distinguishes_own_commit_from_immediate_external_edit() {
        let temp = tempfile::tempdir().unwrap();
        let proj = temp.path();
        let proj_str = proj.to_string_lossy().to_string();

        let ws = WorkspaceConfig {
            workspace_version: "3.0".to_string(),
            languages: sample_languages(),
            custom_concepts: Vec::new(),
            extra: BTreeMap::new(),
        };
        fs::write(
            proj.join("family.conlang"),
            serde_json::to_string_pretty(&ws).unwrap(),
        )
        .unwrap();

        // 1. GUI commits `save_grammar` with operation_id = "op_gui_1"
        let mut gram = crate::models::GrammarConfig::default();
        gram.language_id = "lang_root".to_string();
        save_grammar(
            proj_str,
            "roots/root".to_string(),
            gram,
            None,
            Some("op_gui_1".to_string()),
        )
        .unwrap();

        let ev_own = build_workspace_change_event(
            proj,
            WorkspaceChangeKind::Grammar,
            Some("roots/root".to_string()),
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(ev_own.origin, "gui");
        assert_eq!(ev_own.operation_id.as_deref(), Some("op_gui_1"));

        // 2. External editor immediately modifies `roots/root/grammar.json` -> MUST be recognized as "external"!
        fs::write(
            proj.join("roots/root/grammar.json"),
            b"{\"language_id\":\"lang_root\",\"__external\":true}\n",
        )
        .unwrap();

        let ev_ext = build_workspace_change_event(
            proj,
            WorkspaceChangeKind::Grammar,
            Some("roots/root".to_string()),
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(ev_ext.origin, "external");
        assert!(ev_ext.operation_id.is_none());
    }
}
