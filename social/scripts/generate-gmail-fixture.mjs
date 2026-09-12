// Deterministic synthetic Gmail messages.get(format=metadata) fixture — see
// docs/contracts.md §6 and docs/lanes/B.md. Self address: you@example.com.
// Re-run with `npm run fixture:gmail` in social/ to regenerate.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(7);

const SELF = 'you@example.com';
const CONTACTS = [
  'maria@example.com',
  'jordan@example.net',
  'priya@example.org',
  'sam@example.com',
  'alex@example.net',
  'devon@example.org',
  'lin@example.com',
  'marcus@example.net',
];

const WINDOW_DAYS = 90;
const NOW_MS = new Date(2026, 8, 12, 20, 0, 0).getTime();
const WINDOW_START_MS = NOW_MS - WINDOW_DAYS * 24 * 60 * 60 * 1000;

let nextId = 1;

function genThreadMessages(contact) {
  const messages = [];
  const threadCount = 3 + Math.floor(rand() * 8); // 3..10 threads
  let t = WINDOW_START_MS;

  for (let i = 0; i < threadCount; i++) {
    t += (0.5 + rand() * 12) * 24 * 60 * 60 * 1000;
    if (t > NOW_MS) break;
    const messagesInThread = 1 + Math.floor(rand() * 4);
    let outgoing = rand() < 0.5;

    for (let j = 0; j < messagesInThread; j++) {
      t += (2 + rand() * 180) * 60 * 1000;
      if (t > NOW_MS) break;
      const from = outgoing ? SELF : contact;
      const to = outgoing ? contact : SELF;
      messages.push({
        id: `msg-${nextId++}`,
        labelIds: [outgoing ? 'SENT' : 'INBOX'],
        internalDate: String(Math.round(t)),
        sizeEstimate: 800 + Math.floor(rand() * 6000),
        payload: {
          headers: [
            { name: 'From', value: from },
            { name: 'To', value: to },
            { name: 'Date', value: new Date(t).toUTCString() },
          ],
        },
      });
      outgoing = !outgoing; // reply flips direction most of the time
    }
  }

  return messages;
}

const allMessages = CONTACTS.flatMap(genThreadMessages).sort(
  (a, b) => Number(a.internalDate) - Number(b.internalDate),
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '..', '..', 'fixtures', 'gmail_metadata_sample.json');
writeFileSync(outPath, JSON.stringify(allMessages, null, 2) + '\n', 'utf8');
console.log(`Wrote ${outPath} (${allMessages.length} messages, self=${SELF})`);
