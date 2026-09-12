export type App = 'gmail' | 'whatsapp' | 'sms' | 'imessage' | 'notif';

/**
 * The only shape of message data that ever leaves the browser/device.
 * `contact` is a salted sha256 hash, never a raw name/number/email.
 * `len` is a bucket (see parsers/whatsapp.ts bucketLength), never a length
 * derived from stored text — text itself is never retained past parsing.
 */
export interface Event {
  contact: string;
  ts: string; // ISO
  app: App;
  dir: 'in' | 'out';
  len: 0 | 1 | 2 | 3; // <20, <100, <500, more chars
}
