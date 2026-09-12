import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarize, median, NoReading } from '../src/summarize.mjs';
import { postVitals } from '../src/post.mjs';

const capturedAt = new Date('2026-09-12T14:00:00Z');

function ramp(n = 30) {
  // 30 s of samples at 1 Hz: warm-up nonsense in the first half, a steady 62 bpm / 14 rpm after.
  return Array.from({ length: n }, (_, i) => ({
    t: i * 1000,
    pulse: i < n / 2 ? 90 - i : 62 + (i % 3) - 1,
    pulseConf: i < n / 2 ? 0.3 : 0.9,
    breathing: i < n / 2 ? null : 14 + (i % 2),
    breathingConf: 0.8,
    baevsky: i === n - 1 ? 98.4 : null,
    rmssd: i === n - 1 ? 41.2 : null,
  }));
}

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test('summarize uses the confident second half and matches the contract payload', () => {
  const p = summarize(ramp(), { capturedAt });
  assert.equal(p.source, 'presage');
  assert.equal(p.pulse_bpm, 62);
  assert.equal(p.breathing_bpm, 15);
  assert.equal(p.stress_index, 98.4);
  assert.equal(p.hrv_rmssd_ms, 41.2);
  assert.equal(p.captured_at, '2026-09-12T14:00:00.000Z');
  assert.equal(p.samples, 15);
  assert.equal(p.confidence, 0.9);
  assert.deepEqual(Object.keys(p).sort(), ['breathing_bpm', 'captured_at', 'confidence', 'hrv_rmssd_ms', 'pulse_bpm', 'samples', 'source', 'stress_index']);
});

test('summarize drops low-confidence pulse and throws when too few remain', () => {
  const s = ramp().map((x) => ({ ...x, pulseConf: 0.2 }));
  assert.throws(() => summarize(s, { capturedAt }), NoReading);
  assert.throws(() => summarize([], { capturedAt }), NoReading);
});

test('breathing is null when it never became confident', () => {
  const s = ramp().map((x) => ({ ...x, breathingConf: 0.1 }));
  assert.equal(summarize(s, { capturedAt }).breathing_bpm, null);
});

test('the checked-in fixture payload equals what summarize produces', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/payload.json', import.meta.url), 'utf8'));
  assert.deepEqual(summarize(ramp(), { capturedAt }), fixture);
});

test('postVitals sends a bearer token and JSON, and throws on non-2xx', async () => {
  const calls = [];
  const ok = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  };
  const res = await postVitals({ pulse_bpm: 62 }, { apiUrl: 'http://api.test/', token: 'tkn', fetchImpl: ok });
  assert.deepEqual(res, { ok: true });
  assert.equal(calls[0].url, 'http://api.test/vitals');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tkn');
  assert.equal(JSON.parse(calls[0].init.body).pulse_bpm, 62);

  const bad = async () => ({ ok: false, status: 422, text: async () => 'nope' });
  await assert.rejects(postVitals({}, { apiUrl: 'http://api.test', fetchImpl: bad }), /422: nope/);
});

test('samplesFromMetrics flattens whole series and normalises 0..100 confidence', async () => {
  const { samplesFromMetrics, normConf } = await import('../src/flatten.mjs');
  assert.ok(Math.abs(normConf(90.58) - 0.9058) < 1e-9);
  assert.equal(normConf(0.7), 0.7);
  assert.equal(normConf(null), null);
  const m = {
    cardio: { pulseRate: [{ time: 10, value: 81, confidence: 12.58 }, { time: 11, value: 85, confidence: 90.58, stable: true }],
              hrv: [{ timestamp: 20, baevsky: 98, rmssd: 41 }] },
    breathing: { rate: [{ time: 10.5, value: 14, confidence: 80 }] },
  };
  const s = samplesFromMetrics(m, 5000);
  assert.equal(s.length, 4);
  assert.equal(s[1].t, 11000); assert.equal(s[1].pulse, 85); assert.ok(Math.abs(s[1].pulseConf - 0.9058) < 1e-9); assert.equal(s[1].stable, true);
  assert.equal(s[2].breathing, 14);
  assert.equal(s[3].baevsky, 98);
  assert.equal(samplesFromMetrics({ cardio: { pulseRate: [{ value: 60 }] } }, 7000)[0].t, 7000);
});
