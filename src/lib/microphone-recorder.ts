const RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

type MediaRecorderConstructor = {
  new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
  isTypeSupported(mimeType: string): boolean;
};

type RecorderEnvironment = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder: MediaRecorderConstructor;
};

export type RecordingResult = {
  blob: Blob;
  mimeType: string;
  duration: number;
};

export function selectRecordingMimeType(
  recorder: Pick<typeof MediaRecorder, 'isTypeSupported'>,
): string | undefined {
  return RECORDING_MIME_TYPES.find((mimeType) =>
    recorder.isTypeSupported(mimeType),
  );
}

export function microphoneErrorMessage(error: unknown): string {
  if (!(error instanceof DOMException))
    return 'Microphone recording is unavailable.';
  switch (error.name) {
    case 'NotAllowedError':
      return 'Microphone permission was denied.';
    case 'NotFoundError':
      return 'No microphone was found.';
    case 'NotReadableError':
      return 'The microphone is already in use.';
    case 'SecurityError':
      return 'Microphone access requires HTTPS.';
    default:
      return 'Microphone recording is unavailable.';
  }
}

export class MicrophoneRecorder {
  private readonly chunks: Blob[] = [];
  private startedAt = 0;

  private constructor(
    private readonly stream: MediaStream,
    private readonly recorder: MediaRecorder,
    private readonly requestedMimeType: string | undefined,
  ) {
    recorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
  }

  static async create(
    environment?: RecorderEnvironment,
  ): Promise<MicrophoneRecorder> {
    const resolvedEnvironment = environment ?? browserEnvironment();
    const stream = await resolvedEnvironment.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });
    const mimeType = selectRecordingMimeType(resolvedEnvironment.MediaRecorder);

    try {
      const recorder = new resolvedEnvironment.MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      return new MicrophoneRecorder(stream, recorder, mimeType);
    } catch (error) {
      stopTracks(stream);
      throw error;
    }
  }

  start(): void {
    this.chunks.length = 0;
    this.startedAt = Date.now();
    this.recorder.start();
  }

  stop(): Promise<RecordingResult> {
    if (this.recorder.state === 'inactive') {
      return Promise.reject(new Error('The recorder is not active.'));
    }

    return new Promise((resolve, reject) => {
      this.recorder.addEventListener(
        'stop',
        () => {
          resolve({
            blob: new Blob(this.chunks, {
              type:
                this.recorder.mimeType ||
                this.requestedMimeType ||
                'audio/webm',
            }),
            mimeType:
              this.recorder.mimeType || this.requestedMimeType || 'audio/webm',
            duration: Math.max(0, (Date.now() - this.startedAt) / 1000),
          });
        },
        { once: true },
      );
      this.recorder.addEventListener(
        'error',
        () => reject(new Error('Microphone recording failed.')),
        { once: true },
      );
      this.recorder.stop();
      stopTracks(this.stream);
    });
  }

  cancel(): void {
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    stopTracks(this.stream);
  }
}

function browserEnvironment(): RecorderEnvironment {
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === 'undefined'
  ) {
    throw new Error('MediaRecorder is unavailable.');
  }
  return {
    getUserMedia: (constraints) =>
      navigator.mediaDevices.getUserMedia(constraints),
    MediaRecorder,
  };
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
