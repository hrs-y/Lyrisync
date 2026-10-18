# 開啟 Lyrisync（桌面和開始功能表的捷徑會執行這個腳本）。
# 開發模式下執行檔仍叫 lyrics-app（Cargo 套件名稱），所以用這個名字找已經開著的視窗。
# 已經開著就把視窗叫到前面；沒開就用開發模式啟動，跑的永遠是最新的程式碼。

$project = Split-Path -Parent $PSScriptRoot

$running = Get-Process lyrics-app -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object -First 1

if ($running) {
  Add-Type -Namespace LyricsApp -Name Window -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
'@
  $handle = $running.MainWindowHandle
  # 9 = SW_RESTORE：縮到最小時先還原
  if ([LyricsApp.Window]::IsIconic($handle)) { [void][LyricsApp.Window]::ShowWindow($handle, 9) }
  [void][LyricsApp.Window]::SetForegroundWindow($handle)
  exit 0
}

# 開發模式：先開 Vite，再編譯並執行 Rust（Rust 有改動時第一次會等比較久）。
# 縮到最小的命令列視窗裡看得到進度；關掉 app 時一起結束，失敗時停住讓你看錯誤訊息。
Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/c', 'title Lyrisync && npm run tauri dev || pause' `
  -WorkingDirectory $project `
  -WindowStyle Minimized
