use std::process::Command;
use tauri::command;

fn escape_applescript_string(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "macos")]
fn run_osascript(lines: Vec<String>) -> Result<Option<String>, String> {
    let mut cmd = Command::new("osascript");
    for line in lines {
        cmd.arg("-e").arg(line);
    }

    let output = cmd.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            Ok(None)
        } else {
            Ok(Some(selected))
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.contains("User canceled") || stderr.contains("User cancelled") {
            Ok(None)
        } else {
            Err(stderr.trim().to_string())
        }
    }
}

#[command]
pub fn pick_file_path_macos(title: Option<String>) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let prompt =
            escape_applescript_string(&title.unwrap_or_else(|| "Choose a file".to_string()));
        return run_osascript(vec![
            format!("set _picked to choose file with prompt \"{}\"", prompt),
            "POSIX path of _picked".to_string(),
        ]);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = title;
        Err("pick_file_path_macos is only available on macOS".to_string())
    }
}

#[command]
pub fn pick_directory_path_macos(title: Option<String>) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let prompt =
            escape_applescript_string(&title.unwrap_or_else(|| "Choose a folder".to_string()));
        return run_osascript(vec![
            format!("set _picked to choose folder with prompt \"{}\"", prompt),
            "POSIX path of _picked".to_string(),
        ]);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = title;
        Err("pick_directory_path_macos is only available on macOS".to_string())
    }
}

#[command]
pub fn pick_save_file_path_macos(
    title: Option<String>,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let prompt =
            escape_applescript_string(&title.unwrap_or_else(|| "Choose save location".to_string()));

        let mut lines = Vec::new();
        if let Some(name) = default_name.filter(|n| !n.trim().is_empty()) {
            let escaped_name = escape_applescript_string(name.trim());
            lines.push(format!(
                "set _picked to choose file name with prompt \"{}\" default name \"{}\"",
                prompt, escaped_name
            ));
        } else {
            lines.push(format!(
                "set _picked to choose file name with prompt \"{}\"",
                prompt
            ));
        }
        lines.push("POSIX path of _picked".to_string());

        return run_osascript(lines);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = title;
        let _ = default_name;
        Err("pick_save_file_path_macos is only available on macOS".to_string())
    }
}
