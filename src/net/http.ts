import { invoke } from '@tauri-apps/api/core';

export interface HttpResponse {
  status: number;
  body: string;
}

export interface HttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type HttpGet = (url: string, options?: HttpOptions) => Promise<HttpResponse>;

/** 透過 Rust 端連線（net.rs 的 http_get）避開 CORS；只能連到白名單裡的主機。 */
export const tauriHttpGet: HttpGet = (url, options) =>
  invoke<HttpResponse>('http_get', {
    url,
    headers: options?.headers ?? null,
    timeoutMs: options?.timeoutMs ?? null,
  });

export function buildUrl(base: string, params: Record<string, string | number>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.toString();
}

/** 取得 JSON；404 回傳 null，其他非 2xx 丟出錯誤。 */
export async function getJson<T>(http: HttpGet, url: string, options?: HttpOptions): Promise<T | null> {
  const response = await http(url, options);
  const host = new URL(url).host;
  if (response.status === 404) return null;
  if (response.status < 200 || response.status >= 300) throw new Error(`${host} 回應 HTTP ${response.status}`);
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new Error(`${host} 的回應不是 JSON`);
  }
}
