import { describe, expect, it } from 'vitest';

import { isLanguagePreference, resolveLocale, translate } from './i18n';

describe('resolveLocale', () => {
  it('uses Norwegian for Norwegian system locales', () => {
    expect(resolveLocale('system', ['nn-NO', 'en-US'])).toBe('nb');
    expect(resolveLocale('system', ['no'])).toBe('nb');
  });

  it('falls back to English and honors explicit choices', () => {
    expect(resolveLocale('system', ['de-DE'])).toBe('en');
    expect(resolveLocale('en', ['nb-NO'])).toBe('en');
    expect(resolveLocale('nb', ['en-US'])).toBe('nb');
  });
});

it('validates stored language preferences', () => {
  expect(isLanguagePreference('system')).toBe(true);
  expect(isLanguagePreference('nb')).toBe(true);
  expect(isLanguagePreference('fr')).toBe(false);
});

it('translates and interpolates messages', () => {
  expect(translate('nb', 'pad.label', { number: 2, name: 'Skarptromme' })).toBe(
    'Pad 2: Skarptromme',
  );
});
