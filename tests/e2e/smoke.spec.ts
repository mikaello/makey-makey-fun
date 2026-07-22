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
  const pads = page
    .getByRole('region', { name: 'Sampler pads' })
    .getByRole('button');

  const pressed = await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.pad')];
    buttons[0]?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'touch',
      }),
    );
    buttons[1]?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 2,
        pointerType: 'touch',
      }),
    );
    await new Promise(requestAnimationFrame);
    return buttons
      .slice(0, 2)
      .map((button) => button.getAttribute('aria-pressed'));
  });

  expect(pressed).toEqual(['true', 'true']);
  await expect(pads).toHaveCount(12);
});
