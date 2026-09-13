import { describe, expect, it } from 'vitest';

import { parseNumberText, textForValue } from './number-text';

/** Replays keystrokes the way a controlled input sees them: shown text + key -> onChange -> re-render. */
function typeInto(keys: string, initial: number | null = null) {
  let text = textForValue('', initial);
  let value: number | null = initial;
  for (const k of keys) {
    const next = textForValue(text, value) + k;
    text = next;
    value = parseNumberText(next);
  }
  return { shown: textForValue(text, value), value };
}

describe('number-text', () => {
  it('lets a decimal be typed (regression: "5.4" used to become 54)', () => {
    expect(typeInto('5.4')).toEqual({ shown: '5.4', value: 5.4 });
    expect(typeInto('13.1')).toEqual({ shown: '13.1', value: 13.1 });
  });

  it('keeps leading zeros and dots mid-entry (regression: "0.08" used to become 8)', () => {
    expect(typeInto('0.08')).toEqual({ shown: '0.08', value: 0.08 });
  });

  it('shows a number that changed elsewhere (e.g. a unit conversion)', () => {
    expect(textForValue('5.4', 97.3)).toBe('97.3');
    expect(textForValue('5.4', null)).toBe('');
  });

  it('treats blank and non-numbers as missing', () => {
    expect(parseNumberText('')).toBeNull();
    expect(parseNumberText('  ')).toBeNull();
    expect(parseNumberText('abc')).toBeNull();
    expect(parseNumberText(' 44 ')).toBe(44);
  });
});
