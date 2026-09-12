import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GmailMetadataMessage } from './gmail';
import { parseGmailHeaders } from './gmail';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..', '..', '..', 'fixtures', 'gmail_metadata_sample.json');
const SELF = 'you@example.com';

function msg(overrides: Partial<GmailMetadataMessage> & { headers: Record<string, string> }): GmailMetadataMessage {
  const { headers, ...rest } = overrides;
  return {
    id: 'msg-1',
    internalDate: String(new Date(2026, 8, 1, 12, 0, 0).getTime()),
    sizeEstimate: 1000,
    payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
    ...rest,
  };
}

describe('parseGmailHeaders — direction and shape', () => {
  it('marks a message as incoming when From is not self', () => {
    const events = parseGmailHeaders(
      [msg({ headers: { From: 'Maria <maria@example.com>', To: SELF } })],
      SELF,
      'salt',
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.dir).toBe('in');
    expect(events[0]!.app).toBe('gmail');
  });

  it('fans out one event per To recipient on an outgoing message', () => {
    const events = parseGmailHeaders(
      [msg({ headers: { From: SELF, To: 'maria@example.com, jordan@example.net' } })],
      SELF,
      'salt',
    );
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.dir === 'out')).toBe(true);
    expect(new Set(events.map((e) => e.contact)).size).toBe(2);
  });

  it('ignores Cc entirely', () => {
    const events = parseGmailHeaders(
      [msg({ headers: { From: SELF, To: 'maria@example.com', Cc: 'jordan@example.net' } })],
      SELF,
      'salt',
    );
    expect(events).toHaveLength(1);
  });

  it('extracts the email out of a "Name <email>" header', () => {
    const events = parseGmailHeaders(
      [msg({ headers: { From: 'Maria G. <maria@example.com>', To: SELF } })],
      SELF,
      'salt',
    );
    const direct = parseGmailHeaders([msg({ headers: { From: 'maria@example.com', To: SELF } })], SELF, 'salt');
    expect(events[0]!.contact).toBe(direct[0]!.contact);
  });

  it('skips messages missing From or internalDate', () => {
    const noFrom = msg({ headers: { To: SELF } });
    const noDate = { ...msg({ headers: { From: 'maria@example.com', To: SELF } }), internalDate: '' };
    expect(parseGmailHeaders([noFrom, noDate], SELF, 'salt')).toHaveLength(0);
  });

  it('never leaks the raw address in the hash', () => {
    const events = parseGmailHeaders(
      [msg({ headers: { From: 'maria@example.com', To: SELF } })],
      SELF,
      'salt',
    );
    expect(events[0]!.contact).not.toMatch(/maria/i);
    expect(events[0]!.contact).toMatch(/^[0-9a-f]{64}$/);
  });

  it('buckets length from sizeEstimate, not any body content', () => {
    const events = parseGmailHeaders(
      [msg({ headers: { From: 'maria@example.com', To: SELF }, sizeEstimate: 50 })],
      SELF,
      'salt',
    );
    expect(events[0]!.len).toBe(1); // 50 -> <100
  });
});

describe('parseGmailHeaders — fixtures/gmail_metadata_sample.json', () => {
  const messages: GmailMetadataMessage[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

  it('parses every message without throwing and produces well-formed events', () => {
    const events = parseGmailHeaders(messages, SELF, 'fixture-salt');
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.app === 'gmail')).toBe(true);
    expect(events.every((e) => e.dir === 'in' || e.dir === 'out')).toBe(true);
    expect(events.every((e) => /^[0-9a-f]{64}$/.test(e.contact))).toBe(true);
  });

  it('covers more than one distinct contact', () => {
    const events = parseGmailHeaders(messages, SELF, 'fixture-salt');
    expect(new Set(events.map((e) => e.contact)).size).toBeGreaterThan(1);
  });
});
