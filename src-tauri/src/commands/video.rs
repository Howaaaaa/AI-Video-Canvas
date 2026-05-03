use md5;
use std::path::PathBuf;
use std::time::Instant;
use tauri::{AppHandle, Manager};
use tracing::info;

use super::image::normalize_extension;

#[tauri::command]
pub async fn download_remote_video(app: AppHandle, url: String) -> Result<String, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL is not a remote address".to_string());
    }
    persist_video_from_url(&app, &url).await
}

#[tauri::command]
pub async fn prepare_node_video_binary(
    app: AppHandle,
    bytes: Vec<u8>,
    extension: Option<String>,
) -> Result<String, String> {
    let started = Instant::now();
    if bytes.is_empty() {
        return Err("Video bytes are empty".to_string());
    }

    let resolved_extension = extension
        .as_deref()
        .map(normalize_extension)
        .unwrap_or_else(|| "mp4".to_string());

    let video_path = persist_video_bytes(&app, &bytes, &resolved_extension)?;

    info!(
        "prepare_node_video_binary done: bytes={}, ext={}, total={}ms",
        bytes.len(),
        resolved_extension,
        started.elapsed().as_millis()
    );

    Ok(video_path)
}

fn persist_video_bytes(app: &AppHandle, bytes: &[u8], extension: &str) -> Result<String, String> {
    let videos_dir = resolve_videos_dir(app)?;
    let digest = md5::compute(bytes);
    let filename = format!("{:x}.{}", digest, normalize_extension(extension));
    let output_path = videos_dir.join(&filename);

    if output_path.exists() {
        return Ok(output_path.to_string_lossy().to_string());
    }

    let temp_filename = format!("{}.tmp-{}", filename, std::process::id());
    let temp_path = videos_dir.join(&temp_filename);

    std::fs::write(&temp_path, bytes)
        .map_err(|e| format!("Failed to write temp video file: {}", e))?;

    match std::fs::rename(&temp_path, &output_path) {
        Ok(()) => {}
        Err(e) => {
            if output_path.exists() {
                std::fs::remove_file(&temp_path).ok();
            } else {
                return Err(format!("Failed to rename video file: {}", e));
            }
        }
    }

    Ok(output_path.to_string_lossy().to_string())
}

fn resolve_videos_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    let videos_dir = data_dir.join("videos");
    std::fs::create_dir_all(&videos_dir)
        .map_err(|e| format!("Failed to create videos dir: {}", e))?;

    Ok(videos_dir)
}

#[tauri::command]
pub async fn copy_video_to_clipboard(source: String) -> Result<(), String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("Video source is empty".to_string());
    }

    copy_file_to_clipboard(trimmed)
}

#[cfg(target_os = "macos")]
fn copy_file_to_clipboard(path: &str) -> Result<(), String> {
    use std::process::Command;

    let script = format!(
        "set the clipboard to (POSIX file \"{}\")",
        path.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to run osascript: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("osascript failed: {}", stderr));
    }

    Ok(())
}

pub async fn persist_video_from_url(app: &AppHandle, url: &str) -> Result<String, String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download video from URL: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Video download failed with status {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read video body: {}", e))?
        .to_vec();

    let ext = url
        .split('?')
        .next()
        .and_then(|path| path.split('.').last())
        .map(normalize_extension)
        .unwrap_or_else(|| "mp4".to_string());

    persist_video_bytes(app, &bytes, &ext)
}

#[cfg(not(target_os = "macos"))]
fn copy_file_to_clipboard(path: &str) -> Result<(), String> {
    use std::process::Command;

    if cfg!(target_os = "windows") {
        // On Windows, use PowerShell to copy file to clipboard
        let script = format!(
            "Set-Clipboard -Path '{}'",
            path.replace('\'', "''")
        );
        let output = Command::new("powershell")
            .args(["-Command", &script])
            .output()
            .map_err(|e| format!("Failed to run powershell: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("powershell failed: {}", stderr));
        }
    } else {
        // On Linux, xclip doesn't support files well, fall back to path copy
        let output = Command::new("xclip")
            .args(["-selection", "clipboard"])
            .output()
            .map_err(|_| "xclip not available".to_string())?;

        use std::io::Write;
        let mut stdin = output.stdin;
        // This won't work directly; for Linux we'd need a proper implementation
        return Err("File copy to clipboard is not supported on this platform".to_string());
    }

    Ok(())
}
