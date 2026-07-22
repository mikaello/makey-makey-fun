import { describe, expect, it } from 'vitest';

import {
  assignSampleToPad,
  createDefaultProject,
  type SampleRecord,
} from './project';
import {
  exportPortableProject,
  importPortableProject,
  MAX_IMPORT_BYTES,
  PortableProjectError,
} from './portable-project';

describe('portable projects', () => {
  it('round-trips metadata and audio bytes', async () => {
    const initial = createDefaultProject({
      id: 'project-1',
      now: '2026-01-01T00:00:00.000Z',
    });
    const sample: SampleRecord = {
      id: 'sample-1',
      projectId: initial.id,
      name: 'Voice',
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' }),
      mimeType: 'audio/wav',
      duration: 1.25,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const project = assignSampleToPad(
      initial,
      'pad-1',
      sample,
      '2026-01-02T00:00:00.000Z',
    );
    const exported = await exportPortableProject(project, [sample]);
    const imported = await importPortableProject(
      new Blob([exported], { type: 'application/json' }),
    );

    expect(imported.project).toEqual(project);
    expect(imported.samples[0]).toMatchObject({
      id: 'sample-1',
      name: 'Voice',
    });
    expect(
      new Uint8Array(await imported.samples[0]?.blob.arrayBuffer()),
    ).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('rejects malformed and unsupported files', async () => {
    await expect(
      importPortableProject(new Blob(['not json'])),
    ).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(
      importPortableProject(
        new Blob([JSON.stringify({ format: 'something-else' })]),
      ),
    ).rejects.toBeInstanceOf(PortableProjectError);
  });

  it('rejects oversized input before reading it', async () => {
    let read = false;
    await expect(
      importPortableProject({
        size: MAX_IMPORT_BYTES + 1,
        text: async () => {
          read = true;
          return '{}';
        },
      }),
    ).rejects.toMatchObject({ code: 'too-large' });
    expect(read).toBe(false);
  });
});
