import {
  createStarterBuffer,
  createStarterChannelData,
  starterKit,
  type StarterSound,
} from './starter-kit';
import { calculateWaveform, normalizeTrim } from './sample-editing';

export type AudioEngineState = 'locked' | 'ready' | 'error';

const MEDIA_SAMPLE_RATE = 44100;

type AudioContextConstructor = new (
  options?: AudioContextOptions,
) => AudioContext;
type WebKitAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };

export class AudioEngine {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly activeSources = new Set<AudioBufferSourceNode>();
  private readonly loopSources = new Map<string, AudioBufferSourceNode>();
  private readonly mediaUrls = new Map<string, string>();
  private readonly activeMedia = new Set<HTMLAudioElement>();
  private readonly mediaLoopTimers = new Map<string, number>();
  private readonly loopMedia = new Map<string, HTMLAudioElement>();
  private starterLoaded = false;

  primeUserGesture(): void {
    const context = this.getContext();
    this.playSilentUnlockSource(context);
    if (context.state !== 'running') void context.resume();
    this.prepare();
  }

  async unlock(): Promise<void> {
    const context = this.getContext();
    this.playSilentUnlockSource(context);
    if (context.state !== 'running') await context.resume();
    this.prepare();
  }

  prepare(): void {
    const context = this.getContext();
    if (!this.starterLoaded) {
      for (const sound of starterKit) {
        this.buffers.set(sound.id, createStarterBuffer(context, sound));
        this.ensureStarterMedia(sound);
      }
      this.starterLoaded = true;
    }
  }

  async decodeSample(sampleId: string, blob: Blob): Promise<number> {
    const context = this.getContext();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    this.buffers.set(sampleId, buffer);
    return buffer.duration;
  }

  hasSample(sampleId: string): boolean {
    return this.buffers.has(sampleId);
  }

  removeSample(sampleId: string): void {
    this.buffers.delete(sampleId);
  }

  getSampleDuration(sampleId: string): number | null {
    return this.buffers.get(sampleId)?.duration ?? null;
  }

  get currentTime(): number {
    return this.getContext().currentTime;
  }

