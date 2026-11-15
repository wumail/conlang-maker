use rand::RngCore;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::Path;

/// Generate a 128-bit random value encoded as 32 lowercase hex characters.
pub fn generate_nonce_hex() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Generate an RFC 4122 version 4 UUID string (lowercase).
pub fn generate_uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let h = hex::encode(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

/// Current UTC timestamp in RFC 3339 format with millisecond precision.
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Current UTC timestamp in compact `YYYYMMDDTHHMMSS` format.
pub fn now_compact_utc() -> String {
    chrono::Utc::now().format("%Y%m%dT%H%M%S").to_string()
}

/// Best-effort fsync on a directory (Unix platforms).
pub fn sync_dir_best_effort(dir: &Path) {
    #[cfg(unix)]
    {
        let _ = fs::File::open(dir).and_then(|d| d.sync_all());
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
    }
}

/// §3.3 Single-file atomic replacement using exclusive `<target>.<pid>.<nonce>.tmp`.
/// Retries with a fresh 128-bit hex nonce on `AlreadyExists`, syncs file bytes,
/// renames over `path`, cleans up only the owned `.tmp` file on failure, and
/// performs a best-effort parent directory sync on Unix.
pub fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("IO: Target path '{}' has no parent directory", path.display()))?;
    if !parent.as_os_str().is_empty() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("IO: Failed to create directory '{}': {e}", parent.display()))?;
    }

    let base_name = path
        .file_name()
        .ok_or_else(|| format!("IO: Invalid target file path '{}'", path.display()))?
        .to_string_lossy();
    let pid = std::process::id();

    let mut created_tmp = None;
    let mut created_file = None;

    for _ in 0..16 {
        let nonce = generate_nonce_hex();
        let tmp_name = format!("{base_name}.{pid}.{nonce}.tmp");
        let candidate = parent.join(tmp_name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => {
                created_tmp = Some(candidate);
                created_file = Some(file);
                break;
            }
            Err(err) if err.kind() == ErrorKind::AlreadyExists => {
                // Never delete an existing file on AlreadyExists; retry with fresh nonce.
                continue;
            }
            Err(err) => {
                return Err(format!(
                    "IO: Failed to create temporary file '{}': {err}",
                    candidate.display()
                ));
            }
        }
    }

    let tmp_path = created_tmp.ok_or_else(|| {
        format!(
            "IO: Exhausted nonce retries creating temporary file for '{}'",
            path.display()
        )
    })?;
    let mut file = created_file.ok_or_else(|| {
        format!(
            "IO: Missing file handle for temporary file '{}'",
            tmp_path.display()
        )
    })?;

    let write_res = (|| -> Result<(), String> {
        file.write_all(bytes).map_err(|e| {
            format!(
                "IO: Failed writing temporary file '{}': {e}",
                tmp_path.display()
            )
        })?;
        file.sync_all().map_err(|e| {
            format!(
                "IO: Failed syncing temporary file '{}': {e}",
                tmp_path.display()
            )
        })?;
        Ok(())
    })();

    // Ensure handle is closed before rename (critical on Windows).
    drop(file);

    if let Err(err) = write_res {
        let _ = fs::remove_file(&tmp_path);
        return Err(err);
    }

    if let Err(err) = rename_with_windows_retry(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "IO: Failed renaming '{}' to '{}': {err}",
            tmp_path.display(),
            path.display()
        ));
    }

    if !parent.as_os_str().is_empty() {
        sync_dir_best_effort(parent);
    }

    Ok(())
}

/// UTF-8 string convenience wrapper around `atomic_write_bytes`.
pub fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    atomic_write_bytes(path, content.as_bytes())
}

fn rename_with_windows_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    #[cfg(not(windows))]
    {
        fs::rename(from, to)
    }
    #[cfg(windows)]
    {
        const ERROR_ACCESS_DENIED: i32 = 5;
        const ERROR_SHARING_VIOLATION: i32 = 32;
        let mut attempt = 0u32;
        loop {
            match fs::rename(from, to) {
                Ok(()) => return Ok(()),
                Err(err) => {
                    let raw = err.raw_os_error();
                    let retryable = err.kind() == ErrorKind::PermissionDenied
                        || raw == Some(ERROR_ACCESS_DENIED)
                        || raw == Some(ERROR_SHARING_VIOLATION);
                    if !retryable || attempt >= 20 {
                        return Err(err);
                    }
                    attempt += 1;
                    std::thread::sleep( std::time::Duration::from_millis((attempt as u64).min(10)) );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn t1_8_concurrent_atomic_write_leaves_valid_payload_and_zero_tmp_files() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("shared_target.json");

        let mut expected_payloads = HashSet::new();
        for t in 0..8 {
            for i in 0..100 {
                let payload = format!(
                    "{{\"thread\":{t},\"iter\":{i},\"padding\":\"{}\"}}\n",
                    "x".repeat(256)
                );
                expected_payloads.insert(payload);
            }
        }

        let barrier = Arc::new(Barrier::new(8));
        let mut handles = Vec::new();
        for t in 0..8 {
            let b = Arc::clone(&barrier);
            let p = target.clone();
            handles.push(thread::spawn(move || {
                b.wait();
                for i in 0..100 {
                    let payload = format!(
                        "{{\"thread\":{t},\"iter\":{i},\"padding\":\"{}\"}}\n",
                        "x".repeat(256)
                    );
                    atomic_write(&p, &payload).unwrap();
                }
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        let final_text = fs::read_to_string(&target).unwrap();
        assert!(
            expected_payloads.contains(&final_text),
            "Final file content was corrupted or partial: {final_text}"
        );

        let leftovers: Vec<_> = fs::read_dir(temp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "Expected zero .tmp files remaining, found: {leftovers:?}"
        );
    }
}
