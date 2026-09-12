import { bucketLength } from '../bucket';
import { hashContact } from '../hash';
import type { Event } from '../types';

export interface GmailHeader {
  name: string;
  value: string;
}

/** Shape of Gmail API's `messages.get?format=metadata` response. */
export interface GmailMetadataMessage {
  id: string;
  labelIds?: string[];
  internalDate: string; // ms since epoch, as a string
  sizeEstimate?: number; // total MIME message size in bytes — the only size signal available under gmail.metadata scope
  payload?: {
    headers?: GmailHeader[];
  };
}

function getHeader(msg: GmailMetadataMessage, name: string): string | undefined {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function extractEmail(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/);
  return (match ? match[1]! : headerValue).trim().toLowerCase();
}

function splitAddressList(headerValue: string): string[] {
  return headerValue
    .split(',')
    .map(extractEmail)
    .filter((addr) => addr.length > 0);
}

/**
 * Maps Gmail metadata-scope messages to anonymized Events. `From` decides
 * direction; outgoing messages fan out one Event per `To` recipient (each
 * is a real correspondence target). `Cc` is ignored — broadcast noise, not
 * a signal about who you're actually talking with.
 */
export function parseGmailHeaders(msgs: GmailMetadataMessage[], selfEmail: string, salt: string): Event[] {
  const self = selfEmail.trim().toLowerCase();
  const events: Event[] = [];

  for (const msg of msgs) {
    const fromHeader = getHeader(msg, 'From');
    if (!fromHeader || !msg.internalDate) continue;

    const from = extractEmail(fromHeader);
    const ts = new Date(Number(msg.internalDate)).toISOString();
    const len = bucketLength(msg.sizeEstimate ?? 0);

    if (from === self) {
      const toHeader = getHeader(msg, 'To');
      const recipients = toHeader ? splitAddressList(toHeader) : [];
      for (const to of recipients) {
        if (to === self) continue;
        events.push({ contact: hashContact(to, salt), ts, app: 'gmail', dir: 'out', len });
      }
    } else {
      events.push({ contact: hashContact(from, salt), ts, app: 'gmail', dir: 'in', len });
    }
  }

  return events;
}
