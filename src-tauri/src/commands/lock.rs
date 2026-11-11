use crate::utils::fs_util::{generate_nonce_hex, now_rfc3339};
use crate::utils::revision::{canonicalize_best_effort, resolve_project_root, sha256_hex};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

pub const DEFAULT_LOCK_TIMEOUT_MS: u64 = 5_000;
const BASE_BACKOFF_MS: u64 = 50;
const MAX_JITTER_MS: u64 = 25;
const EMPTY_DIR_GRACE_SECS: u64 = 30;

/// Explicit execution context tracking locks held by the current call chain for reentrancy.
/// Different threads/tasks without this context serialize on the in-process project mutex.
#[derive(Debug, Clone, Default)]
pub struct LockContext {
    held_locks: HashSet<PathBuf>,
}

impl LockContext {
    pub fn holds(&self, canonical_lock_dir: &Path) -> bool {
        self.held_locks.contains(canonical_lock_dir)
    }

    fn with_lock(&self, canonical_lock_dir: PathBuf) -> Self {
        let mut next = self.clone();
        next.held_locks.insert(canonical_lock_dir);
        next
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct OwnerFilePayload {
    host_key: String,
    pid: u32,
    nonce: String,
    tool: String,
    acquired_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedOwnerName {
    pub host_key: String,
    pub pid: u32,
    pub nonce: String,
}

#[cfg(test)]
#[derive(Default, Clone)]
pub struct LockTestHooks {
    pub after_mkdir: Option<Arc<dyn Fn() + Send + Sync>>,
    pub after_create_owner: Option<Arc<dyn Fn(&Path) + Send + Sync>>,
    pub before_read_dir: Option<Arc<dyn Fn() + Send + Sync>>,
    pub fail_read_dir_once: Option<Arc<std::sync::atomic::AtomicBool>>,
    pub before_reclaim_unlink: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    pub before_release_rmdir: Option<Arc<dyn Fn() + Send + Sync>>,
}

static IN_PROCESS_MUTEXES: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
static CACHED_HOST_KEY: OnceLock<String> = OnceLock::new();

fn project_in_process_mutex(canonical_lock_dir: &Path) -> Arc<Mutex<()>> {
    let map_mutex = IN_PROCESS_MUTEXES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = map_mutex.lock().unwrap_or_else(|e| e.into_inner());
    Arc::clone(
        guard
            .entry(canonical_lock_dir.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(()))),
    )
}

fn raw_os_hostname() -> String {
    #[cfg(unix)]
    {
        let mut buf = [0u8; 256];
        // SAFETY: `buf` is a valid mutable stack buffer of 256 bytes passed with its exact length.
        let rc = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) };
        if rc == 0 {
            let len = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
            let s = String::from_utf8_lossy(&buf[..len]).trim().to_lowercase();
            if !s.is_empty() {
                return s;
            }
        }
    }

    if let Ok(env_host) = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")) {
        let s = env_host.trim().to_lowercase();
        if !s.is_empty() {
            return s;
        }
    }

    "localhost".to_string()
}

/// §3.2 Host key: OS hostname trimmed & lowercased (fallback `"localhost"`),
/// SHA-256 first 12 lowercase hex characters. Matches `mcp/storage/lock.ts` byte-for-byte.
pub fn compute_host_key() -> String {
    CACHED_HOST_KEY
        .get_or_init(|| {
            let host = raw_os_hostname();
            let digest = sha256_hex(host.as_bytes());
            digest[..12].to_string()
        })
        .clone()
}

/// Parse `owner-<host_key_12hex>-<pid>-<nonce_32hex>.json`.
pub fn parse_owner_filename(file_name: &str) -> Option<ParsedOwnerName> {
    let inner = file_name.strip_prefix("owner-")?.strip_suffix(".json")?;
    let mut parts = inner.splitn(3, '-');
    let host_key = parts.next()?;
    let pid_str = parts.next()?;
    let nonce = parts.next()?;

    if host_key.len() != 12
        || !host_key
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return None;
    }
    if nonce.len() != 32
        || !nonce
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return None;
    }
    let pid: u32 = pid_str.parse().ok()?;
    if pid == 0 {
        return None;
    }

    Some(ParsedOwnerName {
        host_key: host_key.to_string(),
        pid,
        nonce: nonce.to_string(),
    })
}

