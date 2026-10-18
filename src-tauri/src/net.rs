//! 前端抓歌詞用的 HTTP GET。
//!
//! 歌詞來源大多沒有開放 CORS，所以由 Rust 代為連線。只允許 HTTPS 和白名單裡的主機；
//! 回傳狀態碼和文字內容，判斷與解析都在前端做。

use std::collections::HashMap;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, RETRY_AFTER};
use reqwest::{RequestBuilder, Response, StatusCode, Url};
use serde::Serialize;
use tauri::State;

/// 允許連線的主機
const ALLOWED_HOSTS: &[&str] = &[
    "lrclib.net",
    "music.163.com",
    "lyrics.kugou.com",
    // QQ 音樂的搜尋與歌詞
    "c.y.qq.com",
    "u.y.qq.com",
    // AMLL TTML DB 本站與鏡像
    "raw.githubusercontent.com",
    "amll.mirror.dimeta.top",
    "amlldb.bikonoo.com",
    "amll-ttml-db.gbclstudio.cn",
];
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_TIMEOUT: Duration = Duration::from_secs(30);
/// 歌詞檔都很小；最大的是 AMLL TTML DB 的 Spotify 索引（2026 年約 3MB），留一點成長空間
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
/// 伺服器忙碌（503／429）時稍等再試；最多重試兩次，不要一直敲。
const MAX_RETRIES: u32 = 2;
const MAX_RETRY_WAIT: Duration = Duration::from_secs(3);

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

pub struct HttpClient {
    http: reqwest::Client,
}

impl HttpClient {
    pub fn new() -> reqwest::Result<Self> {
        let http = reqwest::Client::builder()
            // LRCLIB 希望用戶端在 User-Agent 帶上程式名稱與版本
            .user_agent(concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(8))
            .build()?;
        Ok(Self { http })
    }
}

fn check_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|e| format!("網址格式錯誤：{e}"))?;
    if url.scheme() != "https" {
        return Err(format!("只允許 HTTPS：{raw}"));
    }
    match url.host_str() {
        Some(host) if ALLOWED_HOSTS.contains(&host) => Ok(url),
        Some(host) => Err(format!("不允許連線到 {host}")),
        None => Err(format!("網址沒有主機名稱：{raw}")),
    }
}

fn build_headers(headers: Option<HashMap<String, String>>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for (name, value) in headers.unwrap_or_default() {
        let name = HeaderName::from_bytes(name.as_bytes()).map_err(|e| format!("標頭名稱錯誤：{e}"))?;
        let value = HeaderValue::from_str(&value).map_err(|e| format!("標頭內容錯誤：{e}"))?;
        map.insert(name, value);
    }
    Ok(map)
}

async fn send(request: RequestBuilder) -> Result<Response, String> {
    let mut attempt = 0;
    loop {
        let response = request
            .try_clone()
            .expect("GET 請求沒有串流內容，一定可以複製")
            .send()
            .await
            .map_err(|e| format!("連線失敗：{e}"))?;
        let busy = matches!(response.status(), StatusCode::SERVICE_UNAVAILABLE | StatusCode::TOO_MANY_REQUESTS);
        if !busy || attempt >= MAX_RETRIES {
            return Ok(response);
        }
        attempt += 1;
        let retry_after = response
            .headers()
            .get(RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok())
            .map(Duration::from_secs);
        let wait = retry_after.unwrap_or(Duration::from_millis(800 * u64::from(attempt)));
        tokio::time::sleep(wait.min(MAX_RETRY_WAIT)).await;
    }
}

async fn read_body(mut response: Response) -> Result<String, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("讀取回應失敗：{e}"))? {
        if bytes.len() + chunk.len() > MAX_BODY_BYTES {
            return Err("回應內容太大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// GET 指定網址。非 2xx 也照樣回傳，由前端判斷（例如 404 代表沒有這首歌）。
#[tauri::command]
pub async fn http_get(
    client: State<'_, HttpClient>,
    url: String,
    headers: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<HttpResponse, String> {
    let url = check_url(&url)?;
    let timeout = timeout_ms.map(Duration::from_millis).unwrap_or(DEFAULT_TIMEOUT).min(MAX_TIMEOUT);
    let request = client.http.get(url).headers(build_headers(headers)?).timeout(timeout);
    let response = send(request).await?;
    let status = response.status().as_u16();
    Ok(HttpResponse { status, body: read_body(response).await? })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_https_hosts_on_the_list() {
        assert!(check_url("https://lrclib.net/api/search?track_name=a").is_ok());
        assert!(check_url("https://music.163.com/api/song/lyric/v1?id=1").is_ok());
        assert!(check_url("http://lrclib.net/api/search").is_err());
        assert!(check_url("https://example.com/").is_err());
        assert!(check_url("https://lrclib.net.example.com/").is_err());
        assert!(check_url("file:///C:/Windows/win.ini").is_err());
        assert!(check_url("not a url").is_err());
    }
}
