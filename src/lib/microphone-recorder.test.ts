import { describe, expect, it } from 'vitest';

import {
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
