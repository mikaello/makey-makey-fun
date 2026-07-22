import { describe, expect, it } from 'vitest';

import { normalizeMakeyKey } from './input';

describe('Makey Makey key normalization', () => {
  it('uses physical key codes when available', () => {
    expect(normalizeMakeyKey({ code: 'KeyW', key: 'z' })).toBe('KeyW');
    expect(normalizeMakeyKey({ code: 'ArrowUp', key: 'ArrowUp' })).toBe(
      'ArrowUp',
    );
  });

  it('falls back to key values for mobile external keyboards', () => {
    expect(normalizeMakeyKey({ key: 'G' })).toBe('KeyG');
    expect(normalizeMakeyKey({ key: 'Spacebar' })).toBe('Space');
  });

  it('ignores repeats and unsupported keys', () => {
    expect(
      normalizeMakeyKey({ code: 'KeyA', key: 'a', repeat: true }),
    ).toBeNull();
    expect(normalizeMakeyKey({ code: 'Enter', key: 'Enter' })).toBeNull();
  });
});
