import { keyboardBindings } from './input';
import { starterKit } from './starter-kit';

export type KeyboardBinding = { type: 'keyboard'; code: string };
export type MouseBinding = { type: 'mouse-primary' };
export type InputBinding = KeyboardBinding | MouseBinding;

export type Pad = {
  id: string;
  label: string;
  binding: InputBinding;
  sampleId: string | null;
  color: string;
  gain: number;
  playbackMode: 'one-shot' | 'loop';
  trimStart: number;
  trimEnd: number | null;
};

export type LoopPattern = {
  bpm: number;
  bars: 1 | 2 | 4;
  events: Array<{ padId: string; step: number }>;
};

export type ProjectV1 = {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  pads: Pad[];
  loop: LoopPattern;
};

export type SampleRecord = {
  id: string;
  projectId: string;
  name: string;
  blob: Blob;
  mimeType: string;
  duration: number;
  createdAt: string;
};

export function createDefaultProject(
  options: { id?: string; now?: string } = {},
): ProjectV1 {
  const now = options.now ?? new Date().toISOString();
  const id = options.id ?? crypto.randomUUID();

  return {
    schemaVersion: 1,
    id,
    name: 'My sampler',
    createdAt: now,
    updatedAt: now,
    pads: starterKit.map((sound, index) => ({
      id: `pad-${index + 1}`,
      label: sound.label,
      binding:
        index < keyboardBindings.length
          ? { type: 'keyboard', code: keyboardBindings[index]?.code ?? '' }
          : { type: 'mouse-primary' },
      sampleId: sound.id,
      color: sound.color,
      gain: 0.9,
      playbackMode: 'one-shot',
      trimStart: 0,
      trimEnd: null,
    })),
    loop: {
      bpm: 110,
      bars: 1,
      events: [],
    },
  };
}

export function resetProjectToStarterKit(
  project: ProjectV1,
  now = new Date().toISOString(),
): ProjectV1 {
  const starter = createDefaultProject({
    id: project.id,
    now: project.createdAt,
  });
  return {
    ...starter,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: now,
  };
}

export function assignSampleToPad(
  project: ProjectV1,
  padId: string,
  sample: Pick<SampleRecord, 'id' | 'name'>,
  now = new Date().toISOString(),
): ProjectV1 {
  return {
    ...project,
    updatedAt: now,
    pads: project.pads.map((pad) =>
      pad.id === padId
        ? {
            ...pad,
            label: sample.name,
            sampleId: sample.id,
            trimStart: 0,
            trimEnd: null,
          }
        : pad,
    ),
  };
}

export function updatePad(
  project: ProjectV1,
  padId: string,
  changes: Pick<
    Pad,
    'gain' | 'label' | 'playbackMode' | 'trimEnd' | 'trimStart'
  >,
  now = new Date().toISOString(),
): ProjectV1 {
  return {
    ...project,
    updatedAt: now,
    pads: project.pads.map((pad) =>
      pad.id === padId ? { ...pad, ...changes } : pad,
    ),
  };
}

export function clearPad(
  project: ProjectV1,
  padId: string,
  now = new Date().toISOString(),
): ProjectV1 {
  return {
    ...project,
    updatedAt: now,
    pads: project.pads.map((pad) =>
      pad.id === padId
        ? {
            ...pad,
            label: 'Empty pad',
            sampleId: null,
            gain: 0.9,
            playbackMode: 'one-shot',
            trimStart: 0,
            trimEnd: null,
          }
        : pad,
    ),
  };
}

export function updateLoopPattern(
  project: ProjectV1,
  loop: LoopPattern,
  now = new Date().toISOString(),
): ProjectV1 {
  return { ...project, updatedAt: now, loop };
}
