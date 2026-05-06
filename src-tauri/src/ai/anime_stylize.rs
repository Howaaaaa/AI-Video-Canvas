use std::path::PathBuf;
use std::process::Command;
use tracing::info;

const PIP_REQUIREMENTS: &str = "onnxruntime\nPillow\nnumpy\n";
const PIP_INDEX: &str = "https://pypi.tuna.tsinghua.edu.cn/simple";

fn resolve_resource(file_name: &str) -> PathBuf {
    if let Ok(dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let p = PathBuf::from(&dir).join("resources").join(file_name);
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
    PathBuf::from("resources").join(file_name)
}

fn venv_dir() -> PathBuf {
    if let Some(proj_dirs) = directories::ProjectDirs::from("com", "storyboard-copilot", "StoryboardCopilot") {
        proj_dirs.data_dir().join("anime_venv")
    } else {
        // Fallback: next to the executable
        let exe = std::env::current_exe().unwrap_or_default();
        let parent = exe.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        parent.join("anime_venv")
    }
}

fn venv_python(venv: &PathBuf) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv.join("Scripts/python.exe")
    } else {
        venv.join("bin/python3")
    }
}

/// Ensure the venv exists with all required packages.
/// Returns the path to the venv's python3 binary.
/// On first call this may take 20-40 seconds to create the venv and pip install.
fn ensure_venv() -> Result<PathBuf, String> {
    let venv = venv_dir();
    let python = venv_python(&venv);

    // Already installed — fast path
    if python.exists() {
        return Ok(python);
    }

    info!("[anime_stylize] venv not found at {:?}, creating...", venv);

    // Find a system python3 to bootstrap the venv
    let system_python = find_system_python()
        .ok_or_else(|| "Python3 not found on system; cannot create venv for AnimeGAN".to_string())?;

    // Step 1: create venv
    let status = Command::new(&system_python)
        .args(["-m", "venv", &venv.to_string_lossy()])
        .status()
        .map_err(|e| format!("Failed to run python venv: {}", e))?;

    if !status.success() {
        return Err(format!("python -m venv failed with exit code: {:?}", status.code()));
    }

    if !python.exists() {
        return Err("venv was created but python binary not found".to_string());
    }
    info!("[anime_stylize] venv created at {:?}", venv);

    // Step 2: upgrade pip
    let _ = Command::new(&python)
        .args(["-m", "pip", "install", "--upgrade", "pip"])
        .args(["-i", PIP_INDEX])
        .status();

    // Step 3: install requirements
    info!("[anime_stylize] pip installing onnxruntime, Pillow, numpy...");
    let status = Command::new(&python)
        .args(["-m", "pip", "install"])
        .args(["-i", PIP_INDEX])
        .arg("--")
        .args(PIP_REQUIREMENTS.trim().split('\n').filter(|s| !s.is_empty()))
        .status()
        .map_err(|e| format!("Failed to run pip install: {}", e))?;

    if !status.success() {
        return Err(format!(
            "pip install failed (exit {:?}). Check network or try manually:\n  {} -m pip install -i {} onnxruntime Pillow numpy",
            status.code(),
            python.to_string_lossy(),
            PIP_INDEX
        ));
    }

    // Verify by importing
    let verify = Command::new(&python)
        .arg("-c")
        .arg("import onnxruntime, PIL, numpy")
        .status()
        .map_err(|e| format!("Failed to verify venv: {}", e))?;

    if !verify.success() {
        return Err("Packages installed but import check failed".to_string());
    }

    info!("[anime_stylize] venv ready at {:?}", python);
    Ok(python)
}

fn find_system_python() -> Option<String> {
    // Same list as before, but we don't need to check for packages yet
    // (the caller checks after venv creation instead)
    for candidate in &[
        "/usr/local/Caskroom/miniconda/base/envs/rembg/bin/python3",
        "/usr/local/Caskroom/miniconda/base/envs/whisper_env/bin/python3",
        "/usr/local/Caskroom/miniconda/base/bin/python3",
        "python3",
    ] {
        let ok = Command::new(candidate)
            .arg("-c")
            .arg("import sys; sys.exit(0)")
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Some(candidate.to_string());
        }
    }
    None
}

pub fn stylize_image(image_bytes: &[u8], target_width: u32) -> Result<Vec<u8>, String> {
    info!(
        "[anime_stylize] start target_width={} input_bytes={}",
        target_width,
        image_bytes.len()
    );

    // Ensure venv exists (auto-install on first call)
    let python = ensure_venv()?;
    info!("[anime_stylize] using python: {}", python.display());

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
