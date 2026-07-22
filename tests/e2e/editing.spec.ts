import { expect, test } from '@playwright/test';

test('edits, loops, restores, and clears a pad', async ({ page }) => {
  await page.goto('/');
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Sounds', exact: true }).click();
  await page.getByRole('button', { name: 'Edit selected sound' }).click();

  const editor = page.getByRole('dialog', { name: 'Edit sample' });
  await expect(editor.locator('.waveform span')).toHaveCount(64);
  await editor.getByLabel('Name').fill('Short kick');
  await editor.getByLabel('Trim start').fill('0.05');
  await editor.getByLabel('Trim end').fill('0.2');
  await editor.getByLabel('Gain').fill('1.2');
  await editor.getByRole('button', { name: 'Loop', exact: true }).click();
  await editor.getByRole('button', { name: 'Save changes' }).click();

  const pad = page.getByRole('button', { name: 'Pad 1: Short kick' });
  await expect(pad).toBeVisible();
  await pad.click();
  await expect(pad).toHaveAttribute('aria-pressed', 'true');
  await pad.click();
  await expect(pad).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Sounds', exact: true }).click();
  await page.getByRole('button', { name: 'Edit selected sound' }).click();
  await expect(editor.getByLabel('Name')).toHaveValue('Short kick');
  await expect(editor.getByLabel('Gain')).toHaveValue('1.2');
  await expect(
    editor.getByRole('button', { name: 'Loop', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  await editor.getByRole('button', { name: 'Clear pad' }).click();
  await expect(
    page.getByRole('button', { name: 'Pad 1: Empty pad' }),
  ).toBeVisible();
  await page.reload();
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await expect(
    page.getByRole('button', { name: 'Pad 1: Empty pad' }),
  ).toBeVisible();
});
