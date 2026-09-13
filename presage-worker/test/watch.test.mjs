import test from 'node:test';
import assert from 'node:assert/strict';
import { pickPending, watchLoop } from '../src/watch.mjs';

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
  const fetchImpl = async (url, { headers }) => {
    assert.match(url, /\/vitals\/arm$/);
    assert.equal(headers.authorization, 'Bearer tok');
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
  assert.ok(logs.some((l) => l.includes('giving up')));
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
