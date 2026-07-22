import { createStarterBuffer, starterKit } from './starter-kit';
import { calculateWaveform, normalizeTrim } from './sample-editing';

export type AudioEngineState = 'locked' | 'ready' | 'error';

export class AudioEngine {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly activeSources = new Set<AudioBufferSourceNode>();
  private readonly loopSources = new Map<string, AudioBufferSourceNode>();
  private starterLoaded = false;

  async unlock(): Promise<void> {
    const context = this.getContext();
    if (context.state !== 'running') await context.resume();
    this.prepare();
  }

  prepare(): void {
    const context = this.getContext();
    if (!this.starterLoaded) {
      for (const sound of starterKit) {
        this.buffers.set(sound.id, createStarterBuffer(context, sound));
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
    return this.loopSources.has(loopId);
  }

  stopLoop(loopId: string): boolean {
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
    this.activeSources.clear();
    this.loopSources.clear();
    void this.context?.close();
    this.context = null;
    this.buffers.clear();
    this.starterLoaded = false;
  }

  private getContext(): AudioContext {
    if (!this.context)
      this.context = new AudioContext({ latencyHint: 'interactive' });
    return this.context;
  }
}
