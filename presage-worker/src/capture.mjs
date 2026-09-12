// One spot capture from the laptop webcam via the SmartSpectra headless SDK.
// Frames stay inside the SDK process; only the decoded metric samples are returned.
//
// Observed with node-sdk 3.3.0 + useCamera(): metrics stream continuously (~1 pulse entry per
// 0.7 s) and maxDurationMs does not end the session, so this module keeps its own clock: it
// records for `seconds` after the SDK reports Running, then calls stop() and waits for Idle.
import {
  SmartSpectraSDK,
  ProcessingStatus,
  breathingMetrics,
  cardioMetrics,
  decodeMetrics,
  SmartSpectraLogLevel,
} from '@smartspectra/node-sdk';
import { samplesFromMetrics } from './flatten.mjs';

const START_GRACE_S = 120; // camera ISP lock + settle (~20 s) and the SDK waits for a face before Running
const STOP_GRACE_S = 30; // stop() -> Idle (observed ~1 s)

export async function captureVitals({ apiKey, seconds = 30, deviceIndex = 0, verbose = false, log = console.error }) {
  const sdk = new SmartSpectraSDK({
    apiKey,
    requestedMetrics: [...breathingMetrics, ...cardioMetrics],
    maxDurationMs: seconds * 1000,
    logLevel: verbose ? SmartSpectraLogLevel.kInfo : SmartSpectraLogLevel.kWarning,
  });

  const samples = [];
  const raw = [];
  const t0 = Date.now();
  let tRunning = null;
  let lastHint = '';
  let stopRequested = false;

  const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1);

  const settled = new Promise((resolve, reject) => {
    let timer = setTimeout(() => reject(new Error(`SDK never reached Running within ${START_GRACE_S} s`)), START_GRACE_S * 1000);

    const requestStop = () => {
      if (stopRequested) return;
      stopRequested = true;
      clearTimeout(timer);
      if (verbose) log(`[presage] ${seconds} s recorded, stopping at ${elapsed()}s`);
      timer = setTimeout(() => {
        log(`[presage] warning: no Idle within ${STOP_GRACE_S} s of stop(); using the samples collected`);
        resolve();
      }, STOP_GRACE_S * 1000);
      try {
        sdk.stop();
      } catch (e) {
        log(`[presage] stop() threw: ${e.message}`);
      }
    };

    sdk.on('processingStatus', (status) => {
      if (verbose) log(`[presage] status ${status} at ${elapsed()}s`);
      if (status === ProcessingStatus.kStarting) log('[presage] waiting for a face; sit still in front of the camera');
      if (status === ProcessingStatus.kRunning && tRunning == null) {
        tRunning = Date.now();
        clearTimeout(timer);
        timer = setTimeout(requestStop, seconds * 1000);
      }
      if (stopRequested && status === ProcessingStatus.kIdle) {
        clearTimeout(timer);
        resolve();
      }
      if (status === ProcessingStatus.kError) {
        clearTimeout(timer);
        reject(new Error('SDK entered error state'));
      }
    });
    sdk.on('error', (code, message, retryable) => {
      // After recording started, errors (e.g. the insight session while stopping) are logged only.
      log(`[presage] error ${code}: ${message} (retryable=${retryable})`);
      if (tRunning == null && !retryable) {
        clearTimeout(timer);
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
    if (stopRequested) return; // ignore the tail after stop()
    const m = decodeMetrics(buf);
    if (Buffer.isBuffer(m)) return; // no Metrics class registered: nothing to read
    raw.push(m);
    const sinceRec = Date.now() - (tRunning ?? t0);
    const batch = samplesFromMetrics(m, sinceRec);
    samples.push(...batch);
    if (verbose) {
      const p = batch.filter((s) => s.pulse != null);
      if (p.length) log(`[presage] rec ${(sinceRec / 1000).toFixed(1)}s pulse ${p.map((s) => `${s.pulse.toFixed(0)}(${s.pulseConf?.toFixed(2)})`).join(' ')}`);
    }
  });

  sdk.useCamera({ deviceIndex });
  try {
    sdk.start();
    await settled;
  } finally {
    await sdk.destroy();
  }
  return { samples, raw, capturedAt: new Date(tRunning ?? t0), durationMs: Date.now() - t0 };
}
