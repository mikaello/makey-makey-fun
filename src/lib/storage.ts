import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';

import {
  createDefaultProject,
  type ProjectV1,
  type SampleRecord,
} from './project';
import type { WaveformRecord } from './sample-editing';

const DATABASE_NAME = 'makey-sampler';
const ACTIVE_PROJECT_KEY = 'active-project';

type StoredSample = Omit<SampleRecord, 'blob'> & { data: ArrayBuffer };

interface SamplerDatabase extends DBSchema {
  projects: {
    key: string;
    value: ProjectV1;
  };
  samples: {
    key: string;
    value: StoredSample;
    indexes: { 'by-project': string };
  };
  meta: {
    key: string;
    value: { key: string; value: string };
  };
  waveforms: {
    key: string;
    value: WaveformRecord;
  };
}

let databasePromise: Promise<IDBPDatabase<SamplerDatabase>> | null = null;

export async function loadWorkspace(): Promise<{
  project: ProjectV1;
  samples: SampleRecord[];
}> {
  const database = await getDatabase();
  const activeEntry = await database.get('meta', ACTIVE_PROJECT_KEY);
  const storedProject = activeEntry
    ? await database.get('projects', activeEntry.value)
    : undefined;
  const project = storedProject ?? createDefaultProject();

  if (!storedProject) await saveProject(project);
  const storedSamples = await database.getAllFromIndex(
    'samples',
    'by-project',
    project.id,
  );
  const samples = storedSamples.map(fromStoredSample);
  return { project, samples };
}

export async function saveProject(project: ProjectV1): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(['projects', 'meta'], 'readwrite');
  await Promise.all([
    transaction.objectStore('projects').put(project),
    transaction
      .objectStore('meta')
      .put({ key: ACTIVE_PROJECT_KEY, value: project.id }),
    transaction.done,
  ]);
}

export async function saveSample(sample: SampleRecord): Promise<void> {
  const database = await getDatabase();
  await database.put('samples', await toStoredSample(sample));
}

export async function loadWaveform(
  sampleId: string,
): Promise<WaveformRecord | undefined> {
  const database = await getDatabase();
  return database.get('waveforms', sampleId);
}

export async function saveWaveform(waveform: WaveformRecord): Promise<void> {
  const database = await getDatabase();
  await database.put('waveforms', waveform);
}

export async function saveEditedProject(
  project: ProjectV1,
  options: {
    deletedSampleId?: string;
    updatedSample?: SampleRecord;
  } = {},
): Promise<void> {
  const database = await getDatabase();
  const storedSample = options.updatedSample
    ? await toStoredSample(options.updatedSample)
    : undefined;
  const transaction = database.transaction(
    ['projects', 'samples', 'waveforms'],
    'readwrite',
  );
  await transaction.objectStore('projects').put(project);
  if (storedSample) await transaction.objectStore('samples').put(storedSample);
  if (options.deletedSampleId) {
    await transaction.objectStore('samples').delete(options.deletedSampleId);
    await transaction.objectStore('waveforms').delete(options.deletedSampleId);
  }
  await transaction.done;
}

export async function saveSampleAssignment(
  project: ProjectV1,
  sample: SampleRecord,
): Promise<void> {
  const database = await getDatabase();
  const storedSample = await toStoredSample(sample);
  const transaction = database.transaction(
    ['projects', 'samples', 'meta'],
    'readwrite',
  );
  await Promise.all([
    transaction.objectStore('projects').put(project),
    transaction.objectStore('samples').put(storedSample),
    transaction
      .objectStore('meta')
      .put({ key: ACTIVE_PROJECT_KEY, value: project.id }),
    transaction.done,
  ]);
}

export async function deleteSamplesForProject(
  projectId: string,
): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(
    ['samples', 'waveforms'],
    'readwrite',
  );
  const index = transaction.objectStore('samples').index('by-project');
  let cursor = await index.openCursor(projectId);
  while (cursor) {
    await transaction.objectStore('waveforms').delete(cursor.primaryKey);
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await transaction.done;
}

export async function resetWorkspace(project: ProjectV1): Promise<void> {
  const database = await getDatabase();
  const transaction = database.transaction(
    ['projects', 'samples', 'meta', 'waveforms'],
    'readwrite',
  );
  const sampleIndex = transaction.objectStore('samples').index('by-project');
  let cursor = await sampleIndex.openCursor(project.id);
  while (cursor) {
    await transaction.objectStore('waveforms').delete(cursor.primaryKey);
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await transaction.objectStore('projects').put(project);
  await transaction
    .objectStore('meta')
    .put({ key: ACTIVE_PROJECT_KEY, value: project.id });
  await transaction.done;
}

export async function replaceWorkspace(
  project: ProjectV1,
  samples: SampleRecord[],
): Promise<void> {
  const database = await getDatabase();
  const storedSamples = await Promise.all(samples.map(toStoredSample));
  const transaction = database.transaction(
    ['projects', 'samples', 'meta', 'waveforms'],
    'readwrite',
  );
  await transaction.objectStore('projects').clear();
  await transaction.objectStore('samples').clear();
  await transaction.objectStore('waveforms').clear();
  await transaction.objectStore('meta').clear();
  await transaction.objectStore('projects').put(project);
  for (const sample of storedSamples)
    await transaction.objectStore('samples').put(sample);
  await transaction
    .objectStore('meta')
    .put({ key: ACTIVE_PROJECT_KEY, value: project.id });
  await transaction.done;
}

export async function clearSamplerDatabase(): Promise<void> {
  if (databasePromise) {
    const database = await databasePromise;
    database.close();
  }
  databasePromise = null;
  await deleteDB(DATABASE_NAME);
}

function getDatabase(): Promise<IDBPDatabase<SamplerDatabase>> {
  databasePromise ??= openDB<SamplerDatabase>(DATABASE_NAME, 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('projects', { keyPath: 'id' });
        const samples = database.createObjectStore('samples', {
          keyPath: 'id',
        });
        samples.createIndex('by-project', 'projectId');
        database.createObjectStore('meta', { keyPath: 'key' });
      }
      if (oldVersion < 2) {
        database.createObjectStore('waveforms', { keyPath: 'sampleId' });
      }
    },
  });
  return databasePromise;
}

async function toStoredSample(sample: SampleRecord): Promise<StoredSample> {
  const { blob, ...metadata } = sample;
  return { ...metadata, data: await blob.arrayBuffer() };
}

function fromStoredSample(sample: StoredSample): SampleRecord {
  const { data, ...metadata } = sample;
  return {
    ...metadata,
    blob: new Blob([data], { type: sample.mimeType }),
  };
}
