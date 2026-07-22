import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as Window & { __trackStops?: number };
    testWindow.__trackStops = 0;

    const stream = {
      getTracks: () => [
        {
          stop: () => {
            testWindow.__trackStops = (testWindow.__trackStops ?? 0) + 1;
          },
        },
      ],
    };

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });

    class FakeMediaRecorder extends EventTarget {
      static isTypeSupported(type: string): boolean {
        return type === 'audio/webm;codecs=opus';
      }

      mimeType: string;
      state: RecordingState = 'inactive';

      constructor(_stream: unknown, options?: MediaRecorderOptions) {
        super();
        this.mimeType = options?.mimeType ?? '';
      }

      start(): void {
        this.state = 'recording';
      }

      stop(): void {
        this.state = 'inactive';
        const dataEvent = new Event('dataavailable');
        Object.defineProperty(dataEvent, 'data', {
          value: new Blob(['recorded audio'], { type: this.mimeType }),
        });
        this.dispatchEvent(dataEvent);
        this.dispatchEvent(new Event('stop'));
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    });

    class FakeAudioContext {
      createAnalyser() {
        return {
          fftSize: 0,
          smoothingTimeConstant: 0,
          getByteTimeDomainData: (samples: Uint8Array) => samples.fill(0),
        };
      }

      createMediaStreamSource() {
        return { connect: () => undefined, disconnect: () => undefined };
      }

      resume(): Promise<void> {
        return Promise.resolve();
      }

      close(): Promise<void> {
        return Promise.resolve();
      }
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
  });
});

test('records into a pad, stops tracks, and restores the sample', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Record', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Record a sound' });
  await dialog.getByRole('button', { name: 'Start recording' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Stop recording' }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('progressbar', { name: 'Input level' }),
  ).toHaveAttribute('aria-valuenow', '100');
  await dialog.getByRole('button', { name: 'Stop recording' }).click();

  await expect(
    dialog.getByRole('progressbar', { name: 'Input level' }),
  ).toHaveCount(0);

  await expect(dialog.getByRole('button', { name: 'Preview' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __trackStops?: number }).__trackStops,
      ),
    )
    .toBe(1);

  await dialog.getByRole('button', { name: 'Accept' }).click();
  await expect(
    page.getByRole('button', { name: /Pad 1: Recording 01/ }),
  ).toBeVisible();

  await page.reload();
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await expect(
    page.getByRole('button', { name: /Pad 1: Recording 01/ }),
  ).toBeVisible();
});

test('shows microphone permission denial and remains retryable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('', 'NotAllowedError');
        },
      },
    });
  });
  await page.goto('/');
  await page.locator('main[data-client-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Record', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Record a sound' });
  await dialog.getByRole('button', { name: 'Start recording' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Microphone permission was denied.',
  );
  await expect(
    dialog.getByRole('button', { name: 'Start recording' }),
  ).toBeEnabled();
});
