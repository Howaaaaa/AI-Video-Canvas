use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{
    AIProvider, GenerateRequest, ProviderTaskHandle, ProviderTaskPollResult, ProviderTaskSubmission,
};
use crate::commands::CosUploader;

const LEMONDATA_BASE_URL: &str = "https://api.lemondata.cc";
const LEMONDATA_VIDEO_GENERATIONS_PATH: &str = "/v1/videos/generations";
const LEMONDATA_TASK_PATH: &str = "/v1/tasks";
const POLL_INTERVAL_MS: u64 = 20000; // 20 seconds between polls
const MAX_POLL_DURATION_SECS: u64 = 1200; // 20 minutes max wait for video generation

#[derive(Debug, Deserialize)]
struct LemonDataTaskSubmitResponse {
    task_id: String,
}

#[derive(Debug, Deserialize)]
struct LemonDataTaskStatusResponse {
    status: String,
    video_url: Option<String>,
    error: Option<String>,
}

/// Video generation operation mode
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub enum VideoOperation {
    TextToVideo,
    ImageToVideo,
    StartEndToVideo,
    ReferenceToVideo,
}

pub struct LemonDataProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    cos_uploader: CosUploader,
}

impl LemonDataProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
            cos_uploader: CosUploader::new(),
        }
    }

    fn sanitize_model(model: &str) -> String {
        model
            .split_once('/')
            .map(|(_, bare)| bare.to_string())
            .unwrap_or_else(|| model.to_string())
    }

    /// Resolve operation based on user mode and image count
    fn resolve_operation(user_mode: &str, image_count: usize) -> VideoOperation {
        if image_count == 0 {
            return VideoOperation::TextToVideo;
        }

        match user_mode {
            "start-end" => {
                if image_count == 1 {
                    VideoOperation::ImageToVideo
                } else {
                    VideoOperation::StartEndToVideo
                }
            }
            "reference" => VideoOperation::ReferenceToVideo,
            _ => {
                // Auto mode based on image count
                if image_count == 1 {
                    VideoOperation::ImageToVideo
                } else if image_count == 2 {
                    VideoOperation::StartEndToVideo
                } else {
                    VideoOperation::ReferenceToVideo
                }
            }
        }
    }

    fn operation_to_str(op: VideoOperation) -> &'static str {
        match op {
            VideoOperation::TextToVideo => "text-to-video",
            VideoOperation::ImageToVideo => "image-to-video",
            VideoOperation::StartEndToVideo => "start-end-to-video",
            VideoOperation::ReferenceToVideo => "reference-to-video",
        }
    }

    async fn upload_image_to_cos(&self, image_path: &str) -> Result<String, AIError> {
        // Read local file
        let bytes = if image_path.starts_with("file://") {
            let path = image_path.trim_start_matches("file://");
            std::fs::read(urlencoding::decode(path).map(|p| p.into_owned()).unwrap_or_else(|_| path.to_string()))
                .map_err(|e| AIError::Provider(format!("Failed to read image file: {}", e)))?
        } else {
            std::fs::read(image_path)
                .map_err(|e| AIError::Provider(format!("Failed to read image file: {}", e)))?
        };

        // Determine extension
        let extension = if image_path.to_lowercase().ends_with(".png") {
            "png"
        } else if image_path.to_lowercase().ends_with(".webp") {
            "webp"
        } else if image_path.to_lowercase().ends_with(".gif") {
            "gif"
        } else {
            "jpg"
        };

        self.cos_uploader
            .upload_image(&bytes, extension)
            .await
            .map_err(|e| AIError::Provider(format!("COS upload failed: {}", e)))
    }
}

impl Default for LemonDataProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for LemonDataProvider {
    fn name(&self) -> &str {
        "lemondata"
    }

    fn supports_model(&self, model: &str) -> bool {
        matches!(
            Self::sanitize_model(model).as_str(),
            "seedance-2.0-fast" | "seedance-2.0" | "viduq3-turbo"
        )
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "lemondata/seedance-2.0-fast".to_string(),
            "lemondata/viduq3-turbo".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    fn supports_task_resume(&self) -> bool {
        true
    }

    async fn submit_task(&self, request: GenerateRequest) -> Result<ProviderTaskSubmission, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let reference_images = request.reference_images.as_deref().unwrap_or(&[]);
        let image_count = reference_images.len();

        let model = Self::sanitize_model(&request.model);
        let is_viduq = model == "viduq3-turbo";

        // Get user generation mode from extra_params
        let user_mode = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("userGenerationMode"))
            .and_then(|raw| raw.as_str())
            .unwrap_or("start-end");

        let operation = Self::resolve_operation(user_mode, image_count);
        // viduq3 doesn't support reference-to-video; fall back to start-end-to-video
        let operation = if is_viduq && operation == VideoOperation::ReferenceToVideo {
            VideoOperation::StartEndToVideo
        } else {
            operation
        };
        let operation_str = Self::operation_to_str(operation);

