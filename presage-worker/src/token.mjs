// Bearer tokens for POST /vitals. SCALLION_API_TOKEN may hold several tokens separated by commas
// (demo laptop: the shared demo account and the presenter's own account), so the reading lands on
// whichever account the phone is signed in to. Only the JWT payload is decoded, never verified;
// the API verifies. Nothing here sees the frames.

export function parseTokens(value) {
  return String(value ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

// {sub, exp} from a JWT payload, or null when the token is not a JWT.
export function tokenClaims(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const { sub, exp } = JSON.parse(json);
    return { sub: typeof sub === 'string' ? sub : null, exp: typeof exp === 'number' ? exp : null };
  } catch {
    return null;
  }
}

// One line per token for the terminal: who it posts as and whether it is still valid.
export function describeToken(token, now = Date.now()) {
  const c = tokenClaims(token);
  if (!c) return 'opaque token (not a JWT)';
  const who = c.sub ? `user ${c.sub.slice(0, 8)}…` : 'no sub';
  if (c.exp == null) return `${who}, no expiry`;
  const left = c.exp * 1000 - now;
  if (left <= 0) return `${who}, EXPIRED ${Math.round(-left / 3600e3)} h ago: re-mint it`;
  return `${who}, valid ${Math.round(left / 3600e3)} h`;
}
