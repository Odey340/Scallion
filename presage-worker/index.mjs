#!/usr/bin/env node
// Scallion presage-worker: 30 s webcam capture -> pulse + breathing -> POST /vitals.
//   node index.mjs [--seconds 30] [--device 0] [--dry-run] [--verbose] [--dump raw.json] [--replay test/fixtures/capture_real.json]
// Exit codes: 0 posted, 1 no confident reading, 2 configuration (missing PRESAGE_API_KEY).
import { loadEnv } from './src/env.mjs';
import { summarize, NoReading } from './src/summarize.mjs';
import { postVitals } from './src/post.mjs';
import { parseTokens, describeToken } from './src/token.mjs';

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
// One POST per token: the reading has to land on the account the phone is signed in to, and the
// camera screen only reads its own user's /vitals/latest (Sun H31: worker posted to the presenter's
// account while the phone was on the shared demo account -> "No reading arrived").
const tokens = parseTokens(process.env.SCALLION_API_TOKEN);
if (!dryRun) {
  if (tokens.length === 0) console.error(`[presage] no SCALLION_API_TOKEN: posting to ${apiUrl} unauthenticated (DEV_AUTH_BYPASS only)`);
  for (const t of tokens) console.error(`[presage] will post as ${describeToken(t)}`);
}

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
  let posted = 0;
  for (const token of tokens.length ? tokens : ['']) {
    try {
      const res = await postVitals(payload, { apiUrl, token });
      posted += 1;
      console.error(`[presage] POST ${apiUrl}/vitals as ${token ? describeToken(token) : 'anonymous'} -> ${JSON.stringify(res)}`);
    } catch (e) {
      console.error(`[presage] POST failed as ${token ? describeToken(token) : 'anonymous'}: ${e.message}`);
    }
  }
  if (posted === 0) process.exit(1);
  console.error(`[presage] posted to ${posted} account(s); press Start on the phone within 60 s`);
}
process.exit(0); // the SDK's native camera handles keep the loop alive after destroy()
