//! Spotify Web API（選用）：PKCE 登入、權杖保存、API 代理。
//!
//! - 登入：瀏覽器打開 Spotify 的授權頁，授權後轉回本機的 http://127.0.0.1:47823/callback，
//!   這裡暫時開一個只收一次回呼的小伺服器拿授權碼，再換成權杖。
//! - 權杖只留在 Rust 端：refresh token 存在 Windows 認證管理員，access token 只放記憶體。
//! - 前端只能呼叫幾個固定的端點（ALLOWED_CALLS），回傳狀態碼和內容，解析在前端做。
//! - 錯誤一律回傳代碼（「代碼」或「代碼:細節」），由前端依介面語言轉成文字（spotify/errors.ts）。

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::header::RETRY_AFTER;
use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Notify};

/// 要在 Spotify 開發者後台登記的回呼網址（只能用 127.0.0.1，不能用 localhost）
pub const REDIRECT_PORT: u16 = 47823;
pub const REDIRECT_URI: &str = "http://127.0.0.1:47823/callback";
/// 讀目前播放的歌與播放佇列、查詢與修改「已按讚的歌曲」
const SCOPES: &str = "user-read-currently-playing user-read-playback-state user-library-read user-library-modify";
const AUTHORIZE_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const API_BASE: &str = "https://api.spotify.com/v1/";
/// 建立開發者 App 的後台（設定頁的按鈕打開它）
const DASHBOARD_URL: &str = "https://developer.spotify.com/dashboard";
/// 前端可以呼叫的端點；其他一律拒絕
const ALLOWED_CALLS: &[(&str, &str)] = &[
    ("GET", "me"),
    ("GET", "me/player/currently-playing"),
    ("GET", "me/player/queue"),
    ("GET", "me/library/contains"),
    ("PUT", "me/library"),
    ("DELETE", "me/library"),
];
/// 等使用者在瀏覽器裡登入的時間
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
/// access token 到期前多久就先換新的
const REFRESH_MARGIN: Duration = Duration::from_secs(60);
/// Spotify 要求稍等時最多等多久（超過就當成這麼久）
const MAX_BACKOFF: Duration = Duration::from_secs(600);
/// refresh token 從登入起算半年後失效（2026 年 6 月起的規定），只用來在設定頁顯示
const REFRESH_TOKEN_LIFETIME_MS: u64 = 182 * 24 * 3600 * 1000;
const KEYRING_SERVICE: &str = "lyrics-app";
const KEYRING_USER: &str = "spotify";
pub const STATUS_EVENT: &str = "spotify://status";

/// 存在認證管理員裡的資料
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    client_id: String,
    /// 登出或授權過期後是 None；Client ID 留著，重新連結時不必再貼
    refresh_token: Option<String>,
    user_name: Option<String>,
    /// 登入時間（Unix 毫秒）
    logged_in_at: u64,
    /// 上次是不是因為授權過期才斷線
    #[serde(default)]
    expired: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyStatus {
    /// disconnected：沒有連結；connected：已連結；expired：授權過期要重新登入；logging-in：等瀏覽器登入
    state: &'static str,
    client_id: Option<String>,
    user_name: Option<String>,
    /// 授權大約什麼時候到期（Unix 毫秒）
    expires_at: Option<u64>,
    redirect_uri: &'static str,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SpotifyResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenError {
    error: String,
    error_description: Option<String>,
}

#[derive(Default)]
struct Inner {
    saved: Option<Saved>,
    access: Option<(String, Instant)>,
    logging_in: bool,
    backoff_until: Option<Instant>,
    last_error: Option<String>,
}

pub struct Spotify {
    http: reqwest::Client,
    inner: Mutex<Inner>,
    cancel_login: Notify,
}

