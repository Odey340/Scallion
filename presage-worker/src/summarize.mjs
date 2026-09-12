// Pure: SDK samples -> the /vitals payload (docs/contracts.md section 3). No SDK import here so it is unit-testable.

export class NoReading extends Error {}

export const MIN_CONFIDENCE = 0.5;
export const MIN_SAMPLES = 3;

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function round(x, dp = 1) {
  return x == null ? null : Math.round(x * 10 ** dp) / 10 ** dp;
}

/**
 * samples: [{ t (ms since capture start), pulse, pulseConf, breathing, breathingConf, baevsky, rmssd }]
 * The first half of a spot capture is warm-up, so rates come from the second half only.
 */
export function summarize(samples, { capturedAt = new Date(), minConfidence = MIN_CONFIDENCE, minSamples = MIN_SAMPLES } = {}) {
  if (!samples.length) throw new NoReading('no metrics samples arrived (camera blocked, bad key, or no network?)');
  const tMax = Math.max(...samples.map((s) => s.t ?? 0));
  const late = samples.filter((s) => (s.t ?? 0) >= tMax / 2);

  const pulse = late.filter((s) => s.pulse != null && (s.pulseConf ?? 1) >= minConfidence).map((s) => s.pulse);
  if (pulse.length < minSamples) {
    throw new NoReading(`only ${pulse.length} confident pulse samples in the second half (need ${minSamples}); hold still, face the light`);
  }
  const breathing = late.filter((s) => s.breathing != null && (s.breathingConf ?? 1) >= minConfidence).map((s) => s.breathing);
  const withHrv = samples.filter((s) => s.baevsky != null || s.rmssd != null);
  const lastHrv = withHrv.length ? withHrv[withHrv.length - 1] : null;
  const confs = late.filter((s) => s.pulseConf != null).map((s) => s.pulseConf);

  return {
    source: 'presage',
    pulse_bpm: round(median(pulse)),
    breathing_bpm: breathing.length >= minSamples ? round(median(breathing)) : null,
    stress_index: lastHrv?.baevsky != null ? round(lastHrv.baevsky) : null,
    captured_at: capturedAt.toISOString(),
    hrv_rmssd_ms: lastHrv?.rmssd != null ? round(lastHrv.rmssd) : null,
    confidence: confs.length ? round(median(confs), 2) : null,
    samples: pulse.length,
  };
}
