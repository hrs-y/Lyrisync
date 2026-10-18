import { t, type MessageKey } from '../i18n';

/** Rust 端（spotify.rs）回傳的錯誤代碼，格式是「代碼」或「代碼:細節」 */
const CODES = [
  'invalid_client_id',
  'port_in_use',
  'browser',
  'timeout',
  'cancelled',
  'denied',
  'auth',
  'invalid_client',
  'invalid_grant',
  'network',
  'token',
  'keyring',
  'busy',
  'not_connected',
  'rate_limited',
  'forbidden',
  'unauthorized',
  'http',
  'unavailable',
] as const;

type ErrorCode = (typeof CODES)[number];

/** 把錯誤代碼轉成目前語言的說明；不認得的（例如舊版留下的文字）原樣顯示。 */
export function spotifyErrorText(raw: string): string {
  const separator = raw.indexOf(':');
  const code = (separator < 0 ? raw : raw.slice(0, separator)).trim();
  const detail = separator < 0 ? '' : raw.slice(separator + 1).trim();
  if (!(CODES as readonly string[]).includes(code)) return raw;
  return t(`spotifyError.${code as ErrorCode}` as MessageKey, { detail });
}

/** 前端自己產生的錯誤也用同樣的代碼，顯示時才翻譯 */
export class SpotifyError extends Error {
  constructor(code: ErrorCode, detail?: string | number) {
    super(detail === undefined ? code : `${code}:${detail}`);
  }
}