impl Spotify {
    pub fn new() -> reqwest::Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(15))
            .build()?;
        let saved = load_saved().unwrap_or_else(|e| {
            eprintln!("讀取 Spotify 登入資料失敗：{e}");
            None
        });
        Ok(Self { http, inner: Mutex::new(Inner { saved, ..Inner::default() }), cancel_login: Notify::new() })
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn status_of(inner: &Inner) -> SpotifyStatus {
    let saved = inner.saved.as_ref();
    let connected = saved.is_some_and(|s| s.refresh_token.is_some());
    let state = if inner.logging_in {
        "logging-in"
    } else if connected {
        "connected"
    } else if saved.is_some_and(|s| s.expired) {
        "expired"
    } else {
        "disconnected"
    };
    SpotifyStatus {
        state,
        client_id: saved.map(|s| s.client_id.clone()),
        user_name: saved.filter(|_| connected).and_then(|s| s.user_name.clone()),
        expires_at: saved.filter(|_| connected).map(|s| s.logged_in_at + REFRESH_TOKEN_LIFETIME_MS),
        redirect_uri: REDIRECT_URI,
        error: inner.last_error.clone(),
    }
}

fn emit_status(app: &AppHandle, inner: &Inner) {
    let _ = app.emit(STATUS_EVENT, status_of(inner));
}

// ===== 認證管理員 =====

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("keyring:{e}"))
}

fn load_saved() -> Result<Option<Saved>, String> {
    match keyring_entry()?.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring:{e}")),
    }
}

fn store_saved(saved: &Saved) -> Result<(), String> {
    let json = serde_json::to_string(saved).map_err(|e| e.to_string())?;
    keyring_entry()?.set_password(&json).map_err(|e| format!("keyring:{e}"))
}

// ===== PKCE =====

fn random_token(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| format!("auth:{e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

/// code_challenge = BASE64URL(SHA256(code_verifier))（RFC 7636 的 S256）
fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Spotify 的 Client ID 是 32 個十六進位字元
fn is_valid_client_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

fn authorize_url(client_id: &str, challenge: &str, state: &str) -> Url {
    let mut url = Url::parse(AUTHORIZE_URL).expect("固定的網址");
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", challenge)
        .append_pair("scope", SCOPES)
        .append_pair("state", state);
    url
}

/// 回呼請求的結果
#[derive(Debug, PartialEq)]
enum Callback {
    Code { code: String, state: String },
    Denied { error: String, state: String },
    /// 不是回呼（例如瀏覽器要 favicon）
    Other,
}

/// 從 HTTP 請求的第一行（「GET /callback?code=…&state=… HTTP/1.1」）取出授權碼或錯誤。
fn parse_callback(request: &str) -> Callback {
    let Some(target) = request.lines().next().and_then(|line| line.split_whitespace().nth(1)) else {
        return Callback::Other;
    };
    let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
        return Callback::Other;
    };
    if url.path() != "/callback" {
        return Callback::Other;
    }
    let get = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned());
    let state = get("state").unwrap_or_default();
    match (get("code"), get("error")) {
        (Some(code), _) => Callback::Code { code, state },
        (None, Some(error)) => Callback::Denied { error, state },
        _ => Callback::Other,
    }
}

/// 登入完成後瀏覽器分頁顯示的文字（前端依介面語言傳進來）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallbackPage {
    lang: String,
    success_title: String,
    success_message: String,
    denied_title: String,
    denied_message: String,
    other_title: String,
    other_message: String,
}

