import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bucketLength, parseWhatsApp, UnsupportedChatError } from './whatsapp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..', '..', '..', 'fixtures', 'whatsapp_sample.txt');

function loadFixtureBlocks(): { name: string; format: 'ios' | 'android'; text: string }[] {
  const raw = readFileSync(FIXTURE_PATH, 'utf8');
  const parts = raw.split(/\n(?==== BLOCK: )/).filter((p) => p.trim().length > 0);
  return parts.map((part) => {
    const header = part.match(/^=== BLOCK: (.+) \((ios|android)\) ===\n?/);
    if (!header) throw new Error(`Malformed fixture block: ${part.slice(0, 40)}`);
    const body = part.slice(header[0].length);
    return { name: header[1]!, format: header[2] as 'ios' | 'android', text: body };
  });
}

describe('parseWhatsApp — line formats', () => {
  it('parses the iOS export format', () => {
    const text = [
      '[9/12/26, 8:14:05 PM] Maria: hey, you around this weekend?',
      "[9/12/26, 8:20:11 PM] You: yeah! what's up",
    ].join('\n');

    const events = parseWhatsApp(text, 'You', 'test-salt');

    expect(events).toHaveLength(2);
    expect(events[0]!.dir).toBe('in');
    expect(events[0]!.ts).toBe(new Date(2026, 8, 12, 20, 14, 5).toISOString());
    expect(events[1]!.dir).toBe('out');
    expect(events[0]!.app).toBe('whatsapp');
  });

  it('parses the Android export format', () => {
    const text = [
      '9/12/26, 8:14 PM - Maria: hey, you around this weekend?',
      "9/12/26, 8:20 PM - You: yeah! what's up",
    ].join('\n');

    const events = parseWhatsApp(text, 'You', 'test-salt');

    expect(events).toHaveLength(2);
    expect(events[0]!.ts).toBe(new Date(2026, 8, 12, 20, 14, 0).toISOString());
  });

  it('folds multi-line messages into the preceding message length', () => {
    const shortLineText = ['[9/12/26, 8:14:05 PM] Maria: hi', '9/12/26, 8:20 PM - You: hi'].join('\n');
    const events = parseWhatsApp(shortLineText, 'You', 'test-salt');
    expect(events[0]!.len).toBe(0); // "hi" < 20 chars

    const longMultiLine = [
      '[9/12/26, 8:14:05 PM] Maria: ' + 'a'.repeat(15),
      'b'.repeat(15), // continuation, pushes total past 20 (15 + 1 + 15 = 31)
      '9/12/26, 8:20 PM - You: hi',
    ].join('\n');
    const events2 = parseWhatsApp(longMultiLine, 'You', 'test-salt');
    expect(events2[0]!.len).toBe(1); // 31 chars -> bucket 1 (<100)
  });

  it('skips system messages with no sender', () => {
    const text = [
      '[9/12/26, 8:00:00 PM] Messages and calls are end-to-end encrypted.',
      '[9/12/26, 8:14:05 PM] Maria: hi',
      '9/12/26, 8:20 PM - You: hi',
    ].join('\n');

    const events = parseWhatsApp(text, 'You', 'test-salt');

    expect(events).toHaveLength(2);
  });
});

describe('bucketLength', () => {
  it('buckets at the documented boundaries', () => {
    expect(bucketLength(0)).toBe(0);
    expect(bucketLength(19)).toBe(0);
    expect(bucketLength(20)).toBe(1);
    expect(bucketLength(99)).toBe(1);
    expect(bucketLength(100)).toBe(2);
    expect(bucketLength(499)).toBe(2);
    expect(bucketLength(500)).toBe(3);
    expect(bucketLength(5000)).toBe(3);
  });
});

describe('parseWhatsApp — hashing and shape', () => {
  it('hashes the non-self participant and never leaks the raw name', () => {
    const text = ['[9/12/26, 8:14:05 PM] Maria: hey', '9/12/26, 8:20 PM - You: yo'].join('\n');

    const events = parseWhatsApp(text, 'You', 'test-salt');

    expect(events[0]!.contact).toBe(events[1]!.contact);
    expect(events[0]!.contact).not.toBe('Maria');
    expect(events[0]!.contact).not.toMatch(/maria/i);
    expect(events[0]!.contact).toMatch(/^[0-9a-f]{64}$/); // sha256 hex digest
  });

  it('produces a different hash for the same contact with a different salt', () => {
    const text = '[9/12/26, 8:14:05 PM] Maria: hey';
    const a = parseWhatsApp(text + '\n9/12/26, 8:20 PM - You: yo', 'You', 'salt-a');
    const b = parseWhatsApp(text + '\n9/12/26, 8:20 PM - You: yo', 'You', 'salt-b');
    expect(a[0]!.contact).not.toBe(b[0]!.contact);
  });

  it('rejects group chats (more than 2 participants)', () => {
    const text = [
      '[9/12/26, 8:14:05 PM] Maria: hey',
      '[9/12/26, 8:15:00 PM] Sam: hi all',
      '9/12/26, 8:20 PM - You: yo',
    ].join('\n');

    expect(() => parseWhatsApp(text, 'You', 'test-salt')).toThrow(UnsupportedChatError);
  });

  it('rejects a selfName that matches nobody in the export', () => {
    const text = '[9/12/26, 8:14:05 PM] Maria: hey';
    expect(() => parseWhatsApp(text, 'Nobody', 'test-salt')).toThrow(UnsupportedChatError);
  });
});

describe('parseWhatsApp — fixtures/whatsapp_sample.txt', () => {
  const blocks = loadFixtureBlocks();

  it('has 12 contact blocks covering both export formats', () => {
    expect(blocks).toHaveLength(12);
    expect(blocks.some((b) => b.format === 'ios')).toBe(true);
    expect(blocks.some((b) => b.format === 'android')).toBe(true);
  });

  it('parses every block as a valid 1:1 chat with a stable per-contact hash', () => {
    for (const block of blocks) {
      const events = parseWhatsApp(block.text, 'You', 'fixture-salt');
      expect(events.length).toBeGreaterThan(0);
      const contactIds = new Set(events.map((e) => e.contact));
      expect(contactIds.size).toBe(1); // one hash per block, consistent across all its messages
      expect(events.every((e) => e.dir === 'in' || e.dir === 'out')).toBe(true);
      // timestamps are non-decreasing within the export
      const timestamps = events.map((e) => new Date(e.ts).getTime());
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    }
  });

  it('assigns distinct contact hashes to distinct contacts', () => {
    const hashesByContact = blocks.map((b) => parseWhatsApp(b.text, 'You', 'fixture-salt')[0]!.contact);
    expect(new Set(hashesByContact).size).toBe(blocks.length);
  });
});
