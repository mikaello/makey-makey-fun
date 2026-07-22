export type TrimRange = { start: number; end: number };
export type WaveformRecord = {
  sampleId: string;
  duration: number;
  points: number[];
};

export function normalizeTrim(
  duration: number,
  start: number,
  end: number | null,
): TrimRange {
  const safeDuration = Math.max(0, duration);
  const safeStart = clamp(start, 0, safeDuration);
  const safeEnd = clamp(end ?? safeDuration, safeStart, safeDuration);
  return { start: safeStart, end: safeEnd };
}

export function calculateWaveform(
  channels: Float32Array[],
  pointCount = 64,
): number[] {
  if (pointCount <= 0 || channels.length === 0) return [];
  const sampleCount = channels[0]?.length ?? 0;
  if (sampleCount === 0) return Array.from({ length: pointCount }, () => 0);

  return Array.from({ length: pointCount }, (_, pointIndex) => {
    const start = Math.floor((pointIndex * sampleCount) / pointCount);
    const end = Math.max(
      start + 1,
      Math.floor(((pointIndex + 1) * sampleCount) / pointCount),
    );
    let peak = 0;
    for (const channel of channels) {
      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        peak = Math.max(peak, Math.abs(channel[sampleIndex] ?? 0));
      }
    }
    return peak;
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(
    Math.max(Number.isFinite(value) ? value : minimum, minimum),
    maximum,
  );
}
