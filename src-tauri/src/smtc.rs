//! 透過 Windows SMTC（系統媒體傳輸控制）讀取 Spotify 的播放狀態與專輯封面。
//!
//! 所有 WinRT 呼叫都集中在同一條背景執行緒（MTA）上，指令透過 channel 送進來，
//! 這樣就不會在 Tauri 主執行緒上同步等待非同步作業。

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, State};

pub const SNAPSHOT_EVENT: &str = "player://snapshot";

/// Spotify 一次播放狀態的快照，欄位對應前端的 `PlayerSnapshot`。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub app_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub status: &'static str,
    pub position_ms: i64,
    pub duration_ms: i64,
    /// Spotify 最後一次更新進度的系統時間（Unix 毫秒），0 代表沒有提供。
    pub last_updated_ms: i64,
    /// 封面圖的編號，換圖時加一；0 代表沒有封面。前端看到新編號再用 smtc_artwork 取圖。
    pub artwork_id: u64,
}

/// 送給前端的事件：快照加上讀取當下的時間，用來記錄事件先後順序。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEvent {
    pub snapshot: Option<PlayerSnapshot>,
    pub captured_ms: i64,
}

enum Command {
    Seek(i64),
    TogglePlayPause,
    Next,
    Previous,
}

struct Request {
    command: Command,
    reply: Sender<Result<bool, String>>,
}

pub struct SmtcState {
    tx: Sender<Request>,
    latest: Arc<Mutex<SnapshotEvent>>,
    artwork: Arc<Mutex<Option<Vec<u8>>>>,
}

impl SmtcState {
    async fn send(&self, command: Command) -> Result<bool, String> {
        let (reply, response) = mpsc::channel();
        self.tx
            .send(Request { command, reply })
            .map_err(|_| "SMTC 執行緒已停止".to_string())?;
        tauri::async_runtime::spawn_blocking(move || response.recv_timeout(Duration::from_secs(5)))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|_| "SMTC 沒有回應".to_string())?
    }
}

/// 啟動 SMTC 輪詢執行緒，回傳給 Tauri 管理的狀態。
pub fn start(app: AppHandle) -> SmtcState {
    let (tx, rx) = mpsc::channel();
    let latest = Arc::new(Mutex::new(SnapshotEvent { snapshot: None, captured_ms: now_ms() }));
    let artwork = Arc::new(Mutex::new(None));

    #[cfg(windows)]
    {
        let latest = latest.clone();
        let artwork = artwork.clone();
        std::thread::Builder::new()
            .name("smtc".into())
            .spawn(move || win::run(app, rx, latest, artwork))
            .expect("無法建立 SMTC 執行緒");
    }
    #[cfg(not(windows))]
    {
        // 其他平台還沒有實作；丟掉 rx 讓指令直接回報錯誤
        let _ = (app, rx);
    }

    SmtcState { tx, latest, artwork }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// FNV-1a：只用來判斷封面圖有沒有換，不需要密碼學強度。
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, &b| (hash ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3))
}

#[tauri::command]
pub fn smtc_snapshot(state: State<'_, SmtcState>) -> SnapshotEvent {
    state.latest.lock().unwrap().clone()
}

/// 目前的封面圖原始內容（JPEG／PNG）；沒有封面時回傳空內容。以二進位傳給前端，不經過 JSON。
#[tauri::command]
pub fn smtc_artwork(state: State<'_, SmtcState>) -> tauri::ipc::Response {
    tauri::ipc::Response::new(state.artwork.lock().unwrap().clone().unwrap_or_default())
}

/// 回傳 Spotify 是否接受這次跳轉（SMTC 的 TryChangePlaybackPositionAsync 結果）。
#[tauri::command]
pub async fn smtc_seek(state: State<'_, SmtcState>, position_ms: i64) -> Result<bool, String> {
    state.send(Command::Seek(position_ms.max(0))).await
}

#[tauri::command]
pub async fn smtc_toggle_play_pause(state: State<'_, SmtcState>) -> Result<bool, String> {
    state.send(Command::TogglePlayPause).await
}

#[tauri::command]
pub async fn smtc_next(state: State<'_, SmtcState>) -> Result<bool, String> {
    state.send(Command::Next).await
}

