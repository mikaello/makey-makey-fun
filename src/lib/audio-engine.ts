import { createStarterBuffer, starterKit } from './starter-kit';

export type AudioEngineState = 'locked' | 'ready' | 'error';

export class AudioEngine {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly activeSources = new Set<AudioBufferSourceNode>();

  async unlock(): Promise<void> {
    const context = this.getContext();
    if (context.state !== 'running') await context.resume();
    if (this.buffers.size === 0) {
      for (const sound of starterKit) {
        this.buffers.set(sound.id, createStarterBuffer(context, sound));
      }
    }
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
  }

  private getContext(): AudioContext {
    if (!this.context)
      this.context = new AudioContext({ latencyHint: 'interactive' });
    return this.context;
  }
}
