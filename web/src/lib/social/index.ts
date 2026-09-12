/**
 * Vendored copy of social/src (Lane B), not a symlinked dependency. Vercel's CLI deploy only
 * uploads the directory you invoke it from (web/), so a sibling "file:../social" dependency
 * resolves locally but 404s/fails to install in production. This copy exists so the deployed
 * app actually has the source bytes. social/ remains the canonical package — Lane B's own tests
 * (social/src/**\/*.test.ts) run against that copy, not this one. Re-sync manually if social/
 * changes: bucket.ts, hash.ts, index.ts, strength.ts, types.ts, parsers/gmail.ts,
 * parsers/whatsapp.ts (tests excluded on purpose).
 */
export type { App, Event } from './types';
export { hashContact } from './hash';
export { bucketLength } from './bucket';
export { parseWhatsApp, UnsupportedChatError } from './parsers/whatsapp';
export { parseGmailHeaders } from './parsers/gmail';
export type { GmailHeader, GmailMetadataMessage } from './parsers/gmail';
export { contactStrengths } from './strength';
export type { ContactStrength, StrengthTier } from './strength';
