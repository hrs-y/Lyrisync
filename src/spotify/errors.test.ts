import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { SpotifyError, spotifyErrorText } from './errors';

afterEach(() => setLocale('zh-TW'));

describe('spotifyErrorText', () => {
  it('turns error codes from Rust into text in the interface language', () => {
    expect(spotifyErrorText('port_in_use')).toContain('47823');
    expect(spotifyErrorText('rate_limited:30')).toBe('Spotify 要求稍候，請於 30 秒後再試。');
    setLocale('en');
    expect(spotifyErrorText('network:timed out')).toBe('Couldn’t reach Spotify: timed out');
    expect(spotifyErrorText(new SpotifyError('http', 500).message)).toBe('Spotify returned HTTP 500.');
  });

  it('shows anything it does not recognise as is', () => {
    expect(spotifyErrorText('something odd: here')).toBe('something odd: here');
  });
});