impl Default for CallbackPage {
    fn default() -> Self {
        Self {
            lang: "zh-Hant-TW".into(),
            success_title: "已連結 Spotify".into(),
            success_message: "可以關閉這個分頁，回到 Lyrisync。".into(),
            denied_title: "沒有連結 Spotify".into(),
            denied_message: "你取消了授權，可以關閉這個分頁。".into(),
            other_title: "找不到頁面".into(),
            other_message: "這不是 Lyrisync 的登入回呼。".into(),
        }
    }
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn html_page(lang: &str, title: &str, message: &str) -> String {
    let (lang, title, message) = (escape_html(lang), escape_html(title), escape_html(message));
    format!(
        "<!doctype html><html lang=\"{lang}\"><head><meta charset=\"utf-8\"><title>{title}</title>\
         <style>body{{margin:0;height:100vh;display:grid;place-items:center;background:#141211;color:#f4f1ec;\
         font:16px 'Segoe UI','Microsoft JhengHei UI',sans-serif}}main{{text-align:center}}h1{{font-size:22px;margin:0 0 10px}}\
         p{{margin:0;color:#ffffff99}}</style></head><body><main><h1>{title}</h1><p>{message}</p></main></body></html>"
    )
}

async fn respond(stream: &mut tokio::net::TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// 等瀏覽器轉回本機的回呼，回傳授權碼。
async fn wait_for_code(listener: TcpListener, expected_state: &str, page: &CallbackPage) -> Result<String, String> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|e| format!("network:{e}"))?;
        let mut buf = vec![0u8; 8192];
        let n = match tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buf)).await {
            Ok(Ok(n)) => n,
            _ => continue,
        };
        let request = String::from_utf8_lossy(&buf[..n]);
        match parse_callback(&request) {
            Callback::Code { code, state } if state == expected_state => {
                respond(&mut stream, "200 OK", &html_page(&page.lang, &page.success_title, &page.success_message)).await;
                return Ok(code);
            }
            Callback::Denied { error, state } if state == expected_state => {
                respond(&mut stream, "200 OK", &html_page(&page.lang, &page.denied_title, &page.denied_message)).await;
                return Err(if error == "access_denied" { "denied".into() } else { format!("auth:{error}") });
            }
            // 舊的分頁或別的請求：不理它，繼續等
            _ => respond(&mut stream, "404 Not Found", &html_page(&page.lang, &page.other_title, &page.other_message)).await,
        }
    }
}

/// 換權杖失敗的原因，轉成錯誤代碼
fn describe_token_error(status: StatusCode, body: &str) -> String {
    match serde_json::from_str::<TokenError>(body) {
        Ok(e) => match e.error.as_str() {
            "invalid_client" => "invalid_client".into(),
            "invalid_grant" => "invalid_grant".into(),
            _ => format!("auth:{} {}", e.error, e.error_description.unwrap_or_default()).trim_end().to_string(),
        },
        Err(_) => format!("http:{}", status.as_u16()),
    }
}