#[tauri::command]
pub async fn smtc_previous(state: State<'_, SmtcState>) -> Result<bool, String> {
    state.send(Command::Previous).await
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::mpsc::RecvTimeoutError;
    use std::time::Instant;
    use tauri::Emitter;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as MediaProperties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    };
    use windows::Storage::Streams::{Buffer, DataReader, InputStreamOptions};
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};

    /// Spotify 只在狀態改變時更新 SMTC，所以這個間隔決定的是「多快察覺變化」。
    const POLL_INTERVAL: Duration = Duration::from_millis(100);
    /// FILETIME（1601-01-01 起算，單位 100ns）與 Unix 紀元的差距。
    const FILETIME_UNIX_EPOCH: i64 = 116_444_736_000_000_000;
    /// 換歌後讀封面的時間點：Spotify 的封面常比歌名晚一點更新，所以分幾次重讀
    const ARTWORK_CHECKS_MS: [u64; 5] = [0, 400, 1200, 3000, 6000];
    /// 封面圖的大小上限，超過就不讀
    const MAX_ARTWORK_BYTES: u64 = 8 * 1024 * 1024;

    /// 追蹤目前這首歌的封面
    struct ArtworkTracker {
        shared: Arc<Mutex<Option<Vec<u8>>>>,
        track_key: String,
        pending_checks: VecDeque<Instant>,
        hash: Option<u64>,
        id: u64,
    }

    impl ArtworkTracker {
        /// 換歌時排定接下來幾次的重讀
        fn on_track(&mut self, key: &str) {
            if key == self.track_key {
                return;
            }
            self.track_key = key.to_string();
            let now = Instant::now();
            self.pending_checks = ARTWORK_CHECKS_MS.iter().map(|ms| now + Duration::from_millis(*ms)).collect();
        }

        /// 時間到了就重讀一次；封面真的換了才更新編號
        fn poll(&mut self, props: &MediaProperties) {
            let now = Instant::now();
            let mut due = false;
            while self.pending_checks.front().is_some_and(|t| *t <= now) {
                self.pending_checks.pop_front();
                due = true;
            }
            if !due {
                return;
            }
            let bytes = read_thumbnail(props).unwrap_or(None);
            let hash = bytes.as_deref().map(fnv1a);
            if hash == self.hash {
                return;
            }
            self.hash = hash;
            self.id += 1;
            #[cfg(debug_assertions)]
            eprintln!("[smtc] 封面 #{}：{} bytes", self.id, bytes.as_ref().map_or(0, |b| b.len()));
            *self.shared.lock().unwrap() = bytes;
        }

        fn clear(&mut self) {
            self.track_key.clear();
            self.pending_checks.clear();
            if self.hash.take().is_some() {
                self.id += 1;
                *self.shared.lock().unwrap() = None;
            }
        }

        /// 快照裡的封面編號；沒有封面時是 0
        fn current_id(&self) -> u64 {
            if self.hash.is_some() { self.id } else { 0 }
        }
    }

    pub fn run(
        app: AppHandle,
        rx: Receiver<Request>,
        latest: Arc<Mutex<SnapshotEvent>>,
        artwork: Arc<Mutex<Option<Vec<u8>>>>,
    ) {
        // 這條執行緒專門跑 SMTC：先進入 MTA，之後就能直接同步等待非同步作業
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };

        let manager = match SessionManager::RequestAsync().and_then(|op| op.join()) {
            Ok(manager) => manager,
            Err(e) => {
                eprintln!("[smtc] 無法取得 SessionManager：{e}");
                return;
            }
        };

        let mut art = ArtworkTracker {
            shared: artwork,
            track_key: String::new(),
            pending_checks: VecDeque::new(),
            hash: None,
            id: 0,
        };
        let mut last: Option<Option<PlayerSnapshot>> = None;
        let mut last_error = String::new();
        loop {
            match rx.recv_timeout(POLL_INTERVAL) {
                Ok(request) => {
                    let result = match find_spotify(&manager) {
                        Ok(Some(session)) => execute(&session, &request.command).map_err(|e| e.to_string()),
                        Ok(None) => Err("找不到 Spotify 的播放工作階段".to_string()),
                        Err(e) => Err(e.to_string()),
                    };
                    let _ = request.reply.send(result);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }

            let read = find_spotify(&manager).and_then(|s| s.map(|s| read_snapshot(&s)).transpose());
            let snapshot = match read {
                Ok(Some((mut snapshot, props))) => {
                    art.on_track(&format!("{}\u{1}{}\u{1}{}", snapshot.title, snapshot.artist, snapshot.album));
                    art.poll(&props);
                    snapshot.artwork_id = art.current_id();
                    Some(snapshot)
                }
                Ok(None) => {
                    art.clear();
                    None
                }
                Err(e) => {
                    // 偶發的讀取失敗不當成「Spotify 關掉了」，保留上一份快照，只記一次錯誤
                    let message = e.to_string();
                    if message != last_error {
                        eprintln!("[smtc] 讀取失敗：{message}");
                        last_error = message;
                    }
                    continue;
                }
            };
            last_error.clear();

            if last.as_ref() != Some(&snapshot) {
                #[cfg(debug_assertions)]
                match &snapshot {
                    Some(s) => eprintln!(
                        "[smtc] {} — {} | {} | {}ms / {}ms | lastUpdated {} | art #{}",
                        s.title, s.artist, s.status, s.position_ms, s.duration_ms, s.last_updated_ms, s.artwork_id
                    ),
                    None => eprintln!("[smtc] 偵測不到 Spotify"),
                }
                let event = SnapshotEvent { snapshot: snapshot.clone(), captured_ms: now_ms() };
                *latest.lock().unwrap() = event.clone();
                let _ = app.emit(SNAPSHOT_EVENT, &event);
                last = Some(snapshot);
            }
        }
    }

    fn find_spotify(manager: &SessionManager) -> windows::core::Result<Option<Session>> {
        let sessions = manager.GetSessions()?;
        for i in 0..sessions.Size()? {
            let session = sessions.GetAt(i)?;
            // 桌面版是 "Spotify.exe"，Microsoft Store 版是 "SpotifyAB.SpotifyMusic_…!Spotify"
            let app_id = session.SourceAppUserModelId()?.to_string_lossy();
            if app_id.to_ascii_lowercase().contains("spotify") {
                return Ok(Some(session));
            }
        }
        Ok(None)
    }

    fn read_snapshot(session: &Session) -> windows::core::Result<(PlayerSnapshot, MediaProperties)> {
        let props = session.TryGetMediaPropertiesAsync()?.join()?;
        let timeline = session.GetTimelineProperties()?;
        let start = timeline.StartTime()?.Duration;
        let snapshot = PlayerSnapshot {
            app_id: session.SourceAppUserModelId()?.to_string_lossy(),
            title: props.Title()?.to_string_lossy(),
            artist: props.Artist()?.to_string_lossy(),
            album: props.AlbumTitle()?.to_string_lossy(),
            status: status_name(session.GetPlaybackInfo()?.PlaybackStatus()?),
            position_ms: (timeline.Position()?.Duration - start) / 10_000,
            duration_ms: (timeline.EndTime()?.Duration - start) / 10_000,
            last_updated_ms: filetime_to_unix_ms(timeline.LastUpdatedTime()?.UniversalTime),
            artwork_id: 0,
        };
        Ok((snapshot, props))
    }

    /// 讀出 SMTC 提供的封面圖；沒有封面（例如本機檔案）時回傳 None。
    fn read_thumbnail(props: &MediaProperties) -> windows::core::Result<Option<Vec<u8>>> {
        let Ok(reference) = props.Thumbnail() else {
            return Ok(None);
        };
        let stream = reference.OpenReadAsync()?.join()?;
        let size = stream.Size()?;
        if size == 0 || size > MAX_ARTWORK_BYTES {
            return Ok(None);
        }
        let capacity = size as u32;
        let buffer = Buffer::Create(capacity)?;
        let filled = stream.ReadAsync(&buffer, capacity, InputStreamOptions::None)?.join()?;
        let reader = DataReader::FromBuffer(&filled)?;
        let mut bytes = vec![0u8; filled.Length()? as usize];
        reader.ReadBytes(&mut bytes)?;
        Ok(Some(bytes))
    }

    fn execute(session: &Session, command: &Command) -> windows::core::Result<bool> {
        match command {
            Command::Seek(ms) => session.TryChangePlaybackPositionAsync(ms * 10_000)?.join(),
            Command::TogglePlayPause => session.TryTogglePlayPauseAsync()?.join(),
            Command::Next => session.TrySkipNextAsync()?.join(),
            Command::Previous => session.TrySkipPreviousAsync()?.join(),
        }
    }

    fn status_name(status: PlaybackStatus) -> &'static str {
        match status {
            PlaybackStatus::Playing => "playing",
            PlaybackStatus::Paused => "paused",
            PlaybackStatus::Stopped => "stopped",
            PlaybackStatus::Changing => "changing",
            PlaybackStatus::Opened => "opened",
            PlaybackStatus::Closed => "closed",
            _ => "unknown",
        }
    }

    fn filetime_to_unix_ms(filetime: i64) -> i64 {
        if filetime <= 0 { 0 } else { (filetime - FILETIME_UNIX_EPOCH) / 10_000 }
    }
}

#[cfg(test)]
mod tests {
    use super::fnv1a;

    #[test]
    fn hash_changes_with_content() {
        assert_eq!(fnv1a(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a(b"same"), fnv1a(b"same"));
        assert_ne!(fnv1a(b"cover-a"), fnv1a(b"cover-b"));
    }
}
