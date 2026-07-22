import { expect, test } from '@playwright/test';

test('uploads a sound, restores it, and resets the starter kit', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Sounds', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Sounds' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Upload audio').setInputFiles({
    name: 'Finger-snap.wav',
    mimeType: 'audio/wav',
    buffer: createWav(),
  });

  await expect(dialog.getByText('Finger-snap', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Pad 1: Finger-snap' }),
  ).toBeVisible();

  await page.reload();
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await expect(
    page.getByRole('button', { name: 'Pad 1: Finger-snap' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Sounds', exact: true }).click();
  await page.getByRole('button', { name: 'Reset kit' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pad 1: Kick' })).toBeVisible();
});

function createWav(): Buffer {
  const sampleRate = 44100;
  const sampleCount = 4410;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = 1 - index / sampleCount;
    const sample =
      Math.sin((Math.PI * 2 * 440 * index) / sampleRate) * envelope;
    buffer.writeInt16LE(Math.round(sample * 16000), 44 + index * 2);
  }
  return buffer;
}
