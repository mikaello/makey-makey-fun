import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import { createDefaultProject, type SampleRecord } from './project';
import {
  clearSamplerDatabase,
  deleteSamplesForProject,
  loadWorkspace,
  replaceWorkspace,
  saveProject,
  saveSample,
} from './storage';

afterEach(async () => {
  await clearSamplerDatabase();
});

describe('local workspace storage', () => {
  it('creates and restores the active project', async () => {
    const first = await loadWorkspace();
    const renamed = { ...first.project, name: 'Kitchen beats' };
    await saveProject(renamed);

    const restored = await loadWorkspace();
    expect(restored.project.name).toBe('Kitchen beats');
  });

  it('stores audio blobs separately and clears them by project', async () => {
    const project = createDefaultProject({ id: 'project-1' });
    await saveProject(project);
    const sample: SampleRecord = {
      id: 'sample-1',
      projectId: project.id,
      name: 'Voice',
      blob: new Blob(['audio'], { type: 'audio/wav' }),
      mimeType: 'audio/wav',
      duration: 1.2,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await saveSample(sample);

    expect((await loadWorkspace()).samples).toHaveLength(1);
    await deleteSamplesForProject(project.id);
    expect((await loadWorkspace()).samples).toHaveLength(0);
  });

  it('atomically replaces the current workspace', async () => {
    const first = createDefaultProject({ id: 'project-1' });
    await saveProject(first);
    await saveSample({
      id: 'old-sample',
      projectId: first.id,
      name: 'Old',
      blob: new Blob(['old']),
      mimeType: 'audio/wav',
      duration: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const replacement = createDefaultProject({ id: 'project-2' });
    await replaceWorkspace(replacement, []);
    const restored = await loadWorkspace();
    expect(restored.project.id).toBe('project-2');
    expect(restored.samples).toEqual([]);
  });
});
