# 第三方授權聲明

本專案的部分程式碼移植自以下開源專案。

## jixunmoe-go/qrc

`src/lyrics/qrcDes.ts`（QQ 音樂 QRC 歌詞的 DES 解密）移植自 <https://github.com/jixunmoe-go/qrc>。

```
MIT License

Copyright (c) 2023 Jixun Wu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 歌詞字型

設定頁「歌詞 → 字體」裡的以下字型打包進程式（透過 [Fontsource](https://fontsource.org/) 的 npm 套件），授權都是 SIL Open Font License 1.1。授權全文在各套件的 `LICENSE` 檔（`node_modules/@fontsource/<名稱>/LICENSE`），也可以在 <https://openfontlicense.org> 查看。

| 字型 | 套件 | 著作權 |
|---|---|---|
| Noto Serif TC（思源宋體） | `@fontsource/noto-serif-tc` | Google Inc. |
| LXGW WenKai TC（霞鶩文楷） | `@fontsource/lxgw-wenkai-tc` | The LXGW WenKai Project Authors |
| Shippori Mincho | `@fontsource/shippori-mincho` | The Shippori Mincho Project Authors |
| Klee One | `@fontsource/klee-one` | The Klee Project Authors |
| Zen Maru Gothic | `@fontsource/zen-maru-gothic` | The Zen Maru Gothic Authors |
| EB Garamond | `@fontsource/eb-garamond` | The EB Garamond Project Authors |
| Libre Baskerville | `@fontsource/libre-baskerville` | The Libre Baskerville Project Authors |
| Playfair Display | `@fontsource/playfair-display` | The Playfair Display Project Authors |

「黑體」「ゴシック」「Sans」「標楷」用的是 Windows 內建字型，沒有打包。