/// §3.2 Reliable local process death detection.
/// Returns `true` ONLY when `pid` is provably dead on this local OS namespace.
/// On Unix, `EPERM` means the process IS alive under another user -> returns `false`!
pub fn is_local_pid_dead(pid: u32) -> bool {
    if pid == 0 || pid == std::process::id() {
        return false;
    }

    #[cfg(unix)]
    {
        if pid > i32::MAX as u32 {
            return false;
        }
        // SAFETY: `kill(pid, 0)` sends no signal and only performs kernel process/permission check.
        let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
        if rc == 0 {
            return false;
        }
        let errno = std::io::Error::last_os_error().raw_os_error();
        errno == Some(libc::ESRCH)
    }

    #[cfg(windows)]
    {
        const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
        const ERROR_INVALID_PARAMETER: u32 = 87;
        const STILL_ACTIVE: u32 = 259;

        extern "system" {
            fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> *mut core::ffi::c_void;
            fn GetExitCodeProcess(hProcess: *mut core::ffi::c_void, lpExitCode: *mut u32) -> i32;
            fn CloseHandle(hObject: *mut core::ffi::c_void) -> i32;
            fn GetLastError() -> u32;
        }

        // SAFETY: Standard Win32 handle query with immediate CloseHandle.
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return GetLastError() == ERROR_INVALID_PARAMETER;
            }
            let mut exit_code: u32 = 0;
            let ok = GetExitCodeProcess(handle, &mut exit_code);
            let _ = CloseHandle(handle);
            ok != 0 && exit_code != STILL_ACTIVE
        }
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        false
    }
}