impl Spotify {
    async fn request_token(&self, form: &[(&str, &str)]) -> Result<TokenResponse, (StatusCode, String)> {
        let response = self
            .http
            .post(TOKEN_URL)
            .form(form)
            .send()
            .await
            .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, format!("network:{e}")))?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err((status, describe_token_error(status, &body)));
        }
        serde_json::from_str(&body).map_err(|_| (status, "token".to_string()))
    }

    /// 取得有效的 access token；快到期就用 refresh token 換新的。授權過期時標記為 expired。
    async fn access_token(&self, app: &AppHandle, force_refresh: bool) -> Result<String, String> {
        let mut inner = self.inner.lock().await;
        if !force_refresh {
            if let Some((token, until)) = &inner.access {
                if Instant::now() + REFRESH_MARGIN < *until {
                    return Ok(token.clone());
                }
            }
        }
        let Some(saved) = inner.saved.clone() else {
            return Err("not_connected".into());
        };
        let Some(refresh_token) = saved.refresh_token.clone() else {
            return Err("not_connected".into());
        };
        let form = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            ("client_id", saved.client_id.as_str()),
        ];
        match self.request_token(&form).await {
            Ok(token) => {
                inner.access = Some((token.access_token.clone(), Instant::now() + Duration::from_secs(token.expires_in)));
                inner.last_error = None;
                // PKCE 的 refresh token 可能只能用一次：有新的就一定要存下來
                if let Some(next) = token.refresh_token.filter(|next| *next != refresh_token) {
                    let updated = Saved { refresh_token: Some(next), ..saved };
                    if let Err(e) = store_saved(&updated) {
                        eprintln!("{e}");
                    }
                    inner.saved = Some(updated);
                }
                Ok(token.access_token)
            }
            Err((status, message)) if status == StatusCode::BAD_REQUEST || status == StatusCode::UNAUTHORIZED => {
                // 授權過期（登入滿半年）或在 Spotify 帳號裡撤銷了：要重新登入
                let updated = Saved { refresh_token: None, expired: true, ..saved };
                let _ = store_saved(&updated);
                inner.saved = Some(updated);
                inner.access = None;
                inner.last_error = Some(message.clone());
                emit_status(app, &inner);
                Err(message)
            }
            Err((_, message)) => Err(message),
        }
    }

    async fn login(&self, app: &AppHandle, client_id: String, page: CallbackPage) -> Result<SpotifyStatus, String> {
        let client_id = client_id.trim().to_string();
        if !is_valid_client_id(&client_id) {
            return Err("invalid_client_id".into());
        }
        let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
            .await
            .map_err(|_| "port_in_use".to_string())?;
        let verifier = random_token(64)?;
        let state = random_token(16)?;
        let url = authorize_url(&client_id, &code_challenge(&verifier), &state);
        app.opener()
            .open_url(url.as_str(), None::<&str>)
            .map_err(|e| format!("browser:{e}"))?;

        let code = tokio::select! {
            result = tokio::time::timeout(LOGIN_TIMEOUT, wait_for_code(listener, &state, &page)) => {
                result.map_err(|_| "timeout".to_string())??
            }
            _ = self.cancel_login.notified() => return Err("cancelled".into()),
        };

        let form = [
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", REDIRECT_URI),
            ("client_id", client_id.as_str()),
            ("code_verifier", verifier.as_str()),
        ];
        let token = self.request_token(&form).await.map_err(|(_, message)| message)?;
        let refresh_token = token.refresh_token.ok_or("token")?;
        let user_name = self.fetch_user_name(&token.access_token).await;
        let saved = Saved {
            client_id,
            refresh_token: Some(refresh_token),
            user_name,
            logged_in_at: now_ms(),
            expired: false,
        };
        store_saved(&saved)?;
        let mut inner = self.inner.lock().await;
        inner.access = Some((token.access_token, Instant::now() + Duration::from_secs(token.expires_in)));
        inner.saved = Some(saved);
        inner.last_error = None;
        inner.backoff_until = None;
        Ok(status_of(&inner))
    }

    /// 顯示在設定頁的名稱；拿不到也不影響登入
    async fn fetch_user_name(&self, access_token: &str) -> Option<String> {
        let response = self.http.get(format!("{API_BASE}me")).bearer_auth(access_token).send().await.ok()?;
        let me: serde_json::Value = response.json().await.ok()?;
        me.get("display_name").or_else(|| me.get("id")).and_then(|v| v.as_str()).map(str::to_owned)
    }

    async fn call(&self, app: &AppHandle, method: &str, path: &str, query: &[(String, String)]) -> Result<SpotifyResponse, String> {
        if !ALLOWED_CALLS.contains(&(method, path)) {
            return Err(format!("http:403 {method} {path}"));
        }
        if let Some(until) = self.inner.lock().await.backoff_until {
            let now = Instant::now();
            if now < until {
                return Err(format!("rate_limited:{}", (until - now).as_secs() + 1));
            }
        }
        let method = Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
        let mut url = Url::parse(API_BASE).expect("固定的網址").join(path).map_err(|e| e.to_string())?;
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query);
        }
        let has_no_body = method != Method::GET;

        let mut token = self.access_token(app, false).await?;
        for attempt in 0..2 {
            let mut request = self.http.request(method.clone(), url.clone()).bearer_auth(&token);
            if has_no_body {
                // PUT／DELETE 沒有內容，Spotify 仍要求長度標頭（不然回 411）
                request = request.header(reqwest::header::CONTENT_LENGTH, "0");
            }
            let response = request
                .send()
                .await
                .map_err(|e| format!("network:{e}"))?;
            let status = response.status();
            if status == StatusCode::UNAUTHORIZED && attempt == 0 {
                // access token 被提早作廢：換一個再試一次
                token = self.access_token(app, true).await?;
                continue;
            }
            if status == StatusCode::TOO_MANY_REQUESTS {
                let wait = response
                    .headers()
                    .get(RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.trim().parse::<u64>().ok())
                    .map(Duration::from_secs)
                    .unwrap_or(Duration::from_secs(30))
                    .min(MAX_BACKOFF);
                self.inner.lock().await.backoff_until = Some(Instant::now() + wait);
                return Err(format!("rate_limited:{}", wait.as_secs()));
            }
            let body = response.text().await.map_err(|e| format!("network:{e}"))?;
            return Ok(SpotifyResponse { status: status.as_u16(), body });
        }
        unreachable!("迴圈只跑兩次，第二次一定會回傳")
    }
}

