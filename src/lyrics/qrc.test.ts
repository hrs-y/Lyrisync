import { describe, expect, it } from 'vitest';
import { encryptQrc, qrcXml } from '../test/qrcFixture';
import { decryptQrc, extractQrcContent, isQrcContent, parseQrc } from './qrc';
import { desTransform } from './qrcDes';

describe('desTransform', () => {
  // 測試向量取自 jixunmoe-go/qrc 的單元測試
  const cipher = [0xfd, 0x0e, 0x64, 0x06, 0x65, 0xbe, 0x74, 0x13, 0x77, 0x63, 0x3b, 0x02, 0x45, 0x4e, 0x70, 0x7a];
  const plain = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6];

  it('matches the reference implementation in both directions', () => {
    expect(Array.from(desTransform(Uint8Array.from(cipher), 'TEST!KEY', true))).toEqual(plain);
    expect(Array.from(desTransform(Uint8Array.from(plain), 'TEST!KEY', false))).toEqual(cipher);
  });
});

describe('decryptQrc', () => {
  it('reverses the encryption, including the padding after the zlib stream', async () => {
    for (const text of ['短', 'a longer piece of text that needs several DES blocks', qrcXml('[0,1000]字(0,1000)')]) {
      expect(await decryptQrc(await encryptQrc(text))).toBe(text);
    }
  });

  it('rejects data that is not hex in whole DES blocks', async () => {
    await expect(decryptQrc('not hex')).rejects.toThrow('不是 QRC 加密格式');
    await expect(decryptQrc('ABCD')).rejects.toThrow('不是 QRC 加密格式');
  });
});

describe('extractQrcContent', () => {
  it('keeps the line breaks and unescapes entities inside LyricContent', () => {
    expect(extractQrcContent(qrcXml('[0,500]A & "B"(0,500)\n[500,500]C(500,500)'))).toBe('[0,500]A & "B"(0,500)\n[500,500]C(500,500)');
  });

  it('returns plain LRC unchanged', () => {
    expect(extractQrcContent('[00:01.00]翻譯')).toBe('[00:01.00]翻譯');
  });
});

describe('parseQrc', () => {
  it('reads words whose timing follows the text', () => {
    expect(parseQrc('[ti:示範]\n[1000,2000]Hel(1000,500)lo (1500,500)there(2000,1000)')).toEqual([
      {
        startMs: 1000,
        endMs: 3000,
        text: 'Hello there',
        words: [
          { text: 'Hel', startMs: 1000, endMs: 1500 },
          { text: 'lo ', startMs: 1500, endMs: 2000 },
          { text: 'there', startMs: 2000, endMs: 3000 },
        ],
      },
    ]);
  });

  it('keeps parentheses that belong to the lyrics', () => {
    const [line] = parseQrc('[0,3000]走吧 (0,1000)(oh)(1000,1000) 再見(2000,1000)');
    expect(line.text).toBe('走吧 (oh) 再見');
    expect(line.words?.map((w) => w.text)).toEqual(['走吧 ', '(oh)', ' 再見']);
  });

  it('keeps lines without word timing and sorts by start', () => {
    expect(parseQrc('[5000,1000]後(5000,1000)\n[0,1000]只有整行')).toEqual([
      { startMs: 0, endMs: 1000, text: '只有整行' },
      { startMs: 5000, endMs: 6000, text: '後', words: [{ text: '後', startMs: 5000, endMs: 6000 }] },
    ]);
  });

  it('tells QRC from LRC', () => {
    expect(isQrcContent('[ti:x]\n[0,1000]字(0,1000)')).toBe(true);
    expect(isQrcContent('[00:01.00]字')).toBe(false);
  });
});
