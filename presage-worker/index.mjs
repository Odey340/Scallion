#!/usr/bin/env node
// Scallion presage-worker: 30 s webcam capture -> pulse + breathing -> POST /vitals.
//   node index.mjs [--seconds 30] [--device 0] [--dry-run] [--verbose] [--dump raw.json] [--replay test/fixtures/capture_real.json]
// Exit codes: 0 posted, 1 no confident reading, 2 configuration (missing PRESAGE_API_KEY).
import { loadEnv } from './src/env.mjs';
import { summarize, NoReading } from './src/summarize.mjs';
import { postVitals } from './src/post.mjs';

loadEnv();

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const seconds = Number(flag('seconds', 30));
const deviceIndex = Number(flag('device', 0));
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const dump = flag('dump', '');
const replay = flag('replay', '');

const apiKey = process.env.PRESAGE_API_KEY;
if (!apiKey && !replay) {
  console.error('PRESAGE_API_KEY is empty. Put the key from physiology.presagetech.com in ../.env (see .env.example).');
  process.exit(2);
}
const apiUrl = process.env.SCALLION_API_URL || 'http://localhost:8000';
const token = process.env.SCALLION_API_TOKEN || '';

let samples, raw, capturedAt, durationMs;
if (replay) {
  // Demo fallback: replay a saved real capture (samples only) when there is no camera or face.
  const { readFileSync } = await import('node:fs');
  const saved = JSON.parse(readFileSync(replay, 'utf8'));
  samples = saved.samples; raw = []; capturedAt = new Date(); durationMs = (saved.seconds ?? seconds) * 1000;
  console.error(`[presage] REPLAY ${replay}: ${samples.length} saved samples (no camera used)`);
} else {
  console.error(`[presage] capturing ${seconds} s from camera ${deviceIndex}; hold still, face the light`);
  const { captureVitals } = await import('./src/capture.mjs');
  ({ samples, raw, capturedAt, durationMs } = await captureVitals({ apiKey, seconds, deviceIndex, verbose }));
}
if (dump) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(dump, JSON.stringify({ samples, raw }, null, 1));
  console.error(`[presage] wrote ${dump}`);
}
console.error(`[presage] ${samples.length} metric samples over ${(durationMs / 1000).toFixed(1)} s`);

let payload;
try {
  payload = summarize(samples, { capturedAt });
} catch (e) {
  if (e instanceof NoReading) {
    console.error(`[presage] no reading: ${e.message}`);
    process.exit(1);
  }
  throw e;
}

console.log(`pulse ${payload.pulse_bpm} bpm, breathing ${payload.breathing_bpm ?? '-'} /min, stress ${payload.stress_index ?? '-'} (n=${payload.samples}, conf=${payload.confidence ?? '-'})`);
if (replay) payload.source = 'presage';  // still the Presage pipeline's numbers, replayed
console.log(JSON.stringify(payload));

if (dryRun) {
  console.error('[presage] --dry-run: not posting');
} else {
  const res = await postVitals(payload, { apiUrl, token });
  console.error(`[presage] POST ${apiUrl}/vitals -> ${JSON.stringify(res)}`);
}
process.exit(0); // the SDK's native camera handles keep the loop alive after destroy()
