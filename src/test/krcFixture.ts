// 測試用：做出和酷狗下載內容相同格式的 KRC（只給測試檔匯入，不會打包進程式）

const KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];

export function utf8ToBase64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** zlib 壓縮 → XOR → 加上「krc1」標頭 → base64 */
export async function encodeKrc(text: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = 'krc1';
  compressed.forEach((byte, i) => {
    binary += String.fromCharCode(byte ^ KEY[i % KEY.length]);
  });
  return btoa(binary);
}
