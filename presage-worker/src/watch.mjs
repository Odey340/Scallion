// --watch: stay running on the demo laptop and capture whenever a phone presses Start.
// The camera screen POSTs /vitals/arm; this loop polls GET /vitals/arm for every configured token
// and runs one capture per distinct armed_at (contract v12). Each capture is a child process
// (node index.mjs ...) because the SmartSpectra SDK cannot be restarted inside one process on
// Windows (stop()/destroy() hang after a live camera session, Sun H28); the child posts and exits.
import { describeToken } from './token.mjs';

export const MAX_ATTEMPTS_PER_ARM = 2; // one retry when a capture yields no confident reading
// Every request from the watcher carries this header: the API stamps worker_seen_at on the arm
// status (v12 addendum), and the phone reads "no laptop worker is running" from a missing or stale
// stamp within seconds instead of waiting out a generic timeout.
export const WORKER_HEADERS = { 'x-scallion-worker': 'watch' };

// Why a capture child failed, from its stderr. The phone shows NOTES[reason] (PATCH /vitals/arm).
export function classifyCaptureOutput(text) {
  if (/0xC00D3704|Hardware MFT failed|lack of hardware resources|camera (is )?(busy|in use)/i.test(text)) return 'busy';
  if (/never reached Running/.test(text)) return 'noface';
  if (/no reading: only/.test(text)) return 'lostface';
  if (/PRESAGE_API_KEY is empty/.test(text)) return 'nokey';
  return null;
}

export const NOTES = {
  busy: 'The laptop webcam is in use by another app (this page open in the laptop browser, Teams, Zoom). Close it and press Start again.',
  noface: 'No face found on the laptop webcam within 2 minutes. Sit closer, face the light, and press Start again.',
  lostface: 'Face lost during the recording. Hold still for the full minute, facing the laptop webcam.',
  hung: 'The laptop capture hung and was stopped. Press Start again.',
  nokey: 'PRESAGE_API_KEY is missing on the laptop (.env).',
  failed: 'The laptop capture failed; see its terminal.',
};
const RETRYABLE = new Set(['noface', 'lostface']); // the presenter can fix these while the phone still waits

export async function fetchArm(apiUrl, token, fetchImpl = fetch) {
  const headers = { ...WORKER_HEADERS };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(`${apiUrl.replace(/\/$/, '')}/vitals/arm`, { headers });
  if (!res.ok) throw new Error(`GET /vitals/arm -> ${res.status}`);
  return res.json();
}

export async function postNote(apiUrl, token, note, final, fetchImpl = fetch) {
  const headers = { 'content-type': 'application/json', ...WORKER_HEADERS };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(`${apiUrl.replace(/\/$/, '')}/vitals/arm`, { method: 'PATCH', headers, body: JSON.stringify({ note, final }) });
  if (!res.ok) throw new Error(`PATCH /vitals/arm -> ${res.status}`);
}

// Which arm (if any) needs a capture: pending and not the one already handled for that token.
export function pickPending(statuses, handled) {
  for (const { token, status } of statuses) {
    if (!status || !status.pending || !status.armed_at) continue;
    if (handled.get(token) === status.armed_at) continue;
    return { token, armedAt: status.armed_at };
  }
  return null;
}

export async function watchLoop({
  apiUrl,
  tokens,
  runCapture,
  pollMs = 2000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.error,
  maxIterations = Infinity,
}) {
  const handled = new Map(); // token -> armed_at already captured for (see attempts)
  const attempts = new Map(); // `${token}|${armed_at}` -> captures tried for that arm
  const lastErr = new Map(); // token -> last error message, so one bad token logs once, not every poll
  // A capture that failed for a fixable reason (no face, face lost) is tried once more at once. The
  // retry must not depend on the API's `pending`: a first attempt can take up to 3 min (2 min waiting
  // for a face, then the recording), by which time the 120 s arm window has expired and `pending` is
  // false although the phone is still waiting (Sun H33: "trying once more" was promised, nothing ran).
  // Only a Cancel (armed_at null) or a new Start (a different armed_at) calls the retry off.
  let retry = null; // {token, armedAt}
  let captures = 0;
  const allTokens = tokens.length ? tokens : [''];
  for (let i = 0; i < maxIterations; i += 1) {
    const statuses = [];
    for (const token of allTokens) {
      try {
        statuses.push({ token, status: await fetchArm(apiUrl, token, fetchImpl) });
        lastErr.delete(token);
      } catch (e) {
        if (lastErr.get(token) !== e.message) {
          log(`[presage] watch (${token ? describeToken(token) : 'anonymous'}): ${e.message} (retrying every ${pollMs / 1000} s)`);
        }
        lastErr.set(token, e.message);
      }
    }
    let pick = null;
    if (retry) {
      const st = statuses.find((s) => s.token === retry.token)?.status;
      if (st && st.armed_at === retry.armedAt) {
        pick = retry;
        retry = null;
      } else if (st) {
        log(`[presage] retry called off: the phone ${st.armed_at ? 'pressed Start again' : 'cancelled'}`);
        retry = null;
      }
      // st undefined: the API poll failed this round; keep the retry for the next one
    }
    if (!pick) pick = pickPending(statuses, handled);
    if (pick) {
      const key = `${pick.token}|${pick.armedAt}`;
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      log(`[presage] Start pressed on the phone (${pick.token ? describeToken(pick.token) : 'anonymous'}, armed ${pick.armedAt}); capturing${n > 1 ? ` (retry ${n - 1})` : ''}`);
      // Keep polling while the child runs (up to 3 min) so worker_seen_at stays fresh and the phone
      // can tell "the laptop is busy capturing" from "no worker is running".
      const keepAlive = setInterval(() => {
        for (const token of allTokens) fetchArm(apiUrl, token, fetchImpl).catch(() => undefined);
      }, pollMs);
      let res;
      try {
        res = await runCapture(pick);
      } finally {
        clearInterval(keepAlive);
      }
      const code = typeof res === 'number' ? res : res.code;
      const reason = typeof res === 'number' ? null : res.reason;
      captures += 1;
      if (code === 0) {
        handled.set(pick.token, pick.armedAt);
        log('[presage] capture posted; watching for the next Start');
      } else {
        // Tell the phone why (it shows the note instead of a generic timeout). Face problems get one
        // retry while the phone still waits; a busy webcam or a hang will not fix itself, so end the
        // arm (final) and let the presenter press Start again after closing the other camera app.
        const again = (reason == null || RETRYABLE.has(reason)) && n < MAX_ATTEMPTS_PER_ARM;
        const note = `${NOTES[reason ?? 'failed']}${again ? ' The laptop is trying once more; keep still.' : ''}`;
        await postNote(apiUrl, pick.token, note, !again, fetchImpl).catch((e) => log(`[presage] could not report to the phone: ${e.message}`));
        if (again) {
          retry = pick;
          log(`[presage] capture exited ${code} (${reason ?? 'unknown'}); retrying while the phone still waits`);
        } else {
          handled.set(pick.token, pick.armedAt);
          log(`[presage] capture exited ${code} (${reason ?? 'unknown'}); told the phone: ${NOTES[reason ?? 'failed']}`);
        }
      }
      continue; // re-poll at once: the post cleared pending, a retry is due, or a new arm is waiting
    }
    await sleep(pollMs);
  }
  return { captures };
}