struct OwnerReleaseGuard {
    lock_dir: PathBuf,
    owner_file: String,
    #[cfg(test)]
    before_release_rmdir: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl Drop for OwnerReleaseGuard {
    fn drop(&mut self) {
        let owner_path = self.lock_dir.join(&self.owner_file);
        let _ = fs::remove_file(&owner_path);
        #[cfg(test)]
        if let Some(ref hook) = self.before_release_rmdir {
            hook();
        }
        // Never remove_dir_all; only best-effort empty directory rmdir!
        let _ = fs::remove_dir(&self.lock_dir);
    }
}

/// Acquire the §3.2 project lock for `project_or_conlang` and run `f`.
pub fn with_project_lock<R, F>(
    project_or_conlang: &Path,
    tool_name: &str,
    ctx_opt: Option<&LockContext>,
    f: F,
) -> Result<R, String>
where
    F: FnOnce(&LockContext) -> Result<R, String>,
{
    let project_root = resolve_project_root(project_or_conlang);
    let lock_dir = project_root.join(".conlang-maker").join("lock");
    with_custom_lock_dir(&lock_dir, tool_name, ctx_opt, f)
}

/// Acquire a §3.2 owner lock on an arbitrary lock directory (e.g. registry lock).
pub fn with_custom_lock_dir<R, F>(
    raw_lock_dir: &Path,
    tool_name: &str,
    ctx_opt: Option<&LockContext>,
    f: F,
) -> Result<R, String>
where
    F: FnOnce(&LockContext) -> Result<R, String>,
{
    with_directory_lock(
        raw_lock_dir,
        tool_name,
        DEFAULT_LOCK_TIMEOUT_MS,
        ctx_opt,
        #[cfg(test)]
        None,
        f,
    )
}

/// Acquire a directory lock using the §3.2 owner protocol.
pub fn with_directory_lock<R, F>(
    raw_lock_dir: &Path,
    tool_name: &str,
    timeout_ms: u64,
    ctx_opt: Option<&LockContext>,
    #[cfg(test)] hooks: Option<LockTestHooks>,
    f: F,
) -> Result<R, String>
where
    F: FnOnce(&LockContext) -> Result<R, String>,
{
    let lock_dir = canonicalize_best_effort(raw_lock_dir);

    if let Some(ctx) = ctx_opt {
        if ctx.holds(&lock_dir) {
            return f(ctx);
        }
    }

    let in_proc_mutex = project_in_process_mutex(&lock_dir);
    let _in_proc_guard = in_proc_mutex.lock().unwrap_or_else(|e| e.into_inner());

    let local_host_key = compute_host_key();
    let pid = std::process::id();
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut acquired_owner_name: Option<String> = None;

    loop {
        // Empty stale lock directory grace period check (30s)
        if let Ok(meta) = fs::metadata(&lock_dir) {
            if meta.is_dir() {
                let is_old = meta
                    .modified()
                    .ok()
                    .and_then(|m| SystemTime::now().duration_since(m).ok())
                    .is_some_and(|age| age > Duration::from_secs(EMPTY_DIR_GRACE_SECS));
                if is_old {
                    if let Ok(mut rd) = fs::read_dir(&lock_dir) {
                        if rd.next().is_none() {
                            let _ = fs::remove_dir(&lock_dir);
                        }
                    }
                }
            }
        }

        let _ = fs::create_dir_all(&lock_dir);

        #[cfg(test)]
        if let Some(ref h) = hooks {
            if let Some(ref cb) = h.after_mkdir {
                cb();
            }
        }

        let nonce = generate_nonce_hex();
        let owner_name = format!("owner-{local_host_key}-{pid}-{nonce}.json");
        let owner_path = lock_dir.join(&owner_name);

        let mut created_by_us = false;
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&owner_path)
        {
            Ok(mut file) => {
                let payload = OwnerFilePayload {
                    host_key: local_host_key.clone(),
                    pid,
                    nonce: nonce.clone(),
                    tool: tool_name.to_string(),
                    acquired_at: now_rfc3339(),
                };
                let write_res = serde_json::to_vec_pretty(&payload)
                    .map_err(|e| format!("IO: Failed to serialize lock owner payload: {e}"))
                    .and_then(|bytes| {
                        file.write_all(&bytes)
                            .map_err(|e| format!("IO: Failed writing lock owner file: {e}"))?;
                        file.sync_all()
                            .map_err(|e| format!("IO: Failed syncing lock owner file: {e}"))
                    });
                drop(file);
                if let Err(err) = write_res {
                    let _ = fs::remove_file(&owner_path);
                    let _ = fs::remove_dir(&lock_dir);
                    return Err(err);
                }
                created_by_us = true;
            }
            Err(err)
                if err.kind() == ErrorKind::AlreadyExists || err.kind() == ErrorKind::NotFound =>
            {
                // Never delete an existing file on AlreadyExists; NotFound means lock_dir raced with rmdir.
            }
            Err(err) => {
                return Err(format!(
                    "IO: Failed creating lock owner file '{}': {err}",
                    owner_path.display()
                ));
            }
        }

        if created_by_us {
            #[cfg(test)]
            if let Some(ref h) = hooks {
                if let Some(ref cb) = h.after_create_owner {
                    cb(&owner_path);
                }
                if let Some(ref cb) = h.before_read_dir {
                    cb();
                }
            }

            let enumerated = enumerate_lock_dir(
                &lock_dir,
                #[cfg(test)]
                hooks.as_ref(),
            );

            if let Some(entries) = enumerated {
                let owners: Vec<String> = entries
                    .into_iter()
                    .filter(|name| name.starts_with("owner-"))
                    .collect();

                if owners.len() == 1 && owners[0] == owner_name {
                    acquired_owner_name = Some(owner_name);
                    break;
                }

                // Reclaim provably dead local owners (even 0-byte or truncated JSON files, via filename identity)
                for other in &owners {
                    if other == &owner_name {
                        continue;
                    }
                    if let Some(parsed) = parse_owner_filename(other) {
                        if parsed.host_key == local_host_key
                            && parsed.pid != pid
                            && is_local_pid_dead(parsed.pid)
                        {
                            #[cfg(test)]
                            if let Some(ref h) = hooks {
                                if let Some(ref cb) = h.before_reclaim_unlink {
                                    cb(other);
                                }
                            }
                            let _ = fs::remove_file(lock_dir.join(other));
                        }
                    }
                }
            }

            // Contended or enumeration failed: withdraw OUR owner file & attempt empty rmdir
            let _ = fs::remove_file(&owner_path);
            let _ = fs::remove_dir(&lock_dir);
        }

        let now = Instant::now();
        if now >= deadline {
            break;
        }
        let jitter = rand::thread_rng().gen_range(0..MAX_JITTER_MS);
        let sleep_dur = Duration::from_millis(BASE_BACKOFF_MS + jitter)
            .min(deadline.saturating_duration_since(now));
        thread::sleep(sleep_dur);
    }

