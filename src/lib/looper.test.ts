import { describe, expect, it } from 'vitest';

import { quantizeElapsedToStep, scheduleWindow, stepDuration } from './looper';

describe('quantized looper timing', () => {
  it('calculates sixteenth-note timing and clamps BPM', () => {
    expect(stepDuration(120)).toBe(0.125);
    expect(stepDuration(20)).toBe(0.25);
    expect(stepDuration(300)).toBeCloseTo(1 / 12);
  });

  it('quantizes events to the nearest step and wraps the pattern', () => {
    expect(quantizeElapsedToStep(0.13, 120, 16)).toBe(1);
    expect(quantizeElapsedToStep(0.24, 120, 16)).toBe(2);
    expect(quantizeElapsedToStep(2, 120, 16)).toBe(0);
  });

  it('schedules every step in the audio look-ahead window', () => {
    expect(
      scheduleWindow({
        bpm: 120,
        horizon: 0.26,
        nextStep: 0,
        nextStepTime: 0,
        totalSteps: 16,
      }),
    ).toEqual({
      scheduled: [
        { step: 0, time: 0 },
        { step: 1, time: 0.125 },
        { step: 2, time: 0.25 },
      ],
      nextStep: 3,
      nextStepTime: 0.375,
    });
  });
});
