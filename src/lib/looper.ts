import type { LoopPattern } from './project';

export type ScheduledStep = { step: number; time: number };

export function stepDuration(bpm: number): number {
  return 60 / clampBpm(bpm) / 4;
}

export function quantizeElapsedToStep(
  elapsedSeconds: number,
  bpm: number,
  totalSteps: number,
): number {
  if (totalSteps <= 0) return 0;
  const step = Math.round(Math.max(0, elapsedSeconds) / stepDuration(bpm));
  return step % totalSteps;
}

export function scheduleWindow(options: {
  bpm: number;
  horizon: number;
  nextStep: number;
  nextStepTime: number;
  totalSteps: number;
}): { scheduled: ScheduledStep[]; nextStep: number; nextStepTime: number } {
  const scheduled: ScheduledStep[] = [];
  let nextStep = options.nextStep;
  let nextStepTime = options.nextStepTime;
  const duration = stepDuration(options.bpm);

  while (nextStepTime <= options.horizon) {
    scheduled.push({ step: nextStep, time: nextStepTime });
    nextStep = (nextStep + 1) % Math.max(1, options.totalSteps);
    nextStepTime += duration;
  }
  return { scheduled, nextStep, nextStepTime };
}

type SchedulerOptions = {
  clock: () => number;
  getPattern: () => LoopPattern;
  onSchedule: (step: number, time: number) => void;
  onStep: (step: number, time: number) => void;
  lookAheadMs?: number;
  scheduleAheadSeconds?: number;
};

export class LookAheadScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private nextStep = 0;
  private nextStepTime = 0;

  constructor(private readonly options: SchedulerOptions) {}

  start(startTime = this.options.clock()): void {
    this.stop();
    this.nextStep = 0;
    this.nextStepTime = startTime;
    this.tick();
    this.intervalId = setInterval(
      () => this.tick(),
      this.options.lookAheadMs ?? 25,
    );
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
  }

  private tick(): void {
    const pattern = this.options.getPattern();
    const window = scheduleWindow({
      bpm: pattern.bpm,
      horizon:
        this.options.clock() + (this.options.scheduleAheadSeconds ?? 0.1),
      nextStep: this.nextStep,
      nextStepTime: this.nextStepTime,
      totalSteps: pattern.bars * 16,
    });
    this.nextStep = window.nextStep;
    this.nextStepTime = window.nextStepTime;

    for (const scheduled of window.scheduled) {
      this.options.onStep(scheduled.step, scheduled.time);
      this.options.onSchedule(scheduled.step, scheduled.time);
    }
  }
}

function clampBpm(bpm: number): number {
  return Math.min(180, Math.max(60, bpm));
}
