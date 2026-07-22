import { describe, expect, it } from 'vitest';

import {
  calculateInputLevel,
  microphoneErrorMessage,
  selectRecordingMimeType,
} from './microphone-recorder';

describe('microphone recorder', () => {
  it('prefers Opus and falls back to an iOS-compatible MP4 type', () => {
    expect(
      selectRecordingMimeType({
        isTypeSupported: (type) => type === 'audio/webm;codecs=opus',
      }),
    ).toBe('audio/webm;codecs=opus');
    expect(
      selectRecordingMimeType({
        isTypeSupported: (type) => type === 'audio/mp4',
      }),
    ).toBe('audio/mp4');
  });

  it('allows the browser to choose when no candidate is supported', () => {
    expect(
      selectRecordingMimeType({ isTypeSupported: () => false }),
    ).toBeUndefined();
  });

  it('maps microphone samples to a normalized input level', () => {
    expect(calculateInputLevel(new Uint8Array([128, 128, 128]))).toBe(0);
    expect(calculateInputLevel(new Uint8Array([126, 130]))).toBeGreaterThan(0);
    expect(calculateInputLevel(new Uint8Array([0, 255]))).toBe(1);
    expect(calculateInputLevel(new Uint8Array())).toBe(0);
  });

  it('provides useful permission and device errors', () => {
    expect(
      microphoneErrorMessage(new DOMException('', 'NotAllowedError')),
    ).toContain('denied');
    expect(
      microphoneErrorMessage(new DOMException('', 'NotFoundError')),
    ).toContain('No microphone');
    expect(microphoneErrorMessage(new Error('unknown'))).toContain(
      'unavailable',
    );
  });
});
