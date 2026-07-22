import { expect, test } from '@playwright/test';

test('records, overdubs, mutes, and restores a quantized loop', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Open loop controls' }).click();

  const looper = page.getByRole('dialog', { name: 'Looper' });
  await looper.getByLabel('BPM').fill('132');
  await looper.getByRole('button', { name: '2 bars' }).click();
  await looper.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(
    looper.getByRole('button', { name: 'Stop', exact: true }),
  ).toBeVisible();

  const record = looper.getByRole('button', { name: 'Record', exact: true });
  await record.click();
  await expect(record).toHaveAttribute('aria-pressed', 'true');
  await looper.getByRole('button', { name: 'Loop pad 1: Kick' }).click();
  await expect(looper.getByText('1 hit')).toBeVisible();
  await expect(looper).toHaveAttribute('data-loop-saving', 'false');

  const mute = looper.getByRole('button', { name: 'Mute', exact: true });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await looper.getByRole('button', { name: 'Stop', exact: true }).click();

  await page.reload();
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Open loop controls' }).click();
  await expect(looper.getByLabel('BPM')).toHaveValue('132');
  await expect(looper.getByRole('button', { name: '2 bars' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(looper.getByText('1 hit')).toBeVisible();

  await looper.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(looper.getByText('0 hits')).toBeVisible();
  await expect(looper).toHaveAttribute('data-loop-saving', 'false');
  await page.reload();
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Open loop controls' }).click();
  await expect(looper.getByText('0 hits')).toBeVisible();
});
