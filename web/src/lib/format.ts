/**
 * Shared number formatting so every screen rounds the same way. Headlines round; detail lines keep
 * one decimal. Model outputs are never shown with more precision than one decimal of a year.
 */

const MINUS = '−';

export function formatYears(n: number, decimals = 1): string {
  return `${n.toFixed(decimals).replace('-', MINUS)} ${Math.abs(n) === 1 && decimals === 0 ? 'year' : 'years'}`;
}

/** "+5.6" / "−0.4" — a sign is always shown so direction never depends on color. */
export function formatSigned(n: number, decimals = 1): string {
  const v = n.toFixed(decimals);
  if (Number(v) === 0) return (0).toFixed(decimals);
  return n > 0 ? `+${v}` : v.replace('-', MINUS);
}

export function formatBand(n: number): string {
  return `±${n.toFixed(1)} years`;
}

/** "Sep 12", or "today" / "yesterday" when that's more useful. */
export function formatDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
