import { expect, test } from '@playwright/test';

test('publishes an installable web app manifest', async ({ page }) => {
  await page.goto('/');
  const manifestUrl = await page
    .locator('link[rel="manifest"]')
    .getAttribute('href');
  expect(manifestUrl).toBe('/manifest.webmanifest');

  const response = await page.request.get(manifestUrl ?? '');
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: 'Makey Makey Sampler',
    display: 'standalone',
    start_url: '/',
  });
  expect(manifest.icons).toHaveLength(3);
});

test('starts offline after one successful visit', async ({
  browserName,
  context,
  page,
}) => {
  test.skip(
    browserName === 'webkit',
    'Playwright WebKit cannot navigate while its context is offline.',
  );
  await page.goto('/');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sampler' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Pad 1: Kick' }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
