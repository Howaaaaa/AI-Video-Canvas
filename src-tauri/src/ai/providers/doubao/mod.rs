use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;
use base64::{engine::general_purpose::STANDARD, Engine};

use crate::ai::error::AIError;
use crate::ai::{AIProvider, ChatRequest, ChatResponse, GenerateRequest};

const CHAT_ENDPOINT_PATH: &str = "/api/v3/chat/completions";
const DEFAULT_BASE_URL: &str = "https://ark.cn-beijing.volces.com";

const SUPPORTED_MODELS: [&str; 2] = [
    "doubao-seed-2-0-mini-260215",
    "doubao-seed-2-0-lite-260215",
];

fn decode_file_url_path(value: &str) -> String {
    let raw = value.trim_start_matches("file://");
    let decoded = urlencoding::decode(raw)
        .map(|result| result.into_owned())
        .unwrap_or_else(|_| raw.to_string());
    let normalized = if decoded.starts_with('/')
        && decoded.len() > 2
        && decoded.as_bytes().get(2) == Some(&b':')
    {
        &decoded[1..]
    } else {
        &decoded
    };
    normalized.to_string()
}

fn encode_image_for_doubao(source: &str) -> Option<String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return None;
    }

    // HTTP/HTTPS URL - use directly
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(trimmed.to_string());
    }

    // Data URL - extract base64 payload
    if let Some((meta, payload)) = trimmed.split_once(',') {
        if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    // Check if it's already base64
    let likely_base64 = trimmed.len() > 256
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
    if likely_base64 {
        return Some(format!("data:image/jpeg;base64,{}", trimmed));
    }

    // File path - read and encode
    let path = if trimmed.starts_with("file://") {
        PathBuf::from(decode_file_url_path(trimmed))
    } else {
        PathBuf::from(trimmed)
    };
    let bytes = std::fs::read(path).ok()?;
    Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

#[derive(Debug, Serialize)]
struct ChatContentPart {
    #[serde(rename = "type")]
    content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_url: Option<ImageUrlContent>,
}

#[derive(Debug, Serialize)]
struct ImageUrlContent {
    url: String,
}

#[derive(Debug, Serialize)]
struct ChatMessageBody {
    role: String,
    content: Vec<ChatContentPart>,
}

#[derive(Debug, Serialize)]
struct ChatRequestBody {
    model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<String>,
    messages: Vec<ChatMessageBody>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
}

#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatResponsePayload {
    choices: Vec<ChatChoice>,
}

pub struct DoubaoProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
}

impl DoubaoProvider {
    pub fn new() -> Self {
        let client = crate::ai::create_shared_client()
            .expect("Failed to create shared HTTP client");
        Self {
            client,
            api_key: Arc::new(RwLock::new(None)),
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    async fn request_chat(&self, request: &ChatRequest) -> Result<ChatResponse, AIError> {
        let endpoint = format!("{}{}", self.base_url, CHAT_ENDPOINT_PATH);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let model = request
            .model
            .split_once('/')
            .map(|(_, model)| model.to_string())
            .unwrap_or_else(|| request.model.clone());

        info!("[Doubao Chat API] URL: {}, model: {}", endpoint, model);

        let mut messages: Vec<ChatMessageBody> = Vec::new();

        for msg in &request.messages {
            let mut parts: Vec<ChatContentPart> = Vec::new();

            // Add text content
            parts.push(ChatContentPart {
                content_type: "text".to_string(),
                text: Some(msg.content.clone()),
                image_url: None,
            });

            // Add images for user messages
            if msg.role == "user" {
                if let Some(images) = &request.images {
                    for image in images {
                        if let Some(url) = encode_image_for_doubao(image) {
                            parts.push(ChatContentPart {
                                content_type: "image_url".to_string(),
                                text: None,
                                image_url: Some(ImageUrlContent { url }),
                            });
                        }
                    }
                }
            }

            messages.push(ChatMessageBody {
                role: msg.role.clone(),
                content: parts,
            });
        }

        let body = ChatRequestBody {
            model,
            reasoning_effort: Some("minimal".to_string()),
            messages,
        };

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
                "Doubao chat request failed {}: {}",
                status, error_text
            )));
        }

        let chat_response = response.json::<ChatResponsePayload>().await?;

        let content = chat_response
            .choices
            .first()
            .and_then(|choice| choice.message.content.clone())
            .ok_or_else(|| AIError::Provider("Doubao chat response missing content".to_string()))?;

        Ok(ChatResponse { content })
    }
}

impl Default for DoubaoProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for DoubaoProvider {
    fn name(&self) -> &str {
        "doubao"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("doubao/") {
            return true;
        }
        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "doubao/doubao-seed-2-0-mini-260215".to_string(),
            "doubao/doubao-seed-2-0-lite-260215".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, _request: GenerateRequest) -> Result<String, AIError> {
        Err(AIError::Provider("Doubao provider does not support image generation".to_string()))
    }

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, AIError> {
        self.request_chat(&request).await
    }
}
