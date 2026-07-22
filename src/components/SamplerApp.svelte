<script lang="ts">
  import {
    Activity,
    MousePointer2,
    PlugZap,
    Volume2,
    VolumeX,
    X,
  } from '@lucide/svelte';
  import { onDestroy, onMount } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';

  import { AudioEngine, type AudioEngineState } from '../lib/audio-engine';
  import {
    bindingForCode,
    keyboardBindings,
    normalizeMakeyKey,
    type MakeyKeyboardCode,
  } from '../lib/input';
  import { starterKit, type StarterSound } from '../lib/starter-kit';

  type ActivePointer = { padId: string; sourceId: string };

  const audio = new AudioEngine();
  const pointerPads = new SvelteMap<number, ActivePointer>();
  const activePadSources = new SvelteMap<string, SvelteSet<string>>();
  const activePads = new SvelteSet<string>();
  const activeInputs = new SvelteSet<MakeyKeyboardCode>();

  let audioState: AudioEngineState = 'locked';
  let clientReady = false;
  let devicePanelOpen = false;
  let mouseBindingEnabled = false;
  let lastInput = 'Waiting for input';

  onMount(() => (clientReady = true));
  onDestroy(() => audio.close());

  async function playSound(sound: StarterSound): Promise<void> {
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

    const isMappedMouse =
      mouseBindingEnabled &&
      event.pointerType === 'mouse' &&
      event.button === 0;
    const targetSound = isMappedMouse ? starterKit[11] : sound;
    if (!targetSound) return;

    const sourceId = `pointer:${event.pointerId}`;
    pointerPads.set(event.pointerId, { padId: targetSound.id, sourceId });
    setPadActive(targetSound.id, sourceId, true);
    if (isMappedMouse) lastInput = 'Primary click';
    void playSound(targetSound);
  }

  function handlePointerEnd(event: PointerEvent): void {
    const activePointer = pointerPads.get(event.pointerId);
    if (!activePointer) return;
    pointerPads.delete(event.pointerId);
    setPadActive(activePointer.padId, activePointer.sourceId, false);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && devicePanelOpen) {
      devicePanelOpen = false;
      return;
    }
    if (isEditableTarget(event.target)) return;

    const code = normalizeMakeyKey(event);
    if (!code) return;
    event.preventDefault();

    const bindingIndex = keyboardBindings.findIndex(
      (binding) => binding.code === code,
    );
    const sound = starterKit[bindingIndex];
    const binding = bindingForCode(code);
    if (!sound || !binding) return;

    activeInputs.add(code);
    lastInput = binding.label;
    setPadActive(sound.id, `key:${code}`, true);
    void playSound(sound);
  }

  function handleKeyUp(event: KeyboardEvent): void {
    const code = normalizeMakeyKey({ code: event.code, key: event.key });
    if (!code) return;

    const bindingIndex = keyboardBindings.findIndex(
      (binding) => binding.code === code,
    );
    const sound = starterKit[bindingIndex];
    activeInputs.delete(code);
    if (sound) setPadActive(sound.id, `key:${code}`, false);
  }

  function handleWindowBlur(): void {
    for (const code of activeInputs) {
      const bindingIndex = keyboardBindings.findIndex(
        (binding) => binding.code === code,
      );
      const sound = starterKit[bindingIndex];
      if (sound) setPadActive(sound.id, `key:${code}`, false);
    }
    activeInputs.clear();
  }

  async function unlockAudio(): Promise<void> {
    try {
      await audio.unlock();
      audioState = 'ready';
    } catch {
      audioState = 'error';
    }
  }

  function setPadActive(
    padId: string,
    sourceId: string,
    active: boolean,
  ): void {
    let sources = activePadSources.get(padId);
    if (!sources && active) {
      sources = new SvelteSet<string>();
      activePadSources.set(padId, sources);
    }
    if (!sources) return;

    if (active) sources.add(sourceId);
    else sources.delete(sourceId);
    if (sources.size > 0) activePads.add(padId);
    else {
      activePadSources.delete(padId);
      activePads.delete(padId);
    }
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    );
  }
</script>

<svelte:window
  onkeydown={handleKeyDown}
  onkeyup={handleKeyUp}
  onblur={handleWindowBlur}
/>

<svelte:head>
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
</svelte:head>

<main class="app-shell" data-client-ready={clientReady}>
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
        <span class="pad-meta">
          <span class="pad-number">{String(index + 1).padStart(2, '0')}</span>
          <span class="pad-binding">
            {index < keyboardBindings.length
              ? keyboardBindings[index]?.display
              : 'Click'}
          </span>
        </span>
        <span class="pad-label">{sound.label}</span>
      </button>
    {/each}
  </section>

  <footer>
    <span>Starter kit / 12 sounds</span>
    <button
      class="tool-button"
      type="button"
      onclick={() => (devicePanelOpen = true)}
    >
      <PlugZap size={18} strokeWidth={2.25} />
      <span>Test Makey Makey</span>
    </button>
  </footer>
</main>

{#if devicePanelOpen}
  <div class="dialog-layer">
    <button
      class="dialog-backdrop"
      type="button"
      aria-label="Close Makey Makey test"
      onclick={() => (devicePanelOpen = false)}
    ></button>
    <section
      class="device-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="device-title"
    >
      <header class="panel-header">
        <div>
          <p class="eyebrow">Input monitor</p>
          <h2 id="device-title">Makey Makey test</h2>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="Close"
          onclick={() => (devicePanelOpen = false)}
        >
          <X size={22} />
        </button>
      </header>

      <div class="input-status" aria-live="polite">
        <Activity size={20} />
        <span>{lastInput}</span>
      </div>

      <div class="key-grid" aria-label="Keyboard inputs">
        {#each keyboardBindings as binding (binding.code)}
          <kbd class:active={activeInputs.has(binding.code)}
            >{binding.display}</kbd
          >
        {/each}
      </div>

      <label class="toggle-row" for="mouse-binding">
        <span class="toggle-label">
          <MousePointer2 size={20} />
          <span>
            <strong>Primary click</strong>
            <small>Triggers pad 12</small>
          </span>
        </span>
        <input
          id="mouse-binding"
          type="checkbox"
          bind:checked={mouseBindingEnabled}
        />
      </label>
    </section>
  </div>
{/if}
