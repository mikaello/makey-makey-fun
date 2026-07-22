import { expect, test } from '@playwright/test';

test('renders the sampler shell without horizontal overflow', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sampler' })).toBeVisible();
  const pads = page
    .getByRole('region', { name: 'Sampler pads' })
    .getByRole('button');
  await expect(pads).toHaveCount(12);
  await expect(pads.first()).toBeEnabled();

  const viewportWidth = await page.evaluate(
    () => document.documentElement.clientWidth,
  );
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
});

test('supports simultaneous pointer presses without changing the pad layout', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('main[data-client-ready="true"]').waitFor();
  const pads = page
    .getByRole('region', { name: 'Sampler pads' })
    .getByRole('button');

  const pressed = await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.pad')];
    const firstTouchStart = new Event('touchstart', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(firstTouchStart, 'changedTouches', {
      value: [{ identifier: 1 }],
    });
    buttons[0]?.dispatchEvent(firstTouchStart);

    const secondTouchStart = new Event('touchstart', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(secondTouchStart, 'changedTouches', {
      value: [{ identifier: 2 }],
    });
    buttons[1]?.dispatchEvent(secondTouchStart);
    await new Promise(requestAnimationFrame);
    return buttons
      .slice(0, 2)
      .map((button) => button.getAttribute('aria-pressed'));
  });

  expect(pressed).toEqual(['true', 'true']);
  await expect(pads).toHaveCount(12);
});

test('uses the system language and persists an explicit choice', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', {
      configurable: true,
      get: () => ['nb-NO', 'en-US'],
    });
  });
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
  await expect(page.getByRole('button', { name: 'Lyder' })).toBeVisible();
  await page.getByRole('button', { name: 'Velg språk' }).click();
  await page.getByRole('button', { name: 'Engelsk' }).click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Sounds' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('keeps the manual audio unlock in device diagnostics', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Start audio' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Test Makey Makey' }).click();
  const dialog = page.getByRole('dialog', { name: 'Makey Makey test' });
  await expect(
    dialog.getByRole('button', { name: 'Start audio' }),
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Start audio' }).click();
  await expect(dialog.getByText('Audio ready')).toBeVisible();
});
