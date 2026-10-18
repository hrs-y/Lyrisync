/*
 * QQ 音樂 QRC 歌詞用的 DES 變體（和標準 DES 的位元編號、資料讀取順序不同，所以標準 3DES 解不開）。
 * 移植自 jixunmoe-go/qrc（https://github.com/jixunmoe-go/qrc），MIT License，Copyright (c) 2023 Jixun Wu。
 * 完整授權條款見專案根目錄的 THIRD_PARTY_NOTICES.md。
 *
 * 64 位元的值拆成高、低兩個 32 位元整數處理，避免用 BigInt（慢很多）。
 */

const KEY_ROUND_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
/** 8 個 S 盒各自從 48 位元狀態的哪個位置取 6 位元（前 4 個在低 32 位元、後 4 個在高 32 位元） */
const SBOX_SHIFTS = [26, 20, 14, 8, 58, 52, 46, 40];
const SBOXES: readonly (readonly number[])[] = [
  [14, 0, 4, 15, 13, 7, 1, 4, 2, 14, 15, 2, 11, 13, 8, 1, 3, 10, 10, 6, 6, 12, 12, 11, 5, 9, 9, 5, 0, 3, 7, 8, 4, 15, 1, 12, 14, 8, 8, 2, 13, 4, 6, 9, 2, 1, 11, 7, 15, 5, 12, 11, 9, 3, 7, 14, 3, 10, 10, 0, 5, 6, 0, 13],
  [15, 3, 1, 13, 8, 4, 14, 7, 6, 15, 11, 2, 3, 8, 4, 15, 9, 12, 7, 0, 2, 1, 13, 10, 12, 6, 0, 9, 5, 11, 10, 5, 0, 13, 14, 8, 7, 10, 11, 1, 10, 3, 4, 15, 13, 4, 1, 2, 5, 11, 8, 6, 12, 7, 6, 12, 9, 0, 3, 5, 2, 14, 15, 9],
  [10, 13, 0, 7, 9, 0, 14, 9, 6, 3, 3, 4, 15, 6, 5, 10, 1, 2, 13, 8, 12, 5, 7, 14, 11, 12, 4, 11, 2, 15, 8, 1, 13, 1, 6, 10, 4, 13, 9, 0, 8, 6, 15, 9, 3, 8, 0, 7, 11, 4, 1, 15, 2, 14, 12, 3, 5, 11, 10, 5, 14, 2, 7, 12],
  [7, 13, 13, 8, 14, 11, 3, 5, 0, 6, 6, 15, 9, 0, 10, 3, 1, 4, 2, 7, 8, 2, 5, 12, 11, 1, 12, 10, 4, 14, 15, 9, 10, 3, 6, 15, 9, 0, 0, 6, 12, 10, 11, 10, 7, 13, 13, 8, 15, 9, 1, 4, 3, 5, 14, 11, 5, 12, 2, 7, 8, 2, 4, 14],
  [2, 14, 12, 11, 4, 2, 1, 12, 7, 4, 10, 7, 11, 13, 6, 1, 8, 5, 5, 0, 3, 15, 15, 10, 13, 3, 0, 9, 14, 8, 9, 6, 4, 11, 2, 8, 1, 12, 11, 7, 10, 1, 13, 14, 7, 2, 8, 13, 15, 6, 9, 15, 12, 0, 5, 9, 6, 10, 3, 4, 0, 5, 14, 3],
  [12, 10, 1, 15, 10, 4, 15, 2, 9, 7, 2, 12, 6, 9, 8, 5, 0, 6, 13, 1, 3, 13, 4, 14, 14, 0, 7, 11, 5, 3, 11, 8, 9, 4, 14, 3, 15, 2, 5, 12, 2, 9, 8, 5, 12, 15, 3, 10, 7, 11, 0, 14, 4, 1, 10, 7, 1, 6, 13, 0, 11, 8, 6, 13],
  [4, 13, 11, 0, 2, 11, 14, 7, 15, 4, 0, 9, 8, 1, 13, 10, 3, 14, 12, 3, 9, 5, 7, 12, 5, 2, 10, 15, 6, 8, 1, 6, 1, 6, 4, 11, 11, 13, 13, 8, 12, 1, 3, 4, 7, 10, 14, 7, 10, 9, 15, 5, 6, 0, 8, 15, 0, 14, 5, 2, 9, 3, 2, 12],
  [13, 1, 2, 15, 8, 13, 4, 8, 6, 10, 15, 3, 11, 7, 1, 4, 10, 12, 9, 5, 3, 6, 14, 11, 5, 0, 0, 14, 12, 9, 7, 2, 7, 2, 11, 1, 4, 14, 1, 7, 9, 4, 12, 10, 14, 8, 2, 13, 0, 15, 6, 12, 10, 9, 13, 0, 15, 3, 3, 5, 5, 6, 8, 11],
];

