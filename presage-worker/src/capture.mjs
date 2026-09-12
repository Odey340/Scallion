// One spot capture from the laptop webcam via the SmartSpectra headless SDK.
// Frames stay inside the SDK process; only the decoded metric samples are returned.
import {
  SmartSpectraSDK,
  ProcessingStatus,
  breathingMetrics,
  cardioMetrics,
  decodeMetrics,
  SmartSpectraLogLevel,
} from '@smartspectra/node-sdk';

const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);

/** Flatten one decoded Metrics message into the sample shape summarize() expects. */
export function sampleFromMetrics(m, t) {
  const pulse = last(m?.cardio?.pulseRate);
  const breathing = last(m?.breathing?.rate);
  const hrv = last(m?.cardio?.hrv);
  if (!pulse && !breathing && !hrv) return null;
  return {
    t,
    pulse: pulse?.value ?? null,
    pulseConf: pulse?.confidence ?? null,
    breathing: breathing?.value ?? null,
    breathingConf: breathing?.confidence ?? null,
    baevsky: hrv?.baevsky ?? null,
    rmssd: hrv?.rmssd ?? null,
  };
}

export async function captureVitals({ apiKey, seconds = 30, deviceIndex = 0, verbose = false, log = console.error }) {
  const sdk = new SmartSpectraSDK({
    apiKey,
    requestedMetrics: [...breathingMetrics, ...cardioMetrics],
    maxDurationMs: seconds * 1000,
    logLevel: verbose ? SmartSpectraLogLevel.kInfo : SmartSpectraLogLevel.kWarning,
  });

  const samples = [];
  const t0 = Date.now();
  let started = false;
  let lastHint = '';

  const settled = new Promise((resolve, reject) => {
    const watchdog = setTimeout(() => reject(new Error(`capture did not settle within ${seconds + 15} s`)), (seconds + 15) * 1000);
    sdk.on('processingStatus', (status) => {
      if (verbose) log(`[presage] status ${status}`);
      if (status === ProcessingStatus.kRunning) started = true;
      if (started && (status === ProcessingStatus.kIdle || status === ProcessingStatus.kError)) {
        clearTimeout(watchdog);
        status === ProcessingStatus.kError ? reject(new Error('SDK entered error state')) : resolve();
      }
    });
    sdk.on('error', (code, message, retryable) => {
      log(`[presage] error ${code}: ${message} (retryable=${retryable})`);
      if (!retryable) {
        clearTimeout(watchdog);
        reject(new Error(`SmartSpectra error ${code}: ${message}`));
      }
    });
  });

  sdk.on('validationStatus', (code, _ts, hint) => {
    if (hint && hint !== lastHint) {
      lastHint = hint;
      log(`[presage] hint: ${hint}`);
    }
  });
  sdk.on('metrics', (buf) => {
    const m = decodeMetrics(buf);
    if (Buffer.isBuffer(m)) return; // no Metrics class registered: nothing to read
    const s = sampleFromMetrics(m, Date.now() - t0);
    if (s) {
      samples.push(s);
      if (verbose && s.pulse != null) log(`[presage] t=${(s.t / 1000).toFixed(1)}s pulse=${s.pulse.toFixed(0)} (${s.pulseConf?.toFixed(2)}) breathing=${s.breathing?.toFixed(0) ?? '-'}`);
    }
  });

  sdk.useCamera({ deviceIndex });
  try {
    sdk.start();
    await settled;
  } finally {
    await sdk.destroy();
  }
  return { samples, capturedAt: new Date(t0), durationMs: Date.now() - t0 };
}
