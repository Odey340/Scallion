// Deterministic synthetic WhatsApp export fixture: 12 concatenated 1:1 chat
// blocks (see docs/contracts.md §6 and docs/lanes/B.md setup checklist),
// spanning a 90-day window, alternating iOS and Android export formats.
// Re-run with `npm run fixture:whatsapp` in social/ to regenerate.
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

const rand = mulberry32(42);

const SELF = 'You';
const CONTACTS = [
  { name: 'Maria', format: 'ios' },
  { name: 'Jordan', format: 'android' },
  { name: 'Priya', format: 'ios' },
  { name: 'Sam', format: 'android' },
  { name: 'Alex', format: 'ios' },
  { name: 'Devon', format: 'android' },
  { name: 'Lin', format: 'ios' },
  { name: 'Marcus', format: 'android' },
  { name: 'Aisha', format: 'ios' },
  { name: 'Noah', format: 'android' },
  { name: 'Sofia', format: 'ios' },
  { name: 'Theo', format: 'android' },
];

const WINDOW_DAYS = 90;
const NOW = new Date(2026, 8, 12, 20, 0, 0); // anchor "today": Sep 12 2026
const WINDOW_START_MS = NOW.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;

const SAMPLE_TEXTS = [
  'hey!',
  'you around?',
  'lol yeah',
  'sounds good',
  'see you then',
  'omw',
  'can we push to next week',
  'miss you, been forever',
  'happy birthday!!',
  'just checking in',
  'long time no talk',
  "let's catch up soon, it's been a while, how have you been doing lately",
];

function formatDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function formatTime(d, withSeconds) {
  let h = d.getHours();
  const meridiem = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (withSeconds) {
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${mm}:${ss} ${meridiem}`;
  }
  return `${h}:${mm} ${meridiem}`;
}

function randomText() {
  return SAMPLE_TEXTS[Math.floor(rand() * SAMPLE_TEXTS.length)];
}

function formatLine(format, sender, date, text) {
  if (format === 'ios') {
    return `[${formatDate(date)}, ${formatTime(date, true)}] ${sender}: ${text}`;
  }
  return `${formatDate(date)}, ${formatTime(date, false)} - ${sender}: ${text}`;
}

function genBlock(contact) {
  const lines = [`=== BLOCK: ${contact.name} (${contact.format}) ===`];
  const senders = new Set();
  const threadCount = 4 + Math.floor(rand() * 10); // 4..13 conversation bursts
  let t = WINDOW_START_MS;

  for (let i = 0; i < threadCount; i++) {
    t += (0.5 + rand() * 11.5) * 24 * 60 * 60 * 1000; // gap before next thread: 0.5-12 days
    if (t > NOW.getTime()) break;
    const starter = rand() < 0.5 ? SELF : contact.name;
    const messagesInThread = 1 + Math.floor(rand() * 5);

    for (let j = 0; j < messagesInThread; j++) {
      t += (1 + rand() * 90) * 60 * 1000; // 1-91 min between messages in-thread
      if (t > NOW.getTime()) break;
      const sender = j === 0 ? starter : rand() < 0.5 ? SELF : contact.name;
      senders.add(sender);
      lines.push(formatLine(contact.format, sender, new Date(t), randomText()));
    }
  }

  // Guarantee both participants appear at least once, so every block is a
  // valid 1:1 chat (parseWhatsApp requires exactly 2 distinct senders).
  for (const required of [SELF, contact.name]) {
    if (!senders.has(required)) {
      t += 60 * 1000;
      lines.push(formatLine(contact.format, required, new Date(Math.min(t, NOW.getTime())), randomText()));
    }
  }

  return lines.join('\n');
}

const out = CONTACTS.map(genBlock).join('\n\n') + '\n';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '..', '..', 'fixtures', 'whatsapp_sample.txt');
writeFileSync(outPath, out, 'utf8');
console.log(`Wrote ${outPath}`);