/** 標準 DES 的表格是從 1 起算，這裡統一改成從 0 起算 */
const fromOne = (table: number[]) => table.map((v) => v - 1);
const P_BOX = fromOne([16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25]);
const IP = fromOne([
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
]);
const IP_INV = fromOne([
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
]);
const KEY_PERMUTATION = fromOne([
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
]);
/** 子金鑰壓縮：前半取自 C（位元 31～4），後半取自 D（放在高 32 位元，所以位置要換算） */
const KEY_COMPRESSION = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
].map((v, i) => (i < 24 ? v - 1 : v - 28 + 32));
const KEY_EXPANSION = fromOne([
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
]);

type U64 = [hi: number, lo: number];

/** 位元 v：0～31 是低 32 位元的第 (31 - v) 位，32～63 是高 32 位元的第 (63 - v) 位 */
function bitAt(hi: number, lo: number, v: number): number {
  return v < 32 ? (lo >>> (31 - v)) & 1 : (hi >>> (63 - v)) & 1;
}

function mapHalf(hi: number, lo: number, table: readonly number[], from: number, to: number): number {
  let out = 0;
  for (let i = from; i < to; i++) if (bitAt(hi, lo, table[i])) out |= 1 << (31 - (i - from));
  return out >>> 0;
}

/** 依表格重排位元：表格前半決定結果的低 32 位元、後半決定高 32 位元，都從最高位往下排 */
function mapU64(hi: number, lo: number, table: readonly number[]): U64 {
  const mid = table.length / 2;
  return [mapHalf(hi, lo, table, mid, table.length), mapHalf(hi, lo, table, 0, mid)];
}

/** 在位元 31～4 這 28 位元之內循環左移 */
function rotate28(value: number, shift: number): number {
  return ((value << shift) | ((value >>> (28 - shift)) & 0xfffffff0)) >>> 0;
}

function keySchedule(key: Uint8Array, encrypt: boolean): U64[] {
  const view = new DataView(key.buffer, key.byteOffset, 8);
  let [d, c] = mapU64(view.getUint32(4, true), view.getUint32(0, true), KEY_PERMUTATION);
  const subkeys: U64[] = new Array(16);
  KEY_ROUND_SHIFTS.forEach((shift, round) => {
    c = rotate28(c, shift);
    d = rotate28(d, shift);
    subkeys[encrypt ? round : 15 - round] = mapU64(d, c, KEY_COMPRESSION);
  });
  return subkeys;
}

function transformBlock(hi: number, lo: number, subkeys: readonly U64[]): U64 {
  [hi, lo] = mapU64(hi, lo, IP);
  for (const [keyHi, keyLo] of subkeys) {
    const [expandedHi, expandedLo] = mapU64(hi, hi, KEY_EXPANSION);
    const stateHi = (expandedHi ^ keyHi) >>> 0;
    const stateLo = (expandedLo ^ keyLo) >>> 0;
    let sboxed = 0;
    SBOX_SHIFTS.forEach((shift, i) => {
      const index = shift < 32 ? (stateLo >>> shift) & 0x3f : (stateHi >>> (shift - 32)) & 0x3f;
      sboxed = ((sboxed << 4) | SBOXES[i][index]) >>> 0;
    });
    let permuted = 0;
    for (let i = 0; i < 32; i++) if ((sboxed >>> (31 - P_BOX[i])) & 1) permuted |= 1 << (31 - i);
    const next = ((permuted >>> 0) ^ lo) >>> 0;
    lo = hi;
    hi = next;
  }
  return mapU64(lo, hi, IP_INV);
}

/** 就地加密或解密（以 8 位元組為一組，每組以 little-endian 讀寫）；長度不是 8 的倍數時，最後不足的部分不處理。 */
export function desTransform(bytes: Uint8Array, key: string, encrypt: boolean): Uint8Array {
  const keyBytes = new TextEncoder().encode(key);
  if (keyBytes.length < 8) throw new Error('DES 金鑰需要 8 個位元組');
  const subkeys = keySchedule(keyBytes, encrypt);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 8 <= bytes.length; i += 8) {
    const [hi, lo] = transformBlock(view.getUint32(i + 4, true), view.getUint32(i, true), subkeys);
    view.setUint32(i, lo, true);
    view.setUint32(i + 4, hi, true);
  }
  return bytes;
}
