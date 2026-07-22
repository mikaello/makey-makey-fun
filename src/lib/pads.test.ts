import { describe, expect, it } from 'vitest';

import { PAD_COUNT, padNumbers } from './pads';

describe('pad layout', () => {
  it('provides twelve stable pad positions', () => {
    expect(padNumbers).toHaveLength(PAD_COUNT);
    expect(padNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
