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

    first.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: 'touch',
      }),
    );
    await new Promise(requestAnimationFrame);
    const touch = buttons.map((button) => button.getAttribute('aria-pressed'));
    first.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: 'touch',
      }),
    );
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
    return [touch, mouse];
  });

  expect(pressedStates[0]?.[0]).toBe('true');
  expect(pressedStates[0]?.[11]).toBe('false');
  expect(pressedStates[1]?.[0]).toBe('false');
  expect(pressedStates[1]?.[11]).toBe('true');
});
