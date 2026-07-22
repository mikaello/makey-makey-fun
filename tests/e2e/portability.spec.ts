import { expect, test } from '@playwright/test';

test('exports and restores a project with embedded audio', async ({ page }) => {
  await page.goto('/');
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Sounds', exact: true }).click();

  await page.getByLabel('Upload audio').setInputFiles({
    name: 'Door-bell.wav',
    mimeType: 'audio/wav',
    buffer: createWav(),
  });
  await expect(
    page.getByRole('dialog', { name: 'Sounds' }).getByText('Door-bell'),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export project' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('my-sampler.makey-sampler.json');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exportedProject = Buffer.concat(chunks);

  await page.getByRole('button', { name: 'Reset kit' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Sounds' }).getByText('Kick'),
  ).toBeVisible();

  await page.getByLabel('Import project').setInputFiles({
    name: 'restored.json',
    mimeType: 'application/json',
    buffer: exportedProject,
  });
  await expect(
    page.getByRole('button', { name: 'Pad 1: Door-bell' }),
  ).toBeVisible();

  await page.reload();
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await expect(
    page.getByRole('button', { name: 'Pad 1: Door-bell' }),
  ).toBeVisible();
});

test('rejects invalid imports without replacing the project', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('main[data-storage-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Sounds', exact: true }).click();

  await page.getByLabel('Import project').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"unknown"}'),
  });

  await expect(page.getByRole('alert')).toContainText(
    'not a supported Makey Sampler project',
  );
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
    const sample =
      Math.sin((Math.PI * 2 * 440 * index) / sampleRate) *
      (1 - index / sampleCount);
    buffer.writeInt16LE(Math.round(sample * 16000), 44 + index * 2);
  }
  return buffer;
}
