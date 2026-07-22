import { expect, test } from '@playwright/test';

test('renders the sampler shell without horizontal overflow', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sampler' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Sampler pads' }).getByRole('button'),
  ).toHaveCount(12);

  const viewportWidth = await page.evaluate(
    () => document.documentElement.clientWidth,
  );
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
});
