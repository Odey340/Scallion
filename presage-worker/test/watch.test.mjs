import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES, WORKER_HEADERS, classifyCaptureOutput, pickPending, watchLoop } from '../src/watch.mjs';

const ok = (body) => ({ ok: true, json: async () => body });

test('pickPending returns the first pending arm not yet handled', () => {
  const handled = new Map([['a', 't1']]);
  const statuses = [
    { token: 'a', status: { armed_at: 't1', pending: true } },
    { token: 'b', status: { armed_at: 't2', pending: true } },
  ];
  assert.deepEqual(pickPending(statuses, handled), { token: 'b', armedAt: 't2' });
  assert.equal(pickPending([{ token: 'a', status: { armed_at: null, pending: false } }], new Map()), null);
  assert.equal(pickPending([{ token: 'a', status: null }], new Map()), null);
});

test('watchLoop captures once per distinct arm, retries a failed capture once, survives API errors', async () => {
  // poll 1: idle; poll 2: armed t1 (capture, exit 0); poll 3: still t1 pending (server not yet
  // updated) -> no second capture; poll 4: API error; poll 5: armed t2 -> capture exits 1;
  // poll 6: t2 still pending -> one retry (exit 1); poll 7: t2 still pending -> given up.
  const responses = [
    { armed_at: null, pending: false },
    { armed_at: 't1', pending: true },
    { armed_at: 't1', pending: true },
    'error',
    { armed_at: 't2', pending: true },
    { armed_at: 't2', pending: true },
    { armed_at: 't2', pending: true },
  ];
  let calls = 0;
  const patches = [];
  const fetchImpl = async (url, init) => {
    assert.match(url, /\/vitals\/arm$/);
    assert.equal(init.headers.authorization, 'Bearer tok');
    assert.equal(init.headers['x-scallion-worker'], WORKER_HEADERS['x-scallion-worker']); // every poll and note stamps worker_seen_at
    if (init.method === 'PATCH') {
      patches.push(JSON.parse(init.body));
      return ok({});
    }
    const r = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    if (r === 'error') return { ok: false, status: 502, json: async () => ({}) };
    return ok(r);
  };
  const captured = [];
  const logs = [];
  const result = await watchLoop({
    apiUrl: 'http://api.test/',
    tokens: ['tok'],
    fetchImpl,
    sleep: async () => undefined,
    log: (m) => logs.push(m),
    runCapture: async (pick) => {
      captured.push(pick.armedAt);
      return captured.length === 1 ? 0 : 1;
    },
    maxIterations: 7,
  });
  assert.deepEqual(captured, ['t1', 't2', 't2']);
  assert.equal(result.captures, 3);
  assert.equal(logs.filter((l) => l.includes('502')).length, 1); // logged once per token, not per poll
  assert.ok(logs.some((l) => l.includes('retry 1')));
  assert.ok(logs.some((l) => l.includes('told the phone')));
  // the phone is told after each failure: first "trying once more", then final
  assert.equal(patches.length, 2);
  assert.equal(patches[0].final, false);
  assert.match(patches[0].note, /trying once more/);
  assert.equal(patches[1].final, true);
  assert.equal(patches[1].note, NOTES.failed);
});

test('a busy webcam is final at once (no retry) and the phone is told why', async () => {
  const patches = [];
  const captured = [];
  await watchLoop({
    apiUrl: 'http://api.test',
    tokens: ['tok'],
    fetchImpl: async (_url, init) => {
      if (init.method === 'PATCH') {
        patches.push(JSON.parse(init.body));
        return ok({});
      }
      return ok({ armed_at: 't1', pending: true });
    },
    sleep: async () => undefined,
    log: () => undefined,
    runCapture: async () => {
      captured.push(1);
      return { code: 1, reason: 'busy' };
    },
    maxIterations: 3,
  });
  assert.equal(captured.length, 1);
  assert.deepEqual(patches, [{ note: NOTES.busy, final: true, armed_at: 't1' }]); // the note names its arm
});

