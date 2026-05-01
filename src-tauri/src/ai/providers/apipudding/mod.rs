use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

const DEFAULT_BASE_URL: &str = "https://new.apipudding.com";
const CHAT_COMPLETIONS_PATH: &str = "/v1/chat/completions";

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: String,
}

pub struct ApipuddingProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
}

impl ApipuddingProvider {
    pub fn new() -> Self {
        let client = crate::ai::create_shared_client()
            .expect("Failed to create shared HTTP client");
        Self {
            client,
            api_key: Arc::new(RwLock::new(None)),
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    fn sanitize_model(model: &str) -> String {
        model
            .split_once('/')
            .map(|(_, bare)| bare.to_string())
            .unwrap_or_else(|| model.to_string())
    }

    fn resolve_model_id(bare_model: &str) -> String {
        // Model IDs are fixed, aspect ratio is handled by the API
        match bare_model {
            "nano-banana-2" => "[官逆C]Nano banana 2".to_string(),
            "nano-banana-2-2k" => "[官逆C]Nano banana 2-2k".to_string(),
            _ => "[官逆C]Nano banana 2".to_string(),
        }
    }

    fn build_chat_request(request: &GenerateRequest) -> Value {
        let bare_model = Self::sanitize_model(&request.model);
        let resolved_model = Self::resolve_model_id(&bare_model);

        let user_content = if let Some(ref images) = request.reference_images {
            if images.is_empty() {
                json!(request.prompt)
            } else {
                let mut parts = vec![json!({
                    "type": "text",
                    "text": request.prompt,
                })];
                for image_url in images {
                    parts.push(json!({
                        "type": "image_url",
                        "image_url": {
                            "url": image_url,
                        },
                    }));
                }
                json!(parts)
            }
        } else {
            json!(request.prompt)
        };

        let mut body = json!({
            "model": resolved_model,
            "messages": [{
                "role": "user",
                "content": user_content,
            }],
            "stream": false,
        });

        if let Some(ref extra) = request.extra_params {
            if let Some(thinking) = extra.get("thinking_level").and_then(|v| v.as_str()) {
                if thinking == "minimal" || thinking == "high" {
                    body["thinking"] = json!({
                        "type": "enable",
                        "budget_tokens": if thinking == "high" { 10000 } else { 1024 },
                    });
                }
            }
        }

        body
    }

    fn extract_first_image_base64(content: &str) -> Option<String> {
        let data_uri_start = content.find("data:image/")?;
        let comma_offset = content[data_uri_start..].find(";base64,")?;
        let b64_start = data_uri_start + comma_offset + ";base64,".len();
        let b64_end = content[b64_start..].find(')')?;

        Some(content[b64_start..b64_start + b64_end].to_string())
    }

    fn decode_base64(data: &str) -> Result<Vec<u8>, AIError> {
        let cleaned: String = data.chars().filter(|c| !c.is_whitespace()).collect();
        STANDARD
            .decode(&cleaned)
            .map_err(|err| AIError::Provider(format!("Failed to decode base64 image data: {}", err)))
    }

    async fn save_base64_to_file(&self, data: &str) -> Result<String, AIError> {
        let image_bytes = Self::decode_base64(data)?;
        info!("[Apipudding] Saving image: {} bytes", image_bytes.len());

        let temp_dir = std::env::temp_dir();
        let file_name = format!("apipudding-{}.png", uuid_v4_simple());
        let file_path = temp_dir.join(&file_name);
        std::fs::write(&file_path, &image_bytes)
            .map_err(|err| AIError::Provider(format!("Failed to write image file: {}", err)))?;

        let file_url = format!("file://{}", file_path.display());
        info!("[Apipudding] Saved image to local file: {}", file_url);
        Ok(file_url)
    }
}

fn uuid_v4_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{:x}", ts & 0xFFFFFFFFFFFF)
}

impl Default for ApipuddingProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for ApipuddingProvider {
    fn name(&self) -> &str {
        "apipudding"
    }

    fn supports_model(&self, model: &str) -> bool {
        let sanitized = Self::sanitize_model(model);
        sanitized == "nano-banana-2" || sanitized == "nano-banana-2-2k"
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "apipudding/nano-banana-2".to_string(),
            "apipudding/nano-banana-2-2k".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let bare_model = Self::sanitize_model(&request.model);
        let body = Self::build_chat_request(&request);
        let endpoint = format!("{}{}", self.base_url, CHAT_COMPLETIONS_PATH);

        info!(
            "[Apipudding Request] model: {}, resolved: {}, size: {}, aspect_ratio: {}, refs: {}",
            request.model,
            bare_model,
            request.size,
            request.aspect_ratio,
            request.reference_images.as_ref().map(|refs| refs.len()).unwrap_or(0),
        );
        info!("[Apipudding API] URL: {}", endpoint);

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "Apipudding API error {}: {}",
                status, error_text,
            )));
        }

        let chat_response: ChatCompletionResponse = response.json().await?;
        let content = chat_response
            .choices
            .first()
            .map(|c| c.message.content.as_str())
            .unwrap_or("");

        let base64_data = Self::extract_first_image_base64(content).ok_or_else(|| {
            AIError::Provider(format!(
                "Apipudding response contained no base64 image data. Content preview: {}",
                &content[..content.len().min(200)],
            ))
        })?;

        self.save_base64_to_file(&base64_data).await
    }
}
