// --watch: stay running on the demo laptop and capture whenever a phone presses Start.
// The camera screen POSTs /vitals/arm; this loop polls GET /vitals/arm for every configured token
// and runs one capture per distinct armed_at (contract v12). Each capture is a child process
// (node index.mjs ...) because the SmartSpectra SDK cannot be restarted inside one process on
// Windows (stop()/destroy() hang after a live camera session, Sun H28); the child posts and exits.
import { describeToken } from './token.mjs';

export const MAX_ATTEMPTS_PER_ARM = 2; // one retry when a capture yields no confident reading

export async function fetchArm(apiUrl, token, fetchImpl = fetch) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await fetchImpl(`${apiUrl.replace(/\/$/, '')}/vitals/arm`, { headers });
  if (!res.ok) throw new Error(`GET /vitals/arm -> ${res.status}`);
  return res.json();
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
  let captures = 0;
  for (let i = 0; i < maxIterations; i += 1) {
    const statuses = [];
    for (const token of tokens.length ? tokens : ['']) {
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
    const pick = pickPending(statuses, handled);
    if (pick) {
      const key = `${pick.token}|${pick.armedAt}`;
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      log(`[presage] Start pressed on the phone (${pick.token ? describeToken(pick.token) : 'anonymous'}, armed ${pick.armedAt}); capturing${n > 1 ? ` (retry ${n - 1})` : ''}`);
      const code = await runCapture(pick);
      captures += 1;
      if (code === 0) {
        handled.set(pick.token, pick.armedAt);
        log('[presage] capture posted; watching for the next Start');
      } else if (n < MAX_ATTEMPTS_PER_ARM) {
        // No confident reading (face lost, bad light): the phone is still polling, so try once more
        // while the arm is pending; pickPending re-selects it on the next poll.
        log(`[presage] capture exited ${code} (no confident reading?); retrying while the phone still waits`);
      } else {
        handled.set(pick.token, pick.armedAt);
        log(`[presage] capture exited ${code} again; giving up on this Start. Face the light and press Start again`);
      }
      continue; // re-poll at once: the post cleared pending, or a new arm is waiting
    }
    await sleep(pollMs);
  }
  return { captures };
}
