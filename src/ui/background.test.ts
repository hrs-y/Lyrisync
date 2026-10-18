// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BackgroundRenderer, webglAvailable } from './background';
import { QUALITY_PROFILES } from './quality';

describe('BackgroundRenderer', () => {
  it('falls back to the static background when WebGL is unavailable', () => {
    document.body.innerHTML = '<div class="backdrop"></div>';
    const root = document.querySelector<HTMLElement>('.backdrop')!;
    const renderer = new BackgroundRenderer(root);
    expect(webglAvailable()).toBe(false);
    renderer.setQuality(QUALITY_PROFILES.high);
    expect(root.dataset.background ?? 'static').toBe('static');
    expect(root.querySelector('.bg-canvas')).not.toBeNull();
    expect(root.querySelector('.bg-static')).not.toBeNull();
  });

  it('sets the scrim, shadow and background colours from the palette', () => {
    document.body.innerHTML = '<div class="backdrop"></div>';
    new BackgroundRenderer(document.querySelector<HTMLElement>('.backdrop')!);
    const style = document.documentElement.style;
    expect(Number(style.getPropertyValue('--scrim'))).toBeGreaterThan(0);
    expect(style.getPropertyValue('--art-shadow')).toMatch(/^\d+ \d+ \d+$/);
    for (const name of ['--mesh-1', '--mesh-5', '--mesh-base']) {
      expect(style.getPropertyValue(name)).toMatch(/^rgb\(\d+ \d+ \d+\)$/);
    }
  });
});
