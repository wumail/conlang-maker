//! GUI-side hosting of the `conlang-mcp serve` HTTP server (T-R1..T-R3).
//!
//! The GUI owns `<app data>/mcp-server.json` (mode 0600), spawns the sidecar with
//! `serve --settings <file> --parent-pid <pid>`, and keeps a single owned child process.
//! The server re-reads the settings file on every request (mtime check), so token edits
//! take effect without restarting; only a port change requires a restart.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};

use crate::utils::fs_util::{atomic_write, now_rfc3339};

pub const MCP_SERVER_NAME: &str = "conlang-maker-mcp";
pub const DEFAULT_HTTP_PORT: u16 = 43117;
const SETTINGS_FILE_NAME: &str = "mcp-server.json";
const STATE_FILE_NAME: &str = "mcp-server.state.json";
const USAGE_FILE_NAME: &str = "mcp-token-usage.json";
const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "mcp-server.log";

const VALID_MODES: [&str; 3] = ["read-only", "write", "write+destructive"];
const VALID_TOOLSETS: [&str; 6] = ["core", "audit", "compute", "write", "evolution", "admin"];
const START_TIMEOUT: Duration = Duration::from_secs(5);
const STOP_GRACE: Duration = Duration::from_secs(2);

// ---------------------------------------------------------------------------
// Settings model (§2.1)
// ---------------------------------------------------------------------------

fn default_true() -> bool {
    true
}

fn default_settings_version() -> u32 {
    1
}

fn default_port() -> u16 {
    DEFAULT_HTTP_PORT
}

