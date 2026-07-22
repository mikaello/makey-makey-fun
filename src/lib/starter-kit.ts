export type StarterSound = {
  id: string;
  label: string;
  color: string;
  textColor: '#151718' | '#ffffff';
  duration: number;
  waveform: 'sine' | 'triangle' | 'square' | 'noise' | 'metal';
  frequencyStart: number;
  frequencyEnd: number;
  noiseMix: number;
  decay: number;
};

export const starterKit: StarterSound[] = [
  {
    id: 'kick',
    label: 'Kick',
    color: '#ef5b3f',
    textColor: '#151718',
    duration: 0.55,
    waveform: 'sine',
    frequencyStart: 150,
    frequencyEnd: 44,
    noiseMix: 0.03,
    decay: 7,
  },
  {
    id: 'snare',
    label: 'Snare',
    color: '#f4a63a',
    textColor: '#151718',
    duration: 0.32,
    waveform: 'triangle',
    frequencyStart: 210,
    frequencyEnd: 135,
    noiseMix: 0.82,
    decay: 9,
  },
  {
    id: 'closed-hat',
    label: 'Closed hat',
    color: '#f0d34f',
    textColor: '#151718',
    duration: 0.12,
    waveform: 'metal',
    frequencyStart: 5400,
    frequencyEnd: 3900,
    noiseMix: 0.64,
    decay: 20,
  },
  {
    id: 'open-hat',
    label: 'Open hat',
    color: '#70bd5b',
    textColor: '#151718',
    duration: 0.55,
    waveform: 'metal',
    frequencyStart: 4900,
    frequencyEnd: 3200,
    noiseMix: 0.7,
    decay: 7,
  },
  {
    id: 'clap',
    label: 'Clap',
    color: '#28a88c',
    textColor: '#151718',
    duration: 0.3,
    waveform: 'noise',
    frequencyStart: 1100,
    frequencyEnd: 700,
    noiseMix: 1,
    decay: 8,
  },
  {
    id: 'rim',
    label: 'Rim',
    color: '#32a6c7',
    textColor: '#151718',
    duration: 0.16,
    waveform: 'square',
    frequencyStart: 720,
    frequencyEnd: 510,
    noiseMix: 0.16,
    decay: 18,
  },
  {
    id: 'high-tom',
    label: 'High tom',
    color: '#4c7ee8',
    textColor: '#ffffff',
    duration: 0.45,
    waveform: 'sine',
    frequencyStart: 260,
    frequencyEnd: 145,
    noiseMix: 0.04,
    decay: 6,
  },
  {
    id: 'low-tom',
    label: 'Low tom',
    color: '#745ed6',
    textColor: '#ffffff',
    duration: 0.52,
    waveform: 'sine',
    frequencyStart: 175,
    frequencyEnd: 86,
    noiseMix: 0.05,
    decay: 6,
  },
  {
    id: 'cowbell',
    label: 'Cowbell',
    color: '#a760c8',
    textColor: '#ffffff',
    duration: 0.3,
    waveform: 'metal',
    frequencyStart: 820,
    frequencyEnd: 540,
    noiseMix: 0.08,
    decay: 10,
  },
  {
    id: 'shaker',
    label: 'Shaker',
    color: '#d45c9f',
    textColor: '#151718',
    duration: 0.24,
    waveform: 'noise',
    frequencyStart: 5800,
    frequencyEnd: 4200,
    noiseMix: 1,
    decay: 10,
  },
  {
    id: 'chime',
    label: 'Chime',
    color: '#dd6572',
    textColor: '#151718',
    duration: 0.9,
    waveform: 'triangle',
    frequencyStart: 880,
    frequencyEnd: 660,
    noiseMix: 0,
    decay: 4,
  },
  {
    id: 'zap',
    label: 'Zap',
    color: '#ea7550',
    textColor: '#151718',
    duration: 0.38,
    waveform: 'square',
    frequencyStart: 1250,
    frequencyEnd: 95,
    noiseMix: 0.05,
    decay: 5,
  },
];

export function createStarterBuffer(
  context: AudioContext,
  sound: StarterSound,
): AudioBuffer {
  const frameCount = Math.ceil(context.sampleRate * sound.duration);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  const random = seededRandom(sound.id);
  let phase = 0;
  let previousNoise = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const progress = frame / frameCount;
    const frequency =
      sound.frequencyStart *
      Math.pow(sound.frequencyEnd / sound.frequencyStart, progress);
    phase += (Math.PI * 2 * frequency) / context.sampleRate;
    const rawNoise = random() * 2 - 1;
    const brightNoise = rawNoise - previousNoise * 0.72;
    previousNoise = rawNoise;
    const oscillator = waveformValue(sound.waveform, phase, brightNoise);
    const clapPulse = sound.id === 'clap' ? clapEnvelope(progress) : 1;
    const attack = Math.min(1, frame / Math.max(1, context.sampleRate * 0.003));
    const envelope = attack * Math.exp(-sound.decay * progress) * clapPulse;
    const value =
      oscillator * (1 - sound.noiseMix) + brightNoise * sound.noiseMix;
    channel[frame] = Math.max(-1, Math.min(1, value * envelope * 0.82));
  }

  return buffer;
}

function waveformValue(
  waveform: StarterSound['waveform'],
  phase: number,
  noise: number,
): number {
  switch (waveform) {
    case 'triangle':
      return (2 / Math.PI) * Math.asin(Math.sin(phase));
    case 'square':
      return Math.sin(phase) >= 0 ? 0.68 : -0.68;
    case 'noise':
      return noise;
    case 'metal':
      return (
        (Math.sin(phase) + Math.sin(phase * 1.43) + Math.sin(phase * 1.91)) / 3
      );
    default:
      return Math.sin(phase);
  }
}

function clapEnvelope(progress: number): number {
  const pulse = progress < 0.34 ? progress % 0.11 : progress - 0.34;
  return Math.exp(-32 * pulse);
}

function seededRandom(seed: string): () => number {
  let state = [...seed].reduce(
    (value, character) => value * 31 + character.charCodeAt(0),
    2166136261,
  );
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}
