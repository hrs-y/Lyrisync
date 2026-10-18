mod cache;
mod desktop;
mod net;
mod smtc;
mod spotify;

use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(smtc::start(app.handle().clone()));
            app.manage(net::HttpClient::new()?);
            app.manage(spotify::Spotify::new()?);
            Ok(())
        })
        // 主視窗關掉就結束整個程式：桌面歌詞沒有工作列圖示，留著它會沒辦法再叫回主視窗
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            smtc::smtc_snapshot,
            smtc::smtc_artwork,
            smtc::smtc_seek,
            smtc::smtc_toggle_play_pause,
            smtc::smtc_next,
            smtc::smtc_previous,
            net::http_get,
            cache::cache_read,
            cache::cache_write,
            cache::cache_delete,
            cache::cache_clear,
            desktop::desktop_lyrics_open,
            desktop::desktop_lyrics_close,
            spotify::spotify_status,
            spotify::spotify_login,
            spotify::spotify_cancel_login,
            spotify::spotify_logout,
            spotify::spotify_open_dashboard,
            spotify::spotify_open,
            spotify::spotify_api,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
