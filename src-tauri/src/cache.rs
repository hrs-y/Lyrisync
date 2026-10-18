//! 歌詞的磁碟快取：每首歌一個 JSON 檔，放在系統的程式快取資料夾底下的 lyrics。
//! 內容格式由前端決定，這裡只負責讀寫檔案。

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// 一首歌的歌詞加上幾份備選，遠小於這個大小
const MAX_VALUE_BYTES: usize = 2 * 1024 * 1024;

/// 快取鍵由前端雜湊產生；只接受十六進位字元，避免組出快取資料夾以外的路徑。
fn is_valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 128 && key.bytes().all(|b| b.is_ascii_hexdigit())
}

fn entry_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    if !is_valid_key(key) {
        return Err(format!("快取鍵格式錯誤：{key}"));
    }
    let dir = app.path().app_cache_dir().map_err(|e| format!("找不到快取資料夾：{e}"))?;
    Ok(dir.join("lyrics").join(format!("{key}.json")))
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cache_read(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = entry_path(&app, &key)?;
    blocking(move || match fs::read_to_string(&path) {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("讀取快取失敗：{e}")),
    })
    .await
}

#[tauri::command]
pub async fn cache_write(app: AppHandle, key: String, value: String) -> Result<(), String> {
    if value.len() > MAX_VALUE_BYTES {
        return Err("快取內容太大".into());
    }
    let path = entry_path(&app, &key)?;
    blocking(move || {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("建立快取資料夾失敗：{e}"))?;
        }
        // 先寫暫存檔再改名，寫到一半當掉也不會留下壞掉的快取
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, value).map_err(|e| format!("寫入快取失敗：{e}"))?;
        fs::rename(&tmp, &path).map_err(|e| format!("寫入快取失敗：{e}"))
    })
    .await
}

#[tauri::command]
pub async fn cache_delete(app: AppHandle, key: String) -> Result<(), String> {
    let path = entry_path(&app, &key)?;
    blocking(move || match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("刪除快取失敗：{e}")),
    })
    .await
}

/// 刪掉所有歌詞快取，回傳刪了幾首。
#[tauri::command]
pub async fn cache_clear(app: AppHandle) -> Result<usize, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("找不到快取資料夾：{e}"))?
        .join("lyrics");
    blocking(move || {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(format!("讀取快取資料夾失敗：{e}")),
        };
        let mut removed = 0;
        for entry in entries.flatten() {
            let path = entry.path();
            let is_cache_file = path.extension().is_some_and(|ext| ext == "json" || ext == "tmp");
            if is_cache_file && fs::remove_file(&path).is_ok() && path.extension().is_some_and(|ext| ext == "json") {
                removed += 1;
            }
        }
        Ok(removed)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_hex_keys() {
        assert!(is_valid_key("0123456789abcdef"));
        assert!(!is_valid_key(""));
        assert!(!is_valid_key("../secret"));
        assert!(!is_valid_key("abc.json"));
        assert!(!is_valid_key("C:\\Windows"));
        assert!(!is_valid_key(&"a".repeat(129)));
    }
}
