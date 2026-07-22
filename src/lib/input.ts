export const keyboardBindings = [
  { code: 'ArrowUp', label: 'Up', display: '↑' },
  { code: 'ArrowDown', label: 'Down', display: '↓' },
  { code: 'ArrowLeft', label: 'Left', display: '←' },
  { code: 'ArrowRight', label: 'Right', display: '→' },
  { code: 'Space', label: 'Space', display: 'Space' },
  { code: 'KeyW', label: 'W', display: 'W' },
  { code: 'KeyA', label: 'A', display: 'A' },
  { code: 'KeyS', label: 'S', display: 'S' },
  { code: 'KeyD', label: 'D', display: 'D' },
  { code: 'KeyF', label: 'F', display: 'F' },
  { code: 'KeyG', label: 'G', display: 'G' },
] as const;

export type MakeyKeyboardCode = (typeof keyboardBindings)[number]['code'];

const supportedCodes = new Set<string>(
  keyboardBindings.map((binding) => binding.code),
);
const keyFallbacks: Record<string, MakeyKeyboardCode> = {
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ' ': 'Space',
  Spacebar: 'Space',
  w: 'KeyW',
  a: 'KeyA',
  s: 'KeyS',
  d: 'KeyD',
  f: 'KeyF',
  g: 'KeyG',
};

export function normalizeMakeyKey(event: {
  code?: string;
  key?: string;
  repeat?: boolean;
}): MakeyKeyboardCode | null {
  if (event.repeat) return null;
  if (event.code && supportedCodes.has(event.code))
    return event.code as MakeyKeyboardCode;

  const fallback =
    keyFallbacks[event.key ?? ''] ??
    keyFallbacks[(event.key ?? '').toLowerCase()];
  return fallback ?? null;
}

export function bindingForCode(code: MakeyKeyboardCode) {
  return keyboardBindings.find((binding) => binding.code === code);
}
