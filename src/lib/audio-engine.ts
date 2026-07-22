import { createStarterBuffer, starterKit } from './starter-kit';

export type AudioEngineState = 'locked' | 'ready' | 'error';

export class AudioEngine {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly activeSources = new Set<AudioBufferSourceNode>();
  private starterLoaded = false;

  async unlock(): Promise<void> {
    const context = this.getContext();
    if (context.state !== 'running') await context.resume();
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

  async trigger(sampleId: string): Promise<void> {
    await this.unlock();
    const context = this.getContext();
    const buffer = this.buffers.get(sampleId);
    if (!buffer) throw new Error(`Unknown starter sample: ${sampleId}`);

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.9;
    source.connect(gain).connect(context.destination);
    source.addEventListener('ended', () => this.activeSources.delete(source), {
      once: true,
    });
    this.activeSources.add(source);
    source.start();
  }

  close(): void {
    for (const source of this.activeSources) source.stop();
    this.activeSources.clear();
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
