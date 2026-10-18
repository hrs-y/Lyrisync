// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerSnapshot } from '../player/types';
import { PlayerView } from './playerView';

const MARKUP = `
  <main class="player">
    <section class="now-playing">
      <div class="cover-frame"><div class="cover empty"><div class="cover-placeholder"></div></div></div>
      <div class="meta">
        <div class="meta-text"><h1 class="title"></h1><p class="artist"></p></div>
        <button class="like-button" hidden></button>
      </div>
      <div class="transport">
        <div class="progress" role="slider" tabindex="0"><div class="progress-track"><div class="progress-fill"></div></div></div>
        <div class="times"><span class="time-elapsed"></span><span class="time-remaining"></span></div>
        <button class="control-previous"></button><button class="control-play"></button><button class="control-next"></button>
      </div>
      <p class="status-note" hidden></p>
    </section>
  </main>`;

const snapshot: PlayerSnapshot = {
  appId: 'mock',
  title: '夜車',
  artist: '測試樂團',
  album: '城市燈火',
  status: 'playing',
  positionMs: 0,
  durationMs: 200_000,
  lastUpdatedMs: 0,
};

let root: HTMLElement;
let actions: {
  previous: () => void;
  togglePlayPause: () => void;
  next: () => void;
  seek: (ms: number) => void;
  toggleLike: () => void;
  openAlbum: () => void;
  openArtist: (index: number, name: string) => void;
};
let view: PlayerView;
const $ = (selector: string) => root.querySelector<HTMLElement>(selector)!;

beforeEach(() => {
  document.body.innerHTML = MARKUP;
  root = document.querySelector<HTMLElement>('.player')!;
  actions = {
    previous: vi.fn(),
    togglePlayPause: vi.fn(),
    next: vi.fn(),
    seek: vi.fn(),
    toggleLike: vi.fn(),
    openAlbum: vi.fn(),
    openArtist: vi.fn(),
  };
  view = new PlayerView(root, actions);
  view.setAnimationsEnabled(false);
});

describe('PlayerView', () => {
  it('shows the title, artist and album', () => {
    view.setTrack(snapshot);
    expect($('.title').textContent).toBe('夜車');
    expect($('.artist').textContent).toBe('測試樂團 — 城市燈火');
    view.setTrack(null);
    expect($('.title').textContent).toBe('等待 Spotify');
  });

  it('moves the progress bar and shows elapsed and remaining time', () => {
    view.update(61_500, 200_000);
    expect($('.progress').style.getPropertyValue('--progress')).toBe('0.30750');
    expect($('.time-elapsed').textContent).toBe('1:01');
    expect($('.time-remaining').textContent).toBe('-2:18');
    expect($('.progress').getAttribute('aria-valuenow')).toBe('61');
  });

  it('seeks with the arrow keys on the progress bar', () => {
    view.update(60_000, 200_000);
    $('.progress').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(actions.seek).toHaveBeenCalledWith(65_000);
    $('.progress').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(actions.seek).toHaveBeenLastCalledWith(0);
  });

  it('wires up the playback buttons', () => {
    $('.control-previous').click();
    $('.control-play').click();
    $('.control-next').click();
    expect(actions.previous).toHaveBeenCalledOnce();
    expect(actions.togglePlayPause).toHaveBeenCalledOnce();
    expect(actions.next).toHaveBeenCalledOnce();
  });

  it('switches layout modes and play state', () => {
    view.setMode('cover');
    expect(root.dataset.mode).toBe('cover');
    view.setPlaying(true);
    expect(root.classList.contains('is-playing')).toBe(true);
  });

  it('shows a note with an optional action', () => {
    const run = vi.fn();
    view.setNote('找不到這首歌的歌詞', { label: '重新搜尋', run });
    expect($('.status-note').hidden).toBe(false);
    expect($('.status-note').textContent).toContain('找不到這首歌的歌詞');
    root.querySelector<HTMLButtonElement>('.status-note button')!.click();
    expect(run).toHaveBeenCalledOnce();
    view.setNote(null);
    expect($('.status-note').hidden).toBe(true);
  });

  it('shows the like button only for a Spotify track and reflects whether it is saved', () => {
    const like = $('.like-button') as HTMLButtonElement;
    expect(like.hidden).toBe(true);
    view.setLike({ kind: 'ready', saved: false, busy: false });
    expect(like.hidden).toBe(false);
    expect(like.getAttribute('aria-pressed')).toBe('false');
    like.click();
    expect(actions.toggleLike).toHaveBeenCalledOnce();
    view.setLike({ kind: 'ready', saved: true, busy: true });
    expect(like.getAttribute('aria-pressed')).toBe('true');
    expect(like.classList.contains('busy')).toBe(true);
    view.setLike({ kind: 'hidden' });
    expect(like.hidden).toBe(true);
  });

  it('links each artist and the album, and opens the album from the cover', () => {
    view.setTrack({ ...snapshot, artist: '測試樂團, Guest', album: '城市燈火' });
    const links = Array.from(root.querySelectorAll<HTMLButtonElement>('.artist-link'));
    expect(links.map((link) => link.textContent)).toEqual(['測試樂團', 'Guest']);
    links[1].click();
    expect(actions.openArtist).toHaveBeenCalledWith(1, 'Guest');
    $('.album-link').click();
    $('.cover-frame').click();
    expect(actions.openAlbum).toHaveBeenCalledTimes(2);
    expect($('.cover-frame').getAttribute('role')).toBe('button');
  });

  it('keeps band names with "&" whole and takes the exact names from Spotify', () => {
    view.setTrack({ ...snapshot, artist: 'Simon & Garfunkel' });
    expect(Array.from(root.querySelectorAll('.artist-link'), (link) => link.textContent)).toEqual(['Simon & Garfunkel']);
    view.setArtists(['Simon & Garfunkel', 'Someone']);
    expect(root.querySelectorAll('.artist-link')).toHaveLength(2);
  });

  it('does not link anything while waiting for Spotify', () => {
    view.setTrack(null);
    expect(root.querySelectorAll('.artist-link')).toHaveLength(0);
    $('.cover-frame').click();
    expect(actions.openAlbum).not.toHaveBeenCalled();
    expect($('.cover-frame').hasAttribute('role')).toBe(false);
  });
});
