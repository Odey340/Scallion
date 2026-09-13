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

// --watch: stay running and capture whenever a phone presses Start (GET /vitals/arm, contract v12).
// Each capture is a child `node index.mjs` with the other flags passed through, so an SDK hang in
// one capture cannot take the watcher down and the camera is released between captures.
if (args.includes('--watch')) {
  const { watchLoop, classifyCaptureOutput } = await import('./src/watch.mjs');
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const self = fileURLToPath(import.meta.url);
  const childArgs = args.filter((a) => a !== '--watch');
  const watchTokens = parseTokens(process.env.SCALLION_API_TOKEN);
  const watchUrl = process.env.SCALLION_API_URL || 'http://localhost:8000';
  if (!process.env.PRESAGE_API_KEY && !replay) {
    console.error('PRESAGE_API_KEY is empty. Put the key from physiology.presagetech.com in ../.env (see .env.example).');
    process.exit(2);
  }
  console.error(`[presage] watching ${watchUrl}/vitals/arm for ${watchTokens.length || 'anonymous'} account(s)${replay ? ` (replay ${replay})` : ''}; press Start on the phone`);
  for (const t of watchTokens) console.error(`[presage]   ${describeToken(t)}`);
  await watchLoop({
    apiUrl: watchUrl,
    tokens: watchTokens,
    runCapture: () =>
      new Promise((resolve) => {
        // Deadline: the SDK can block natively (camera held by another app, no timer fires in the
        // child), so the watcher kills a child that has not exited and keeps serving later Starts.
        // stderr is piped through (and echoed) so the failure can be classified and told to the phone.
        const deadlineS = replay ? 60 : 180;
        const child = spawn(process.execPath, [self, ...childArgs], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
        let reason = null;
        let done = false;
        const settle = (code) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ code, reason });
        };
        const timer = setTimeout(() => {
          reason = reason ?? 'hung';
          console.error(`[presage] capture hung for ${deadlineS} s; killed it`);
          child.kill();
          settle(1);
        }, deadlineS * 1000);
        child.stdout.on('data', (d) => process.stdout.write(d));
        child.stderr.on('data', (d) => {
          process.stderr.write(d);
          if (reason) return;
          reason = classifyCaptureOutput(String(d));
          if (reason === 'busy') {
            // Another app holds the webcam (Media Foundation 0xC00D3704); waiting 2 min for a face is pointless.
            console.error('[presage] webcam is busy (another app holds it); stopping this capture');
            child.kill();
          }
        });
        child.on('exit', (code) => settle(code ?? 1));
        child.on('error', (e) => { console.error(`[presage] could not start capture: ${e.message}`); settle(1); });
      }),
  });
}

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
