import { defineConfig, type Plugin } from "vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

/**
 * @fontsource 的字型 CSS 同時列出 woff2 和 woff；WebView2 一定支援 woff2，
 * 拿掉 woff 後打包的字型檔少一半（中日文字型每個字重都拆成上百個小檔）。
 */
function woff2Only(): Plugin {
  return {
    name: "lyrics-app:woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]@fontsource[\\/].+\.css(\?|$)/.test(id)) return null;
      return { code: code.replace(/,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g, ""), map: null };
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  plugins: [woff2Only()],
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // opencc-js 的簡繁字典約 1.2MB，已經用 dynamic import 拆成獨立檔案、用到時才載入
    chunkSizeWarningLimit: 1500,
    // 兩個頁面：主視窗、桌面歌詞視窗
    rolldownOptions: {
      input: { main: "index.html", desktop: "desktop.html" },
    },
  },
}));
