<script lang="ts">
  import {
    Activity,
    Check,
    Circle,
    Download,
    Edit3,
    FileAudio,
    FolderOpen,
    Library,
    Languages,
    LoaderCircle,
    Mic,
    MousePointer2,
    Play,
    PlugZap,
    RefreshCw,
    Repeat2,
    RotateCcw,
    Save,
    Square,
    Trash2,
    Upload,
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
  import {
    isLanguagePreference,
    LANGUAGE_STORAGE_KEY,
    resolveLocale,
    translate,
    type LanguagePreference,
    type Locale,
    type TranslationKey,
  } from '../lib/i18n';
  import { LookAheadScheduler, quantizeElapsedToStep } from '../lib/looper';
  import {
    exportPortableProject,
    importPortableProject,
    PortableProjectError,
  } from '../lib/portable-project';
  import {
    MicrophoneRecorder,
    type RecordingResult,
  } from '../lib/microphone-recorder';
  import {
    assignSampleToPad,
    clearPad,
    createDefaultProject,
    resetProjectToStarterKit,
    type Pad,
    type ProjectV1,
    type SampleRecord,
    updateLoopPattern,
    updatePad,
  } from '../lib/project';
  import { normalizeTrim } from '../lib/sample-editing';
  import { starterKit } from '../lib/starter-kit';
  import {
    loadWorkspace,
    loadWaveform,
    replaceWorkspace,
    resetWorkspace,
    saveEditedProject,
    saveProject,
    saveSampleAssignment,
    saveWaveform,
  } from '../lib/storage';

  type ActivePointer = { padId: string; sourceId: string };
  type OpenPanel =
    'device' | 'edit' | 'language' | 'loop' | 'record' | 'sounds' | null;
  type RecordingState =
    'idle' | 'requesting' | 'recording' | 'preview' | 'saving';

  const MAX_SAMPLE_BYTES = 25 * 1024 * 1024;
  const CLICK_FALLBACK_SUPPRESSION_MS = 700;
  const CLICK_ACTIVE_MS = 120;
  const audio = new AudioEngine();
  const pointerPads = new SvelteMap<number, ActivePointer>();
  const touchPads = new SvelteMap<number, ActivePointer>();
  const activePadSources = new SvelteMap<string, SvelteSet<string>>();
  const activePads = new SvelteSet<string>();
  const activeInputs = new SvelteSet<MakeyKeyboardCode>();
  const loopingPads = new SvelteSet<string>();
  const samples = new SvelteMap<string, SampleRecord>();
  const loopStepTimers = new SvelteSet<ReturnType<typeof setTimeout>>();
  const clickActiveTimers = new SvelteSet<ReturnType<typeof setTimeout>>();
  const recentDirectPadGestures = new SvelteMap<string, number>();

  let project: ProjectV1 = createDefaultProject();
  let selectedPadId = project.pads[0]?.id ?? '';
  let audioState: AudioEngineState = 'locked';
  let clientReady = false;
  let storageReady = false;
  let touchEventsSupported = false;
  let openPanel: OpenPanel = null;
  let mouseBindingEnabled = false;
  let uploadBusy = false;
  let portabilityBusy = false;
  let recordingState: RecordingState = 'idle';
  let recordingSession: MicrophoneRecorder | null = null;
  let pendingRecording: (RecordingResult & { id: string }) | null = null;
  let recordingElapsed = 0;
  let recordingLevel = 0;
  let recordingLevelFrame: number | null = null;
  let recordingTimer: ReturnType<typeof setInterval> | null = null;
  let recordingError = '';
  let editBusy = false;
  let editSaving = false;
  let editLabel = '';
  let editGain = 0.9;
  let editPlaybackMode: Pad['playbackMode'] = 'one-shot';
  let editTrimStart = 0;
  let editTrimEnd = 0;
  let editDuration = 0;
  let editWaveform: number[] = [];
  let loopScheduler: LookAheadScheduler | null = null;
  let loopPlaying = false;
  let loopStarting = false;
  let loopRecording = false;
  let loopMuted = false;
  let loopSaving = false;
  let loopSaveVersion = 0;
  let loopSaveQueue: Promise<void> = Promise.resolve();
  let currentLoopStep = 0;
  let loopStartedAt = 0;
  let languagePreference: LanguagePreference = 'system';
  let locale: Locale = 'en';
  let t = (
    key: TranslationKey,
    values?: Record<string, string | number>,
  ): string => translate(locale, key, values);
  let lastInput: string | null = null;
  let errorMessage = '';

  onMount(() => {
    clientReady = true;
    touchEventsSupported = 'TouchEvent' in window;
    let storedPreference: string | null = null;
    try {
      storedPreference = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      // The system language remains available when browser storage is blocked.
    }
    if (isLanguagePreference(storedPreference)) {
      languagePreference = storedPreference;
    }
    applyLanguage(languagePreference);
    void restoreWorkspace();
  });
  onDestroy(() => {
    cancelRecording();
    stopLooper();
    for (const timer of clickActiveTimers) clearTimeout(timer);
    clickActiveTimers.clear();
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
      showError(error, t('error.storageUnavailable'));
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
      await audio.trigger(pad.sampleId, {
        gain: pad.gain,
        loopId: pad.id,
        playbackMode: pad.playbackMode,
        trimStart: pad.trimStart,
        trimEnd: pad.trimEnd,
      });
      if (audio.isLooping(pad.id)) loopingPads.add(pad.id);
      else loopingPads.delete(pad.id);
      captureLoopEvent(pad.id);
      audioState = 'ready';
    } catch (error) {
      audioState = 'error';
      showError(error, t('error.playPad', { name: displayPadLabel(pad) }));
    }
  }

  function handlePointerDown(event: PointerEvent, pad: Pad): void {
    if (event.pointerType === 'touch' && touchEventsSupported) return;

    const isMappedMouse =
      mouseBindingEnabled &&
      event.pointerType === 'mouse' &&
      event.button === 0;
    const targetPad = isMappedMouse ? project.pads[11] : pad;
    if (!targetPad) return;

    event.preventDefault();
    const button = event.currentTarget as HTMLButtonElement;
    if (event.isTrusted && button.setPointerCapture) {
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // The press can still be tracked by pointerup/cancel in browsers
        // that reject capture for this pointer.
      }
    }

    const sourceId = `pointer:${event.pointerId}`;
    pointerPads.set(event.pointerId, { padId: targetPad.id, sourceId });
    pressPad(targetPad, sourceId);
    if (isMappedMouse) lastInput = t('device.primaryClick');
  }

  function handlePointerEnd(event: PointerEvent): void {
    const activePointer = pointerPads.get(event.pointerId);
    if (!activePointer) return;
    pointerPads.delete(event.pointerId);
    setPadActive(activePointer.padId, activePointer.sourceId, false);
  }

  function handleTouchStart(event: TouchEvent, pad: Pad): void {
    event.preventDefault();
    for (const touch of event.changedTouches) {
      const sourceId = `touch:${touch.identifier}`;
      touchPads.set(touch.identifier, { padId: pad.id, sourceId });
      pressPad(pad, sourceId);
    }
  }

  function handleTouchEnd(event: TouchEvent): void {
    for (const touch of event.changedTouches) {
      const activeTouch = touchPads.get(touch.identifier);
      if (!activeTouch) continue;
      touchPads.delete(touch.identifier);
      setPadActive(activeTouch.padId, activeTouch.sourceId, false);
    }
  }

  function handlePadClick(pad: Pad): void {
    if (recentlyHandledDirectPadGesture(pad.id)) return;
    const sourceId = `click:${Date.now()}`;
    pressPad(pad, sourceId);
    const timer = setTimeout(() => {
      setPadActive(pad.id, sourceId, false);
      clickActiveTimers.delete(timer);
    }, CLICK_ACTIVE_MS);
    clickActiveTimers.add(timer);
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
    releasePadSources(pointerPads);
    releasePadSources(touchPads);
  }

  async function handleUpload(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_SAMPLE_BYTES) {
      errorMessage = t('error.audioFileSize');
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
      showError(error, t('error.audioFile'));
    } finally {
      uploadBusy = false;
    }
  }

  async function resetStarterKit(): Promise<void> {
    const resetProject = resetProjectToStarterKit(project);
    try {
      await resetWorkspace(resetProject);
      stopLooper();
      stopAllPadLoops();
      for (const sampleId of samples.keys()) audio.removeSample(sampleId);
      samples.clear();
      project = resetProject;
      selectedPadId = project.pads[0]?.id ?? '';
    } catch (error) {
      showError(error, t('error.reset'));
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
      showError(error, t('error.export'));
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
      stopLooper();
      stopAllPadLoops();
      for (const sampleId of samples.keys()) audio.removeSample(sampleId);
      samples.clear();
      for (const sample of imported.samples) samples.set(sample.id, sample);
      project = imported.project;
      selectedPadId = project.pads[0]?.id ?? '';
      closePanel();
    } catch (error) {
      errorMessage =
        error instanceof PortableProjectError
          ? t(
              error.code === 'too-large'
                ? 'error.importTooLarge'
                : 'error.importInvalid',
            )
          : t('error.import');
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
      showError(error, t('error.audioUnavailable'));
    }
  }

  async function openEditor(): Promise<void> {
    const pad = project.pads.find(
      (candidate) => candidate.id === selectedPadId,
    );
    if (!pad?.sampleId) return;

    editBusy = true;
    editLabel = pad.label;
    editGain = pad.gain;
    editPlaybackMode = pad.playbackMode;
    editWaveform = [];
    openPanel = 'edit';

    try {
      const customSample = samples.get(pad.sampleId);
      if (customSample && !audio.hasSample(customSample.id)) {
        await audio.decodeSample(customSample.id, customSample.blob);
      } else {
        audio.prepare();
      }

      const duration = audio.getSampleDuration(pad.sampleId) ?? 0;
      const cachedWaveform = customSample
        ? await loadWaveform(customSample.id)
        : undefined;
      const waveform =
        cachedWaveform?.duration === duration
          ? cachedWaveform.points
          : (audio.getWaveform(pad.sampleId) ?? []);
      if (customSample && cachedWaveform?.duration !== duration) {
        await saveWaveform({
          sampleId: customSample.id,
          duration,
          points: waveform,
        });
      }

      const trim = normalizeTrim(duration, pad.trimStart, pad.trimEnd);
      editDuration = duration;
      editTrimStart = trim.start;
      editTrimEnd = trim.end;
      editWaveform = waveform;
    } catch (error) {
      showError(error, t('error.editOpen'));
      openPanel = 'sounds';
    } finally {
      editBusy = false;
    }
  }

  function updateTrimStart(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    editTrimStart = Math.min(value, Math.max(0, editTrimEnd - 0.01));
  }

  function updateTrimEnd(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    editTrimEnd = Math.max(value, Math.min(editDuration, editTrimStart + 0.01));
  }

  async function previewEdit(): Promise<void> {
    const pad = project.pads.find(
      (candidate) => candidate.id === selectedPadId,
    );
    if (!pad?.sampleId) return;
    try {
      await audio.trigger(pad.sampleId, {
        gain: editGain,
        playbackMode: 'one-shot',
        trimStart: editTrimStart,
        trimEnd: editTrimEnd,
      });
    } catch (error) {
      showError(error, t('error.editPreview'));
    }
  }

  async function saveEdit(): Promise<void> {
    const label = editLabel.trim();
    if (!label) {
      errorMessage = t('error.emptyName');
      return;
    }
    const trim = normalizeTrim(editDuration, editTrimStart, editTrimEnd);
    const updatedProject = updatePad(project, selectedPadId, {
      label: label.slice(0, 48),
      gain: editGain,
      playbackMode: editPlaybackMode,
      trimStart: trim.start,
      trimEnd: trim.end >= editDuration ? null : trim.end,
    });
    const currentPad = project.pads.find((pad) => pad.id === selectedPadId);
    const customSample = currentPad?.sampleId
      ? samples.get(currentPad.sampleId)
      : undefined;
    const updatedSample = customSample
      ? { ...customSample, name: label.slice(0, 48) }
      : undefined;
    editSaving = true;
    try {
      if (editPlaybackMode === 'one-shot') {
        audio.stopLoop(selectedPadId);
        loopingPads.delete(selectedPadId);
      }
      await saveEditedProject(updatedProject, { updatedSample });
      if (updatedSample) samples.set(updatedSample.id, updatedSample);
      project = updatedProject;
      closePanel();
    } catch (error) {
      showError(error, t('error.editSave'));
    } finally {
      editSaving = false;
    }
  }

  async function clearSelectedPad(): Promise<void> {
    const pad = project.pads.find(
      (candidate) => candidate.id === selectedPadId,
    );
    if (!pad?.sampleId) return;
    const sampleId = pad.sampleId;
    const isCustomSample = samples.has(sampleId);
    const updatedProject = clearPad(project, pad.id);
    editSaving = true;
    try {
      await saveEditedProject(
        updatedProject,
        isCustomSample ? { deletedSampleId: sampleId } : undefined,
      );
      audio.stopLoop(pad.id);
      loopingPads.delete(pad.id);
      if (isCustomSample) {
        audio.removeSample(sampleId);
        samples.delete(sampleId);
      }
      project = updatedProject;
      closePanel();
    } catch (error) {
      showError(error, t('error.clearPad'));
    } finally {
      editSaving = false;
    }
  }

  function waveformBarHeight(value: number): string {
    return `${Math.max(8, value * 100)}%`;
  }

  function formatSeconds(value: number): string {
    return `${value.toFixed(2)}s`;
  }

  async function startLooper(): Promise<void> {
    if (loopPlaying || loopStarting) return;
    loopStarting = true;
    try {
      for (const pad of project.pads) {
        if (!pad.sampleId) continue;
        const customSample = samples.get(pad.sampleId);
        if (customSample && !audio.hasSample(customSample.id)) {
          await audio.decodeSample(customSample.id, customSample.blob);
        }
      }
      await audio.unlock();
      audioState = 'ready';
      loopStartedAt = audio.currentTime + 0.05;
      loopScheduler = new LookAheadScheduler({
        clock: () => audio.currentTime,
        getPattern: () => project.loop,
        onSchedule: scheduleLoopStep,
        onStep: updateVisibleLoopStep,
      });
      loopScheduler.start(loopStartedAt);
      loopPlaying = true;
    } catch (error) {
      audioState = 'error';
      showError(error, t('error.loopStart'));
    } finally {
      loopStarting = false;
    }
  }

  function stopLooper(): void {
    loopScheduler?.stop();
    loopScheduler = null;
    for (const timer of loopStepTimers) clearTimeout(timer);
    loopStepTimers.clear();
    loopPlaying = false;
    loopRecording = false;
    currentLoopStep = 0;
  }

  function scheduleLoopStep(step: number, time: number): void {
    if (loopMuted) return;
    for (const event of project.loop.events) {
      if (event.step !== step) continue;
      const pad = project.pads.find(
        (candidate) => candidate.id === event.padId,
      );
      if (!pad?.sampleId) continue;
      audio.schedule(pad.sampleId, time, {
        gain: pad.gain,
        trimStart: pad.trimStart,
        trimEnd: pad.trimEnd,
      });
    }
  }

  function updateVisibleLoopStep(step: number, time: number): void {
    const delay = Math.max(0, (time - audio.currentTime) * 1000);
    const timer = setTimeout(() => {
      currentLoopStep = step;
      loopStepTimers.delete(timer);
    }, delay);
    loopStepTimers.add(timer);
  }

  function captureLoopEvent(padId: string): void {
    if (!loopPlaying || !loopRecording) return;
    const totalSteps = project.loop.bars * 16;
    const step = quantizeElapsedToStep(
      audio.currentTime - loopStartedAt,
      project.loop.bpm,
      totalSteps,
    );
    if (
      project.loop.events.some(
        (event) => event.padId === padId && event.step === step,
      )
    ) {
      return;
    }
    persistLoop({
      ...project.loop,
      events: [...project.loop.events, { padId, step }],
    });
  }

  async function changeLoopBpm(event: Event): Promise<void> {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    await persistLoop({
      ...project.loop,
      bpm: Math.min(180, Math.max(60, value)),
    });
  }

  async function changeLoopBars(bars: 1 | 2 | 4): Promise<void> {
    const totalSteps = bars * 16;
    await persistLoop({
      ...project.loop,
      bars,
      events: project.loop.events.filter((event) => event.step < totalSteps),
    });
  }

  async function clearLoop(): Promise<void> {
    await persistLoop({ ...project.loop, events: [] });
  }

  async function persistLoop(loop: ProjectV1['loop']): Promise<void> {
    const updatedProject = updateLoopPattern(project, loop);
    project = updatedProject;
    loopSaving = true;
    const version = ++loopSaveVersion;
    const save = loopSaveQueue.then(() => saveProject(updatedProject));
    loopSaveQueue = save.catch(() => undefined);
    try {
      await save;
    } catch (error) {
      showError(error, t('error.loopSave'));
    } finally {
      if (version === loopSaveVersion) loopSaving = false;
    }
  }

  function loopPosition(): string {
    const bar = Math.floor(currentLoopStep / 16) + 1;
    const beat = Math.floor((currentLoopStep % 16) / 4) + 1;
    const sixteenth = (currentLoopStep % 4) + 1;
    return `${bar}.${beat}.${sixteenth}`;
  }

  function stopAllPadLoops(): void {
    for (const padId of loopingPads) audio.stopLoop(padId);
    loopingPads.clear();
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
      startRecordingMeter();
      const startedAt = Date.now();
      recordingTimer = setInterval(() => {
        recordingElapsed = (Date.now() - startedAt) / 1000;
      }, 100);
    } catch (error) {
      recordingSession = null;
      recordingState = 'idle';
      recordingError = localizedMicrophoneError(error);
    }
  }

  async function stopRecording(): Promise<void> {
    if (!recordingSession || recordingState !== 'recording') return;
    stopRecordingTimer();
    stopRecordingMeter();

    try {
      const result = await recordingSession.stop();
      pendingRecording = { ...result, id: crypto.randomUUID() };
      recordingElapsed = result.duration;
      recordingState = 'preview';
    } catch (error) {
      recordingState = 'idle';
      recordingError = localizedMicrophoneError(error);
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
      showError(error, t('error.recordPreview'));
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
      showError(error, t('error.recordSave'));
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
    stopRecordingMeter();
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

  function startRecordingMeter(): void {
    stopRecordingMeter();
    const update = (): void => {
      if (!recordingSession || recordingState !== 'recording') {
        recordingLevelFrame = null;
        return;
      }
      recordingLevel = recordingSession.getInputLevel();
      recordingLevelFrame = requestAnimationFrame(update);
    };
    update();
  }

  function stopRecordingMeter(): void {
    if (recordingLevelFrame !== null) {
      cancelAnimationFrame(recordingLevelFrame);
      recordingLevelFrame = null;
    }
    recordingLevel = 0;
  }

  function nextRecordingName(): string {
    const count = [...samples.values()].filter((sample) =>
      /^(Recording|Opptak) /.test(sample.name),
    ).length;
    return t('record.name', { number: String(count + 1).padStart(2, '0') });
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

  function pressPad(pad: Pad, sourceId: string): void {
    try {
      audio.primeUserGesture();
    } catch (error) {
      audioState = 'error';
      showError(error, t('error.playPad', { name: displayPadLabel(pad) }));
      return;
    }
    recentDirectPadGestures.set(pad.id, performance.now());
    setPadActive(pad.id, sourceId, true);
    void playPad(pad);
  }

  function recentlyHandledDirectPadGesture(padId: string): boolean {
    const lastGestureAt = recentDirectPadGestures.get(padId) ?? 0;
    return performance.now() - lastGestureAt < CLICK_FALLBACK_SUPPRESSION_MS;
  }

  function releasePadSources(sources: SvelteMap<number, ActivePointer>): void {
    for (const source of sources.values()) {
      setPadActive(source.padId, source.sourceId, false);
    }
    sources.clear();
  }

  function padBindingLabel(pad: Pad): string {
    if (pad.binding.type === 'mouse-primary') return t('pad.click');
    return (
      keyboardBindings.find((binding) => binding.code === pad.binding.code)
        ?.display ?? ''
    );
  }

  function padTextColor(color: string): '#111111' | '#ffffff' {
    const value = color.replace('#', '');
    const channels = [0, 2, 4].map((offset) => {
      const channel =
        Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance =
      (channels[0] ?? 0) * 0.2126 +
      (channels[1] ?? 0) * 0.7152 +
      (channels[2] ?? 0) * 0.0722;
    const darkContrast = (luminance + 0.05) / 0.0556;
    const lightContrast = 1.05 / (luminance + 0.05);
    return darkContrast >= lightContrast ? '#111111' : '#ffffff';
  }

  function sampleNameFromFile(filename: string): string {
    return (
      filename
        .replace(/\.[^/.]+$/, '')
        .trim()
        .slice(0, 48) || t('sample.custom')
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
        ? t('error.storageFull')
        : fallback;
  }

  function applyLanguage(preference: LanguagePreference): void {
    languagePreference = preference;
    locale = resolveLocale(preference, navigator.languages);
    t = (key, values) => translate(locale, key, values);
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
    } catch {
      // Language switching still works for the current visit without storage.
    }
  }

  function displayPadLabel(pad: Pad): string {
    if (pad.sampleId === null && pad.label === 'Empty pad') {
      return t('sample.empty');
    }
    const starterSound = starterKit.find((sound) => sound.id === pad.sampleId);
    if (starterSound && starterSound.label === pad.label) {
      return t(`sample.${starterSound.id}` as TranslationKey);
    }
    return pad.label;
  }

  function displayProjectName(): string {
    return project.name === 'My sampler' ? t('project.default') : project.name;
  }

  function displaySelectedPadLabel(): string {
    const pad = project.pads.find(
      (candidate) => candidate.id === selectedPadId,
    );
    return pad ? displayPadLabel(pad) : '';
  }

  function localizedMicrophoneError(error: unknown): string {
    if (!(error instanceof DOMException))
      return t('error.microphoneUnavailable');
    const keyByName: Partial<Record<string, TranslationKey>> = {
      NotAllowedError: 'error.microphoneDenied',
      NotFoundError: 'error.microphoneMissing',
      NotReadableError: 'error.microphoneBusy',
      SecurityError: 'error.microphoneHttps',
    };
    return t(keyByName[error.name] ?? 'error.microphoneUnavailable');
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

<main
  class="app-shell"
  data-client-ready={clientReady}
  data-storage-ready={storageReady}
>
  <header class="topbar">
    <div>
      <p class="eyebrow">Makey Makey</p>
      <h1>{t('sampler')}</h1>
    </div>
  </header>

  <section class="pad-grid" aria-label={t('pads.label')}>
    {#each project.pads as pad, index (pad.id)}
      <button
        class:active={activePads.has(pad.id) || loopingPads.has(pad.id)}
        class="pad"
        type="button"
        aria-label={t('pad.label', {
          number: index + 1,
          name: displayPadLabel(pad),
        })}
        aria-pressed={activePads.has(pad.id) || loopingPads.has(pad.id)}
        style={`--pad-color: ${pad.color}; --pad-text: ${padTextColor(pad.color)}`}
        onpointerdown={(event) => handlePointerDown(event, pad)}
        onpointerup={handlePointerEnd}
        onpointercancel={handlePointerEnd}
        onlostpointercapture={handlePointerEnd}
        ontouchstart={(event) => handleTouchStart(event, pad)}
        ontouchend={handleTouchEnd}
        ontouchcancel={handleTouchEnd}
        onclick={() => handlePadClick(pad)}
      >
        <span class="pad-meta">
          <span class="pad-number">{String(index + 1).padStart(2, '0')}</span>
          <span class="pad-binding">{padBindingLabel(pad)}</span>
        </span>
        <span class="pad-label">{displayPadLabel(pad)}</span>
      </button>
    {/each}
  </section>

  <footer>
    <span class="project-name">{displayProjectName()}</span>
    <span class="footer-actions">
      <button
        class="tool-button record-tool-button"
        type="button"
        aria-label={t('nav.record')}
        title={t('nav.record')}
        onclick={() => (openPanel = 'record')}
      >
        <span class="record-tool-icon">
          <Mic size={16} strokeWidth={2.5} />
        </span>
        <span>{t('nav.record')}</span>
      </button>
      <button
        class:active={loopPlaying}
        class="tool-button"
        type="button"
        aria-label={t('nav.loop.open')}
        title={t('loop.title')}
        onclick={() => (openPanel = 'loop')}
      >
        <Repeat2 size={18} strokeWidth={2.25} />
        <span>{t('nav.loop')}</span>
      </button>
      <button
        class="tool-button"
        type="button"
        aria-label={t('nav.sounds')}
        title={t('nav.sounds')}
        onclick={() => (openPanel = 'sounds')}
      >
        <Library size={18} strokeWidth={2.25} />
        <span>{t('nav.sounds')}</span>
      </button>
      <button
        class="tool-button"
        type="button"
        aria-label={t('nav.makey.open')}
        title={t('device.title')}
        onclick={() => (openPanel = 'device')}
      >
        <PlugZap size={18} strokeWidth={2.25} />
        <span>{t('nav.makey')}</span>
      </button>
      <button
        class="tool-button"
        type="button"
        aria-label={t('nav.language.open')}
        title={t('nav.language')}
        onclick={() => (openPanel = 'language')}
      >
        <Languages size={18} strokeWidth={2.25} />
        <span>{t('nav.language')}</span>
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
      aria-label={t('common.dismissError')}
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
      aria-label={t('common.closePanel')}
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
            <p class="eyebrow">{t('sounds.eyebrow')}</p>
            <h2 id="sounds-title">{t('nav.sounds')}</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label={t('common.close')}
            onclick={closePanel}
          >
            <X size={22} />
          </button>
        </header>

        <div class="sound-pad-picker" aria-label={t('sounds.choosePad')}>
          {#each project.pads as pad, index (pad.id)}
            <button
              class:selected={selectedPadId === pad.id}
              type="button"
              aria-label={t('pad.select', { number: index + 1 })}
              aria-pressed={selectedPadId === pad.id}
              style={`--picker-color: ${pad.color}; --picker-text: ${padTextColor(pad.color)}`}
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
              <small>{t('sounds.selectedPad')}</small>
              <strong>{displaySelectedPadLabel()}</strong>
            </span>
            <button
              class="icon-button"
              type="button"
              aria-label={t('sounds.edit')}
              disabled={!project.pads.find((pad) => pad.id === selectedPadId)
                ?.sampleId}
              onclick={openEditor}
            >
              <Edit3 size={20} />
            </button>
          </div>
        {/if}

        <div class="portability-actions" aria-label={t('sounds.projectFiles')}>
          <button
            type="button"
            disabled={portabilityBusy}
            onclick={downloadProject}
          >
            <Download size={19} />
            <span>{t('sounds.export')}</span>
          </button>
          <label class:busy={portabilityBusy} for="project-import">
            <FolderOpen size={19} />
            <span>{t('sounds.import')}</span>
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
              <span>{t('common.loading')}</span>
            {:else}
              <Upload size={20} />
              <span>{t('sounds.upload')}</span>
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
            <span>{t('sounds.reset')}</span>
          </button>
        </div>
      </section>
    {:else if openPanel === 'loop'}
      <section
        class="device-panel loop-panel"
        data-loop-saving={loopSaving ? 'true' : 'false'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="loop-title"
      >
        <header class="panel-header">
          <div>
            <p class="eyebrow">{t('loop.eyebrow')}</p>
            <h2 id="loop-title">{t('loop.title')}</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label={t('common.close')}
            onclick={closePanel}
          >
            <X size={22} />
          </button>
        </header>

        <div class:playing={loopPlaying} class="loop-status" aria-live="polite">
          <Repeat2 size={21} />
          <span>
            <small
              >{loopRecording
                ? t('loop.overdubbing')
                : loopPlaying
                  ? t('loop.playing')
                  : t('loop.stopped')}</small
            >
            <strong>{loopPosition()}</strong>
          </span>
          <span class="event-count"
            >{project.loop.events.length}
            {project.loop.events.length === 1
              ? t('loop.hit')
              : t('loop.hits')}</span
          >
        </div>

        <div class="loop-pad-grid" aria-label={t('loop.pads')}>
          {#each project.pads as pad, index (pad.id)}
            <button
              type="button"
              aria-label={t('loop.pad', {
                number: index + 1,
                name: displayPadLabel(pad),
              })}
              disabled={!pad.sampleId}
              style={`--loop-pad-color: ${pad.color}; --loop-pad-text: ${padTextColor(pad.color)}`}
              onclick={() => void playPad(pad)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{displayPadLabel(pad)}</strong>
            </button>
          {/each}
        </div>

        <div class="loop-settings">
          <label class="tempo-field" for="loop-bpm">
            <span>BPM</span>
            <input
              id="loop-bpm"
              type="number"
              min="60"
              max="180"
              step="1"
              disabled={loopPlaying}
              value={project.loop.bpm}
              onchange={changeLoopBpm}
            />
          </label>

          <fieldset class="bars-field">
            <legend>{t('loop.bars')}</legend>
            <div class="segmented-control">
              {#each [1, 2, 4] as bars (bars)}
                <button
                  class:active={project.loop.bars === bars}
                  type="button"
                  aria-label={t(bars === 1 ? 'loop.bar' : 'loop.barPlural', {
                    count: bars,
                  })}
                  aria-pressed={project.loop.bars === bars}
                  disabled={loopPlaying}
                  onclick={() => changeLoopBars(bars as 1 | 2 | 4)}
                  >{bars}</button
                >
              {/each}
            </div>
          </fieldset>
        </div>

        <div class="step-strip" role="img" aria-label={t('loop.steps')}>
          {#each Array.from({ length: 16 }, (_, index) => index) as step (step)}
            <span
              class:current={loopPlaying && currentLoopStep % 16 === step}
              class:filled={project.loop.events.some(
                (event) => event.step % 16 === step,
              )}
            ></span>
          {/each}
        </div>

        <div class="loop-transport">
          {#if loopPlaying}
            <button class="transport-stop" type="button" onclick={stopLooper}>
              <Square size={18} fill="currentColor" />
              <span>{t('common.stop')}</span>
            </button>
          {:else}
            <button
              class="transport-start"
              type="button"
              disabled={loopStarting}
              onclick={startLooper}
            >
              {#if loopStarting}
                <LoaderCircle class="spin" size={19} />
              {:else}
                <Play size={19} fill="currentColor" />
              {/if}
              <span
                >{loopStarting ? t('common.starting') : t('common.start')}</span
              >
            </button>
          {/if}
          <button
            class:active={loopRecording}
            class="transport-record"
            type="button"
            aria-pressed={loopRecording}
            disabled={!loopPlaying}
            onclick={() => (loopRecording = !loopRecording)}
          >
            <Circle size={18} fill="currentColor" />
            <span>{t('loop.record')}</span>
          </button>
          <button
            class:active={loopMuted}
            class="transport-mute"
            type="button"
            aria-pressed={loopMuted}
            onclick={() => (loopMuted = !loopMuted)}
          >
            {#if loopMuted}<VolumeX size={19} />{:else}<Volume2
                size={19}
              />{/if}
            <span>{t('loop.mute')}</span>
          </button>
          <button
            class="transport-clear"
            type="button"
            disabled={project.loop.events.length === 0}
            onclick={clearLoop}
          >
            <Trash2 size={19} />
            <span>{t('common.clear')}</span>
          </button>
        </div>
      </section>
    {:else if openPanel === 'edit'}
      <section
        class="device-panel edit-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-title"
      >
        <header class="panel-header">
          <div>
            <p class="eyebrow">{t('edit.eyebrow')}</p>
            <h2 id="edit-title">{t('edit.title')}</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label={t('common.close')}
            onclick={closePanel}
          >
            <X size={22} />
          </button>
        </header>

        {#if editBusy}
          <div class="editor-loading" role="status">
            <LoaderCircle class="spin" size={22} />
            <span>{t('edit.reading')}</span>
          </div>
        {:else}
          <div class="waveform" aria-label={t('edit.waveform')}>
            {#each editWaveform as point, index (index)}
              <span style={`height: ${waveformBarHeight(point)}`}></span>
            {/each}
          </div>

          <label class="editor-field" for="sample-name">
            <span>{t('edit.name')}</span>
            <input
              id="sample-name"
              type="text"
              maxlength="48"
              bind:value={editLabel}
            />
          </label>

          <div class="trim-controls">
            <label class="range-field" for="trim-start">
              <span
                ><strong>{t('edit.trimStart')}</strong><output
                  >{formatSeconds(editTrimStart)}</output
                ></span
              >
              <input
                id="trim-start"
                type="range"
                min="0"
                max={editDuration}
                step="0.01"
                value={editTrimStart}
                oninput={updateTrimStart}
              />
            </label>
            <label class="range-field" for="trim-end">
              <span
                ><strong>{t('edit.trimEnd')}</strong><output
                  >{formatSeconds(editTrimEnd)}</output
                ></span
              >
              <input
                id="trim-end"
                type="range"
                min="0"
                max={editDuration}
                step="0.01"
                value={editTrimEnd}
                oninput={updateTrimEnd}
              />
            </label>
            <label class="range-field" for="sample-gain">
              <span
                ><strong>{t('edit.gain')}</strong><output
                  >{Math.round(editGain * 100)}%</output
                ></span
              >
              <input
                id="sample-gain"
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                bind:value={editGain}
              />
            </label>
          </div>

          <fieldset class="mode-field">
            <legend>{t('edit.playback')}</legend>
            <div class="segmented-control">
              <button
                class:active={editPlaybackMode === 'one-shot'}
                type="button"
                aria-pressed={editPlaybackMode === 'one-shot'}
                onclick={() => (editPlaybackMode = 'one-shot')}
                >{t('edit.oneShot')}</button
              >
              <button
                class:active={editPlaybackMode === 'loop'}
                type="button"
                aria-pressed={editPlaybackMode === 'loop'}
                onclick={() => (editPlaybackMode = 'loop')}
                >{t('edit.loop')}</button
              >
            </div>
          </fieldset>

          <div class="edit-preview-row">
            <button
              class="secondary-action"
              type="button"
              onclick={previewEdit}
            >
              <Play size={19} />
              <span>{t('edit.preview')}</span>
            </button>
          </div>

          <div class="edit-actions">
            <button
              class="danger-action"
              type="button"
              disabled={editSaving}
              onclick={clearSelectedPad}
            >
              <Trash2 size={19} />
              <span>{t('edit.clearPad')}</span>
            </button>
            <button
              class="primary-action"
              type="button"
              disabled={editSaving}
              onclick={saveEdit}
            >
              {#if editSaving}
                <LoaderCircle class="spin" size={19} />
              {:else}
                <Save size={19} />
              {/if}
              <span>{editSaving ? t('common.saving') : t('edit.save')}</span>
            </button>
          </div>
        {/if}
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
            <p class="eyebrow">{t('record.eyebrow')}</p>
            <h2 id="record-title">{t('record.title')}</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label={t('common.close')}
            onclick={closePanel}
          >
            <X size={22} />
          </button>
        </header>

        <div class="sound-pad-picker" aria-label={t('sounds.choosePad')}>
          {#each project.pads as pad, index (pad.id)}
            <button
              class:selected={selectedPadId === pad.id}
              type="button"
              aria-label={t('pad.select', { number: index + 1 })}
              aria-pressed={selectedPadId === pad.id}
              disabled={recordingState !== 'idle'}
              style={`--picker-color: ${pad.color}; --picker-text: ${padTextColor(pad.color)}`}
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
                ? t('record.ready')
                : recordingState === 'recording'
                  ? t('record.recording')
                  : t('record.selectedPad')}
            </small>
            <strong>
              {recordingState === 'recording' || recordingState === 'preview'
                ? formattedRecordingTime(recordingElapsed)
                : displaySelectedPadLabel()}
            </strong>
          </span>
        </div>

        {#if recordingState === 'recording'}
          <div class="input-level">
            <span>{t('record.inputLevel')}</span>
            <div
              class="input-level-track"
              role="progressbar"
              aria-label={t('record.inputLevel')}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(recordingLevel * 100)}
            >
              <span
                class="input-level-fill"
                style={`transform: scaleX(${recordingLevel})`}
              ></span>
            </div>
          </div>
        {/if}

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
              <span>{t('record.preview')}</span>
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
              <span
                >{recordingState === 'saving'
                  ? t('common.saving')
                  : t('record.accept')}</span
              >
            </button>
            <button
              class="secondary-action retry-action"
              type="button"
              disabled={recordingState === 'saving'}
              onclick={retryRecording}
            >
              <RefreshCw size={19} />
              <span>{t('record.retry')}</span>
            </button>
          </div>
        {:else if recordingState === 'recording'}
          <button class="stop-recording" type="button" onclick={stopRecording}>
            <Square size={19} fill="currentColor" />
            <span>{t('record.stop')}</span>
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
              <span>{t('record.waiting')}</span>
            {:else}
              <Mic size={20} />
              <span>{t('record.start')}</span>
            {/if}
          </button>
        {/if}
      </section>
    {:else if openPanel === 'language'}
      <section
        class="device-panel language-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="language-title"
      >
        <header class="panel-header">
          <div>
            <p class="eyebrow">{t('language.eyebrow')}</p>
            <h2 id="language-title">{t('language.title')}</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label={t('common.close')}
            onclick={closePanel}
          >
            <X size={22} />
          </button>
        </header>

        <p class="language-description">{t('language.description')}</p>
        <div
          class="language-options"
          role="group"
          aria-label={t('language.title')}
        >
          {#each [['system', 'language.system'], ['en', 'language.english'], ['nb', 'language.norwegian']] as [preference, key] (preference)}
            <button
              class:active={languagePreference === preference}
              type="button"
              aria-pressed={languagePreference === preference}
              onclick={() => applyLanguage(preference as LanguagePreference)}
            >
              <span>{t(key as TranslationKey)}</span>
              {#if languagePreference === preference}<Check size={19} />{/if}
            </button>
          {/each}
        </div>
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
            <p class="eyebrow">{t('device.eyebrow')}</p>
            <h2 id="device-title">{t('device.title')}</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label={t('common.close')}
            onclick={closePanel}
          >
            <X size={22} />
          </button>
        </header>

        <div class="input-status" aria-live="polite">
          <Activity size={20} />
          <span>{lastInput ?? t('device.waiting')}</span>
        </div>

        <div class:error={audioState === 'error'} class="audio-diagnostic">
          {#if audioState === 'error'}
            <VolumeX size={20} />
          {:else}
            <Volume2 size={20} />
          {/if}
          <span>
            <strong>{t('device.audio')}</strong>
            <small
              >{audioState === 'ready'
                ? t('audio.ready')
                : audioState === 'error'
                  ? t('audio.unavailable')
                  : t('audio.start')}</small
            >
          </span>
          {#if audioState !== 'ready'}
            <button type="button" onclick={unlockAudio}>
              {audioState === 'error' ? t('audio.retry') : t('audio.start')}
            </button>
          {/if}
        </div>

        <div class="key-grid" aria-label={t('device.keyboardInputs')}>
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
              ><strong>{t('device.primaryClick')}</strong><small
                >{t('device.triggersPad')}</small
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