test('classifyCaptureOutput recognises the failure signatures', () => {
  assert.equal(classifyCaptureOutput('E2026 mediafoundation_camera_source.cc] Hardware MFT failed to start streaming due to lack of hardware resources. (0xC00D3704)'), 'busy');
  assert.equal(classifyCaptureOutput('Error: SDK never reached Running within 120 s'), 'noface');
  assert.equal(classifyCaptureOutput('[presage] no reading: only 0 confident pulse samples in the second half (need 3)'), 'lostface');
  assert.equal(classifyCaptureOutput('PRESAGE_API_KEY is empty.'), 'nokey');
  assert.equal(classifyCaptureOutput('[presage] hint: Face the camera.'), null);
});

test('watchLoop polls anonymously when no token is configured', async () => {
  let auth = 'unset';
  await watchLoop({
    apiUrl: 'http://api.test',
    tokens: [],
    fetchImpl: async (_url, { headers }) => {
      auth = headers.authorization;
      return ok({ armed_at: null, pending: false });
    },
    sleep: async () => undefined,
    log: () => undefined,
    runCapture: async () => 0,
    maxIterations: 1,
  });
  assert.equal(auth, undefined);
});

test('the retry runs even after the arm window expired (pending false), unless the phone cancelled or re-armed', async () => {
  // Attempt 1 of t1 takes longer than the 120 s window: by the time it fails the API says
  // pending=false but armed_at is still t1 -> retry at once. Then t2: attempt 1 fails, the phone
  // cancels (armed_at null) -> no retry. Then t3: attempt 1 fails, the phone re-arms as t4 -> the
  // retry is called off and t4 gets a fresh attempt 1.
  const responses = [
    { armed_at: 't1', pending: true },
    { armed_at: 't1', pending: false }, // window expired while attempt 1 ran
    { armed_at: 't1', pending: false }, // after the retry: given up (final note), nothing more for t1
    { armed_at: 't2', pending: true },
    { armed_at: null, pending: false }, // cancelled during attempt 1 of t2
    { armed_at: 't3', pending: true },
    { armed_at: 't4', pending: true }, // re-armed during attempt 1 of t3
    { armed_at: 't4', pending: false },
  ];
  let calls = 0;
  const patches = [];
  const captured = [];
  const logs = [];
  await watchLoop({
    apiUrl: 'http://api.test',
    tokens: ['tok'],
    fetchImpl: async (_url, init) => {
      if (init.method === 'PATCH') {
        patches.push(JSON.parse(init.body));
        return ok({});
      }
      const r = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      return ok(r);
    },
    sleep: async () => undefined,
    log: (m) => logs.push(m),
    runCapture: async (pick) => {
      captured.push(pick.armedAt);
      return { code: 1, reason: 'lostface' };
    },
    maxIterations: responses.length,
  });
  assert.deepEqual(captured, ['t1', 't1', 't2', 't3', 't4', 't4']);
  assert.ok(logs.some((l) => l.includes('retry called off: the phone cancelled')));
  assert.ok(logs.some((l) => l.includes('retry called off: the phone pressed Start again')));
  // t1: trying once more, then final; t2: trying once more (then cancelled); t3: trying once more
  // (then re-armed); t4: trying once more, then final
  assert.deepEqual(patches.map((p) => p.final), [false, true, false, false, false, true]);
});

test('a capture keeps the worker seen: polls continue while the child runs', async () => {
  const gets = [];
  let armed = { armed_at: 't1', pending: true };
  let resolveCapture;
  const loop = watchLoop({
    apiUrl: 'http://api.test',
    tokens: ['tok'],
    pollMs: 5,
    fetchImpl: async (_url, init) => {
      if (init.method === 'PATCH') return ok({});
      gets.push(1);
      return ok(armed);
    },
    sleep: async () => undefined,
    log: () => undefined,
    runCapture: () => new Promise((r) => { resolveCapture = r; }),
    maxIterations: 1,
  });
  await new Promise((r) => setTimeout(r, 60)); // the "child" is running: keep-alive polls should land
  const during = gets.length;
  assert.ok(during >= 4, `expected keep-alive polls during the capture, got ${during}`);
  armed = { armed_at: 't1', pending: false };
  resolveCapture(0);
  await loop;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(gets.length, during, 'keep-alive stops when the capture ends');
});
