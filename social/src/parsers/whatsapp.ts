import { bucketLength } from '../bucket';
import { hashContact } from '../hash';
import type { Event } from '../types';

export { bucketLength };

// iOS export: [9/12/26, 8:14:05 PM] Name: text
const IOS_LINE = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}:\d{2}\s?[AP]M)\]\s(.*)$/i;
// Android export: 9/12/26, 8:14 PM - Name: text
const ANDROID_LINE = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}\s?[AP]M)\s-\s(.*)$/i;

export class UnsupportedChatError extends Error {}

interface RawMessage {
  sender: string;
  timestamp: Date;
  length: number;
}

function splitSenderAndText(rest: string): { sender: string; text: string } | null {
  const idx = rest.indexOf(': ');
  if (idx === -1) return null; // system message ("Messages are end-to-end encrypted..."), no sender
  return { sender: rest.slice(0, idx), text: rest.slice(idx + 2) };
}

function parseDate(dateStr: string, timeStr: string): Date {
  const parts = dateStr.split('/').map((s) => parseInt(s, 10));
  const month = parts[0]!;
  const day = parts[1]!;
  const yearRaw = parts[2]!;
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;

  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AP]M)/i);
  if (!timeMatch) throw new Error(`Unrecognized WhatsApp timestamp: "${timeStr}"`);
  let hour = parseInt(timeMatch[1]!, 10);
  const minute = parseInt(timeMatch[2]!, 10);
  const second = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
  const meridiem = timeMatch[4]!.toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  return new Date(year, month - 1, day, hour, minute, second);
}

function parseRawMessages(raw: string): RawMessage[] {
  const lines = raw.split(/\r?\n/);
  const messages: RawMessage[] = [];
  let current: { sender: string; timestamp: Date; textLength: number } | null = null;

  const flush = () => {
    if (current) {
      messages.push({ sender: current.sender, timestamp: current.timestamp, length: current.textLength });
      current = null;
    }
  };

  for (const line of lines) {
    const match = line.match(IOS_LINE) ?? line.match(ANDROID_LINE);

    if (match) {
      flush();
      const dateStr = match[1]!;
      const timeStr = match[2]!;
      const rest = match[3]!;
      const parsed = splitSenderAndText(rest);
      if (!parsed) continue; // system message, skip — current stays null
      current = {
        sender: parsed.sender,
        timestamp: parseDate(dateStr, timeStr),
        textLength: parsed.text.length,
      };
    } else if (current) {
      // continuation of a multi-line message
      current.textLength += 1 + line.length; // +1 for the newline that joined it
    }
  }
  flush();

  return messages;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Parses a single WhatsApp "Export chat > Without media" .txt file (iOS or
 * Android format) into anonymized Events. `text` must be one conversation
 * exported from WhatsApp — a real export is always one file per chat.
 *
 * Only 1:1 chats are supported: `selfName` must match one of exactly two
 * distinct senders found in `text`. Group exports (3+ senders) throw
 * UnsupportedChatError, since there's no well-defined single "contact" for
 * an outgoing message in a group — the pairwise metrics model (active ties,
 * reply latency mine/theirs) assumes one contact per relationship.
 */
export function parseWhatsApp(text: string, selfName: string, salt: string): Event[] {
  const rawMessages = parseRawMessages(text);
  const distinctSenders = new Set(rawMessages.map((m) => m.sender));
  const normalizedSelf = normalizeName(selfName);

  if (!Array.from(distinctSenders).some((s) => normalizeName(s) === normalizedSelf)) {
    throw new UnsupportedChatError(`"${selfName}" doesn't match any sender in this export.`);
  }
  if (distinctSenders.size !== 2) {
    throw new UnsupportedChatError(
      `Expected a 1:1 chat (2 participants), found ${distinctSenders.size}. Group chats aren't supported yet.`,
    );
  }

  const otherParticipant = Array.from(distinctSenders).find((s) => normalizeName(s) !== normalizedSelf)!;
  const contact = hashContact(otherParticipant, salt);

  return rawMessages.map((m) => ({
    contact,
    ts: m.timestamp.toISOString(),
    app: 'whatsapp',
    dir: normalizeName(m.sender) === normalizedSelf ? 'out' : 'in',
    len: bucketLength(m.length),
  }));
}
