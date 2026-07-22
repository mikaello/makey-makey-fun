import { z } from 'zod';

import type { ProjectV1, SampleRecord } from './project';
import { starterKit } from './starter-kit';

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const MAX_SAMPLE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_AUDIO_BYTES = 40 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil((MAX_SAMPLE_BYTES * 4) / 3) + 4;

const inputBindingSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('keyboard'), code: z.string().min(1).max(32) })
    .strict(),
  z.object({ type: z.literal('mouse-primary') }).strict(),
]);

const padSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(48),
    binding: inputBindingSchema,
    sampleId: z.string().min(1).max(64).nullable(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    gain: z.number().min(0).max(2),
    playbackMode: z.enum(['one-shot', 'loop']),
    trimStart: z.number().min(0),
    trimEnd: z.number().min(0).nullable(),
  })
  .strict();

const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(80),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    pads: z.array(padSchema).length(12),
    loop: z
      .object({
        bpm: z.number().min(60).max(180),
        bars: z.union([z.literal(1), z.literal(2), z.literal(4)]),
        events: z
          .array(
            z
              .object({
                padId: z.string().min(1).max(64),
                step: z.number().int().min(0).max(255),
              })
              .strict(),
          )
          .max(4096),
      })
      .strict(),
  })
  .strict();

const portableSampleSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(48),
    mimeType: z.string().min(1).max(128),
    duration: z
      .number()
      .min(0)
      .max(60 * 60),
    createdAt: z.iso.datetime(),
    dataBase64: z.string().min(1).max(MAX_BASE64_LENGTH),
  })
  .strict();

const portableProjectSchema = z
  .object({
    format: z.literal('makey-sampler-project'),
    version: z.literal(1),
    project: projectSchema,
    samples: z.array(portableSampleSchema).max(12),
  })
  .strict()
  .superRefine((payload, context) => {
    if (new Set(payload.project.pads.map((pad) => pad.id)).size !== 12) {
      context.addIssue({ code: 'custom', message: 'Pad IDs must be unique.' });
    }
    if (
      new Set(payload.samples.map((sample) => sample.id)).size !==
      payload.samples.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Sample IDs must be unique.',
      });
    }

    const availableSamples = new Set([
      ...starterKit.map((sound) => sound.id),
      ...payload.samples.map((sample) => sample.id),
    ]);
    if (
      payload.project.pads.some(
        (pad) => pad.sampleId && !availableSamples.has(pad.sampleId),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A pad references a missing sample.',
      });
    }
  });

type PortableProject = z.infer<typeof portableProjectSchema>;

export class PortableProjectError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'too-large',
  ) {
    super(message);
    this.name = 'PortableProjectError';
  }
}

export async function exportPortableProject(
  project: ProjectV1,
  samples: SampleRecord[],
): Promise<string> {
  const portableSamples = await Promise.all(
    samples.map(async (sample) => ({
      id: sample.id,
      name: sample.name,
      mimeType: sample.mimeType,
      duration: sample.duration,
      createdAt: sample.createdAt,
      dataBase64: bytesToBase64(
        new Uint8Array(await sample.blob.arrayBuffer()),
      ),
    })),
  );

  const payload: PortableProject = {
    format: 'makey-sampler-project',
    version: 1,
    project,
    samples: portableSamples,
  };
  return JSON.stringify(payload, null, 2);
}

export async function importPortableProject(
  file: Pick<Blob, 'size' | 'text'>,
): Promise<{ project: ProjectV1; samples: SampleRecord[] }> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new PortableProjectError(
      'Project files must be 50 MB or smaller.',
      'too-large',
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(await file.text());
  } catch {
    throw new PortableProjectError(
      'The selected file is not valid JSON.',
      'invalid',
    );
  }

  const parsed = portableProjectSchema.safeParse(input);
  if (!parsed.success) {
    throw new PortableProjectError(
      'The selected file is not a supported Makey Sampler project.',
      'invalid',
    );
  }

  let totalBytes = 0;
  const samples: SampleRecord[] = [];
  try {
    for (const sample of parsed.data.samples) {
      const bytes = base64ToBytes(sample.dataBase64);
      if (bytes.byteLength > MAX_SAMPLE_BYTES) {
        throw new PortableProjectError(
          'A project sample exceeds 25 MB.',
          'too-large',
        );
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_AUDIO_BYTES) {
        throw new PortableProjectError(
          'Project audio exceeds the 40 MB limit.',
          'too-large',
        );
      }
      samples.push({
        id: sample.id,
        projectId: parsed.data.project.id,
        name: sample.name,
        blob: new Blob([bytes], { type: sample.mimeType }),
        mimeType: sample.mimeType,
        duration: sample.duration,
        createdAt: sample.createdAt,
      });
    }
  } catch (error) {
    if (error instanceof PortableProjectError) throw error;
    throw new PortableProjectError(
      'The project contains invalid audio data.',
      'invalid',
    );
  }

  return { project: parsed.data.project, samples };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}
