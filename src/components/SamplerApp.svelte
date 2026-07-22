<script lang="ts">
  import {
    Activity,
    Download,
    FileAudio,
    FolderOpen,
    Library,
    LoaderCircle,
    Mic,
    MousePointer2,
    Play,
    PlugZap,
    RefreshCw,
    RotateCcw,
    Square,
    Upload,
    Volume2,
    VolumeX,
    Check,
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
  import {
    exportPortableProject,
    importPortableProject,
    PortableProjectError,
  } from '../lib/portable-project';
  import {
    MicrophoneRecorder,
    microphoneErrorMessage,
    type RecordingResult,
  } from '../lib/microphone-recorder';
  import {
    assignSampleToPad,
    createDefaultProject,
    resetProjectToStarterKit,
    type Pad,
    type ProjectV1,
    type SampleRecord,
  } from '../lib/project';
  import {
    loadWorkspace,
    replaceWorkspace,
    resetWorkspace,
    saveSampleAssignment,
  } from '../lib/storage';

  type ActivePointer = { padId: string; sourceId: string };
  type OpenPanel = 'device' | 'record' | 'sounds' | null;
  type RecordingState =
    'idle' | 'requesting' | 'recording' | 'preview' | 'saving';

  const MAX_SAMPLE_BYTES = 25 * 1024 * 1024;
  const audio = new AudioEngine();
  const pointerPads = new SvelteMap<number, ActivePointer>();
  const activePadSources = new SvelteMap<string, SvelteSet<string>>();
  const activePads = new SvelteSet<string>();
  const activeInputs = new SvelteSet<MakeyKeyboardCode>();
  const samples = new SvelteMap<string, SampleRecord>();

  let project: ProjectV1 = createDefaultProject();
  let selectedPadId = project.pads[0]?.id ?? '';
  let audioState: AudioEngineState = 'locked';
  let clientReady = false;
  let storageReady = false;
  let openPanel: OpenPanel = null;
  let mouseBindingEnabled = false;
  let uploadBusy = false;
  let portabilityBusy = false;
  let recordingState: RecordingState = 'idle';
  let recordingSession: MicrophoneRecorder | null = null;
  let pendingRecording: (RecordingResult & { id: string }) | null = null;
  let recordingElapsed = 0;
  let recordingTimer: ReturnType<typeof setInterval> | null = null;
  let recordingError = '';
  let lastInput = 'Waiting for input';
  let errorMessage = '';

  onMount(() => {
    clientReady = true;
    void restoreWorkspace();
  });
  onDestroy(() => {
    cancelRecording();
    audio.close();
  });

  async function restoreWorkspace(): Promise<void> {
    try {
      const workspace = await loadWorkspace();
      project = workspace.project;
      selectedPadId = project.pads[0]?.id ?? '';
      samples.clear();
      for (const sample of workspace.samples) samples.set(sample.id, sample);
    } catch (error) {
      showError(
        error,
        'Local storage is unavailable. Changes will not be saved.',
      );
    } finally {
      storageReady = true;
    }
  }

  async function playPad(pad: Pad): Promise<void> {
    if (!pad.sampleId) return;
    try {
      const customSample = samples.get(pad.sampleId);
      if (customSample && !audio.hasSample(customSample.id)) {
        await audio.decodeSample(customSample.id, customSample.blob);
      }
      await audio.trigger(pad.sampleId);
      audioState = 'ready';
    } catch (error) {
      audioState = 'error';
      showError(error, `Could not play ${pad.label}.`);
    }
  }

  function handlePointerDown(event: PointerEvent, pad: Pad): void {
    event.preventDefault();
    const button = event.currentTarget as HTMLButtonElement;
    if (event.isTrusted) button.setPointerCapture(event.pointerId);

    const isMappedMouse =
      mouseBindingEnabled &&
      event.pointerType === 'mouse' &&
      event.button === 0;
    const targetPad = isMappedMouse ? project.pads[11] : pad;
    if (!targetPad) return;

    const sourceId = `pointer:${event.pointerId}`;
    pointerPads.set(event.pointerId, { padId: targetPad.id, sourceId });
    setPadActive(targetPad.id, sourceId, true);
    if (isMappedMouse) lastInput = 'Primary click';
    void playPad(targetPad);
  }

  function handlePointerEnd(event: PointerEvent): void {
    const activePointer = pointerPads.get(event.pointerId);
    if (!activePointer) return;
    pointerPads.delete(event.pointerId);
    setPadActive(activePointer.padId, activePointer.sourceId, false);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && openPanel) {
      closePanel();
      return;
    }
    if (isEditableTarget(event.target)) return;

    const code = normalizeMakeyKey(event);
    if (!code) return;
    event.preventDefault();

    const pad = project.pads.find(
      (candidate) =>
        candidate.binding.type === 'keyboard' &&
        candidate.binding.code === code,
    );
    const binding = bindingForCode(code);
    if (!pad || !binding) return;

    activeInputs.add(code);
    lastInput = binding.label;
    setPadActive(pad.id, `key:${code}`, true);
    void playPad(pad);
  }

  function handleKeyUp(event: KeyboardEvent): void {
    const code = normalizeMakeyKey({ code: event.code, key: event.key });
    if (!code) return;
    const pad = project.pads.find(
      (candidate) =>
        candidate.binding.type === 'keyboard' &&
        candidate.binding.code === code,
    );
    activeInputs.delete(code);
    if (pad) setPadActive(pad.id, `key:${code}`, false);
  }

  function handleWindowBlur(): void {
    for (const code of activeInputs) {
      const pad = project.pads.find(
        (candidate) =>
          candidate.binding.type === 'keyboard' &&
          candidate.binding.code === code,
      );
      if (pad) setPadActive(pad.id, `key:${code}`, false);
    }
    activeInputs.clear();
  }

  async function handleUpload(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_SAMPLE_BYTES) {
      errorMessage = 'Audio files must be 25 MB or smaller.';
      return;
    }

    const pad = project.pads.find(
      (candidate) => candidate.id === selectedPadId,
    );
    if (!pad) return;
    uploadBusy = true;
    const sampleId = crypto.randomUUID();

    try {
      const audioBlob = new Blob([await file.arrayBuffer()], {
        type: file.type || 'application/octet-stream',
      });
      const sample: SampleRecord = {
        id: sampleId,
        projectId: project.id,
        name: sampleNameFromFile(file.name),
        blob: audioBlob,
        mimeType: file.type || 'application/octet-stream',
        duration: 0,
        createdAt: new Date().toISOString(),
      };
      const updatedProject = assignSampleToPad(project, pad.id, sample);
      await saveSampleAssignment(updatedProject, sample);
      samples.set(sample.id, sample);
      project = updatedProject;
    } catch (error) {
      audio.removeSample(sampleId);
      showError(error, 'This audio file could not be decoded or saved.');
    } finally {
      uploadBusy = false;
    }
  }

  async function resetStarterKit(): Promise<void> {
    const resetProject = resetProjectToStarterKit(project);
    try {
      await resetWorkspace(resetProject);
      for (const sampleId of samples.keys()) audio.removeSample(sampleId);
      samples.clear();
      project = resetProject;
      selectedPadId = project.pads[0]?.id ?? '';
    } catch (error) {
      showError(error, 'The starter kit could not be restored.');
    }
  }

  async function downloadProject(): Promise<void> {
    portabilityBusy = true;
    try {
      const contents = await exportPortableProject(project, [
        ...samples.values(),
      ]);
      const url = URL.createObjectURL(
        new Blob([contents], { type: 'application/json' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFilename(project.name)}.makey-sampler.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      showError(error, 'The project could not be exported.');
    } finally {
      portabilityBusy = false;
    }
  }

  async function handleProjectImport(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    portabilityBusy = true;
    try {
      const imported = await importPortableProject(file);
      await replaceWorkspace(imported.project, imported.samples);
      for (const sampleId of samples.keys()) audio.removeSample(sampleId);
      samples.clear();
      for (const sample of imported.samples) samples.set(sample.id, sample);
      project = imported.project;
      selectedPadId = project.pads[0]?.id ?? '';
      closePanel();
    } catch (error) {
      errorMessage =
        error instanceof PortableProjectError
          ? error.message
          : 'The project could not be imported.';
    } finally {
      portabilityBusy = false;
    }
  }

  async function unlockAudio(): Promise<void> {
    try {
      await audio.unlock();
      audioState = 'ready';
    } catch (error) {
      audioState = 'error';
      showError(error, 'Audio is unavailable in this browser.');
    }
  }

  async function startRecording(): Promise<void> {
    clearPendingRecording();
    recordingError = '';
    recordingState = 'requesting';
    recordingElapsed = 0;

    try {
      recordingSession = await MicrophoneRecorder.create();
      recordingSession.start();
      recordingState = 'recording';
      const startedAt = Date.now();
      recordingTimer = setInterval(() => {
        recordingElapsed = (Date.now() - startedAt) / 1000;
      }, 100);
    } catch (error) {
      recordingSession = null;
      recordingState = 'idle';
      recordingError = microphoneErrorMessage(error);
    }
  }

  async function stopRecording(): Promise<void> {
    if (!recordingSession || recordingState !== 'recording') return;
    stopRecordingTimer();

    try {
      const result = await recordingSession.stop();
      pendingRecording = { ...result, id: crypto.randomUUID() };
      recordingElapsed = result.duration;
      recordingState = 'preview';
    } catch (error) {
      recordingState = 'idle';
      recordingError = microphoneErrorMessage(error);
    } finally {
      recordingSession = null;
    }
  }

  async function previewRecording(): Promise<void> {
    if (!pendingRecording) return;
    try {
      if (!audio.hasSample(pendingRecording.id)) {
        await audio.decodeSample(pendingRecording.id, pendingRecording.blob);
      }
      await audio.trigger(pendingRecording.id);
      audioState = 'ready';
    } catch (error) {
      showError(error, 'This recording could not be previewed.');
    }
  }

  async function acceptRecording(): Promise<void> {
    const pad = project.pads.find(
      (candidate) => candidate.id === selectedPadId,
    );
    if (!pad || !pendingRecording) return;
    recordingState = 'saving';

    const sample: SampleRecord = {
      id: pendingRecording.id,
      projectId: project.id,
      name: nextRecordingName(),
      blob: pendingRecording.blob,
      mimeType: pendingRecording.mimeType,
      duration: pendingRecording.duration,
      createdAt: new Date().toISOString(),
    };

    try {
      const updatedProject = assignSampleToPad(project, pad.id, sample);
      await saveSampleAssignment(updatedProject, sample);
      samples.set(sample.id, sample);
      project = updatedProject;
      pendingRecording = null;
      recordingState = 'idle';
      closePanel();
    } catch (error) {
      recordingState = 'preview';
      showError(error, 'This recording could not be saved.');
    }
  }

  function retryRecording(): void {
    clearPendingRecording();
    void startRecording();
  }

  function cancelRecording(): void {
    recordingSession?.cancel();
    recordingSession = null;
    stopRecordingTimer();
    clearPendingRecording();
    recordingElapsed = 0;
    recordingError = '';
    recordingState = 'idle';
  }

  function closePanel(): void {
    if (openPanel === 'record') cancelRecording();
    openPanel = null;
  }

  function clearPendingRecording(): void {
    if (pendingRecording) audio.removeSample(pendingRecording.id);
    pendingRecording = null;
  }

  function stopRecordingTimer(): void {
    if (recordingTimer) clearInterval(recordingTimer);
    recordingTimer = null;
  }

  function nextRecordingName(): string {
    const count = [...samples.values()].filter((sample) =>
      sample.name.startsWith('Recording '),
    ).length;
    return `Recording ${String(count + 1).padStart(2, '0')}`;
  }

  function formattedRecordingTime(seconds: number): string {
    const wholeSeconds = Math.floor(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    return `${minutes}:${String(wholeSeconds % 60).padStart(2, '0')}`;
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

  function padBindingLabel(pad: Pad): string {
    if (pad.binding.type === 'mouse-primary') return 'Click';
    return (
      keyboardBindings.find((binding) => binding.code === pad.binding.code)
        ?.display ?? ''
    );
  }

  function padTextColor(color: string): '#151718' | '#ffffff' {
    const value = color.replace('#', '');
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return red * 0.299 + green * 0.587 + blue * 0.114 > 145
      ? '#151718'
      : '#ffffff';
  }

  function sampleNameFromFile(filename: string): string {
    return (
      filename
        .replace(/\.[^/.]+$/, '')
        .trim()
        .slice(0, 48) || 'Custom sound'
    );
  }

  function safeFilename(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'makey-sampler'
    );
  }

  function showError(error: unknown, fallback: string): void {
    errorMessage =
      error instanceof Error && error.name === 'QuotaExceededError'
        ? 'Device storage is full.'
        : fallback;
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

<main
  class="app-shell"
  data-client-ready={clientReady}
  data-storage-ready={storageReady}
>
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
    {#each project.pads as pad, index (pad.id)}
      <button
        class:active={activePads.has(pad.id)}
        class="pad"
        type="button"
        aria-label={`Pad ${index + 1}: ${pad.label}`}
        aria-pressed={activePads.has(pad.id)}
        style={`--pad-color: ${pad.color}; --pad-text: ${padTextColor(pad.color)}`}
        onpointerdown={(event) => handlePointerDown(event, pad)}
        onpointerup={handlePointerEnd}
        onpointercancel={handlePointerEnd}
        onlostpointercapture={handlePointerEnd}
      >
        <span class="pad-meta">
          <span class="pad-number">{String(index + 1).padStart(2, '0')}</span>
          <span class="pad-binding">{padBindingLabel(pad)}</span>
        </span>
        <span class="pad-label">{pad.label}</span>
      </button>
    {/each}
  </section>

  <footer>
    <span class="project-name">{project.name}</span>
    <span class="footer-actions">
      <button
        class="tool-button"
        type="button"
        onclick={() => (openPanel = 'record')}
      >
        <Mic size={18} strokeWidth={2.25} />
        <span>Record</span>
      </button>
      <button
        class="tool-button"
        type="button"
        onclick={() => (openPanel = 'sounds')}
      >
        <Library size={18} strokeWidth={2.25} />
        <span>Sounds</span>
      </button>
      <button
        class="tool-button"
        type="button"
        aria-label="Test Makey Makey"
        onclick={() => (openPanel = 'device')}
      >
        <PlugZap size={18} strokeWidth={2.25} />
        <span>Makey</span>
      </button>
    </span>
  </footer>
</main>

{#if errorMessage}
  <aside class="error-toast" role="alert">
    <span>{errorMessage}</span>
    <button
      class="icon-button"
      type="button"
      aria-label="Dismiss error"
      onclick={() => (errorMessage = '')}
    >
      <X size={20} />
    </button>
  </aside>
{/if}

{#if openPanel}
  <div class="dialog-layer">
    <button
      class="dialog-backdrop"
      type="button"
      aria-label="Close panel"
      onclick={closePanel}
    ></button>

    {#if openPanel === 'sounds'}
      <section
        class="device-panel sound-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sounds-title"
      >
        <header class="panel-header">
          <div>
            <p class="eyebrow">Local library</p>
            <h2 id="sounds-title">Sounds</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="Close"
            onclick={closePanel}
          >
            <X size={22} />
          </button>
        </header>

        <div class="sound-pad-picker" aria-label="Choose a pad">
          {#each project.pads as pad, index (pad.id)}
            <button
              class:selected={selectedPadId === pad.id}
              type="button"
              aria-label={`Select pad ${index + 1}`}
              aria-pressed={selectedPadId === pad.id}
              style={`--picker-color: ${pad.color}`}
              onclick={() => (selectedPadId = pad.id)}
            >
              {String(index + 1).padStart(2, '0')}
            </button>
          {/each}
        </div>

        {#if project.pads.find((pad) => pad.id === selectedPadId)}
          <div class="selected-sound">
            <FileAudio size={22} />
            <span>
              <small>Selected pad</small>
              <strong
                >{project.pads.find((pad) => pad.id === selectedPadId)
                  ?.label}</strong
              >
            </span>
          </div>
        {/if}

        <div class="portability-actions" aria-label="Project files">
          <button
            type="button"
            disabled={portabilityBusy}
            onclick={downloadProject}
          >
            <Download size={19} />
            <span>Export project</span>
          </button>
          <label class:busy={portabilityBusy} for="project-import">
            <FolderOpen size={19} />
            <span>Import project</span>
          </label>
          <input
            id="project-import"
            class="visually-hidden"
            type="file"
            accept="application/json,.json"
            disabled={portabilityBusy}
            onchange={handleProjectImport}
          />
        </div>

        <div class="panel-actions">
          <label
            class:busy={uploadBusy}
            class="primary-action"
            for="audio-upload"
          >
            {#if uploadBusy}
              <LoaderCircle class="spin" size={20} />
              <span>Loading</span>
            {:else}
              <Upload size={20} />
              <span>Upload audio</span>
            {/if}
          </label>
          <input
            id="audio-upload"
            class="visually-hidden"
            type="file"
            accept="audio/*"
            disabled={uploadBusy}
            onchange={handleUpload}
          />
          <button
            class="secondary-action"
            type="button"
            onclick={resetStarterKit}
          >
            <RotateCcw size={19} />
            <span>Reset kit</span>
          </button>
        </div>
      </section>
    {:else if openPanel === 'record'}
      <section
        class="device-panel record-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-title"
      >
        <header class="panel-header">
          <div>
            <p class="eyebrow">Microphone</p>
            <h2 id="record-title">Record a sound</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="Close"
            onclick={closePanel}
          >
            <X size={22} />
          </button>
        </header>

        <div class="sound-pad-picker" aria-label="Choose a pad">
          {#each project.pads as pad, index (pad.id)}
            <button
              class:selected={selectedPadId === pad.id}
              type="button"
              aria-label={`Select pad ${index + 1}`}
              aria-pressed={selectedPadId === pad.id}
              disabled={recordingState !== 'idle'}
              style={`--picker-color: ${pad.color}`}
              onclick={() => (selectedPadId = pad.id)}
            >
              {String(index + 1).padStart(2, '0')}
            </button>
          {/each}
        </div>

        <div
          class:recording={recordingState === 'recording'}
          class="recorder-status"
          aria-live="polite"
        >
          <span class="recording-indicator"><Mic size={22} /></span>
          <span>
            <small>
              {recordingState === 'preview'
                ? 'Ready to save'
                : recordingState === 'recording'
                  ? 'Recording'
                  : 'Selected pad'}
            </small>
            <strong>
              {recordingState === 'recording' || recordingState === 'preview'
                ? formattedRecordingTime(recordingElapsed)
                : project.pads.find((pad) => pad.id === selectedPadId)?.label}
            </strong>
          </span>
        </div>

        {#if recordingError}
          <p class="recording-error" role="alert">{recordingError}</p>
        {/if}

        {#if recordingState === 'preview' || recordingState === 'saving'}
          <div class="recording-actions preview-actions">
            <button
              class="secondary-action"
              type="button"
              disabled={recordingState === 'saving'}
              onclick={previewRecording}
            >
              <Play size={19} />
              <span>Preview</span>
            </button>
            <button
              class="primary-action"
              type="button"
              disabled={recordingState === 'saving'}
              onclick={acceptRecording}
            >
              {#if recordingState === 'saving'}
                <LoaderCircle class="spin" size={19} />
              {:else}
                <Check size={19} />
              {/if}
              <span>{recordingState === 'saving' ? 'Saving' : 'Accept'}</span>
            </button>
            <button
              class="secondary-action retry-action"
              type="button"
              disabled={recordingState === 'saving'}
              onclick={retryRecording}
            >
              <RefreshCw size={19} />
              <span>Retry</span>
            </button>
          </div>
        {:else if recordingState === 'recording'}
          <button class="stop-recording" type="button" onclick={stopRecording}>
            <Square size={19} fill="currentColor" />
            <span>Stop recording</span>
          </button>
        {:else}
          <button
            class="start-recording"
            type="button"
            disabled={recordingState === 'requesting'}
            onclick={startRecording}
          >
            {#if recordingState === 'requesting'}
              <LoaderCircle class="spin" size={20} />
              <span>Waiting for permission</span>
            {:else}
              <Mic size={20} />
              <span>Start recording</span>
            {/if}
          </button>
        {/if}
      </section>
    {:else}
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
            onclick={closePanel}
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
            <span
              ><strong>Primary click</strong><small>Triggers pad 12</small
              ></span
            >
          </span>
          <input
            id="mouse-binding"
            type="checkbox"
            bind:checked={mouseBindingEnabled}
          />
        </label>
      </section>
    {/if}
  </div>
{/if}
