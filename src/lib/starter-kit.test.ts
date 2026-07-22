import { describe, expect, it } from 'vitest';

import { starterKit } from './starter-kit';

describe('starter kit', () => {
  it('defines twelve distinct, playable sounds', () => {
    expect(starterKit).toHaveLength(12);
    expect(new Set(starterKit.map((sound) => sound.id)).size).toBe(12);
    expect(starterKit.every((sound) => sound.duration > 0)).toBe(true);
  });

  it('uses a varied pad palette', () => {
    expect(
      new Set(starterKit.map((sound) => sound.color)).size,
    ).toBeGreaterThanOrEqual(10);
  });
});