        // Parse duration from extra_params or default to 5
        let duration = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("duration"))
            .and_then(|raw| raw.as_u64())
            .unwrap_or(5) as i32;

        // Parse output_audio from extra_params
        let output_audio = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("output_audio"))
            .and_then(|raw| raw.as_bool())
            .unwrap_or(false);

        // Parse audio / bgm from extra_params (viduq3-turbo)
        let audio_enabled = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("audio"))
            .and_then(|raw| raw.as_bool());
        let bgm_enabled = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("bgm"))
            .and_then(|raw| raw.as_bool());

        // Parse resolution from extra_params
        let resolution = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("resolution"))
            .and_then(|raw| raw.as_str())
            .unwrap_or("480p");

        let mut body = json!({
            "model": model,
            "operation": operation_str,
            "prompt": request.prompt,
            "duration": duration,
            "aspect_ratio": request.aspect_ratio,
            "resolution": resolution,
            "watermark": false,
        });

        if is_viduq {
            if let Some(audio) = audio_enabled {
                body["audio"] = json!(audio);
            }
            if let Some(bgm) = bgm_enabled {
                body["bgm"] = json!(bgm);
            }
        } else {
            body["output_audio"] = json!(output_audio);
        }

        // Upload images to COS and add to request
        // viduq3 uses "image"/"end_image"; seedance uses "image_url"/"end_image_url"/"image_urls"
        let (image_key, end_image_key, reference_key) = if is_viduq {
            ("image", "end_image", None)
        } else {
            ("image_url", "end_image_url", Some("image_urls"))
        };

        if image_count > 0 {
            match operation {
                VideoOperation::ImageToVideo => {
                    let cos_url = self.upload_image_to_cos(&reference_images[0]).await?;
                    body[image_key] = json!(cos_url);
                }
                VideoOperation::StartEndToVideo => {
                    let start_url = self.upload_image_to_cos(&reference_images[0]).await?;
                    let end_url = if reference_images.len() > 1 {
                        self.upload_image_to_cos(&reference_images[1]).await?
                    } else {
                        start_url.clone()
                    };
                    body[image_key] = json!(start_url);
                    body[end_image_key] = json!(end_url);
                }
                VideoOperation::ReferenceToVideo => {
                    let key = reference_key.unwrap_or("reference_images");
                    let mut cos_urls = Vec::new();
                    for image_path in reference_images.iter().take(9) {
                        let cos_url = self.upload_image_to_cos(image_path).await?;
                        cos_urls.push(cos_url);
                    }
                    body[key] = json!(cos_urls);
                }
                VideoOperation::TextToVideo => {}
            }
        }

        let endpoint = format!("{}{}", LEMONDATA_BASE_URL, LEMONDATA_VIDEO_GENERATIONS_PATH);

        info!(
            "[LemonData Request] model: {}, operation: {}, duration: {}s, aspect_ratio: {}, resolution: {}, output_audio: {}, images: {}",
            model, operation_str, duration, request.aspect_ratio, resolution, output_audio, image_count
        );

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .header("User-Agent", "Mozilla/5.0")
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "LemonData submit failed {}: {}",
                status, error_text
            )));
        }

        let response_text = response.text().await.unwrap_or_default();
        let submit_body = serde_json::from_str::<LemonDataTaskSubmitResponse>(&response_text).map_err(|err| {
            AIError::Provider(format!(
                "LemonData submit invalid JSON response: {}; raw={}",
                err, response_text
            ))
        })?;

        Ok(ProviderTaskSubmission::Queued(ProviderTaskHandle {
            task_id: submit_body.task_id,
            metadata: Some(json!({
                "model": model,
                "operation": operation,
            })),
        }))
    }

    async fn poll_task(&self, handle: ProviderTaskHandle) -> Result<ProviderTaskPollResult, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let endpoint = format!("{}/{}", LEMONDATA_BASE_URL, LEMONDATA_TASK_PATH);
        let status_url = format!("{}/{}", endpoint, handle.task_id);

        let response = self
            .client
            .get(&status_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("User-Agent", "Mozilla/5.0")
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "LemonData status check failed {}: {}",
                status, error_text
            )));
        }

        let status_body = response.json::<LemonDataTaskStatusResponse>().await?;

        match status_body.status.as_str() {
            "queued" | "running" | "pending" | "processing" => Ok(ProviderTaskPollResult::Running),
            "completed" | "succeeded" => {
                if let Some(video_url) = status_body.video_url {
                    Ok(ProviderTaskPollResult::Succeeded(video_url))
                } else {
                    Err(AIError::Provider("LemonData completed but no video_url".to_string()))
                }
            }
            "failed" => {
                let error_msg = status_body.error.unwrap_or_else(|| "Unknown error".to_string());
                Ok(ProviderTaskPollResult::Failed(error_msg))
            }
            other => {
                info!("[LemonData] Unknown status '{}' for task {}, treating as running", other, handle.task_id);
                Ok(ProviderTaskPollResult::Running)
            }
        }
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let submitted = self.submit_task(request).await?;
        let handle = match submitted {
            ProviderTaskSubmission::Succeeded(result) => return Ok(result),
            ProviderTaskSubmission::Queued(handle) => handle,
        };

        info!("[LemonData] Waiting for task {} to complete (max {}s)...", handle.task_id, MAX_POLL_DURATION_SECS);

        let deadline = tokio::time::Instant::now() + Duration::from_secs(MAX_POLL_DURATION_SECS);
        let mut poll_count = 0u32;

        loop {
            poll_count += 1;
            let elapsed = deadline.saturating_duration_since(tokio::time::Instant::now());
            if elapsed.is_zero() {
                return Err(AIError::Provider(format!(
                    "LemonData task {} timed out after {}s",
                    handle.task_id, MAX_POLL_DURATION_SECS
                )));
            }

            info!(
                "[LemonData] Polling task {} (attempt {}, remaining ~{}s)...",
                handle.task_id,
                poll_count,
                elapsed.as_secs()
            );

            match self.poll_task(handle.clone()).await? {
                ProviderTaskPollResult::Running => {
                    sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
                }
                ProviderTaskPollResult::Succeeded(url) => {
                    info!("[LemonData] Task {} completed after {} polls: {}", handle.task_id, poll_count, url);
                    return Ok(url);
                }
                ProviderTaskPollResult::Failed(message) => {
                    return Err(AIError::TaskFailed(message));
                }
            }
        }
    }
}
