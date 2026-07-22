import { describe, expect, it } from 'vitest';

import { calculateWaveform, normalizeTrim } from './sample-editing';

describe('sample editing', () => {
  it('clamps trim points to a playable range', () => {
    expect(normalizeTrim(2, -1, 3)).toEqual({ start: 0, end: 2 });
    expect(normalizeTrim(2, 1.5, 1)).toEqual({ start: 1.5, end: 1.5 });
    expect(normalizeTrim(2, 0.5, null)).toEqual({ start: 0.5, end: 2 });
  });

  it('extracts stable waveform peaks across channels', () => {
    const waveform = calculateWaveform(
      [
        new Float32Array([0, -0.5, 0.25, 1]),
        new Float32Array([0.2, 0, -0.75, 0]),
      ],
      2,
    );
    expect(waveform).toEqual([0.5, 1]);
  });
});
