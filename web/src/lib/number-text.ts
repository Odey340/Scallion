/**
 * Text inputs bound to a stored number. Showing `String(value)` back on every keystroke erases a
 * trailing "." ("5." parses to 5), so "5.4" could only ever be typed as "54". Keep the user's own
 * text while it still means the stored number; replace it only when the number changed elsewhere.
 */

export function parseNumberText(text: string): number | null {
  const s = text.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function textForValue(currentText: string, value: number | null | undefined): string {
  const v = value ?? null;
  if (parseNumberText(currentText) === v) return currentText;
  return v === null ? '' : String(v);
}