    let owner_file = acquired_owner_name.ok_or_else(|| {
        format!(
            "LOCKED: Timed out after {timeout_ms}ms waiting for project lock at '{}'",
            lock_dir.display()
        )
    })?;

    let _release_guard = OwnerReleaseGuard {
        lock_dir: lock_dir.clone(),
        owner_file,
        #[cfg(test)]
        before_release_rmdir: hooks.and_then(|h| h.before_release_rmdir),
    };

    let next_ctx = match ctx_opt {
        Some(existing) => existing.with_lock(lock_dir),
        None => LockContext::default().with_lock(lock_dir),
    };

    f(&next_ctx)
}

fn enumerate_lock_dir(
    lock_dir: &Path,
    #[cfg(test)] hooks: Option<&LockTestHooks>,
) -> Option<Vec<String>> {
    #[cfg(test)]
    if let Some(h) = hooks {
        if let Some(ref flag) = h.fail_read_dir_once {
            if flag.swap(false, std::sync::atomic::Ordering::SeqCst) {
                return None;
            }
        }
    }

    let rd = fs::read_dir(lock_dir).ok()?;
    let mut names = Vec::new();
    for entry_res in rd {
        let entry = entry_res.ok()?;
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    Some(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Barrier;

    #[test]
    fn t1_9_acquire_release_and_nested_reentrancy_only_with_explicit_context() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path();

        let entered = with_project_lock(project, "outer_test", None, |ctx| {
            let lock_dir = project.join(".conlang-maker").join("lock");
            let owners: Vec<_> = fs::read_dir(&lock_dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .collect();
            assert_eq!(owners.len(), 1);

            // Reentrant call passing Some(ctx) succeeds immediately without creating a second owner file
            with_project_lock(project, "inner_test", Some(ctx), |_inner_ctx| {
                let owners_inner: Vec<_> = fs::read_dir(&lock_dir)
                    .unwrap()
                    .filter_map(|e| e.ok())
                    .collect();
                assert_eq!(owners_inner.len(), 1);
                Ok(42)
            })
        })
        .unwrap();

        assert_eq!(entered, 42);
        // Empty lock directory cleaned up on release
        assert!(!project.join(".conlang-maker").join("lock").exists());
    }

    #[test]
    fn t1_9_same_pid_parallel_threads_serialize_and_active_never_exceeds_one() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().to_path_buf();
        let active = Arc::new(AtomicUsize::new(0));
        let max_seen = Arc::new(AtomicUsize::new(0));
        let total_runs = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(6));

        let mut handles = Vec::new();
        for _ in 0..6 {
            let p = project.clone();
            let act = Arc::clone(&active);
            let max_a = Arc::clone(&max_seen);
            let tot = Arc::clone(&total_runs);
            let b = Arc::clone(&barrier);
            handles.push(thread::spawn(move || {
                b.wait();
                for _ in 0..8 {
                    with_project_lock(&p, "parallel_worker", None, |_ctx| {
                        let cur = act.fetch_add(1, Ordering::SeqCst) + 1;
                        assert!(cur <= 1, "Critical section violated: active = {cur}");
                        max_a.fetch_max(cur, Ordering::SeqCst);
                        thread::sleep(Duration::from_millis(2));
                        act.fetch_sub(1, Ordering::SeqCst);
                        tot.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    })
                    .unwrap();
                }
            }));
        }

        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(max_seen.load(Ordering::SeqCst), 1);
        assert_eq!(total_runs.load(Ordering::SeqCst), 48);
    }

    #[test]
    fn t1_9_foreign_or_live_owner_times_out_with_locked_error() {
        let temp = tempfile::tempdir().unwrap();
        let lock_dir = temp.path().join(".conlang-maker").join("lock");
        fs::create_dir_all(&lock_dir).unwrap();

        // Foreign host_key (12 zeroes unless local happens to be all zeroes)
        let foreign_host = if compute_host_key() == "000000000000" {
            "ffffffffffff"
        } else {
            "000000000000"
        };
        let foreign_owner = format!(
            "owner-{foreign_host}-999999-{}.json",
            "a".repeat(32)
        );
        fs::write(lock_dir.join(&foreign_owner), b"").unwrap();

        let err = with_directory_lock(&lock_dir, "contender", 160, None, None, |_ctx| Ok(())).unwrap_err();
        assert!(err.starts_with("LOCKED:"), "Expected LOCKED error, got: {err}");
        // Foreign owner file MUST NOT be deleted
        assert!(lock_dir.join(&foreign_owner).exists());
    }

    #[test]
    fn t1_9_reclaims_zero_byte_or_truncated_dead_local_owner_and_handles_read_dir_failure() {
        let temp = tempfile::tempdir().unwrap();
        let lock_dir = temp.path().join(".conlang-maker").join("lock");
        fs::create_dir_all(&lock_dir).unwrap();

        // Spawn a short-lived child process to get a guaranteed-dead local PID
        let mut child = std::process::Command::new("sh")
            .arg("-c")
            .arg("exit 0")
            .spawn()
            .unwrap();
        let dead_pid = child.id();
        let _ = child.wait().unwrap();
        // Wait briefly in case OS reaps asynchronously
        for _ in 0..20 {
            if is_local_pid_dead(dead_pid) {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        assert!(is_local_pid_dead(dead_pid));

        let host_key = compute_host_key();
        // 0-byte truncated stale owner file!
        let stale_zero = format!("owner-{host_key}-{dead_pid}-{}.json", "b".repeat(32));
        fs::write(lock_dir.join(&stale_zero), b"{truncated").unwrap();

        let fail_once = Arc::new(AtomicBool::new(true));
        let hooks = LockTestHooks {
            fail_read_dir_once: Some(Arc::clone(&fail_once)),
            ..Default::default()
        };

        let res = with_directory_lock(&lock_dir, "reclaimer", 2_000, None, Some(hooks), |_ctx| {
            assert!(!lock_dir.join(&stale_zero).exists());
            Ok("recovered")
        })
        .unwrap();
        assert_eq!(res, "recovered");
        assert!(!fail_once.load(Ordering::SeqCst));
    }

    #[test]
    fn t1_9_barrier_concurrent_publishers_and_release_rmdir_race() {
        // Test simultaneous owner publication across distinct in-process keys (simulating cross-process race
        // on the exact same filesystem directory via "./" non-canonical bypass is prevented by canonicalize,
        // so we test the filesystem race protocol directly by staging a concurrent publisher at `before_read_dir`!)
        let temp = tempfile::tempdir().unwrap();
        let lock_dir = temp.path().join("race_lock");

        let rival_name = format!("owner-ffffffffffff-99999-{}.json", "c".repeat(32));
        let lock_dir_clone = lock_dir.clone();
        let lock_dir_assert = lock_dir.clone();
        let rival_clone = rival_name.clone();
        let injected = Arc::new(AtomicBool::new(false));
        let injected_clone = Arc::clone(&injected);

        let hooks = LockTestHooks {
            before_read_dir: Some(Arc::new(move || {
                if !injected_clone.swap(true, Ordering::SeqCst) {
                    // Simulate another process publishing an owner right before our enumeration,
                    // then releasing it 60ms later!
                    let rival_path = lock_dir_clone.join(&rival_clone);
                    fs::write(&rival_path, b"{}").unwrap();
                    let p = rival_path.clone();
                    thread::spawn(move || {
                        thread::sleep(Duration::from_millis(60));
                        let _ = fs::remove_file(p);
                    });
                }
            })),
            ..Default::default()
        };

        let active = Arc::new(AtomicUsize::new(0));
        let act_c = Arc::clone(&active);
        with_directory_lock(&lock_dir, "publisher", 2_000, None, Some(hooks), move |_ctx| {
            let cur = act_c.fetch_add(1, Ordering::SeqCst) + 1;
            assert_eq!(cur, 1);
            assert!(!lock_dir_assert.join(&rival_name).exists());
            act_c.fetch_sub(1, Ordering::SeqCst);
            Ok(())
        })
        .unwrap();
        assert!(!lock_dir.exists());
    }
}
