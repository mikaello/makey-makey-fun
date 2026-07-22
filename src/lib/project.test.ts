import { describe, expect, it } from 'vitest';

import {
  assignSampleToPad,
  clearPad,
  createDefaultProject,
  resetProjectToStarterKit,
  updatePad,
  updateLoopPattern,
} from './project';

describe('project model', () => {
  it('creates a single twelve-pad starter project', () => {
    const project = createDefaultProject({
      id: 'project-1',
      now: '2026-01-01T00:00:00.000Z',
    });

    expect(project.schemaVersion).toBe(1);
    expect(project.pads).toHaveLength(12);
    expect(project.pads[0]?.binding).toEqual({
      type: 'keyboard',
      code: 'ArrowUp',
    });
    expect(project.pads[11]?.binding).toEqual({ type: 'mouse-primary' });
    expect(project.loop).toEqual({ bpm: 110, bars: 1, events: [] });
  });

  it('assigns a sample without mutating unrelated pads', () => {
    const original = createDefaultProject({
      id: 'project-1',
      now: '2026-01-01T00:00:00.000Z',
    });
    const updated = assignSampleToPad(
      original,
      'pad-1',
      { id: 'sample-1', name: 'Door slam' },
      '2026-01-02T00:00:00.000Z',
    );

    expect(updated.pads[0]).toMatchObject({
      label: 'Door slam',
      sampleId: 'sample-1',
    });
    expect(updated.pads[1]).toBe(original.pads[1]);
    expect(original.pads[0]?.label).toBe('Kick');
  });

  it('resets samples while preserving project identity', () => {
    const original = createDefaultProject({
      id: 'project-1',
      now: '2026-01-01T00:00:00.000Z',
    });
    const changed = assignSampleToPad(original, 'pad-1', {
      id: 'sample-1',
      name: 'Voice',
    });
    const reset = resetProjectToStarterKit(changed, '2026-01-03T00:00:00.000Z');

    expect(reset.id).toBe('project-1');
    expect(reset.createdAt).toBe(original.createdAt);
    expect(reset.pads[0]?.sampleId).toBe('kick');
  });

  it('updates and clears one pad without changing its binding', () => {
    const project = createDefaultProject({ id: 'project-1' });
    const edited = updatePad(project, 'pad-1', {
      label: 'Short kick',
      gain: 1.2,
      playbackMode: 'loop',
      trimStart: 0.1,
      trimEnd: 0.3,
    });
    const cleared = clearPad(edited, 'pad-1');

    expect(edited.pads[0]).toMatchObject({ label: 'Short kick', gain: 1.2 });
    expect(cleared.pads[0]).toMatchObject({
      label: 'Empty pad',
      sampleId: null,
      binding: project.pads[0]?.binding,
    });
  });

  it('updates the persisted loop without mutating the project', () => {
    const project = createDefaultProject({ id: 'project-1' });
    const updated = updateLoopPattern(project, {
      bpm: 128,
      bars: 2,
      events: [{ padId: 'pad-1', step: 3 }],
    });

    expect(updated.loop).toEqual({
      bpm: 128,
      bars: 2,
      events: [{ padId: 'pad-1', step: 3 }],
    });
    expect(project.loop.events).toEqual([]);
  });
});