/// One access token. `extra` keeps fields written by newer versions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTokenSettings {
    pub id: String,
    pub name: String,
    pub token: String,
    pub mode: String,
    pub toolsets: String,
    #[serde(default)]
    pub family: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerSettings {
    #[serde(default = "default_settings_version")]
    pub version: u32,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub tokens: Vec<McpTokenSettings>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Service state file written by the server (§2.2).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpServerStateFile {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub settings_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpHealth {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub sessions: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerStatus {
    /// running | stopped | starting | port_in_use | error
    pub state: String,
    pub owned: bool,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub version: Option<String>,
    pub sessions: Option<u32>,
    pub last_error: Option<String>,
    pub log_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpServerSettingsPayload {
    pub settings: McpServerSettings,
    pub url: String,
    pub token_last_used: BTreeMap<String, String>,
    pub log_path: String,
    pub settings_path: String,
    pub state_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortProbe {
    /// Nothing is listening on the port.
    Free,
    /// Our MCP server answered `/healthz`.
    Running,
    /// Something else holds the port.
    Occupied,
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct McpServerPaths {
    pub settings: PathBuf,
    pub state: PathBuf,
    pub usage: PathBuf,
    pub log: PathBuf,
}

pub fn server_paths(app: &AppHandle) -> Result<McpServerPaths, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let log_dir = data_dir.join(LOG_DIR_NAME);
    fs::create_dir_all(&log_dir)
        .map_err(|e| format!("IO: Failed to create '{}': {e}", log_dir.display()))?;
    Ok(McpServerPaths {
        settings: data_dir.join(SETTINGS_FILE_NAME),
        state: data_dir.join(STATE_FILE_NAME),
        usage: data_dir.join(USAGE_FILE_NAME),
        log: log_dir.join(LOG_FILE_NAME),
    })
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

pub fn generate_token_secret() -> String {
    use base64::Engine as _;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    format!(
        "cmk_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    )
}

pub fn generate_token_id() -> String {
    let mut bytes = [0u8; 6];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    format!("tok_{}", hex::encode(bytes))
}

fn validate_mode(mode: &str) -> Result<String, String> {
    let trimmed = mode.trim();
    if VALID_MODES.contains(&trimmed) {
        Ok(trimmed.to_string())
    } else {
        Err(format!(
            "Invalid permission mode \"{mode}\". Expected read-only, write, or write+destructive."
        ))
    }
}

fn validate_toolsets(toolsets: &str) -> Result<String, String> {
    let trimmed = toolsets.trim();
    if trimmed.is_empty() || trimmed == "default" || trimmed == "all" {
        return Ok(if trimmed.is_empty() { "default".to_string() } else { trimmed.to_string() });
    }
    for part in trimmed.split(',') {
        let name = part.trim();
        if name.is_empty() {
            continue;
        }
        if !VALID_TOOLSETS.contains(&name) {
            return Err(format!(
                "Unknown toolset \"{name}\". Expected default, all, or a comma separated list of {VALID_TOOLSETS:?}."
            ));
        }
    }
    Ok(trimmed.to_string())
}

fn new_token(name: &str, mode: &str, toolsets: &str, family: Option<String>) -> McpTokenSettings {
    McpTokenSettings {
        id: generate_token_id(),
        name: name.trim().to_string(),
        token: generate_token_secret(),
        mode: mode.to_string(),
        toolsets: toolsets.to_string(),
        family,
        enabled: true,
        created_at: now_rfc3339(),
        extra: serde_json::Map::new(),
    }
}

pub fn default_settings() -> McpServerSettings {
    McpServerSettings {
        version: 1,
        port: DEFAULT_HTTP_PORT,
        tokens: vec![new_token("Default", "read-only", "default", None)],
        extra: serde_json::Map::new(),
    }
}

// ---------------------------------------------------------------------------
// Settings IO
// ---------------------------------------------------------------------------

pub fn read_settings_at(path: &Path) -> Result<McpServerSettings, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("IO: Cannot read '{}': {e}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("VALIDATION: '{}' is not valid settings JSON: {e}", path.display()))
}

pub fn write_settings_at(path: &Path, settings: &McpServerSettings) -> Result<(), String> {
    let mut json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    json.push('\n');
    atomic_write(path, &json)?;
    restrict_permissions(path)
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("IO: Failed to set 0600 on '{}': {e}", path.display()))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Creates the settings file (one read-only token) when missing, then returns its content.
/// Must run before the server process starts so both sides never race on creation.
pub fn ensure_settings_file_at(path: &Path) -> Result<McpServerSettings, String> {
    if path.is_file() {
        return read_settings_at(path);
    }
    let settings = default_settings();
    write_settings_at(path, &settings)?;
    Ok(settings)
}

pub fn read_state_file(path: &Path) -> Option<McpServerStateFile> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn read_token_last_used(path: &Path) -> BTreeMap<String, String> {
    #[derive(Deserialize)]
    struct UsageFile {
        #[serde(default)]
        token_last_used: BTreeMap<String, String>,
    }
    let Ok(content) = fs::read_to_string(path) else {
        return BTreeMap::new();
    };
    serde_json::from_str::<UsageFile>(&content)
        .map(|parsed| parsed.token_last_used)
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Health probing (§T-R1.6: no HTTP dependency, plain TcpStream)
// ---------------------------------------------------------------------------

pub fn parse_health_response(raw: &str) -> Result<McpHealth, String> {
    let (head, body) = raw
        .split_once("\r\n\r\n")
        .ok_or_else(|| "Malformed HTTP response (no header terminator)".to_string())?;
    let status_line = head
        .lines()
        .next()
        .ok_or_else(|| "Malformed HTTP response (no status line)".to_string())?;
    if !status_line.contains(" 200") {
        return Err(format!("Unexpected status line: {status_line}"));
    }
    serde_json::from_str(body).map_err(|e| format!("Malformed /healthz JSON: {e}"))
}

pub fn probe_port(port: u16, timeout: Duration) -> PortProbe {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(stream) => stream,
        Err(_) => return PortProbe::Free,
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let request = format!("GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return PortProbe::Occupied;
    }

    let mut raw = String::new();
    // A read timeout leaves partial data behind; parse whatever arrived.
    let _ = stream.read_to_string(&mut raw);
    if raw.is_empty() {
        return PortProbe::Occupied;
    }
    match parse_health_response(&raw) {
        Ok(health) if health.name.as_deref() == Some(MCP_SERVER_NAME) => PortProbe::Running,
        _ => PortProbe::Occupied,
    }
}

fn probe_health(port: u16, timeout: Duration) -> Option<McpHealth> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, timeout).ok()?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!("GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut raw = String::new();
    stream.read_to_string(&mut raw).ok()?;
    parse_health_response(&raw).ok()
}

// ---------------------------------------------------------------------------
// Process manager (T-R2)
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct McpServerProcess {
    child: Mutex<Option<Child>>,
    owned: AtomicBool,
    starting: AtomicBool,
    last_error: Mutex<Option<String>>,
}

impl McpServerProcess {
    fn lock_child(&self) -> MutexGuard<'_, Option<Child>> {
        self.child.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn lock_error(&self) -> MutexGuard<'_, Option<String>> {
        self.last_error.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn set_error(&self, message: Option<String>) {
        *self.lock_error() = message;
    }

    /// Whether this GUI instance started (and therefore owns) the child process.
    pub fn is_owned(&self) -> bool {
        self.owned.load(Ordering::SeqCst)
    }
}

fn url_for(port: u16) -> String {
    format!("http://127.0.0.1:{port}/mcp")
}

fn tail_log(path: &Path, max_lines: usize) -> String {
    let Ok(content) = fs::read_to_string(path) else {
        return String::new();
    };
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

#[cfg(unix)]
fn send_terminate(pid: u32) {
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
}

#[cfg(windows)]
fn send_terminate(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn wait_for_exit(child: &mut Child, grace: Duration) -> bool {
    let deadline = Instant::now() + grace;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {}
            Err(_) => return true,
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Starts the sidecar when no current server is serving the configured port.
pub fn start_server(app: &AppHandle) -> Result<(), String> {
    let paths = server_paths(app)?;
    let settings = ensure_settings_file_at(&paths.settings)?;
    let port = settings.port;
    let proc = app.state::<McpServerProcess>();

    if proc.starting.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = start_server_inner(&paths, port, &proc);
    proc.starting.store(false, Ordering::SeqCst);
    if let Err(ref err) = result {
        proc.set_error(Some(err.clone()));
    }
    result
}

fn start_server_inner(
    paths: &McpServerPaths,
    port: u16,
    proc: &McpServerProcess,
) -> Result<(), String> {
    proc.set_error(None);

    match probe_port(port, Duration::from_millis(800)) {
        PortProbe::Running => {
            // Already serving. If a previous GUI instance left an older build behind,
            // stop it (only when the state file confirms it is the same pid) and restart.
            let health = probe_health(port, Duration::from_millis(800)).unwrap_or_default();
            let running_version = health.version.clone().unwrap_or_default();
            if running_version == env!("CARGO_PKG_VERSION") {
                proc.owned.store(false, Ordering::SeqCst);
                return Ok(());
            }
            if let Some(state) = read_state_file(&paths.state) {
                if let Some(state_pid) = state.pid {
                    if Some(state_pid) == health.pid {
                        send_terminate(state_pid);
                        let deadline = Instant::now() + Duration::from_secs(3);
                        while Instant::now() < deadline {
                            if probe_port(port, Duration::from_millis(200)) == PortProbe::Free {
                                break;
                            }
                            std::thread::sleep(Duration::from_millis(100));
                        }
                    }
                }
            }
            if probe_port(port, Duration::from_millis(300)) != PortProbe::Free {
                let message =
                    format!("Port {port} is still served by an older conlang-mcp that did not stop.");
                proc.set_error(Some(message.clone()));
                return Err(message);
            }
        }
        PortProbe::Occupied => {
            let message = format!("Port {port} on 127.0.0.1 is already in use by another program.");
            proc.set_error(Some(message.clone()));
            return Err(message);
        }
        PortProbe::Free => {}
    }

    let binary = crate::commands::mcp::resolve_mcp_binary().ok_or_else(|| {
        "IO: conlang-mcp binary not found. Run `bun run mcp:build` (dev) or reinstall the app."
            .to_string()
    })?;

    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.log)
        .map_err(|e| format!("IO: Cannot open '{}': {e}", paths.log.display()))?;
    let log_for_child = log
        .try_clone()
        .map_err(|e| format!("IO: Cannot duplicate log handle: {e}"))?;

    let mut child = Command::new(&binary)
        .arg("serve")
        .arg("--settings")
        .arg(&paths.settings)
        .arg("--parent-pid")
        .arg(std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log_for_child))
        .spawn()
        .map_err(|e| format!("IO: Failed to start '{}': {e}", binary.display()))?;

    let deadline = Instant::now() + START_TIMEOUT;
    loop {
        if let Ok(Some(exit)) = child.try_wait() {
            return Err(match exit.code() {
                Some(3) => "Another conlang-mcp is already serving this port.".to_string(),
                Some(4) => format!("Port {port} is already in use by another program."),
                other => {
                    let tail = tail_log(&paths.log, 6);
                    format!(
                        "conlang-mcp exited with code {other:?} during startup.\n{tail}"
                    )
                }
            });
        }
        if probe_port(port, Duration::from_millis(300)) == PortProbe::Running {
            *proc.lock_child() = Some(child);
            proc.owned.store(true, Ordering::SeqCst);
            return Ok(());
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let tail = tail_log(&paths.log, 6);
            return Err(format!(
                "conlang-mcp did not answer /healthz within {}s.\n{tail}",
                START_TIMEOUT.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Stops the child process this GUI instance started. Foreign servers are left alone.
pub fn stop_server(app: &AppHandle) -> Result<(), String> {
    let proc = app.state::<McpServerProcess>();
    let mut guard = proc.lock_child();

    if !proc.is_owned() && guard.is_none() {
        return Ok(());
    }

    if let Some(mut child) = guard.take() {
        send_terminate(child.id());
        if !wait_for_exit(&mut child, STOP_GRACE) {
            let _ = child.kill();
        }
        let _ = child.wait();
    }
    proc.owned.store(false, Ordering::SeqCst);
    proc.set_error(None);
    Ok(())
}

/// Best-effort stop used from the `RunEvent::Exit` hook.
pub fn stop_owned_server(app: &AppHandle) {
    if let Err(err) = stop_server(app) {
        eprintln!("[mcp-server] failed to stop: {err}");
    }
}

fn current_status(app: &AppHandle) -> Result<McpServerStatus, String> {
    let paths = server_paths(app)?;
    let proc = app.state::<McpServerProcess>();
    let settings = read_settings_at(&paths.settings).unwrap_or_else(|_| default_settings());
    let port = settings.port;
    let last_error = proc.lock_error().clone();
    let log_path = paths.log.to_string_lossy().into_owned();

    if proc.starting.load(Ordering::SeqCst) {
        return Ok(McpServerStatus {
            state: "starting".to_string(),
            owned: proc.is_owned(),
            pid: None,
            port: Some(port),
            url: Some(url_for(port)),
            version: None,
            sessions: None,
            last_error,
            log_path,
        });
    }

    match probe_port(port, Duration::from_millis(300)) {
        PortProbe::Running => {
            let health = probe_health(port, Duration::from_millis(300)).unwrap_or_default();
            Ok(McpServerStatus {
                state: "running".to_string(),
                owned: proc.is_owned(),
                pid: health.pid,
                port: health.port.or(Some(port)),
                url: Some(url_for(health.port.unwrap_or(port))),
                version: health.version,
                sessions: health.sessions,
                last_error,
                log_path,
            })
        }
        PortProbe::Occupied => Ok(McpServerStatus {
            state: "port_in_use".to_string(),
            owned: proc.is_owned(),
            pid: None,
            port: Some(port),
            url: Some(url_for(port)),
            version: None,
            sessions: None,
            last_error: last_error.or_else(|| {
                Some(format!("Port {port} is used by another program."))
            }),
            log_path,
        }),
        PortProbe::Free => Ok(McpServerStatus {
            state: if last_error.is_some() && !proc.is_owned() {
                "error".to_string()
            } else {
                "stopped".to_string()
            },
            owned: proc.is_owned(),
            pid: None,
            port: Some(port),
            url: Some(url_for(port)),
            version: None,
            sessions: None,
            last_error,
            log_path,
        }),
    }
}

// ---------------------------------------------------------------------------
// Commands (T-R1.5)
// ---------------------------------------------------------------------------

#[command]
pub async fn mcp_server_get_settings(app: AppHandle) -> Result<McpServerSettingsPayload, String> {
    let paths = server_paths(&app)?;
    let settings = ensure_settings_file_at(&paths.settings)?;
    let state = read_state_file(&paths.state);
    let url = state
        .and_then(|s| s.url)
        .unwrap_or_else(|| url_for(settings.port));
    Ok(McpServerSettingsPayload {
        settings,
        url,
        token_last_used: read_token_last_used(&paths.usage),
        log_path: paths.log.to_string_lossy().into_owned(),
        settings_path: paths.settings.to_string_lossy().into_owned(),
        state_path: paths.state.to_string_lossy().into_owned(),
    })
}

#[command]
pub async fn mcp_server_status(app: AppHandle) -> Result<McpServerStatus, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || current_status(&handle))
        .await
        .map_err(|e| e.to_string())?
}

#[command]
pub async fn mcp_server_start(app: AppHandle) -> Result<McpServerStatus, String> {
    let handle = app.clone();
    let started = tauri::async_runtime::spawn_blocking(move || start_server(&handle))
        .await
        .map_err(|e| e.to_string())?;
    started?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || current_status(&handle))
        .await
        .map_err(|e| e.to_string())?
}

#[command]
pub async fn mcp_server_stop(app: AppHandle) -> Result<McpServerStatus, String> {
    let handle = app.clone();
    let stopped = tauri::async_runtime::spawn_blocking(move || stop_server(&handle))
        .await
        .map_err(|e| e.to_string())?;
    stopped?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || current_status(&handle))
        .await
        .map_err(|e| e.to_string())?
}

#[command]
pub async fn mcp_server_restart(app: AppHandle) -> Result<McpServerStatus, String> {
    let handle = app.clone();
    let restarted = tauri::async_runtime::spawn_blocking(move || {
        stop_server(&handle)?;
        start_server(&handle)
    })
    .await
    .map_err(|e| e.to_string())?;
    restarted?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || current_status(&handle))
        .await
        .map_err(|e| e.to_string())?
}

#[command]
pub async fn mcp_server_set_port(app: AppHandle, port: u16) -> Result<McpServerStatus, String> {
    if port == 0 {
        return Err("Port must be between 1 and 65535.".to_string());
    }
    let handle = app.clone();
    let applied = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let paths = server_paths(&handle)?;
        let mut settings = ensure_settings_file_at(&paths.settings)?;
        if settings.port == port {
            return Ok(());
        }
        let was_running = probe_port(settings.port, Duration::from_millis(300)) != PortProbe::Free;
        settings.port = port;
        write_settings_at(&paths.settings, &settings)?;
        if was_running {
            stop_server(&handle)?;
            start_server(&handle)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?;
    applied?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || current_status(&handle))
        .await
        .map_err(|e| e.to_string())?
}

#[command]
pub async fn mcp_token_create(
    app: AppHandle,
    name: String,
    mode: String,
    toolsets: String,
    family: Option<String>,
) -> Result<McpTokenSettings, String> {
    let label = name.trim();
    if label.is_empty() {
        return Err("Token name must not be empty.".to_string());
    }
    let mode = validate_mode(&mode)?;
    let toolsets = validate_toolsets(&toolsets)?;
    let family = family.and_then(|f| {
        let trimmed = f.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    let paths = server_paths(&app)?;
    let mut settings = ensure_settings_file_at(&paths.settings)?;
    let token = new_token(label, &mode, &toolsets, family);
    settings.tokens.push(token.clone());
    write_settings_at(&paths.settings, &settings)?;
    Ok(token)
}

#[command]
pub async fn mcp_token_update(
    app: AppHandle,
    id: String,
    name: Option<String>,
    mode: Option<String>,
    toolsets: Option<String>,
    // Omitted = keep the current value; empty string = switch back to dynamic discovery.
    family: Option<String>,
    enabled: Option<bool>,
) -> Result<McpTokenSettings, String> {
    let paths = server_paths(&app)?;
    let mut settings = ensure_settings_file_at(&paths.settings)?;
    let token = settings
        .tokens
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("Token {id} does not exist."))?;

    if let Some(new_name) = name {
        let trimmed = new_name.trim().to_string();
        if trimmed.is_empty() {
            return Err("Token name must not be empty.".to_string());
        }
        token.name = trimmed;
    }
    if let Some(new_mode) = mode {
        token.mode = validate_mode(&new_mode)?;
    }
    if let Some(new_toolsets) = toolsets {
        token.toolsets = validate_toolsets(&new_toolsets)?;
    }
    if let Some(new_family) = family {
        let trimmed = new_family.trim().to_string();
        token.family = if trimmed.is_empty() { None } else { Some(trimmed) };
    }
    if let Some(new_enabled) = enabled {
        token.enabled = new_enabled;
    }

    let updated = token.clone();
    write_settings_at(&paths.settings, &settings)?;
    Ok(updated)
}

#[command]
pub async fn mcp_token_regenerate(app: AppHandle, id: String) -> Result<String, String> {
    let paths = server_paths(&app)?;
    let mut settings = ensure_settings_file_at(&paths.settings)?;
    let token = settings
        .tokens
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("Token {id} does not exist."))?;
    token.token = generate_token_secret();
    let secret = token.token.clone();
    write_settings_at(&paths.settings, &settings)?;
    Ok(secret)
}

#[command]
pub async fn mcp_token_delete(app: AppHandle, id: String) -> Result<(), String> {
    let paths = server_paths(&app)?;
    let mut settings = ensure_settings_file_at(&paths.settings)?;
    let before = settings.tokens.len();
    settings.tokens.retain(|t| t.id != id);
    if settings.tokens.len() == before {
        return Err(format!("Token {id} does not exist."));
    }
    write_settings_at(&paths.settings, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(name);
        (dir, path)
    }

    #[test]
    fn t_r3_creates_default_settings_with_one_read_only_token() {
        let (_dir, path) = temp_path("mcp-server.json");
        assert!(!path.exists());

        let settings = ensure_settings_file_at(&path).unwrap();
        assert!(path.is_file());
        assert_eq!(settings.version, 1);
        assert_eq!(settings.port, DEFAULT_HTTP_PORT);
        assert_eq!(settings.tokens.len(), 1);
        let token = &settings.tokens[0];
        assert_eq!(token.name, "Default");
        assert_eq!(token.mode, "read-only");
        assert_eq!(token.toolsets, "default");
        assert!(token.enabled);
        assert!(token.family.is_none());
        assert!(token.token.starts_with("cmk_"));
    }

    #[test]
    fn t_r3_settings_roundtrip_preserves_unknown_fields() {
        let (_dir, path) = temp_path("mcp-server.json");
        let raw = r#"{
  "version": 1,
  "port": 43118,
  "future_top_level": {"keep": true},
  "tokens": [
    {
      "id": "tok_abcdef012345",
      "name": "Cursor",
      "token": "cmk_0123456789abcdefghijklmnop",
      "mode": "write",
      "toolsets": "default",
      "family": null,
      "enabled": true,
      "created_at": "2026-11-11T14:00:00Z",
      "future_token_field": 7
    }
  ]
}"#;
        fs::write(&path, raw).unwrap();

        let settings = read_settings_at(&path).unwrap();
        assert_eq!(settings.port, 43118);
        assert_eq!(settings.tokens.len(), 1);
        assert_eq!(settings.tokens[0].name, "Cursor");
        assert_eq!(settings.tokens[0].mode, "write");
        assert!(settings.tokens[0].family.is_none());

        write_settings_at(&path, &settings).unwrap();
        let rewritten: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(rewritten["future_top_level"]["keep"], true);
        assert_eq!(rewritten["tokens"][0]["future_token_field"], 7);
        assert_eq!(rewritten["tokens"][0]["token"], "cmk_0123456789abcdefghijklmnop");
    }

    #[cfg(unix)]
    #[test]
    fn t_r3_settings_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let (_dir, path) = temp_path("mcp-server.json");
        let settings = default_settings();
        write_settings_at(&path, &settings).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn t_r3_token_secrets_and_ids_are_prefixed_and_unique() {
        let secrets: std::collections::HashSet<String> =
            (0..32).map(|_| generate_token_secret()).collect();
        assert_eq!(secrets.len(), 32);
        for secret in &secrets {
            let body = secret.trim_start_matches("cmk_");
            assert_eq!(body.len(), 43, "32 bytes base64url should be 43 chars: {secret}");
            assert!(!body.contains('='));
            assert!(!body.contains('+'));
            assert!(!body.contains('/'));
        }

        let ids: std::collections::HashSet<String> = (0..32).map(|_| generate_token_id()).collect();
        assert_eq!(ids.len(), 32);
        for id in &ids {
            assert!(id.starts_with("tok_"));
            assert_eq!(id.len(), 4 + 12);
        }
    }

    #[test]
    fn t_r3_health_response_is_parsed_and_classified() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let body = format!(
            "{{\"ok\":true,\"name\":\"{MCP_SERVER_NAME}\",\"version\":\"9.9.9\",\"pid\":4242,\"port\":{port},\"sessions\":3}}"
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        let handle = std::thread::spawn(move || {
            // probe_port() and probe_health() each open their own connection.
            for _ in 0..2 {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut buf = [0u8; 512];
                    let _ = stream.read(&mut buf);
                    let _ = stream.write_all(response.as_bytes());
                }
            }
        });

        assert_eq!(probe_port(port, Duration::from_secs(1)), PortProbe::Running);
        let health = probe_health(port, Duration::from_secs(1)).expect("health payload");
        assert_eq!(health.version.as_deref(), Some("9.9.9"));
        assert_eq!(health.pid, Some(4242));
        assert_eq!(health.sessions, Some(3));
        handle.join().unwrap();
    }

    #[test]
    fn t_r3_non_mcp_http_answer_classifies_as_occupied() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let response = "HTTP/1.1 200 OK\r\nContent-Length: 7\r\n\r\n{\"a\":1}";
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 512];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(response.as_bytes());
            }
        });
        assert_eq!(probe_port(port, Duration::from_secs(1)), PortProbe::Occupied);
        handle.join().unwrap();
    }

    #[test]
    fn t_r3_free_port_is_reported_as_free() {
        // Bind then drop to obtain a port that is very likely still free.
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        assert_eq!(probe_port(port, Duration::from_millis(200)), PortProbe::Free);
    }

    #[test]
    fn t_r3_mode_and_toolsets_validation() {
        assert!(validate_mode("read-only").is_ok());
        assert!(validate_mode("write").is_ok());
        assert!(validate_mode("write+destructive").is_ok());
        assert!(validate_mode("admin").is_err());

        assert_eq!(validate_toolsets("").unwrap(), "default");
        assert_eq!(validate_toolsets("all").unwrap(), "all");
        assert_eq!(validate_toolsets("core,write").unwrap(), "core,write");
        assert!(validate_toolsets("core,nope").is_err());
    }
}
