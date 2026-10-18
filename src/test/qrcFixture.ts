// 測試用：做出和 QQ 音樂介面相同格式的加密歌詞（只給測試檔匯入，不會打包進程式）
import { desTransform } from '../lyrics/qrcDes';

/** zlib 壓縮 → 補到 8 的倍數 → 用解密的反向順序做 DES（加密、解密、加密）→ 十六進位 */
export async function encryptQrc(text: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const bytes = new Uint8Array(Math.ceil(compressed.length / 8) * 8);
  bytes.set(compressed);
  desTransform(bytes, '!@#)(*$%', true);
  desTransform(bytes, '123ZXC!@', false);
  desTransform(bytes, '!@#)(NHL', true);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** 把 QRC 內容包成解密後的 XML 格式 */
export function qrcXml(content: string): string {
  const escaped = content.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="utf-8"?>\n<QrcInfos>\n<QrcHeadInfo SaveTime="0" Version="100"/>\n<LyricInfo LyricCount="1">\n<Lyric_1 LyricType="1" LyricContent="${escaped}"/>\n</LyricInfo>\n</QrcInfos>`;
}
