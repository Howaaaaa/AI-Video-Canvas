use std::process::Command;
use tracing::info;

const PYTHON_CANDIDATES: &[&str] = &[
    "/usr/local/Caskroom/miniconda/base/envs/rembg/bin/python3",
    "/usr/local/Caskroom/miniconda/base/envs/whisper_env/bin/python3",
    "/usr/local/Caskroom/miniconda/base/bin/python3",
    "python3",
];

fn find_python() -> Option<String> {
    for candidate in PYTHON_CANDIDATES {
        let ok = Command::new(candidate)
            .arg("-c")
            .arg("import onnxruntime, PIL, numpy")
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Some(candidate.to_string());
        }
    }
    None
}

fn resolve_resource(file_name: &str) -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let p = std::path::PathBuf::from(&dir).join("resources").join(file_name);
        if p.exists() {
            return p;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let p = parent.join(file_name);
            if p.exists() {
                return p;
            }
            let p = parent.join("../Resources").join(file_name);
            if p.exists() {
                return p;
            }
        }
    }
    std::path::PathBuf::from("resources").join(file_name)
}

pub fn stylize_image(image_bytes: &[u8], target_width: u32) -> Result<Vec<u8>, String> {
    info!(
        "[anime_stylize] start target_width={} input_bytes={}",
        target_width,
        image_bytes.len()
    );

    let python = find_python()
        .ok_or_else(|| "Python with onnxruntime/PIL/numpy not found on system".to_string())?;
    info!("[anime_stylize] using python: {}", python);

    let script = resolve_resource("anime_stylize.py");
    let model = resolve_resource("AnimeGANv3_Shinkai_37.onnx");
    if !script.exists() {
        return Err(format!("anime_stylize.py not found at {:?}", script));
    }
    if !model.exists() {
        return Err(format!("AnimeGAN model not found at {:?}", model));
    }

    let tmp_dir = std::env::temp_dir();
    let uniq = format!("{:x}", md5::compute(format!("{:?}-{}", std::time::Instant::now(), image_bytes.len())));
    let input_path = tmp_dir.join(format!("anime_in_{}.bin", uniq));
    let output_path = tmp_dir.join(format!("anime_out_{}.jpg", uniq));

    std::fs::write(&input_path, image_bytes)
        .map_err(|e| format!("Failed to write temp input: {}", e))?;

    let result = Command::new(&python)
        .arg(&script)
        .arg("--input")
        .arg(&input_path)
        .arg("--output")
        .arg(&output_path)
        .arg("--width")
        .arg(target_width.to_string())
        .arg("--model")
        .arg(&model)
        .output();

    let _ = std::fs::remove_file(&input_path);

    let output = result.map_err(|e| format!("Failed to spawn python: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = std::fs::remove_file(&output_path);
        return Err(format!(
            "Python stylize failed (exit {}): {}",
            output.status.code().unwrap_or(-1),
            stderr
        ));
    }

    let bytes = std::fs::read(&output_path)
        .map_err(|e| format!("Failed to read python output: {}", e))?;
    let _ = std::fs::remove_file(&output_path);

    info!(
        "[anime_stylize] done, output_bytes={} stderr={}",
        bytes.len(),
        String::from_utf8_lossy(&output.stderr).trim()
    );
    Ok(bytes)
}
