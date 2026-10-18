// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { SpotifyTrack } from '../spotify/api';
import { QueueView } from './queueView';

// 測試用的歌曲資料都是自己編的
const track = (id: string, name: string, extra: Partial<SpotifyTrack> = {}): SpotifyTrack => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  artists: ['測試樂團', 'Guest'],
  album: '城市燈火',
  durationMs: 201_000,
  ...extra,
});

let root: HTMLElement;
let view: QueueView;

beforeEach(() => {
  document.body.innerHTML = '<div></div>';
  root = document.querySelector('div')!;
  view = new QueueView(root);
});

describe('QueueView', () => {
  it('lists upcoming songs with art, artists, length and a lyrics-ready badge', () => {
    view.setState({
      kind: 'tracks',
      entries: [
        { track: track('a', '下一首', { imageUrl: 'https://i.scdn.co/image/a' }), lyricsReady: true },
        { track: track('b', '再下一首'), lyricsReady: false },
      ],
    });
    const items = root.querySelectorAll('.queue-item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.queue-name')?.textContent).toBe('下一首');
    expect(items[0].querySelector('.queue-artist')?.textContent).toBe('測試樂團, Guest');
    expect(items[0].querySelector('.queue-duration')?.textContent).toBe('3:21');
    expect(items[0].querySelector('img')?.getAttribute('src')).toBe('https://i.scdn.co/image/a');
    expect(items[0].querySelector('.queue-badge')?.textContent).toBe('歌詞已備妥');
    expect(items[1].querySelector('.queue-badge')).toBeNull();
    expect(root.querySelector<HTMLElement>('.queue-status')!.hidden).toBe(true);
  });

  it('says when the queue is empty or could not be read', () => {
    view.setState({ kind: 'tracks', entries: [] });
    expect(root.querySelector('.queue-status')?.textContent).toBe('待播清單是空的');
    view.setState({ kind: 'error' });
    expect(root.querySelector('.queue-status')?.textContent).toBe('無法讀取待播清單');
  });

  it('keeps the shown list while refreshing, and does not redraw an unchanged list', () => {
    const entries = [{ track: track('a', '下一首'), lyricsReady: false }];
    view.setState({ kind: 'tracks', entries });
    const first = root.querySelector('.queue-item');
    view.setState({ kind: 'loading' });
    view.setState({ kind: 'tracks', entries });
    expect(root.querySelector('.queue-item')).toBe(first);
  });
});