// ===== 前端呼叫的指令 =====

#[tauri::command]
pub async fn spotify_status(spotify: State<'_, Spotify>) -> Result<SpotifyStatus, String> {
    Ok(status_of(&*spotify.inner.lock().await))
}

/// 打開瀏覽器讓使用者登入，等授權完成（或取消、逾時）才回傳。
#[tauri::command]
pub async fn spotify_login(
    app: AppHandle,
    spotify: State<'_, Spotify>,
    client_id: String,
    page: Option<CallbackPage>,
) -> Result<SpotifyStatus, String> {
    {
        let mut inner = spotify.inner.lock().await;
        if inner.logging_in {
            return Err("busy".into());
        }
        inner.logging_in = true;
        inner.last_error = None;
        emit_status(&app, &inner);
    }
    let result = spotify.login(&app, client_id, page.unwrap_or_default()).await;
    let mut inner = spotify.inner.lock().await;
    inner.logging_in = false;
    if let Err(e) = &result {
        inner.last_error = Some(e.clone());
    }
    emit_status(&app, &inner);
    result
}

#[tauri::command]
pub async fn spotify_cancel_login(spotify: State<'_, Spotify>) -> Result<(), String> {
    spotify.cancel_login.notify_waiters();
    Ok(())
}

/// 中斷連結：刪掉權杖，Client ID 留著方便下次連結。
#[tauri::command]
pub async fn spotify_logout(app: AppHandle, spotify: State<'_, Spotify>) -> Result<SpotifyStatus, String> {
    let mut inner = spotify.inner.lock().await;
    if let Some(saved) = inner.saved.clone() {
        let updated = Saved { refresh_token: None, user_name: None, expired: false, ..saved };
        store_saved(&updated)?;
        inner.saved = Some(updated);
    }
    inner.access = None;
    inner.last_error = None;
    emit_status(&app, &inner);
    Ok(status_of(&inner))
}

/// 用瀏覽器打開 Spotify 開發者後台（只會打開這個固定網址）。
#[tauri::command]
pub fn spotify_open_dashboard(app: AppHandle) -> Result<(), String> {
    app.opener().open_url(DASHBOARD_URL, None::<&str>).map_err(|e| format!("browser:{e}"))
}

/// 點封面、歌手時在 Spotify 開啟：有 ID 就開專輯或歌手頁，沒有就用名稱搜尋。
/// 先用 spotify: 網址讓桌面版 Spotify 打開；沒裝桌面版（開不起來）時改用瀏覽器開網頁版。
#[tauri::command]
pub fn spotify_open(app: AppHandle, kind: String, id: Option<String>, query: Option<String>) -> Result<(), String> {
    let (uri, web) = spotify_link(&kind, id.as_deref(), query.as_deref())?;
    if app.opener().open_url(&uri, None::<&str>).is_ok() {
        return Ok(());
    }
    app.opener().open_url(&web, None::<&str>).map_err(|e| format!("browser:{e}"))
}

