// Pure: one decoded SmartSpectra Metrics message -> flat samples for summarize().
// Spot captures deliver whole time series at the end (pulseRate[], rate[], hrv[]), so every
// entry becomes a sample. The SDK reports confidence on a 0..100 scale; we normalise to 0..1.

export function normConf(c) {
  if (c == null) return null;
  return c > 1 ? c / 100 : c;
}

const tOf = (entry, fallbackMs) => (typeof entry?.time === 'number' ? entry.time * 1000 : fallbackMs);

export function samplesFromMetrics(m, fallbackMs = 0) {
  const out = [];
  for (const p of m?.cardio?.pulseRate ?? []) {
    out.push({ t: tOf(p, fallbackMs), pulse: p.value ?? null, pulseConf: normConf(p.confidence), stable: p.stable ?? null });
  }
  for (const b of m?.breathing?.rate ?? []) {
    out.push({ t: tOf(b, fallbackMs), breathing: b.value ?? null, breathingConf: normConf(b.confidence), stable: b.stable ?? null });
  }
  for (const h of m?.cardio?.hrv ?? []) {
    out.push({ t: typeof h?.timestamp === 'number' ? h.timestamp * 1000 : fallbackMs, baevsky: h.baevsky ?? null, rmssd: h.rmssd ?? null });
  }
  return out;
}