  getWaveform(sampleId: string, pointCount = 64): number[] | null {
    const buffer = this.buffers.get(sampleId);
    if (!buffer) return null;
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, index) => buffer.getChannelData(index),
    );
    return calculateWaveform(channels, pointCount);
  }

  async trigger(
    sampleId: string,
    options: {
      gain?: number;
      loopId?: string;
      playbackMode?: 'one-shot' | 'loop';
      trimEnd?: number | null;
      trimStart?: number;
    } = {},
  ): Promise<void> {
    const starterSound = starterKit.find((sound) => sound.id === sampleId);
    if (starterSound) {
      this.triggerMedia(starterSound, options);
      return;
    }

    await this.unlock();
    const context = this.getContext();
    const buffer = this.buffers.get(sampleId);
    if (!buffer) throw new Error(`Unknown starter sample: ${sampleId}`);

    if (
      options.playbackMode === 'loop' &&
      options.loopId &&
      this.stopLoop(options.loopId)
    ) {
      return;
    }

    const source = context.createBufferSource();
    const gain = context.createGain();
    const trim = normalizeTrim(
      buffer.duration,
      options.trimStart ?? 0,
      options.trimEnd ?? null,
    );
    source.buffer = buffer;
    gain.gain.value = options.gain ?? 0.9;
    source.connect(gain).connect(context.destination);
    source.addEventListener('ended', () => this.activeSources.delete(source), {
      once: true,
    });
    this.activeSources.add(source);
    if (options.playbackMode === 'loop' && options.loopId) {
      source.loop = true;
      source.loopStart = trim.start;
      source.loopEnd = trim.end;
      this.loopSources.set(options.loopId, source);
      source.start(0, trim.start);
    } else {
      source.start(0, trim.start, Math.max(0, trim.end - trim.start));
    }
  }

  isLooping(loopId: string): boolean {
    return this.loopSources.has(loopId) || this.loopMedia.has(loopId);
  }

  stopLoop(loopId: string): boolean {
    const media = this.loopMedia.get(loopId);
    if (media) {
      this.loopMedia.delete(loopId);
      this.stopMediaLoopTimer(loopId);
      media.pause();
      media.currentTime = 0;
      this.activeMedia.delete(media);
      return true;
    }

    const source = this.loopSources.get(loopId);
    if (!source) return false;
    this.loopSources.delete(loopId);
    this.activeSources.delete(source);
    source.stop();
    return true;
  }

  schedule(
    sampleId: string,
    when: number,
    options: {
      gain: number;
      trimEnd: number | null;
      trimStart: number;
    },
  ): void {
    const context = this.getContext();
    const buffer = this.buffers.get(sampleId);
    if (!buffer) return;
    const trim = normalizeTrim(
      buffer.duration,
      options.trimStart,
      options.trimEnd,
    );
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = options.gain;
    source.connect(gain).connect(context.destination);
    source.addEventListener('ended', () => this.activeSources.delete(source), {
      once: true,
    });
    this.activeSources.add(source);
    source.start(when, trim.start, Math.max(0, trim.end - trim.start));
  }

  close(): void {
    for (const source of this.activeSources) source.stop();
    for (const media of this.activeMedia) {
      media.pause();
      media.currentTime = 0;
    }
    for (const timer of this.mediaLoopTimers.values()) clearInterval(timer);
    for (const url of this.mediaUrls.values()) URL.revokeObjectURL(url);
    this.activeSources.clear();
    this.activeMedia.clear();
    this.mediaLoopTimers.clear();
    this.loopSources.clear();
    this.loopMedia.clear();
    this.mediaUrls.clear();
    void this.context?.close();
    this.context = null;
    this.buffers.clear();
    this.starterLoaded = false;
  }

  private getContext(): AudioContext {
    if (!this.context) {
      const AudioContextClass =
        window.AudioContext ?? (window as WebKitAudioWindow).webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio is unavailable.');
      this.context = new AudioContextClass({ latencyHint: 'interactive' });
    }
    return this.context;
  }

  private playSilentUnlockSource(context: AudioContext): void {
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, context.sampleRate);
    source.connect(context.destination);
    source.start(0);
  }

  private triggerMedia(
    sound: StarterSound,
    options: {
      gain?: number;
      loopId?: string;
      playbackMode?: 'one-shot' | 'loop';
      trimEnd?: number | null;
      trimStart?: number;
    },
  ): void {
    if (
      options.playbackMode === 'loop' &&
      options.loopId &&
      this.stopLoop(options.loopId)
    ) {
      return;
    }

    const url = this.ensureStarterMedia(sound);
    const duration = sound.duration;
    const trim = normalizeTrim(
      duration,
      options.trimStart ?? 0,
      options.trimEnd ?? null,
    );
    const media = new Audio(url);
    media.preload = 'auto';
    media.volume = Math.max(0, Math.min(1, options.gain ?? 0.9));
    this.seekMedia(media, trim.start);
    this.activeMedia.add(media);

    if (options.playbackMode === 'loop' && options.loopId) {
      media.loop = trim.start === 0 && trim.end >= duration;
      this.loopMedia.set(options.loopId, media);
      if (!media.loop) this.startMediaLoopTimer(options.loopId, media, trim);
    } else {
      window.setTimeout(
        () => {
          media.pause();
          media.currentTime = 0;
          this.activeMedia.delete(media);
        },
        Math.max(0, (trim.end - trim.start) * 1000),
      );
      media.addEventListener('ended', () => this.activeMedia.delete(media), {
        once: true,
      });
    }

    void media.play();
  }

  private startMediaLoopTimer(
    loopId: string,
    media: HTMLAudioElement,
    trim: { end: number; start: number },
  ): void {
    this.stopMediaLoopTimer(loopId);
    const timer = window.setInterval(() => {
      if (media.currentTime >= trim.end) this.seekMedia(media, trim.start);
    }, 16);
    this.mediaLoopTimers.set(loopId, timer);
  }

  private stopMediaLoopTimer(loopId: string): void {
    const timer = this.mediaLoopTimers.get(loopId);
    if (!timer) return;
    clearInterval(timer);
    this.mediaLoopTimers.delete(loopId);
  }

  private ensureStarterMedia(sound: StarterSound): string {
    const cached = this.mediaUrls.get(sound.id);
    if (cached) return cached;
    const channel = createStarterChannelData(sound, MEDIA_SAMPLE_RATE);
    const url = URL.createObjectURL(encodeWave(channel, MEDIA_SAMPLE_RATE));
    this.mediaUrls.set(sound.id, url);
    return url;
  }

  private seekMedia(media: HTMLAudioElement, time: number): void {
    try {
      media.currentTime = time;
    } catch {
      media.addEventListener(
        'loadedmetadata',
        () => {
          media.currentTime = time;
        },
        { once: true },
      );
    }
  }
}

function encodeWave(channel: Float32Array, sampleRate: number): Blob {
  const headerBytes = 44;
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(headerBytes + channel.length * bytesPerSample);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + channel.length * bytesPerSample, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, channel.length * bytesPerSample, true);

  let offset = headerBytes;
  for (const sample of channel) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
