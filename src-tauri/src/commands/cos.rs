use std::sync::RwLock;
use hmac::{Hmac, Mac};
use sha1::{Sha1, Digest};
use chrono::Utc;
use hex::encode as hex_encode;
use serde::Deserialize;
use tracing::info;

type HmacSha1 = Hmac<Sha1>;

#[derive(Debug, Clone, Deserialize)]
pub struct CosConfig {
    #[serde(rename = "secretId")]
    pub secret_id: String,
    #[serde(rename = "secretKey")]
    pub secret_key: String,
    pub region: String,
    pub bucket: String,
}

impl Default for CosConfig {
    fn default() -> Self {
        Self {
            secret_id: String::new(),
            secret_key: String::new(),
            region: "ap-nanjing".to_string(),
            bucket: String::new(),
        }
    }
}

static COS_CONFIG: RwLock<CosConfig> = RwLock::new(CosConfig {
    secret_id: String::new(),
    secret_key: String::new(),
    region: String::new(),
    bucket: String::new(),
});

fn cos_host_region_bucket() -> (String, String, String) {
    let cfg = COS_CONFIG.read().unwrap_or_else(|e| e.into_inner());
    let region = if cfg.region.is_empty() { "ap-nanjing".to_string() } else { cfg.region.clone() };
    let bucket = cfg.bucket.clone();
    let host = if bucket.is_empty() {
        String::new()
    } else {
        format!("{}.cos.{}.myqcloud.com", bucket, region)
    };
    (host, region, bucket)
}

fn cos_base_url(host: &str) -> String {
    if host.is_empty() { String::new() } else { format!("https://{}", host) }
}

#[tauri::command]
pub fn set_cos_config(config: CosConfig) {
    let region = config.region.clone();
    let bucket = config.bucket.clone();
    let has_id = !config.secret_id.is_empty();
    let has_key = !config.secret_key.is_empty();
    match COS_CONFIG.write() {
        Ok(mut cfg) => *cfg = config,
        Err(e) => {
            tracing::error!("Failed to acquire COS_CONFIG write lock: {}", e);
            return;
        }
    }
    info!(
        "[COS] Config updated: region={}, bucket={}, hasSecretId={}, hasSecretKey={}",
        region, bucket, has_id, has_key
    );
}

fn cos_secret_id() -> String {
    COS_CONFIG.read().map(|c| c.secret_id.clone()).unwrap_or_default()
}

fn cos_secret_key() -> String {
    COS_CONFIG.read().map(|c| c.secret_key.clone()).unwrap_or_default()
}

pub struct CosUploader {
    client: reqwest::Client,
}

impl CosUploader {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }
}

impl Default for CosUploader {
    fn default() -> Self {
        Self::new()
    }
}

impl CosUploader {
    pub fn generate_public_url(filename: &str) -> String {
        let (host, _region, _bucket) = cos_host_region_bucket();
        let base_url = cos_base_url(&host);
        if base_url.is_empty() {
            return String::new();
        }
        format!("{}/{}", base_url, filename)
    }

    fn generate_signature(
        secret_key: &str,
        method: &str,
        path: &str,
        headers: &str,
        params: &str,
        expiration: i64,
        start_time: i64,
    ) -> String {
        let key_time = format!("{};{}", start_time, expiration);

        // SignKey = HMAC-SHA1(SecretKey, KeyTime)
        let mut mac = HmacSha1::new_from_slice(secret_key.as_bytes()).expect("HMAC initialization failed");
        mac.update(key_time.as_bytes());
        let sign_key = hex_encode(mac.finalize().into_bytes());

        // HttpString = HttpMethod + "\n" + HttpPath + "\n" + HttpParams + "\n" + HttpHeaders + "\n"
        let http_string = format!("{}\n{}\n{}\n{}\n", method, path, params, headers);

        // StringToSign = "sha1\n" + KeyTime + "\n" + SHA1(HttpString) + "\n"
        let http_string_sha1 = {
            let mut hasher = Sha1::new();
            hasher.update(http_string.as_bytes());
            hex_encode(hasher.finalize())
        };
        let string_to_sign = format!("sha1\n{}\n{}\n", key_time, http_string_sha1);

        // Signature = HMAC-SHA1(SignKey, StringToSign)
        let mut mac = HmacSha1::new_from_slice(sign_key.as_bytes()).expect("HMAC initialization failed");
        mac.update(string_to_sign.as_bytes());
        hex_encode(mac.finalize().into_bytes())
    }

    pub async fn upload(
        &self,
        filename: &str,
        data: &[u8],
        content_type: &str,
    ) -> Result<String, String> {
        let (host, _region, _bucket) = cos_host_region_bucket();
        let base_url = cos_base_url(&host);
        if host.is_empty() || base_url.is_empty() {
            return Err("COS 未配置，请在设置中填写存储密钥（图床密钥）".to_string());
        }

        let secret_id = cos_secret_id();
        let secret_key = cos_secret_key();
        if secret_id.is_empty() || secret_key.is_empty() {
            return Err("COS 密钥未配置，请在设置中填写存储密钥".to_string());
        }

        let now = Utc::now().timestamp();
        let expiration = now + 3600; // 1 hour expiration

        let path = format!("/{}", filename);

        // Required headers for COS authorization
        let headers = format!(
            "content-type={}&host={}",
            urlencoding::encode(content_type),
            host
        );

        let signature = Self::generate_signature(
            &secret_key,
            "put",
            &path,
            &headers,
            "",
            expiration,
            now,
        );

        let key_time = format!("{};{}", now, expiration);

        // Build authorization header
        let authorization = format!(
            "q-sign-algorithm=sha1&q-ak={}&q-sign-time={}&q-key-time={}&q-header-list=content-type;host&q-url-param-list=&q-signature={}",
            secret_id,
            key_time,
            key_time,
            signature
        );

        let url = format!("{}/{}", base_url, filename);

        info!("[COS Upload] Uploading to: {}, size: {} bytes", url, data.len());

        let response = self
            .client
            .put(&url)
            .header("Host", &host)
            .header("Content-Type", content_type)
            .header("Authorization", authorization)
            .body(data.to_vec())
            .send()
            .await
            .map_err(|e| format!("COS request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("COS upload failed {}: {}", status, error_text));
        }

        let public_url = Self::generate_public_url(filename);
        info!("[COS Upload] Success: {}", public_url);

        Ok(public_url)
    }

    pub async fn upload_image(&self, data: &[u8], extension: &str) -> Result<String, String> {
        let digest = md5::compute(data);
        let filename = format!("{:x}.{}", digest, extension);

        let content_type = match extension {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "gif" => "image/gif",
            _ => "application/octet-stream",
        };

        self.upload(&filename, data, content_type).await
    }
}
