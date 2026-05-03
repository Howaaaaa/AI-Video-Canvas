use hmac::{Hmac, Mac};
use sha1::{Sha1, Digest};
use chrono::Utc;
use hex::encode as hex_encode;
use tracing::info;

type HmacSha1 = Hmac<Sha1>;

fn cos_secret_id() -> String {
    std::env::var("LEMONDATA_COS_SECRET_ID").unwrap_or_default()
}
fn cos_secret_key() -> String {
    std::env::var("LEMONDATA_COS_SECRET_KEY").unwrap_or_default()
}
fn cos_region() -> String {
    std::env::var("LEMONDATA_COS_REGION").unwrap_or_else(|_| "ap-nanjing".to_string())
}
fn cos_bucket() -> String {
    std::env::var("LEMONDATA_COS_BUCKET").unwrap_or_else(|_| "lemondata-1328693774".to_string())
}
fn cos_host() -> String {
    format!("{}.cos.{}.myqcloud.com", cos_bucket(), cos_region())
}
fn cos_base_url() -> String {
    format!("https://{}", cos_host())
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
        format!("{}/{}", &cos_base_url(), filename)
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
        let now = Utc::now().timestamp();
        let expiration = now + 3600; // 1 hour expiration

        let path = format!("/{}", filename);

        // Required headers for COS authorization
        let headers = format!(
            "content-type={}&host={}",
            urlencoding::encode(content_type),
            &cos_host()
        );

        let signature = Self::generate_signature(
            &cos_secret_key(),
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
            &cos_secret_id(),
            key_time,
            key_time,
            signature
        );

        let url = format!("{}/{}", &cos_base_url(), filename);

        info!("[COS Upload] Uploading to: {}, size: {} bytes", url, data.len());

        let response = self
            .client
            .put(&url)
            .header("Host", &cos_host())
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