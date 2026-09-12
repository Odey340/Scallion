import type { Event } from './types';

export type StrengthTier = 'close' | 'active' | 'weak';

export interface ContactStrength {
  contact: string;
  tier: StrengthTier;
  eventCount: number;
  exchangeDays: number;
  daysSinceLast: number;
}

const TWO_WAY_MS = 7 * 24 * 60 * 60 * 1000; // contracts.md §2: two-way exchange = both directions within 7 days
const CLOSE_TIE_EXCHANGE_DAYS = 4; // contracts.md §2: close tie = 4+ exchange days in 30

/**
 * Per-contact tie strength for the Circle dot map. Mirrors api/app/circle/metrics.py's
 * exchange-day definition, but keeps per-contact detail the server's aggregate `Metrics`
 * doesn't expose. Runs entirely client-side over the same anonymized Events already headed
 * to POST /events — no new data leaves the device for this.
 */
export function contactStrengths(events: Event[], now: Date, windowDays = 30): ContactStrength[] {
  const windowStartMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();

  const byContact = new Map<string, Event[]>();
  for (const e of events) {
    const list = byContact.get(e.contact);
    if (list) list.push(e);
    else byContact.set(e.contact, [e]);
  }

  const results: ContactStrength[] = [];
  for (const [contact, rows] of byContact) {
    const inWindow = rows.filter((e) => {
      const t = new Date(e.ts).getTime();
      return t >= windowStartMs && t <= nowMs;
    });
    const ins = inWindow.filter((e) => e.dir === 'in').map((e) => new Date(e.ts).getTime());
    const outs = inWindow.filter((e) => e.dir === 'out').map((e) => new Date(e.ts).getTime());

    const exchangeDaySet = new Set<string>();
    for (const a of ins) {
      for (const b of outs) {
        if (Math.abs(a - b) <= TWO_WAY_MS) {
          exchangeDaySet.add(new Date(Math.max(a, b)).toISOString().slice(0, 10));
        }
      }
    }

    const lastTs = Math.max(...rows.map((e) => new Date(e.ts).getTime()));
    const daysSinceLast = Math.floor((nowMs - lastTs) / (24 * 60 * 60 * 1000));
    const exchangeDays = exchangeDaySet.size;
    const tier: StrengthTier = exchangeDays >= CLOSE_TIE_EXCHANGE_DAYS ? 'close' : exchangeDays > 0 ? 'active' : 'weak';

    results.push({ contact, tier, eventCount: rows.length, exchangeDays, daysSinceLast });
  }

  return results.sort((a, b) => b.eventCount - a.eventCount);
}
