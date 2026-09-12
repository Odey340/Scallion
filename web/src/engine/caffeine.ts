/**
 * Tonight's last-coffee line, from web/public/engine/caffeine.json (matlab/engine/caffeine_curve.m).
 */

export interface CaffeineData {
  half_life_h: number;
  modifiers: { smoker: number; oral_contraceptive: number };
  bedtime_threshold_mg: number;
  rule: string;
}

export function lastCoffeeHoursBeforeBed(
  doseMg: number,
  opts: { smoker: boolean; oralContraceptive: boolean },
  caffeine: CaffeineData
): number {
  // caffeine.json's rule names a single "modifier"; a person flagged for both is an assumption, not specified.
  let halfLife = caffeine.half_life_h;
  if (opts.smoker) halfLife *= caffeine.modifiers.smoker;
  if (opts.oralContraceptive) halfLife *= caffeine.modifiers.oral_contraceptive;

  if (doseMg <= caffeine.bedtime_threshold_mg) return 0;
  return halfLife * Math.log2(doseMg / caffeine.bedtime_threshold_mg);
}

export function subtractHours(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  let totalMin = h * 60 + m - Math.round(hours * 60);
  totalMin = ((totalMin % 1440) + 1440) % 1440;
  const hh = Math.floor(totalMin / 60)
    .toString()
    .padStart(2, '0');
  const mm = (totalMin % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}
