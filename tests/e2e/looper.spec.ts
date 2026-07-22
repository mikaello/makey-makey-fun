import { expect, test } from '@playwright/test';

test('records, overdubs, mutes, and restores a quantized loop', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const win = window as typeof window & { __mediaPlayVolumes?: number[] };
    win.__mediaPlayVolumes = [];

    class FakeAudio {
      currentTime = 0;
      loop = false;
      preload = '';
      volume = 1;

      constructor(readonly url: string) {}

      addEventListener() {}

      pause() {}

      play() {
        win.__mediaPlayVolumes?.push(this.volume);
        return Promise.resolve();
      }
    }

    Object.defineProperty(window, 'Audio', {
      configurable: true,
      value: FakeAudio,
    });
  });
  await page.goto('/');
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Open beat loop builder' }).click();

  const looper = page.getByRole('dialog', { name: 'Build a beat loop' });
  await expect(looper.getByText('Choose the speed and length')).toBeVisible();
  await looper.getByLabel('Speed (BPM)').fill('132');
  await looper.getByRole('button', { name: '2 bars' }).click();
  await looper
    .getByRole('button', { name: 'Start recording', exact: true })
    .click();
  await expect(
    looper.getByRole('button', { name: 'Stop', exact: true }),
  ).toBeVisible();

  const doneAdding = looper.getByRole('button', {
    name: 'Done adding',
    exact: true,
  });
  await expect(doneAdding).toHaveAttribute('aria-pressed', 'true');
  await looper.getByRole('button', { name: 'Loop pad 1: Kick' }).click();
  await expect(looper.getByText('1 hit')).toBeVisible();
  await expect(looper).toHaveAttribute('data-loop-saving', 'false');

  const mute = looper.getByRole('button', { name: 'Mute', exact: true });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await looper.getByRole('button', { name: 'Stop', exact: true }).click();

  await page.reload();
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Open beat loop builder' }).click();
  await expect(looper.getByLabel('Speed (BPM)')).toHaveValue('132');
  await expect(looper.getByRole('button', { name: '2 bars' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(looper.getByText('1 hit')).toBeVisible();

  await looper.getByRole('button', { name: 'Play loop', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & { __mediaPlayVolumes?: number[] }
          ).__mediaPlayVolumes?.some((volume) => volume > 0) ?? false,
      ),
    )
    .toBe(true);
  await looper.getByRole('button', { name: 'Stop', exact: true }).click();

  await looper.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(looper.getByText('0 hits')).toBeVisible();
  await expect(looper).toHaveAttribute('data-loop-saving', 'false');
  await page.reload();
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Open beat loop builder' }).click();
  await expect(looper.getByText('0 hits')).toBeVisible();
});
