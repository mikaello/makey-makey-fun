import { expect, test } from '@playwright/test';

test('maps Makey Makey keyboard codes and releases held pads', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('main[data-client-ready="true"]').waitFor();
  const upPad = page.getByRole('button', { name: 'Pad 1: Kick' });

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        code: 'ArrowUp',
        key: 'ArrowUp',
      }),
    );
  });
  await expect(upPad).toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keyup', {
        bubbles: true,
        code: 'ArrowUp',
        key: 'ArrowUp',
      }),
    );
  });
  await expect(upPad).toHaveAttribute('aria-pressed', 'false');
});

test('shows incoming keys in the connection tester', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Test Makey Makey' }).click();

  const dialog = page.getByRole('dialog', { name: 'Makey Makey test' });
  await expect(dialog).toBeVisible();

  await page.keyboard.down('w');
  await expect(dialog.locator('.input-status')).toContainText('W');
  await page.keyboard.up('w');
});

test('keeps touch separate from the optional primary-click binding', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Test Makey Makey' }).click();
  await page.getByLabel('Primary click').check();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  const pressedStates = await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.pad')];
    const first = buttons[0];
    if (!first) return [];

    const touchStart = new Event('touchstart', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(touchStart, 'changedTouches', {
      value: [{ identifier: 1 }],
    });
    first.dispatchEvent(touchStart);
    await new Promise(requestAnimationFrame);
    const touch = buttons.map((button) => button.getAttribute('aria-pressed'));

    const touchEnd = new Event('touchend', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(touchEnd, 'changedTouches', {
      value: [{ identifier: 1 }],
    });
    first.dispatchEvent(touchEnd);
    await new Promise(requestAnimationFrame);

    first.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 2,
        pointerType: 'mouse',
      }),
    );
    await new Promise(requestAnimationFrame);
    const mouse = buttons.map((button) => button.getAttribute('aria-pressed'));
    first.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        button: 0,
        pointerId: 2,
        pointerType: 'mouse',
      }),
    );
    await new Promise(requestAnimationFrame);
    return [touch, mouse];
  });

  expect(pressedStates[0]?.[0]).toBe('true');
  expect(pressedStates[0]?.[11]).toBe('false');
  expect(pressedStates[1]?.[0]).toBe('false');
  expect(pressedStates[1]?.[11]).toBe('true');
});

test('plays pads from touch events without relying on pointer events', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const win = window as typeof window & {
      __audioEvents?: string[];
      __mediaPlays?: number;
    };
    win.__audioEvents = [];
    win.__mediaPlays = 0;

    class FakeAudioBuffer {
      duration: number;
      length: number;
      numberOfChannels = 1;
      sampleRate: number;
      private data: Float32Array;

      constructor(channelCount: number, length: number, sampleRate: number) {
        this.length = length;
        this.sampleRate = sampleRate;
        this.duration = length / sampleRate;
        this.numberOfChannels = channelCount;
        this.data = new Float32Array(length);
      }

      getChannelData() {
        return this.data;
      }
    }

    class FakeAudioContext {
      destination = {};
      sampleRate = 44100;
      state = 'suspended';

      close() {
        return Promise.resolve();
      }

      createBuffer(channelCount: number, length: number, sampleRate: number) {
        return new FakeAudioBuffer(channelCount, length, sampleRate);
      }

      createBufferSource() {
        return {
          addEventListener() {},
          buffer: null as FakeAudioBuffer | null,
          connect(node: unknown) {
            return node;
          },
          loop: false,
          loopEnd: 0,
          loopStart: 0,
          start() {
            if (this.buffer?.length === 1) {
              win.__audioEvents?.push('unlock-start');
            }
          },
          stop() {},
        };
      }

      createGain() {
        return {
          connect(node: unknown) {
            return node;
          },
          gain: { value: 1 },
        };
      }

      decodeAudioData() {
        return Promise.resolve(new FakeAudioBuffer(1, 4410, 44100));
      }

      resume() {
        win.__audioEvents?.push('resume');
        this.state = 'running';
        return Promise.resolve();
      }
    }

    class FakeAudio {
      currentTime = 0;
      loop = false;
      preload = '';
      volume = 1;

      constructor(readonly url: string) {}

      addEventListener() {}

      pause() {
        win.__audioEvents?.push('media-pause');
      }

      play() {
        const audible = this.volume > 0;
        win.__audioEvents?.push(audible ? 'media-play' : 'media-prime');
        if (audible) win.__mediaPlays = (win.__mediaPlays ?? 0) + 1;
        return Promise.resolve();
      }
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(window, 'Audio', {
      configurable: true,
      value: FakeAudio,
    });
  });
  await page.goto('/');
  await page.locator('main[data-client-ready="true"]').waitFor();

  const upPad = page.getByRole('button', { name: 'Pad 1: Kick' });
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.pad');
    if (!button) return;

    const touchStart = new Event('touchstart', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(touchStart, 'changedTouches', {
      value: [{ identifier: 7 }],
    });
    button.dispatchEvent(touchStart);
  });

  await expect(upPad).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __mediaPlays?: number }).__mediaPlays,
      ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & { __audioEvents?: string[] }
          ).__audioEvents?.filter((event) => event === 'media-play').length,
      ),
    )
    .toBe(1);
  const audioEvents = await page.evaluate(
    () =>
      (window as typeof window & { __audioEvents?: string[] }).__audioEvents ??
      [],
  );
  expect(audioEvents[0]).toBe('unlock-start');
  expect(audioEvents).toContain('media-prime');
  expect(audioEvents.indexOf('resume')).toBeLessThan(
    audioEvents.indexOf('media-play'),
  );

  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.pad');
    if (!button) return;

    const touchEnd = new Event('touchend', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(touchEnd, 'changedTouches', {
      value: [{ identifier: 7 }],
    });
    button.dispatchEvent(touchEnd);
  });

  await expect(upPad).toHaveAttribute('aria-pressed', 'false');
});