/// 網址的百分比編碼：只留英數與 -._~，其他位元組都編碼（空白是 %20）
fn percent_encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Spotify 的 ID 是 22 個英數字元
fn is_spotify_id(id: &str) -> bool {
    id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// 組出桌面版用的 spotify: 網址與網頁版網址；只接受專輯、歌手，搜尋字串會編碼，不會組出其他指令。
fn spotify_link(kind: &str, id: Option<&str>, query: Option<&str>) -> Result<(String, String), String> {
    if kind != "album" && kind != "artist" {
        return Err(format!("http:400 {kind}"));
    }
    if let Some(id) = id.filter(|id| is_spotify_id(id)) {
        return Ok((format!("spotify:{kind}:{id}"), format!("https://open.spotify.com/{kind}/{id}")));
    }
    let query = query.map(str::trim).filter(|q| !q.is_empty() && q.chars().count() <= 200).ok_or("http:400 query")?;
    let encoded = percent_encode(query);
    Ok((format!("spotify:search:{encoded}"), format!("https://open.spotify.com/search/{encoded}")))
}

/// 呼叫 Spotify Web API（只限 ALLOWED_CALLS）。非 2xx 也照樣回傳，由前端判斷。
#[tauri::command]
pub async fn spotify_api(
    app: AppHandle,
    spotify: State<'_, Spotify>,
    method: String,
    path: String,
    query: Option<Vec<(String, String)>>,
) -> Result<SpotifyResponse, String> {
    spotify.call(&app, &method, &path, &query.unwrap_or_default()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_challenge_is_base64url_of_sha256() {
        // 預期值用 Node 的 crypto 另外算：createHash('sha256').update(v).digest('base64url')
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mJ92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "ngF5GsXcbwljx6u133FFr3Xht9xooA_DuaX_3QwODtc"
        );
    }

    #[test]
    fn random_tokens_are_url_safe_and_long_enough_for_pkce() {
        let verifier = random_token(64).unwrap();
        assert!((43..=128).contains(&verifier.len()));
        assert!(verifier.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_ne!(verifier, random_token(64).unwrap());
    }

    #[test]
    fn checks_the_client_id_shape() {
        assert!(is_valid_client_id("0123456789abcdef0123456789ABCDEF"));
        assert!(!is_valid_client_id("0123456789abcdef"));
        assert!(!is_valid_client_id("0123456789abcdef0123456789abcdeg"));
    }

    #[test]
    fn builds_the_authorize_url_with_the_loopback_redirect() {
        let url = authorize_url("abc", "challenge", "xyz");
        let pairs: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        assert!(pairs.contains(&("redirect_uri".into(), "http://127.0.0.1:47823/callback".into())));
        assert!(pairs.contains(&("code_challenge_method".into(), "S256".into())));
        assert!(pairs.contains(&("scope".into(), SCOPES.into())));
    }

    #[test]
    fn reads_the_code_or_error_from_the_callback() {
        assert_eq!(
            parse_callback("GET /callback?code=AQB&state=s1 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
            Callback::Code { code: "AQB".into(), state: "s1".into() }
        );
        assert_eq!(
            parse_callback("GET /callback?error=access_denied&state=s1 HTTP/1.1\r\n"),
            Callback::Denied { error: "access_denied".into(), state: "s1".into() }
        );
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1\r\n"), Callback::Other);
        assert_eq!(parse_callback(""), Callback::Other);
    }

    #[test]
    fn escapes_the_callback_page_text() {
        let html = html_page("en", "<b>Hi</b>", "a & b");
        assert!(html.contains("&lt;b&gt;Hi&lt;/b&gt;"));
        assert!(html.contains("a &amp; b"));
    }

    #[test]
    fn opens_albums_and_artists_by_id_or_by_search() {
        assert_eq!(
            spotify_link("album", Some("4aawyAB9vmqN3uQ7FjRGTy"), None).unwrap(),
            ("spotify:album:4aawyAB9vmqN3uQ7FjRGTy".into(), "https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy".into())
        );
        // ID 格式不對就改用搜尋；搜尋字串要編碼
        let (uri, web) = spotify_link("artist", Some("../evil"), Some("周杰倫 & Friends")).unwrap();
        assert!(uri.starts_with("spotify:search:%E5%91%A8"));
        assert!(uri.ends_with("%26%20Friends"));
        assert!(web.starts_with("https://open.spotify.com/search/"));
        assert!(spotify_link("track", Some("4aawyAB9vmqN3uQ7FjRGTy"), None).is_err());
        assert!(spotify_link("album", None, Some("  ")).is_err());
    }

    #[test]
    fn only_allows_the_listed_calls() {
        assert!(ALLOWED_CALLS.contains(&("GET", "me/player/queue")));
        assert!(!ALLOWED_CALLS.contains(&("PUT", "me/player/play")));
        assert!(!ALLOWED_CALLS.contains(&("GET", "../me")));
    }
}
