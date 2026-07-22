<script lang="ts">
  import { Volume2, VolumeX } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';

  import { AudioEngine, type AudioEngineState } from '../lib/audio-engine';
  import { starterKit, type StarterSound } from '../lib/starter-kit';

  const audio = new AudioEngine();
  const pointerPads = new SvelteMap<number, string>();
  const activePads = new SvelteSet<string>();

  let audioState: AudioEngineState = 'locked';

  onDestroy(() => audio.close());

  async function triggerPad(sound: StarterSound): Promise<void> {
    setPadActive(sound.id, true);
    try {
      await audio.trigger(sound.id);
      audioState = 'ready';
    } catch {
      audioState = 'error';
    }
  }

  function handlePointerDown(event: PointerEvent, sound: StarterSound): void {
    event.preventDefault();
    const button = event.currentTarget as HTMLButtonElement;
    if (event.isTrusted) button.setPointerCapture(event.pointerId);
    pointerPads.set(event.pointerId, sound.id);
    void triggerPad(sound);
  }

  function handlePointerEnd(event: PointerEvent): void {
    const padId = pointerPads.get(event.pointerId);
    if (!padId) return;
    pointerPads.delete(event.pointerId);
    setPadActive(padId, false);
  }

  async function unlockAudio(): Promise<void> {
    try {
      await audio.unlock();
      audioState = 'ready';
    } catch {
      audioState = 'error';
    }
  }

  function setPadActive(padId: string, active: boolean): void {
    if (active) activePads.add(padId);
    else activePads.delete(padId);
  }
</script>

<svelte:head>
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
</svelte:head>

<main class="app-shell">
  <header class="topbar">
    <div>
      <p class="eyebrow">Makey Makey</p>
      <h1>Sampler</h1>
    </div>

    <button
      class:error={audioState === 'error'}
      class="audio-status"
      type="button"
      onclick={unlockAudio}
    >
      {#if audioState === 'error'}
        <VolumeX size={18} strokeWidth={2.25} />
        <span>Audio unavailable</span>
      {:else}
        <Volume2 size={18} strokeWidth={2.25} />
        <span>{audioState === 'ready' ? 'Audio ready' : 'Start audio'}</span>
      {/if}
    </button>
  </header>

  <section class="pad-grid" aria-label="Sampler pads">
    {#each starterKit as sound, index (sound.id)}
      <button
        class:active={activePads.has(sound.id)}
        class="pad"
        type="button"
        aria-label={`Pad ${index + 1}: ${sound.label}`}
        aria-pressed={activePads.has(sound.id)}
        style={`--pad-color: ${sound.color}; --pad-text: ${sound.textColor}`}
        onpointerdown={(event) => handlePointerDown(event, sound)}
        onpointerup={handlePointerEnd}
        onpointercancel={handlePointerEnd}
        onlostpointercapture={handlePointerEnd}
      >
        <span class="pad-number">{String(index + 1).padStart(2, '0')}</span>
        <span class="pad-label">{sound.label}</span>
      </button>
    {/each}
  </section>

  <footer>
    <span>Starter kit</span>
    <span>12 sounds</span>
  </footer>
</main>
