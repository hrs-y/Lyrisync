//! 桌面歌詞視窗：透明、無邊框、永遠在最上層、不顯示在工作列。
//! 位置、鎖定（滑鼠穿透）、字級都由視窗裡的網頁自己處理；這裡只負責開關。

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "desktop-lyrics";

/// 開啟桌面歌詞（已經開著就不動）。視窗先隱藏，等網頁算好位置後自己顯示，才不會閃一下。
#[tauri::command]
pub async fn desktop_lyrics_open(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("desktop.html".into()))
        .title("桌面歌詞")
        .inner_size(width.clamp(320.0, 2400.0), height.clamp(80.0, 600.0))
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()
        .map(|_| ())
        .map_err(|e| format!("無法開啟桌面歌詞：{e}"))
}

#[tauri::command]
pub async fn desktop_lyrics_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.close().map_err(|e| format!("無法關閉桌面歌詞：{e}"))?;
    }
    Ok(())
}
